import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import Database = require('better-sqlite3');
import { BaseCheckpointSaver } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AgentState } from '../schema';

/**
 * LangGraph-compatible checkpoint saver using SQLite.
 *
 * Implements BaseCheckpointSaver interface for seamless integration with LangGraph's
 * state persistence and resumption API.
 */
export class LangGraphSqliteSaver extends (BaseCheckpointSaver as any) {
  private db: Database.Database;
  private stmtUpsert!: Database.Statement;
  private stmtGetLatest!: Database.Statement;
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
    this.initSchema();
    this.prepareStatements();
  }

  /**
   * Initialize LangGraph checkpoint schema.
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
   * Implements LangGraph's BaseCheckpointSaver.getTuple().
   * Loads persisted channel writes to support resumption/replay semantics.
   */
  public async getTuple(
    config: RunnableConfig,
  ): Promise<[checkpoint: any, metadata: any, writes: any[]] | null> {
    const threadId = (config.configurable as any)?.['thread_id'] || 'default';
    const row = this.stmtGetLatest.get(threadId) as any;

    if (!row) {
      return null;
    }

    // Load channel writes for proper checkpoint restore semantics
    const writesRows = this.db
      .prepare(
        `SELECT channel, version, data FROM checkpoint_writes
         WHERE thread_id = ? AND checkpoint_id = ?
         ORDER BY version DESC`,
      )
      .all(threadId, row.checkpoint_id) as any[];

    const writes = writesRows.map((w: any) => [w.channel, JSON.parse(w.data)]);

    return [
      JSON.parse(row.checkpoint_body),
      JSON.parse(row.metadata_body),
      writes,
    ];
  }

  /**
   * Save a checkpoint.
   * Implements LangGraph's BaseCheckpointSaver.put().
   */
  public async put(
    config: RunnableConfig,
    checkpoint: any,
    metadata: any,
  ): Promise<void> {
    this.txPutTuple(config.configurable || {}, checkpoint, metadata);
  }

  /**
   * Save writes (channel updates) to a checkpoint.
   * Implements LangGraph's BaseCheckpointSaver.putWrites().
   */
  public async putWrites(
    config: RunnableConfig,
    writes: Array<[string, any]>,
    checkpointId: string,
  ): Promise<void> {
    const threadId = (config.configurable as any)?.['thread_id'] || 'default';

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
        INSERT INTO checkpoint_writes (thread_id, checkpoint_id, channel, version, data)
        VALUES (?, ?, ?, ?, ?)
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
          channel,
          version,
          JSON.stringify(data),
        );
      }
    })();
  }

  /**
   * Get a checkpoint by thread ID (convenience method for debugging/inspection).
   */
  public getLatest(threadId: string): AgentState | null {
    const row = this.stmtGetLatest.get(threadId) as any;
    if (!row) return null;

    const checkpoint = JSON.parse(row.checkpoint_body);
    // LangGraph v0.1 checkpoints use 'channel_values' not 'values'
    const state = checkpoint.channel_values || checkpoint.values || checkpoint;
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
