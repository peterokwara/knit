import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { initializeSchema } from '../src/server/utils/configurationSchema'

const createReference = () => new DatabaseSync(':memory:')

void describe('payment ingestion schema', () => {
  void it('upgrades a configuration-only database without replacing its existing data', () => {
    const database = new DatabaseSync(':memory:')
    initializeSchema(database, createReference)
    database.exec(`
      INSERT INTO school_configuration_versions
        (school_id, version, effective_at_ms, configuration_json, created_by, change_reason)
        VALUES ('sch_migration', 1, 0, '{}', 'test', 'migration check');
      DROP TABLE payment_ingestion_observations;
      DROP TABLE payment_ingestion_events;
      PRAGMA user_version = 1;
    `)

    try {
      initializeSchema(database, createReference)

      assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, 2)
      assert.equal(database.prepare('SELECT school_id FROM school_configuration_versions WHERE school_id = ?').get('sch_migration')?.school_id, 'sch_migration')
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'payment_ingestion_events'").get()?.count, 1)
    } finally {
      database.close()
    }
  })
})
