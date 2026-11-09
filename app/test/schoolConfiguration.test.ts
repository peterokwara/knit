import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import type { ISchoolConfiguration } from '../src/server/models/configuration/ISchoolConfiguration'
import type { ISchoolConfigurationStore } from '../src/server/models/configuration/ISchoolConfigurationStore'
import type { IDatabaseConnection } from '../src/server/models/database/IDatabaseConnection'
import { SchoolConfigurationService } from '../src/server/services/schoolConfigurationService'
import { SqliteSchoolConfigurationService } from '../src/server/services/sqliteSchoolConfigurationService'
import { AllocationEvidenceService } from '../src/server/services/allocationEvidenceService'
import { SqliteAllocationEvidenceService } from '../src/server/services/sqliteAllocationEvidenceService'
import { initializeSchema } from '../src/server/utils/configurationSchema'

const createReference = () => new DatabaseSync(':memory:')

interface IConfigFixture {
  school_id: string
  version: number
  effective_from: string
  created_by: string
  change_reason: string
  config: ISchoolConfiguration
}

interface IChangeFixture {
  change_request: string
  school_id: string
  requested_by: string
  approved_by: string
  effective_from: string
  reason: string
  patch: { allocation: { category_priority: string[] } }
}

const fixturePath = path.resolve(import.meta.dirname, '../../fixtures/school')
const configs = JSON.parse(readFileSync(path.join(fixturePath, 'config_history.json'), 'utf8')) as IConfigFixture[]
const change = JSON.parse(readFileSync(path.join(fixturePath, 'change_requests/CR-118.json'), 'utf8')) as IChangeFixture
const defaults = JSON.parse(readFileSync(path.join(fixturePath, 'platform_defaults.json'), 'utf8')) as ISchoolConfiguration

function setup() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  initializeSchema(db, createReference)
  const store = new SqliteSchoolConfigurationService(db)
  const config = new SchoolConfigurationService(store)
  const evidence = new AllocationEvidenceService(config, new SqliteAllocationEvidenceService(db))
  for (const row of configs) {
    config.createSchool({
      schoolId: row.school_id,
      effectiveAt: row.effective_from,
      createdBy: row.created_by,
      reason: row.change_reason,
      configuration: row.config,
    })
  }
  return { db, config, evidence }
}

function approvedChange() {
  return {
    changeId: change.change_request,
    schoolId: change.school_id,
    expectedVersion: 1,
    effectiveAt: change.effective_from,
    requestedBy: change.requested_by,
    approvedBy: change.approved_by,
    reason: change.reason,
    categoryPriority: change.patch.allocation.category_priority,
  }
}

void describe('school configuration safety', () => {
  void it('validates an approval before calling an injected storage dependency', () => {
    let calls = 0
    const failIfCalled = () => { calls += 1; throw new Error('Storage should not be called') }
    const store: ISchoolConfigurationStore = {
      createInitial: failIfCalled, applyChange: failIfCalled, getChange: failIfCalled,
      getVersion: failIfCalled, getVersionAt: failIfCalled,
    }
    const service = new SchoolConfigurationService(store)
    assert.throws(() => service.applyChange({ ...approvedChange(), approvedBy: ' ' }), /approvedBy/)
    assert.equal(calls, 0)
  })

  void it('reads a configuration using an injected database connection', () => {
    const fixture = configs[0]
    const database: IDatabaseConnection = {
      exec() { throw new Error('Unexpected SQL execution') },
      close() { throw new Error('The caller owns the connection') },
      prepare(sql) {
        assert.match(sql, /school_configuration_versions/)
        return {
          get(...values) {
            assert.deepEqual(values, [fixture.school_id, fixture.version])
            return {
              school_id: fixture.school_id, version: fixture.version,
              effective_at_ms: Date.parse(fixture.effective_from),
              configuration_json: JSON.stringify(fixture.config),
              created_by: fixture.created_by, change_reason: fixture.change_reason, change_id: null,
            }
          },
          all() { throw new Error('Unexpected query') },
          run() { throw new Error('Unexpected write') },
        }
      },
    }
    const service = new SqliteSchoolConfigurationService(database)
    assert.deepEqual(service.getVersion(fixture.school_id, 1)?.configuration, fixture.config)
  })

  void it('prevents direct updates, deletes and a default-reset upsert for both schools', () => {
    const { db, config } = setup()
    try {
      initializeSchema(db, createReference)
      for (const row of configs) {
        assert.throws(() => db.prepare('UPDATE school_configuration_versions SET configuration_json = ? WHERE school_id = ?').run(JSON.stringify(defaults), row.school_id), /immutable/)
        assert.throws(() => db.prepare('DELETE FROM school_configuration_versions WHERE school_id = ?').run(row.school_id), /immutable/)
        assert.throws(() => db.prepare(`INSERT OR REPLACE INTO school_configuration_versions
          (school_id, version, effective_at_ms, configuration_json, created_by, change_reason)
          VALUES (?, 1, ?, ?, 'migration', 'defaults')`)
          .run(row.school_id, Date.parse(row.effective_from), JSON.stringify(defaults)), /already exists|immutable/)
        assert.throws(() => db.prepare(`INSERT INTO school_configuration_versions
          (school_id, version, effective_at_ms, configuration_json, created_by, change_reason)
          VALUES (?, 1, ?, ?, 'migration', 'defaults')
          ON CONFLICT(school_id, version) DO UPDATE SET configuration_json = excluded.configuration_json`)
          .run(row.school_id, Date.parse(row.effective_from), JSON.stringify(defaults)), /already exists|immutable/)
        assert.deepEqual(config.getVersion(row.school_id, 1).configuration, row.config)
      }
    } finally { db.close() }
  })

  void it('rejects a new version that does not have a matching approved change', () => {
    const { db, config } = setup()
    try {
      assert.throws(() => db.prepare(`INSERT INTO school_configuration_versions
        (school_id, version, effective_at_ms, configuration_json, created_by, change_reason)
        VALUES ('sch_mlima', 2, ?, ?, 'migration', 'defaults')`)
        .run(Date.parse('2026-11-03T09:00:00Z'), JSON.stringify(defaults)), /approved change/)
      assert.deepEqual(config.getVersion('sch_mlima', 1).configuration, configs[0].config)
    } finally { db.close() }
  })

  void it('refuses to start if a migration removed or replaced a protection trigger', () => {
    const { db } = setup()
    try {
      db.exec('DROP TRIGGER school_configuration_versions_no_update')
      assert.throws(() => initializeSchema(db, createReference), /schema protection mismatch/)
      db.exec(`CREATE TRIGGER school_configuration_versions_no_update
        BEFORE UPDATE ON school_configuration_versions BEGIN SELECT 1; END`)
      assert.throws(() => initializeSchema(db, createReference), /schema protection mismatch/)
    } finally { db.close() }
  })

  void it('does not silently recreate a previously initialized schema after its tables are dropped', () => {
    const { db } = setup()
    try {
      db.exec(`PRAGMA foreign_keys = OFF;
        DROP TABLE allocation_evidence;
        DROP TABLE school_configuration_changes;
        DROP TABLE school_configuration_versions;`)
      assert.throws(() => initializeSchema(db, createReference), /schema protection mismatch/)
    } finally { db.close() }
  })

  void it('rejects a version that changes extra settings beyond the approved patch', () => {
    const { db, config } = setup()
    try {
      const input = approvedChange()
      const altered = structuredClone(configs[0].config)
      altered.allocation.category_priority = input.categoryPriority
      altered.overpayment = 'hold_for_refund'
      db.prepare(`INSERT INTO school_configuration_changes
        (change_id, school_id, expected_version, effective_at_ms, requested_by, approved_by, reason, category_priority_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.changeId, input.schoolId, input.expectedVersion, Date.parse(input.effectiveAt), input.requestedBy, input.approvedBy, input.reason, JSON.stringify(input.categoryPriority))
      assert.throws(() => db.prepare(`INSERT INTO school_configuration_versions
        (school_id, version, effective_at_ms, configuration_json, created_by, change_reason, change_id)
        VALUES (?, 2, ?, ?, ?, ?, ?)`)
        .run(input.schoolId, Date.parse(input.effectiveAt), JSON.stringify(altered), input.approvedBy, input.reason, input.changeId), /matching approved change/)
      assert.deepEqual(config.getVersion('sch_mlima', 1).configuration, configs[0].config)
    } finally { db.close() }
  })

  void it('keeps the prior allocation and its policy intact across CR-118, including the noon boundary', () => {
    const { db, config, evidence } = setup()
    try {
      const before = evidence.record({ id: 'alloc-before', schoolId: 'sch_mlima', paymentId: 'pay-before', invoiceId: 'INV-2001', source: 'mpesa', amountMinor: 3000000, effectiveAt: '2026-11-03T11:59:59+03:00' })
      const version2 = config.applyChange(approvedChange())
      const atBoundary = evidence.record({ id: 'alloc-after', schoolId: 'sch_mlima', paymentId: 'pay-after', invoiceId: 'INV-2002', source: 'mpesa', amountMinor: 500000, effectiveAt: '2026-11-03T12:00:00+03:00' })

      assert.equal(before.policyVersion, 1)
      assert.equal(atBoundary.policyVersion, 2)
      assert.equal(version2.changeId, 'CR-118')
      assert.deepEqual(version2.configuration.allocation.category_priority, ['transport', 'lunch', 'tuition'])
      const expected = structuredClone(configs[0].config)
      expected.allocation.category_priority = ['transport', 'lunch', 'tuition']
      assert.deepEqual(version2.configuration, expected)
      const approval = config.getChange('CR-118')
      assert.equal(approval.requestedBy, change.requested_by)
      assert.equal(approval.approvedBy, change.approved_by)
      assert.equal(approval.reason, change.reason)
      assert.deepEqual(config.getVersion('sch_mlima', 1).configuration, configs[0].config)
      assert.deepEqual(config.getVersion('sch_pwani', 1).configuration, configs[1].config)
      assert.deepEqual(evidence.get('alloc-before'), before)
      assert.throws(() => db.prepare("UPDATE allocation_evidence SET policy_version = 2 WHERE id = 'alloc-before'").run(), /immutable/)
      assert.throws(() => db.prepare("DELETE FROM allocation_evidence WHERE id = 'alloc-before'").run(), /immutable/)
    } finally { db.close() }
  })

  void it('rejects stale or unapproved changes without leaving a partial change record', () => {
    const { db, config } = setup()
    try {
      assert.throws(() => config.applyChange({ ...approvedChange(), approvedBy: ' ' }), /approvedBy/)
      assert.throws(() => config.applyChange({ ...approvedChange(), expectedVersion: 2 }), /version/)
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM school_configuration_changes').get()?.count, 0)
      assert.deepEqual(config.getVersion('sch_mlima', 1).configuration, configs[0].config)
    } finally { db.close() }
  })

  void it('requires a time zone and rejects a policy version that was not in force', () => {
    const { db, config } = setup()
    try {
      assert.throws(() => config.getVersionAt('sch_mlima', '2026-11-03T12:00:00'), /time zone/)
      config.applyChange(approvedChange())
      assert.throws(() => db.prepare(`INSERT INTO allocation_evidence
        (id, school_id, payment_id, invoice_id, source, amount_minor, effective_at_ms, policy_version)
        VALUES ('wrong', 'sch_mlima', 'pay', 'invoice', 'mpesa', 1, ?, 1)`)
        .run(Date.parse('2026-11-03T09:00:00Z')), /policy version/)
    } finally { db.close() }
  })

  void it('rejects a retroactive change that would conflict with recorded evidence', () => {
    const { db, config, evidence } = setup()
    try {
      const recorded = evidence.record({ id: 'late', schoolId: 'sch_mlima', paymentId: 'pay-late', invoiceId: 'INV-2001', source: 'mpesa', amountMinor: 100, effectiveAt: '2026-11-03T13:00:00+03:00' })
      assert.throws(() => config.applyChange(approvedChange()), /existing allocation evidence/)
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM school_configuration_changes').get()?.count, 0)
      assert.deepEqual(evidence.get('late'), recorded)
      assert.equal(config.getVersionAt('sch_mlima', '2026-11-03T13:00:00+03:00').version, 1)
    } finally { db.close() }
  })

  void it('rejects invalid timestamps and configuration values before storage', () => {
    const { db, config } = setup()
    try {
      assert.throws(() => config.getVersionAt('sch_mlima', '2026-02-30T12:00:00+03:00'), /Invalid timestamp/)
      assert.throws(() => config.applyChange({ ...approvedChange(), categoryPriority: ['tuition', 'tuition'] }), /categoryPriority/)
      const invalid = { ...configs[0].config, extra: Number.NaN }
      assert.throws(() => config.createSchool({ schoolId: 'invalid', effectiveAt: '2026-10-01T00:00:00Z', createdBy: 'ops', reason: 'onboarding', configuration: invalid }), /JSON values/)
      const incomplete = { allocation: configs[0].config.allocation }
      assert.throws(() => config.createSchool({ schoolId: 'incomplete', effectiveAt: '2026-10-01T00:00:00Z', createdBy: 'ops', reason: 'onboarding', configuration: incomplete }), /overpayment/)
    } finally { db.close() }
  })

  void it('preserves versions and allocation evidence after reopening a file database', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'knit-config-'))
    const filename = path.join(directory, 'school.sqlite')
    try {
      const first = new DatabaseSync(filename)
      initializeSchema(first, createReference)
      const config = new SchoolConfigurationService(new SqliteSchoolConfigurationService(first))
      const evidence = new AllocationEvidenceService(config, new SqliteAllocationEvidenceService(first))
      const fixture = configs[0]
      config.createSchool({ schoolId: fixture.school_id, effectiveAt: fixture.effective_from, configuration: fixture.config, createdBy: fixture.created_by, reason: fixture.change_reason })
      const before = evidence.record({ id: 'persisted', schoolId: 'sch_mlima', paymentId: 'pay', invoiceId: 'INV-2001', source: 'mpesa', amountMinor: 100, effectiveAt: '2026-11-03T11:59:59+03:00' })
      config.applyChange(approvedChange())
      first.close()

      const reopened = new DatabaseSync(filename)
      try {
        initializeSchema(reopened, createReference)
        const after = new SchoolConfigurationService(new SqliteSchoolConfigurationService(reopened))
        const stored = new AllocationEvidenceService(after, new SqliteAllocationEvidenceService(reopened))
        assert.deepEqual(stored.get('persisted'), before)
        assert.deepEqual(after.getVersion('sch_mlima', 1).configuration, fixture.config)
        assert.equal(after.getVersionAt('sch_mlima', '2026-11-03T12:00:00+03:00').version, 2)
      } finally { reopened.close() }
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
