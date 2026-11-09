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
