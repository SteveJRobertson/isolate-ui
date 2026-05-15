import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import Database = require('better-sqlite3');
import { BaseCheckpointSaver } from '@langchain/langgraph';
import type { CheckpointTuple } from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AgentState } from '../schema';

/**
 * LangGraph-compatible checkpoint saver using SQLite.
 *
 * Implements BaseCheckpointSaver interface for seamless integration with LangGraph's
 * state persistence and resumption API.
 */
/**
 * Deserialize checkpoint_body BLOB to AgentState, handling legacy formats.
 * Used by getLatest() and other callers that need to inspect state without a full thread lookup.
 */
export function deserializeCheckpointBody(checkpointBodyJson: string): unknown {
  const checkpoint = JSON.parse(checkpointBodyJson) as Record<string, unknown>;
  // LangGraph v0.1 checkpoints use 'channel_values' not 'values'
  return checkpoint['channel_values'] ?? checkpoint['values'] ?? checkpoint;
}

export class LangGraphSqliteSaver extends (BaseCheckpointSaver as any) {
  private db: Database.Database;
  private stmtUpsert!: Database.Statement;
  private stmtGetLatest!: Database.Statement;
  private stmtGetById!: Database.Statement;
  private stmtGetAllByThread!: Database.Statement;
  private stmtGetWriteVersion!: Database.Statement;
  private txPutTuple!: (
    configurable: Record<string, any>,
    checkpoint: any,
    metadata: any,
  ) => void;

  constructor(dbPath: string) {
    super();

    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open/create database
    this.db = new Database(dbPath);
    this.db.pragma('foreign_keys = ON');
    // WAL mode allows concurrent readers alongside a single writer, avoiding
    // SQLITE_BUSY errors when the webhook-listener's openDb() connection is
    // active at the same time. busy_timeout gives writers a grace period
    // before giving up.
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.initSchema();
    this.prepareStatements();
  }

  /**
   * Initialize LangGraph checkpoint schema.
   * Handles both new database creation and migration of existing databases
   * (e.g., adding task_id column when not present).
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        checkpoint_body BLOB NOT NULL,
        metadata_body BLOB NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (thread_id, checkpoint_id)
      );

      CREATE TABLE IF NOT EXISTS checkpoint_writes (
        thread_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL DEFAULT 'default',
        channel TEXT NOT NULL,
        version INTEGER NOT NULL,
        data BLOB NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (thread_id, checkpoint_id, channel, version),
        FOREIGN KEY (thread_id, checkpoint_id) REFERENCES checkpoints(thread_id, checkpoint_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_checkpoints_thread ON checkpoints(thread_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_sequence ON checkpoints(thread_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_writes_thread ON checkpoint_writes(thread_id);
      CREATE INDEX IF NOT EXISTS idx_writes_version_lookup ON checkpoint_writes(thread_id, checkpoint_id, channel, version);
    `);

    // Migrate existing checkpoint_writes table: add task_id column if missing.
    // PRAGMA table_info returns empty result if table doesn't exist, so this is safe.
    try {
      const columns = this.db
        .prepare('PRAGMA table_info(checkpoint_writes)')
        .all() as Array<{ name: string }>;
      const hasTaskId = columns.some((col) => col.name === 'task_id');
      if (!hasTaskId) {
        this.db.exec(`
          ALTER TABLE checkpoint_writes
          ADD COLUMN task_id TEXT NOT NULL DEFAULT 'default';
        `);
      }
    } catch (err) {
      // Only swallow errors if table doesn't exist yet (expected during first initialization).
      // For other errors (e.g., locked DB, constraint violation), log a warning so
      // migration failures are surfaced rather than silently failing later.
      const errMsg = (err as Error).message || '';
      const isTableNotExist = errMsg.includes('no such table');
      const isDuplicateColumn = errMsg.includes('duplicate column');
      if (!isTableNotExist && !isDuplicateColumn) {
        console.warn(
          '[LangGraphSqliteSaver] schema migration may have failed:',
          errMsg,
        );
      }
    }
  }

  /**
   * Prepare SQL statements.
   */
  private prepareStatements(): void {
    this.stmtUpsert = this.db.prepare(`
      INSERT INTO checkpoints (thread_id, checkpoint_id, checkpoint_body, metadata_body, sequence)
      VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM checkpoints WHERE thread_id = ?))
      ON CONFLICT(thread_id, checkpoint_id) DO UPDATE SET
      checkpoint_body = excluded.checkpoint_body,
      metadata_body = excluded.metadata_body,
      sequence = excluded.sequence
    `);

    this.stmtGetLatest = this.db.prepare(`
      SELECT checkpoint_id, checkpoint_body, metadata_body
      FROM checkpoints
      WHERE thread_id = ?
      ORDER BY sequence DESC
      LIMIT 1
    `);

    this.stmtGetById = this.db.prepare(`
      SELECT checkpoint_id, checkpoint_body, metadata_body
      FROM checkpoints
      WHERE thread_id = ? AND checkpoint_id = ?
    `);

    this.stmtGetAllByThread = this.db.prepare(`
      SELECT checkpoint_id, checkpoint_body, metadata_body
      FROM checkpoints
      WHERE thread_id = ?
      ORDER BY sequence DESC
    `);

    this.stmtGetWriteVersion = this.db.prepare(`
      SELECT MAX(version) as max_version
      FROM checkpoint_writes
      WHERE thread_id = ? AND checkpoint_id = ? AND channel = ?
    `);

    // Transaction for atomic put operations
    this.txPutTuple = this.db.transaction(
      (configurable: Record<string, any>, checkpoint: any, metadata: any) => {
        const threadId = configurable['thread_id'] || 'default';
        const checkpointId = checkpoint.id || randomUUID();

        // Upsert checkpoint with auto-incrementing sequence
        this.stmtUpsert.run(
          threadId,
          checkpointId,
          JSON.stringify(checkpoint),
          JSON.stringify(metadata),
          threadId,
        );
      },
    );
  }

  /**
   * Get the latest checkpoint for a thread.
   * Implements LangGraph 1.3.0 BaseCheckpointSaver.getTuple().
   * Returns a CheckpointTuple object (not an array).
   */
  public async getTuple(
    config: RunnableConfig,
  ): Promise<CheckpointTuple | undefined> {
    const threadId = (config.configurable as any)?.['thread_id'] || 'default';
    const requestedCheckpointId = (config.configurable as any)?.[
      'checkpoint_id'
    ] as string | undefined;

    const row = requestedCheckpointId
      ? (this.stmtGetById.get(threadId, requestedCheckpointId) as any)
      : (this.stmtGetLatest.get(threadId) as any);

    if (!row) {
      return undefined;
    }

    // Load pending writes — each stored as [task_id, channel, value]
    const writesRows = this.db
      .prepare(
        `SELECT task_id, channel, data FROM checkpoint_writes
         WHERE thread_id = ? AND checkpoint_id = ?
         ORDER BY version ASC`,
      )
      .all(threadId, row.checkpoint_id) as any[];

    const pendingWrites: [string, string, unknown][] = writesRows.map(
      (w: any) => [w.task_id, w.channel, JSON.parse(w.data)],
    );

    const tupleConfig: RunnableConfig = {
      configurable: { thread_id: threadId, checkpoint_id: row.checkpoint_id },
    };

    return {
      config: tupleConfig,
      checkpoint: JSON.parse(row.checkpoint_body),
      metadata: JSON.parse(row.metadata_body),
      pendingWrites,
    };
  }

  /**
   * Save a checkpoint.
   * Implements LangGraph 1.3.0 BaseCheckpointSaver.put().
   * Returns the RunnableConfig for the saved checkpoint.
   */
  public async put(
    config: RunnableConfig,
    checkpoint: any,
    metadata: any,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _newVersions?: Record<string, unknown>,
  ): Promise<RunnableConfig> {
    const configurable = config.configurable || {};
    const threadId = (configurable as any)['thread_id'] || 'default';
    // CRITICAL: Compute checkpointId once and assign to checkpoint so txPutTuple
    // uses the same ID for both storage and return value.
    // If checkpoint.id is falsy, generate a UUID and use it consistently.
    const checkpointId = checkpoint.id || randomUUID();
    // Assign back to checkpoint so txPutTuple's internal computation uses the same ID
    checkpoint.id = checkpointId;
    this.txPutTuple(configurable, checkpoint, metadata);
    return {
      configurable: { thread_id: threadId, checkpoint_id: checkpointId },
    };
  }

  /**
   * Save writes (channel updates) to a checkpoint.
   * Implements LangGraph 1.3.0 BaseCheckpointSaver.putWrites().
   * Third argument is taskId (not checkpointId) per the 1.3.0 interface.
   */
  public async putWrites(
    config: RunnableConfig,
    writes: Array<[string, unknown]>,
    taskId: string,
  ): Promise<void> {
    const threadId = (config.configurable as any)?.['thread_id'] || 'default';
    const checkpointId = (config.configurable as any)?.['checkpoint_id'];

    // checkpoint_id is required — do not default to 'default'.
    // If missing, it indicates an upstream error (put() should have returned it).
    // Requiring it here prevents silent corruption if called with incomplete config.
    if (!checkpointId) {
      throw new Error(
        '[LangGraphSqliteSaver.putWrites] checkpoint_id is required in config.configurable. ' +
          'Did you call put() first to get the checkpoint_id?',
      );
    }

    // Ensure checkpoint exists before inserting writes
    const existing = this.db
      .prepare(
        'SELECT 1 FROM checkpoints WHERE thread_id = ? AND checkpoint_id = ?',
      )
      .get(threadId, checkpointId);

    if (!existing) {
      // Create a minimal checkpoint if it doesn't exist
      this.db
        .prepare(
          `INSERT OR IGNORE INTO checkpoints (thread_id, checkpoint_id, checkpoint_body, metadata_body)
           VALUES (?, ?, ?, ?)`,
        )
        .run(threadId, checkpointId, '{}', '{}');
    }

    // Wrap version lookup and insert in transaction to prevent race conditions
    this.db.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT INTO checkpoint_writes (thread_id, checkpoint_id, task_id, channel, version, data)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const [channel, data] of writes) {
        const versionRow = this.stmtGetWriteVersion.get(
          threadId,
          checkpointId,
          channel,
        ) as any;
        const version = (versionRow?.max_version ?? 0) + 1;

        // Insert a new versioned write record for this channel.
        // The incremented version preserves prior writes rather than replacing them.
        stmt.run(
          threadId,
          checkpointId,
          taskId,
          channel,
          version,
          JSON.stringify(data),
        );
      }
    })();
  }

  /**
   * List all checkpoints for a thread.
   * Implements LangGraph 1.3.0 BaseCheckpointSaver.list().
   */
  public async *list(config: RunnableConfig): AsyncGenerator<CheckpointTuple> {
    const threadId = (config.configurable as any)?.['thread_id'] || 'default';
    const rows = this.stmtGetAllByThread.all(threadId) as any[];

    for (const row of rows) {
      const tupleConfig: RunnableConfig = {
        configurable: { thread_id: threadId, checkpoint_id: row.checkpoint_id },
      };
      yield {
        config: tupleConfig,
        checkpoint: JSON.parse(row.checkpoint_body),
        metadata: JSON.parse(row.metadata_body),
        pendingWrites: [],
      };
    }
  }

  /**
   * Get a checkpoint by thread ID (convenience method for debugging/inspection).
   */
  public getLatest(threadId: string): AgentState | null {
    const row = this.stmtGetLatest.get(threadId) as any;
    if (!row) return null;
    const state = deserializeCheckpointBody(row.checkpoint_body);
    return state as AgentState;
  }

  /**
   * Close the database connection.
   */
  public close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}
