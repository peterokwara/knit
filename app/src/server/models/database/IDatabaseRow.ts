/**
 * A value returned by the database for a single column.
 */
export type DatabaseValue = null | number | bigint | string | Uint8Array;

/**
 * A database result row indexed by column name.
 */
export interface IDatabaseRow {
  /**
   * The value returned for a column.
   */
  [column: string]: DatabaseValue;
}
