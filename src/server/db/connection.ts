import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// This module belongs on the server: SQLite and the filesystem are not available in the browser.
export function openDatabase() {
  const directory = path.resolve(process.cwd(), 'data')
  mkdirSync(directory, { recursive: true })
  const database = new DatabaseSync(path.join(directory, 'knit.sqlite'))
  database.exec('PRAGMA foreign_keys = ON')
  return database
}
