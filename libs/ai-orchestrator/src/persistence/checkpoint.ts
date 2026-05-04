import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');
import { AgentState, AgentStateSchema } from '../schema';

/**
 * SQLite-backed checkpointer for persisting agent state.
 *
 * Enables thread-based resumption via GitHub Issue IDs.
 * State is versioned and can be replayed from any checkpoint.
 */
export class SqliteSaver {
  private db: Database.Database;

  // Prepared statements — initialised once after schema setup for reuse across calls.
  // Preparing on every save() call adds unnecessary overhead in long-running orchestrations.
  private stmtUpsert!: Database.Statement;
  private stmtInsertHistory!: Database.Statement;
  private stmtGetCheckpoint!: Database.Statement;
  private stmtGetAtStep!: Database.Statement;
  private stmtGetHistory!: Database.Statement;
  private stmtListThreads!: Database.Statement;
  private stmtDeleteHistory!: Database.Statement;
  private stmtDeleteCheckpoint!: Database.Statement;
  private stmtGetStepCount!: Database.Statement;
  // Transaction wrapping upsert + history insert so both are always in sync
  private txSave!: (
    threadId: string,
    stateJson: string,
    stepCount: number,
    agentId: string | null,
  ) => void;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open/create database
    this.db = new Database(dbPath);
    // Enforce referential integrity — SQLite disables FK checks by default
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
    this.prepareStatements();
  }

  /**
   * Initialize database schema if not exists.
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL,
        step_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS checkpoint_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        step_number INTEGER NOT NULL,
        state TEXT NOT NULL,
        agent_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(thread_id) REFERENCES checkpoints(thread_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_thread_id ON checkpoints(thread_id);
      CREATE INDEX IF NOT EXISTS idx_history_thread ON checkpoint_history(thread_id);
      CREATE INDEX IF NOT EXISTS idx_history_thread_step ON checkpoint_history(thread_id, step_number);
    `);
  }

  /**
   * Prepare all SQL statements once for reuse across calls.
   * better-sqlite3 prepared statements are safe to reuse on the same synchronous connection.
   */
  private prepareStatements(): void {
    this.stmtUpsert = this.db.prepare(`
      INSERT INTO checkpoints (thread_id, state, step_count, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(thread_id) DO UPDATE SET
        state = excluded.state,
        step_count = excluded.step_count,
        updated_at = CURRENT_TIMESTAMP
    `);
    this.stmtInsertHistory = this.db.prepare(`
      INSERT INTO checkpoint_history (thread_id, step_number, state, agent_id)
      VALUES (?, ?, ?, ?)
    `);
    this.stmtGetCheckpoint = this.db.prepare(
      'SELECT state, step_count FROM checkpoints WHERE thread_id = ?',
    );
    this.stmtGetAtStep = this.db.prepare(
      `SELECT state FROM checkpoint_history
       WHERE thread_id = ? AND step_number = ?`,
    );
    this.stmtGetHistory = this.db.prepare(
      `SELECT step_number, agent_id, state FROM checkpoint_history
       WHERE thread_id = ?
       ORDER BY step_number ASC`,
    );
    this.stmtListThreads = this.db.prepare(
      'SELECT thread_id FROM checkpoints ORDER BY updated_at DESC',
    );
    this.stmtDeleteHistory = this.db.prepare(
      'DELETE FROM checkpoint_history WHERE thread_id = ?',
    );
    this.stmtDeleteCheckpoint = this.db.prepare(
      'DELETE FROM checkpoints WHERE thread_id = ?',
    );
    this.stmtGetStepCount = this.db.prepare(
      'SELECT step_count FROM checkpoints WHERE thread_id = ?',
    );
    const upsert = this.stmtUpsert;
    const insertHistory = this.stmtInsertHistory;
    this.txSave = this.db.transaction(
      (
        threadId: string,
        stateJson: string,
        stepCount: number,
        agentId: string | null,
      ) => {
        upsert.run(threadId, stateJson, stepCount);
        insertHistory.run(threadId, stepCount, stateJson, agentId);
      },
    );
  }

  /**
   * Save or update state for a thread.
   * @param threadId - GitHub Issue ID or unique thread identifier
   * @param state - Current agent state
   * @param agentId - (optional) ID of the agent that produced this state
   */
  public save(threadId: string, state: AgentState, agentId?: string): void {
    try {
      // Validate and serialize inside the try/catch so any failure (including
      // JSON.stringify errors on circular metadata) surfaces with thread context.
      const validatedState = AgentStateSchema.parse(state);
      const stateJson = JSON.stringify(validatedState);

      // Get current step count (1-indexed: first save = 1, second save = 2, …)
      // Query only step_count to avoid re-parsing the full JSON state on every save.
      const row = this.stmtGetStepCount.get(threadId) as
        | { step_count: number }
        | undefined;
      const stepCount = row ? row.step_count + 1 : 1;

      this.txSave(threadId, stateJson, stepCount, agentId ?? null);
    } catch (error) {
      throw new Error(
        `Failed to save checkpoint for thread ${threadId}: ${error}`,
      );
    }
  }

  /**
   * Get the latest state for a thread.
   * @param threadId - Thread identifier
   * @returns Latest state or null if not found
   */
  public get(threadId: string): (AgentState & { step_count: number }) | null {
    try {
      const row = this.stmtGetCheckpoint.get(threadId) as
        | { state: string; step_count: number }
        | undefined;

      if (!row) {
        return null;
      }

      const parsed = JSON.parse(row.state);
      const validatedState = AgentStateSchema.parse(parsed);
      return { ...validatedState, step_count: row.step_count };
    } catch (error) {
      throw new Error(
        `Failed to retrieve checkpoint for thread ${threadId}: ${error}`,
      );
    }
  }

  /**
   * Get state at a specific step in the history.
   * @param threadId - Thread identifier
   * @param stepNumber - Step number (1-indexed; the first saved checkpoint is step 1)
   */
  public getAtStep(threadId: string, stepNumber: number): AgentState | null {
    try {
      const row = this.stmtGetAtStep.get(threadId, stepNumber) as
        | { state: string }
        | undefined;

      if (!row) {
        return null;
      }

      const parsed = JSON.parse(row.state);
      return AgentStateSchema.parse(parsed);
    } catch (error) {
      throw new Error(
        `Failed to retrieve checkpoint at step ${stepNumber} for thread ${threadId}: ${error}`,
      );
    }
  }

  /**
   * Get all states in history for a thread (for replay/debugging).
   */
  public getHistory(threadId: string): Array<{
    step_number: number;
    agent_id: string | null;
    state: AgentState;
  }> {
    try {
      const rows = this.stmtGetHistory.all(threadId) as Array<{
        step_number: number;
        agent_id: string | null;
        state: string;
      }>;

      return rows.map((row) => ({
        step_number: row.step_number,
        agent_id: row.agent_id,
        state: AgentStateSchema.parse(JSON.parse(row.state)),
      }));
    } catch (error) {
      throw new Error(
        `Failed to retrieve history for thread ${threadId}: ${error}`,
      );
    }
  }

  /**
   * List all thread IDs.
   */
  public listThreads(): string[] {
    try {
      const rows = this.stmtListThreads.all() as Array<{ thread_id: string }>;
      return rows.map((row) => row.thread_id);
    } catch (error) {
      throw new Error(`Failed to list threads: ${error}`);
    }
  }

  /**
   * Delete a thread and all its history.
   */
  public deleteThread(threadId: string): void {
    try {
      const deleteThreadTransaction = this.db.transaction((id: string) => {
        this.stmtDeleteHistory.run(id);
        this.stmtDeleteCheckpoint.run(id);
      });
      deleteThreadTransaction(threadId);
    } catch (error) {
      throw new Error(`Failed to delete thread ${threadId}: ${error}`);
    }
  }

  /**
   * Close the database connection.
   */
  public close(): void {
    this.db.close();
  }
}
