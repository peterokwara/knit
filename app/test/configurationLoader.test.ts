import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { it } from 'node:test'
import type { ISchoolConfiguration } from '../src/server/models/configuration/ISchoolConfiguration'
import { SchoolConfigurationService } from '../src/server/services/schoolConfigurationService'
import { SqliteSchoolConfigurationService } from '../src/server/services/sqliteSchoolConfigurationService'
import { initializeSchema } from '../src/server/utils/configurationSchema'

const createReference = () => new DatabaseSync(':memory:')

const executable = path.resolve('node_modules/.bin/tsx')
const script = path.resolve('scripts/load-school-configurations.ts')
const fixturePath = path.resolve(import.meta.dirname, '../../fixtures/school/config_history.json')

function runLoader(directory: string) {
  return spawnSync(executable, [script], { cwd: directory, encoding: 'utf8' })
}

void it('loads the school fixtures twice without adding or overwriting versions', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'knit-loader-'))
  try {
    const first = runLoader(directory)
    assert.equal(first.status, 0, first.stderr)
    const second = runLoader(directory)
    assert.equal(second.status, 0, second.stderr)
    const database = new DatabaseSync(path.join(directory, 'data/knit.sqlite'))
    try {
      initializeSchema(database, createReference)
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM school_configuration_versions').get()?.count, 3)
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM school_configuration_changes').get()?.count, 1)
    } finally { database.close() }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

void it('refuses fixture loading when the school already has different settings', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'knit-loader-conflict-'))
  try {
    const databasePath = path.join(directory, 'school.sqlite')
    const database = new DatabaseSync(databasePath)
    initializeSchema(database, createReference)
    const config = new SchoolConfigurationService(new SqliteSchoolConfigurationService(database))
    const rows = JSON.parse(readFileSync(fixturePath, 'utf8')) as { config: ISchoolConfiguration }[]
    const altered = structuredClone(rows[0].config)
    altered.overpayment = 'hold_for_refund'
    config.createSchool({ schoolId: 'sch_mlima', configuration: altered, effectiveAt: '2026-10-01T00:00:00+03:00', createdBy: 'ops:wanjiru', reason: 'Term 3 onboarding' })
    database.close()

    // The command uses data/knit.sqlite in its working directory.
    const dataDirectory = path.join(directory, 'data')
    mkdirSync(dataDirectory)
    renameSync(databasePath, path.join(dataDirectory, 'knit.sqlite'))
    const result = runLoader(directory)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Existing initial configuration differs/)
    const reopened = new DatabaseSync(path.join(dataDirectory, 'knit.sqlite'))
    try {
      initializeSchema(reopened, createReference)
      const stored = new SchoolConfigurationService(new SqliteSchoolConfigurationService(reopened)).getVersion('sch_mlima', 1)
      assert.deepEqual(stored.configuration, altered)
    } finally { reopened.close() }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
