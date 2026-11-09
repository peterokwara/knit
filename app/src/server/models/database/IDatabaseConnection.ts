import type { IDatabaseStatement } from './IDatabaseStatement'

/**
 * The database operations required by the SQLite-backed services.
 */
export interface IDatabaseConnection {
  /**
   * Execute SQL that does not return rows.
   * @param sql The SQL to execute.
   */
  exec(sql: string): void

  /**
   * Prepare a statement for execution with bound values.
   * @param sql The SQL statement to prepare.
   * @returns The prepared statement.
   */
  prepare(sql: string): IDatabaseStatement

  /**
   * Close the connection when its owner has finished using it.
   */
  close(): void
}
