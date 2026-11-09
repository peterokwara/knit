import type { IDatabaseConnection } from '../models/database/IDatabaseConnection'
import type { IDatabaseRow } from '../models/database/IDatabaseRow'

/**
 * Read a required text column from a SQLite row.
 * @param row - Result row from SQLite.
 * @param column - Column name to read.
 * @returns The column's text value.
 */
export function readText(row: IDatabaseRow, column: string): string {
  const value = row[column]
  if (typeof value !== 'string') throw new Error(`Invalid database column ${column}`)
  return value
}

/**
 * Read a required integer column from a SQLite row.
 * @param row - Result row from SQLite.
 * @param column - Column name to read.
 * @returns The column's safe integer value.
 */
export function readInteger(row: IDatabaseRow, column: string): number {
  const value = row[column]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Invalid database column ${column}`)
  return value
}

/**
 * Execute a synchronous write as one SQLite transaction.
 * @param database - Connection used for the transaction.
 * @param action - Operations to commit together.
 * @returns The value returned by the action.
 */
export function inTransaction<T>(database: IDatabaseConnection, action: () => T): T {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
