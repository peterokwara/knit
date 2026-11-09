/** The full school-owned configuration; unknown settings are preserved. */
export interface SchoolConfiguration {
  allocation: {
    category_priority: string[]
    tie_break: string[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

/** A school configuration at a particular effective time. */
export interface SchoolConfigurationVersion {
  schoolId: string
  version: number
  effectiveAt: string
  configuration: SchoolConfiguration
  createdBy: string
  reason: string
  changeId: string | null
}

/** Initial school settings supplied during onboarding. */
export interface InitialSchoolConfiguration {
  schoolId: string
  effectiveAt: string
  configuration: SchoolConfiguration
  createdBy: string
  reason: string
}

/** An approved change to the invoice-category ordering. */
export interface ApprovedPolicyChange {
  changeId: string
  schoolId: string
  expectedVersion: number
  effectiveAt: string
  requestedBy: string
  approvedBy: string
  reason: string
  categoryPriority: string[]
}

/** Persistence contract used by the configuration service. */
export interface ISchoolConfigurationStore {
  createInitial(input: InitialSchoolConfiguration, effectiveAtMs: number): SchoolConfigurationVersion
  applyChange(input: ApprovedPolicyChange, effectiveAtMs: number): SchoolConfigurationVersion
  getChange(changeId: string): ApprovedPolicyChange | undefined
  getVersion(schoolId: string, version: number): SchoolConfigurationVersion | undefined
  getVersionAt(schoolId: string, effectiveAtMs: number): SchoolConfigurationVersion | undefined
}

/** Read the school configuration effective at a particular allocation time. */
export interface ISchoolConfigurationReader {
  getVersionAt(schoolId: string, effectiveAt: string): SchoolConfigurationVersion
}
