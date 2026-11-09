import { SqliteHelper } from "../src/server/utils/sqliteHelper";

const database = SqliteHelper.openConnection();
try {
  const row = SqliteHelper.queryOne(
    database,
    "SELECT sqlite_version() AS version",
  );
  console.log(`SQLite ${String(row?.version)} is ready at data/knit.sqlite`);
} finally {
  SqliteHelper.closeConnection(database);
}
