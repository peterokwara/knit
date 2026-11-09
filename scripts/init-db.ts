import { openDatabase } from '../src/server/db/connection'

const database = openDatabase()
try {
  const row = database.prepare('SELECT sqlite_version() AS version').get()
  console.log(`SQLite ${String(row?.version)} is ready at data/knit.sqlite`)
} finally {
  database.close()
}
