import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import type { IDatabaseRow } from "../models/database/IDatabaseRow";
import { initializeSchema } from "./configurationSchema";

/** Own SQLite connection setup and the common database operations. */
export class SqliteHelper {
  /**
   * Open the school's local SQLite database and verify its protected schema.
   * @param filename - Database filename, or an in-memory SQLite name.
   * @returns The initialized SQLite connection.
   */
  static openConnection(
    filename = path.resolve(process.cwd(), "data", "knit.sqlite"),
  ): DatabaseSync {
    if (filename !== ":memory:")
      mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    const database = new DatabaseSync(filename);
    try {
      initializeSchema(database, () => new DatabaseSync(":memory:"));
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  /**
   * Close a connection after its owner finishes database work.
   * @param database - The connection to close.
   */
  static closeConnection(database: DatabaseSync): void {
    database.close();
  }

  /**
   * Read all rows returned by a query.
   * @param database - The connection to query.
   * @param sql - The SQL query.
   * @param values - Values bound to SQL placeholders.
   * @returns The query result rows.
   */
  static query(
    database: DatabaseSync,
    sql: string,
    ...values: SQLInputValue[]
  ): IDatabaseRow[] {
    return database.prepare(sql).all(...values);
  }

  /**
   * Read the first row returned by a query.
   * @param database - The connection to query.
   * @param sql - The SQL query.
   * @param values - Values bound to SQL placeholders.
   * @returns The first row, or undefined when no row matches.
   */
  static queryOne(
    database: DatabaseSync,
    sql: string,
    ...values: SQLInputValue[]
  ): IDatabaseRow | undefined {
    return database.prepare(sql).get(...values);
  }

  /**
   * Execute a write statement.
   * @param database - The connection to update.
   * @param sql - The SQL statement.
   * @param values - Values bound to SQL placeholders.
   */
  static execute(
    database: DatabaseSync,
    sql: string,
    ...values: SQLInputValue[]
  ): void {
    database.prepare(sql).run(...values);
  }

  /**
   * Commit the action atomically, rolling it back when the action fails.
   * @param database - The connection for the transaction.
   * @param action - Database work to run in the transaction.
   * @returns The action result.
   */
  static inTransaction<T>(database: DatabaseSync, action: () => T): T {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
