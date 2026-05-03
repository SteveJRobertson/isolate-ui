import * as fs from 'fs';
import * as path from 'path';
// @ts-expect-error - better-sqlite3 type definitions will be added
import Database from 'better-sqlite3';
import { AgentState, AgentStateSchema } from '../schema';

/**
 * SQLite-backed checkpointer for persisting agent state.
 *
 * Enables thread-based resumption via GitHub Issue IDs.
 * State is versioned and can be replayed from any checkpoint.
 */
export class SqliteSaver {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open/create database
    this.db = new Database(dbPath);
    this.initSchema();
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
        FOREIGN KEY(thread_id) REFERENCES checkpoints(thread_id)
      );

      CREATE INDEX IF NOT EXISTS idx_thread_id ON checkpoints(thread_id);
      CREATE INDEX IF NOT EXISTS idx_history_thread ON checkpoint_history(thread_id);
      CREATE INDEX IF NOT EXISTS idx_history_step ON checkpoint_history(step_number);
    `);
  }

  /**
   * Save or update state for a thread.
   * @param threadId - GitHub Issue ID or unique thread identifier
   * @param state - Current agent state
   * @param agentId - (optional) ID of the agent that produced this state
   */
  public save(threadId: string, state: AgentState, agentId?: string): void {
    // Validate state
    const validatedState = AgentStateSchema.parse(state);
    const stateJson = JSON.stringify(validatedState);

    // Get current step count
    const current = this.get(threadId);
    const stepCount = current ? current.step_count + 1 : 0;

    try {
      // Update or insert checkpoint
      const stmt = this.db.prepare(`
        INSERT INTO checkpoints (thread_id, state, step_count, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(thread_id) DO UPDATE SET
          state = excluded.state,
          step_count = excluded.step_count,
          updated_at = CURRENT_TIMESTAMP
      `);
      stmt.run(threadId, stateJson, stepCount);

      // Record in history
      const historyStmt = this.db.prepare(`
        INSERT INTO checkpoint_history (thread_id, step_number, state, agent_id)
        VALUES (?, ?, ?, ?)
      `);
      historyStmt.run(threadId, stepCount, stateJson, agentId || null);
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
      const stmt = this.db.prepare(
        'SELECT state, step_count FROM checkpoints WHERE thread_id = ?',
      );
      const row = stmt.get(threadId) as
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
   * @param stepNumber - Step number (0-indexed)
   */
  public getAtStep(threadId: string, stepNumber: number): AgentState | null {
    try {
      const stmt = this.db.prepare(
        `SELECT state FROM checkpoint_history
         WHERE thread_id = ? AND step_number = ?`,
      );
      const row = stmt.get(threadId, stepNumber) as
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
      const stmt = this.db.prepare(
        `SELECT step_number, agent_id, state FROM checkpoint_history
         WHERE thread_id = ?
         ORDER BY step_number ASC`,
      );
      const rows = stmt.all(threadId) as Array<{
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
      const stmt = this.db.prepare(
        'SELECT thread_id FROM checkpoints ORDER BY updated_at DESC',
      );
      const rows = stmt.all() as Array<{ thread_id: string }>;
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
      this.db
        .prepare('DELETE FROM checkpoint_history WHERE thread_id = ?')
        .run(threadId);
      this.db
        .prepare('DELETE FROM checkpoints WHERE thread_id = ?')
        .run(threadId);
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
