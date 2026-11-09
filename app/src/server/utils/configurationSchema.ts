import type { DatabaseSync } from 'node:sqlite'

/**
 * Create append-only configuration and allocation-evidence tables and guards.
 * @param database - The SQLite connection to initialize before writing data.
 * @param createReference - Creates a temporary database for schema comparison.
 */
export function initializeSchema(database: DatabaseSync, createReference: () => DatabaseSync): void {
  const schema = `
    PRAGMA foreign_keys = ON;
    PRAGMA recursive_triggers = ON;

    CREATE TABLE IF NOT EXISTS school_configuration_versions (
      school_id TEXT NOT NULL CHECK(length(trim(school_id)) > 0),
      version INTEGER NOT NULL CHECK(version > 0),
      effective_at_ms INTEGER NOT NULL,
      configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json) AND json_type(configuration_json) = 'object'),
      created_by TEXT NOT NULL CHECK(length(trim(created_by)) > 0),
      change_reason TEXT NOT NULL CHECK(length(trim(change_reason)) > 0),
      change_id TEXT,
      PRIMARY KEY (school_id, version),
      UNIQUE (school_id, effective_at_ms),
      FOREIGN KEY (change_id) REFERENCES school_configuration_changes(change_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS school_configuration_changes (
      change_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(change_id)) > 0),
      school_id TEXT NOT NULL,
      expected_version INTEGER NOT NULL,
      effective_at_ms INTEGER NOT NULL,
      requested_by TEXT NOT NULL CHECK(length(trim(requested_by)) > 0),
      approved_by TEXT NOT NULL CHECK(length(trim(approved_by)) > 0),
      reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
      category_priority_json TEXT NOT NULL CHECK(json_valid(category_priority_json) AND json_type(category_priority_json) = 'array'),
      FOREIGN KEY (school_id, expected_version) REFERENCES school_configuration_versions(school_id, version)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS allocation_evidence (
      id TEXT PRIMARY KEY NOT NULL,
      school_id TEXT NOT NULL,
      payment_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      source TEXT NOT NULL,
      amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
      effective_at_ms INTEGER NOT NULL,
      policy_version INTEGER NOT NULL,
      UNIQUE (school_id, payment_id, invoice_id),
      FOREIGN KEY (school_id, policy_version) REFERENCES school_configuration_versions(school_id, version)
    ) STRICT;

    CREATE TRIGGER IF NOT EXISTS school_configuration_versions_insert_guard
    BEFORE INSERT ON school_configuration_versions BEGIN
      SELECT RAISE(ABORT, 'configuration version already exists')
        WHERE EXISTS (SELECT 1 FROM school_configuration_versions WHERE school_id = NEW.school_id AND (version = NEW.version OR effective_at_ms = NEW.effective_at_ms));
      SELECT RAISE(ABORT, 'initial configuration must be version 1')
        WHERE NOT EXISTS (SELECT 1 FROM school_configuration_versions WHERE school_id = NEW.school_id)
          AND (NEW.version != 1 OR NEW.change_id IS NOT NULL);
      SELECT RAISE(ABORT, 'new configuration requires a matching approved change')
        WHERE EXISTS (SELECT 1 FROM school_configuration_versions WHERE school_id = NEW.school_id)
          AND NOT EXISTS (
            SELECT 1 FROM school_configuration_versions previous
            JOIN school_configuration_changes change ON change.change_id = NEW.change_id
            WHERE previous.school_id = NEW.school_id
              AND previous.version = NEW.version - 1
              AND previous.version = (SELECT MAX(version) FROM school_configuration_versions WHERE school_id = NEW.school_id)
              AND NEW.effective_at_ms > previous.effective_at_ms
              AND change.school_id = NEW.school_id AND change.expected_version = previous.version
              AND change.effective_at_ms = NEW.effective_at_ms AND change.approved_by = NEW.created_by
              AND change.reason = NEW.change_reason
              AND json(NEW.configuration_json) = json(json_set(previous.configuration_json, '$.allocation.category_priority', json(change.category_priority_json)))
          );
      SELECT RAISE(ABORT, 'change would affect existing allocation evidence')
        WHERE NEW.version > 1 AND EXISTS (
          SELECT 1 FROM allocation_evidence WHERE school_id = NEW.school_id AND effective_at_ms >= NEW.effective_at_ms
        );
    END;

    CREATE TRIGGER IF NOT EXISTS school_configuration_versions_no_update
    BEFORE UPDATE ON school_configuration_versions BEGIN SELECT RAISE(ABORT, 'configuration versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS school_configuration_versions_no_delete
    BEFORE DELETE ON school_configuration_versions BEGIN SELECT RAISE(ABORT, 'configuration versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS school_configuration_changes_no_update
    BEFORE UPDATE ON school_configuration_changes BEGIN SELECT RAISE(ABORT, 'approved changes are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS school_configuration_changes_no_delete
    BEFORE DELETE ON school_configuration_changes BEGIN SELECT RAISE(ABORT, 'approved changes are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS school_configuration_changes_no_replace
    BEFORE INSERT ON school_configuration_changes WHEN EXISTS (SELECT 1 FROM school_configuration_changes WHERE change_id = NEW.change_id)
    BEGIN SELECT RAISE(ABORT, 'approved change already exists'); END;

    CREATE TRIGGER IF NOT EXISTS allocation_evidence_insert_guard
    BEFORE INSERT ON allocation_evidence BEGIN
      SELECT RAISE(ABORT, 'allocation already exists') WHERE EXISTS (
        SELECT 1 FROM allocation_evidence WHERE id = NEW.id OR (school_id = NEW.school_id AND payment_id = NEW.payment_id AND invoice_id = NEW.invoice_id)
      );
      SELECT RAISE(ABORT, 'allocation policy version is not effective') WHERE NOT EXISTS (
        SELECT 1 FROM school_configuration_versions v WHERE v.school_id = NEW.school_id
          AND v.version = NEW.policy_version AND v.effective_at_ms <= NEW.effective_at_ms
          AND v.effective_at_ms = (SELECT MAX(effective_at_ms) FROM school_configuration_versions WHERE school_id = NEW.school_id AND effective_at_ms <= NEW.effective_at_ms)
      );
    END;
    CREATE TRIGGER IF NOT EXISTS allocation_evidence_no_update
    BEFORE UPDATE ON allocation_evidence BEGIN SELECT RAISE(ABORT, 'allocation evidence is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS allocation_evidence_no_delete
    BEFORE DELETE ON allocation_evidence BEGIN SELECT RAISE(ABORT, 'allocation evidence is immutable'); END;
  `

  // SQLite stores canonical CREATE statements. Compare with a fresh database
  // before accepting an existing schema, rather than silently recreating guards.
  const reference = createReference()
  try {
    reference.exec(schema)
    const expected = reference.prepare("SELECT name, type, sql FROM sqlite_schema WHERE type IN ('table', 'trigger') AND name NOT LIKE 'sqlite_%'").all()
    database.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON; BEGIN IMMEDIATE')
    try {
      const version = database.prepare('PRAGMA user_version').get()?.user_version
      if (version !== 0 && version !== 1) throw new Error('Unsupported configuration schema version')
      const lookup = database.prepare('SELECT type, sql FROM sqlite_schema WHERE name = ?')
      const actual = expected.map((item) => {
        if (typeof item.name !== 'string') throw new Error('Invalid schema object name')
        return lookup.get(item.name)
      })
      if (version === 0 && actual.every((item) => item === undefined)) {
        database.exec(schema)
      } else if (actual.some((item, index) => !item || item.type !== expected[index].type || item.sql !== expected[index].sql)) {
        throw new Error('Configuration schema protection mismatch; inspect the database before proceeding')
      }
      database.exec('PRAGMA user_version = 1')
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  } finally {
    reference.close()
  }
}
