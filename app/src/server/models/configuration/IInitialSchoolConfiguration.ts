import type { ISchoolConfiguration } from './ISchoolConfiguration'

/**
 * The school-specific settings and metadata supplied at onboarding.
 */
export interface IInitialSchoolConfiguration {
  /**
   * The school that owns the settings.
   */
  schoolId: string

  /**
   * The instant the initial settings take effect, with a time zone.
   */
  effectiveAt: string

  /**
   * The complete settings to save for the school.
   */
  configuration: ISchoolConfiguration

  /**
   * The person who supplied the settings.
   */
  createdBy: string

  /**
   * The reason for creating the initial settings.
   */
  reason: string
}
