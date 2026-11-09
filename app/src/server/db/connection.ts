import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Open the local SQLite database with foreign-key enforcement enabled.
 * The caller must close the connection when finished.
 * @returns An open connection to the local database.
 */
export function openDatabase() {
  const directory = path.resolve(process.cwd(), 'data')
  mkdirSync(directory, { recursive: true })
  const database = new DatabaseSync(path.join(directory, 'knit.sqlite'))
  database.exec('PRAGMA foreign_keys = ON')
  return database
}
