import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { initializeSchema } from '../utils/configurationSchema'

/**
 * Open the local SQLite database and install the configuration safety guards.
 * The caller must close the connection when finished.
 * @returns An open connection to the local database.
 */
export function openDatabase() {
  const directory = path.resolve(process.cwd(), 'data')
  mkdirSync(directory, { recursive: true })
  const database = new DatabaseSync(path.join(directory, 'knit.sqlite'))
  try {
    initializeSchema(database)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}
