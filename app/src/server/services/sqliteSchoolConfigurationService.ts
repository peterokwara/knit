import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import type { ApprovedPolicyChange, InitialSchoolConfiguration, ISchoolConfigurationStore, SchoolConfiguration, SchoolConfigurationVersion } from '../models/schoolConfiguration'
import { validateCategoryPriority, validateConfiguration } from '../utils/configurationValidation'
import { inTransaction, readInteger, readText } from '../utils/sqliteValues'

type Row = Record<string, SQLOutputValue>

function toVersion(row: Row): SchoolConfigurationVersion {
  const configuration = JSON.parse(readText(row, 'configuration_json')) as SchoolConfiguration
  validateConfiguration(configuration)
  const changeId = row.change_id
  if (changeId !== null && typeof changeId !== 'string') throw new Error('Invalid database column change_id')
  return {
    schoolId: readText(row, 'school_id'),
    version: readInteger(row, 'version'),
    effectiveAt: new Date(readInteger(row, 'effective_at_ms')).toISOString(),
    configuration,
    createdBy: readText(row, 'created_by'),
    reason: readText(row, 'change_reason'),
    changeId,
  }
}

/** Persist school configuration through SQLite's append-only guards. */
export class SqliteSchoolConfigurationService implements ISchoolConfigurationStore {
  /**
   * Create the storage service around an initialized connection.
   * @param database - SQLite connection with configuration schema installed.
   */
  constructor(private readonly database: DatabaseSync) {}

  /**
   * Write a school's first version without changing any existing version.
   * @param input - Initial school configuration and metadata.
   * @param effectiveAtMs - Effective instant in milliseconds.
   * @returns The stored initial version.
   */
  createInitial(input: InitialSchoolConfiguration, effectiveAtMs: number): SchoolConfigurationVersion {
    this.database.prepare(`INSERT INTO school_configuration_versions
      (school_id, version, effective_at_ms, configuration_json, created_by, change_reason)
      VALUES (?, 1, ?, ?, ?, ?)`)
      .run(input.schoolId, effectiveAtMs, JSON.stringify(input.configuration), input.createdBy, input.reason)
    const stored = this.getVersion(input.schoolId, 1)
    if (!stored) throw new Error('Initial configuration was not stored')
    return stored
  }

  /**
   * Atomically save approval and append the approved category-order change.
   * @param input - Approved change and expected previous version.
   * @param effectiveAtMs - Effective instant in milliseconds.
   * @returns The stored new version.
   */
  applyChange(input: ApprovedPolicyChange, effectiveAtMs: number): SchoolConfigurationVersion {
    return inTransaction(this.database, () => {
      const row = this.database.prepare('SELECT * FROM school_configuration_versions WHERE school_id = ? ORDER BY version DESC LIMIT 1').get(input.schoolId)
      if (!row) throw new Error(`No configuration found for ${input.schoolId}`)
      const previous = toVersion(row)
      if (previous.version !== input.expectedVersion) throw new Error('Expected configuration version does not match current version')
      if (effectiveAtMs <= Date.parse(previous.effectiveAt)) throw new Error('New configuration effective time must be after the current version')
      const next = structuredClone(previous.configuration)
      next.allocation.category_priority = [...input.categoryPriority]
      this.database.prepare(`INSERT INTO school_configuration_changes
        (change_id, school_id, expected_version, effective_at_ms, requested_by, approved_by, reason, category_priority_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.changeId, input.schoolId, input.expectedVersion, effectiveAtMs, input.requestedBy, input.approvedBy, input.reason, JSON.stringify(input.categoryPriority))
      this.database.prepare(`INSERT INTO school_configuration_versions
        (school_id, version, effective_at_ms, configuration_json, created_by, change_reason, change_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(input.schoolId, previous.version + 1, effectiveAtMs, JSON.stringify(next), input.approvedBy, input.reason, input.changeId)
      const stored = this.getVersion(input.schoolId, previous.version + 1)
      if (!stored) throw new Error('Configuration change was not stored')
      return stored
    })
  }

  /**
   * Read the request and approval details of a stored policy change.
   * @param changeId - The change identifier.
   * @returns The approved change, or undefined if absent.
   */
  getChange(changeId: string): ApprovedPolicyChange | undefined {
    const row = this.database.prepare('SELECT * FROM school_configuration_changes WHERE change_id = ?').get(changeId)
    if (!row) return undefined
    const categoryPriority: unknown = JSON.parse(readText(row, 'category_priority_json'))
    if (!Array.isArray(categoryPriority) || !categoryPriority.every((value: unknown) => typeof value === 'string')) throw new Error('Invalid category priority in database')
    validateCategoryPriority(categoryPriority)
    return {
      changeId: readText(row, 'change_id'), schoolId: readText(row, 'school_id'),
      expectedVersion: readInteger(row, 'expected_version'),
      effectiveAt: new Date(readInteger(row, 'effective_at_ms')).toISOString(),
      requestedBy: readText(row, 'requested_by'), approvedBy: readText(row, 'approved_by'),
      reason: readText(row, 'reason'), categoryPriority,
    }
  }

  /**
   * Read a particular school configuration version.
   * @param schoolId - The school owning the settings.
   * @param version - The version to read.
   * @returns The stored version, or undefined if absent.
   */
  getVersion(schoolId: string, version: number): SchoolConfigurationVersion | undefined {
    const row = this.database.prepare('SELECT * FROM school_configuration_versions WHERE school_id = ? AND version = ?').get(schoolId, version)
    return row ? toVersion(row) : undefined
  }

  /**
   * Read the latest version effective at a particular instant.
   * @param schoolId - The school owning the settings.
   * @param effectiveAtMs - Instant in milliseconds.
   * @returns The effective version, or undefined if none exists.
   */
  getVersionAt(schoolId: string, effectiveAtMs: number): SchoolConfigurationVersion | undefined {
    const row = this.database.prepare('SELECT * FROM school_configuration_versions WHERE school_id = ? AND effective_at_ms <= ? ORDER BY effective_at_ms DESC LIMIT 1').get(schoolId, effectiveAtMs)
    return row ? toVersion(row) : undefined
  }
}
