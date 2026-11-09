import type { ApprovedPolicyChange, InitialSchoolConfiguration, ISchoolConfigurationReader, ISchoolConfigurationStore, SchoolConfigurationVersion } from '../models/schoolConfiguration'
import { parseInstant, requireText, validateCategoryPriority, validateConfiguration } from '../utils/configurationValidation'

/** Manage school-owned configuration through an injected persistence contract. */
export class SchoolConfigurationService implements ISchoolConfigurationReader {
  /**
   * Create the service with its storage dependency.
   * @param store - Persistence for immutable configuration versions.
   */
  constructor(private readonly store: ISchoolConfigurationStore) {}

  /**
   * Register the initial settings for a school that does not yet exist.
   * @param input - School settings and onboarding metadata.
   * @returns The initial immutable version.
   */
  createSchool(input: InitialSchoolConfiguration): SchoolConfigurationVersion {
    requireText(input.schoolId, 'schoolId')
    requireText(input.createdBy, 'createdBy')
    requireText(input.reason, 'reason')
    validateConfiguration(input.configuration)
    return this.store.createInitial(input, parseInstant(input.effectiveAt))
  }

  /**
   * Apply an approved change without overwriting any previous school settings.
   * @param input - Approved request, expected current version and new priority.
   * @returns The new immutable configuration version.
   */
  applyChange(input: ApprovedPolicyChange): SchoolConfigurationVersion {
    for (const [name, value] of Object.entries({ changeId: input.changeId, schoolId: input.schoolId, requestedBy: input.requestedBy, approvedBy: input.approvedBy, reason: input.reason })) requireText(value, name)
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new Error('expectedVersion must be a positive integer')
    validateCategoryPriority(input.categoryPriority)
    return this.store.applyChange(input, parseInstant(input.effectiveAt))
  }

  /**
   * Retrieve the approval and request metadata for a policy change.
   * @param changeId - Identifier of the approved change.
   * @returns The recorded change and its approval details.
   */
  getChange(changeId: string): ApprovedPolicyChange {
    requireText(changeId, 'changeId')
    const result = this.store.getChange(changeId)
    if (!result) throw new Error(`Configuration change ${changeId} not found`)
    return result
  }

  /**
   * Retrieve a particular version for an explanation or audit.
   * @param schoolId - The school that owns the settings.
   * @param version - The version number to retrieve.
   * @returns The requested version.
   */
  getVersion(schoolId: string, version: number): SchoolConfigurationVersion {
    requireText(schoolId, 'schoolId')
    const result = this.store.getVersion(schoolId, version)
    if (!result) throw new Error(`Configuration version ${version} not found for ${schoolId}`)
    return result
  }

  /**
   * Find the policy effective at an allocation's effective time.
   * @param schoolId - The school that owns the settings.
   * @param effectiveAt - Allocation time with an explicit time zone.
   * @returns The configuration in force at that instant.
   */
  getVersionAt(schoolId: string, effectiveAt: string): SchoolConfigurationVersion {
    requireText(schoolId, 'schoolId')
    const result = this.store.getVersionAt(schoolId, parseInstant(effectiveAt))
    if (!result) throw new Error(`No configuration effective for ${schoolId} at ${effectiveAt}`)
    return result
  }
}
