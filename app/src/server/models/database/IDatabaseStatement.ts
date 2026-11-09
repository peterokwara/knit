import type { IDatabaseRow } from './IDatabaseRow'

/**
 * A prepared statement used by the database services.
 */
export interface IDatabaseStatement {
  /**
   * Execute a statement that does not return rows.
   * @param values The values bound to the statement's placeholders.
   */
  run(...values: (string | number)[]): void

  /**
   * Read one row from the statement.
   * @param values The values bound to the statement's placeholders.
   * @returns The first row, or undefined when there is no result.
   */
  get(...values: (string | number)[]): IDatabaseRow | undefined

  /**
   * Read every row from the statement.
   * @param values The values bound to the statement's placeholders.
   * @returns The resulting rows.
   */
  all(...values: (string | number)[]): IDatabaseRow[]
}
