import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { initializeSchema } from "../src/server/utils/configurationSchema";

const createReference = () => new DatabaseSync(":memory:");

void describe("payment ingestion schema", () => {
  void it("upgrades a configuration-only database without replacing its existing data", () => {
    const database = new DatabaseSync(":memory:");
    initializeSchema(database, createReference);
    database.exec(`
      INSERT INTO school_configuration_versions
        (school_id, version, effective_at_ms, configuration_json, created_by, change_reason)
        VALUES ('sch_migration', 1, 0, '{}', 'test', 'migration check');
      DROP TABLE payment_ingestion_observations;
      DROP TABLE payment_ingestion_events;
      DROP TRIGGER school_configuration_versions_plan_guard;
      DROP TABLE payment_allocation_plans;
      PRAGMA user_version = 1;
    `);

    try {
      initializeSchema(database, createReference);

      assert.equal(
        database.prepare("PRAGMA user_version").get()?.user_version,
        3,
      );
      assert.equal(
        database
          .prepare(
            "SELECT school_id FROM school_configuration_versions WHERE school_id = ?",
          )
          .get("sch_migration")?.school_id,
        "sch_migration",
      );
      assert.equal(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'payment_ingestion_events'",
          )
          .get()?.count,
        1,
      );
    } finally {
      database.close();
    }
  });

  void it("adds immutable payment allocation plans to an existing ingestion database", () => {
    const database = new DatabaseSync(":memory:");
    initializeSchema(database, createReference);
    database.exec(`
      DROP TRIGGER school_configuration_versions_plan_guard;
      DROP TRIGGER payment_allocation_plans_no_delete;
      DROP TRIGGER payment_allocation_plans_no_update;
      DROP TRIGGER payment_allocation_plans_insert_guard;
      DROP TABLE payment_allocation_plans;
      PRAGMA user_version = 2;
    `);

    try {
      initializeSchema(database, createReference);

      assert.equal(
        database.prepare("PRAGMA user_version").get()?.user_version,
        3,
      );
      assert.equal(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'payment_allocation_plans'",
          )
          .get()?.count,
        1,
      );
      assert.equal(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'trigger' AND name = 'school_configuration_versions_plan_guard'",
          )
          .get()?.count,
        1,
      );
    } finally {
      database.close();
    }
  });

  void it("refuses to migrate when an existing configuration guard is missing", () => {
    const database = new DatabaseSync(":memory:");
    initializeSchema(database, createReference);
    database.exec(`
      DROP TABLE payment_ingestion_observations;
      DROP TABLE payment_ingestion_events;
      PRAGMA user_version = 1;
      DROP TRIGGER school_configuration_versions_no_update;
    `);
    try {
      assert.throws(
        () => initializeSchema(database, createReference),
        /Configuration schema protection mismatch/,
      );
      assert.equal(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'payment_ingestion_events'",
          )
          .get()?.count,
        0,
      );
      assert.equal(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'trigger' AND name = 'school_configuration_versions_no_update'",
          )
          .get()?.count,
        0,
      );
    } finally {
      database.close();
    }
  });
});
