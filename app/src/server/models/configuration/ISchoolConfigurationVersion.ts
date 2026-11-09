import type { ISchoolConfiguration } from "./ISchoolConfiguration";

/**
 * An immutable version of one school's configuration.
 */
export interface ISchoolConfigurationVersion {
  /**
   * The school that owns this configuration.
   */
  schoolId: string;

  /**
   * The school's version number, starting at one.
   */
  version: number;

  /**
   * The instant this version takes effect, expressed in UTC.
   */
  effectiveAt: string;

  /**
   * The complete settings stored for this version.
   */
  configuration: ISchoolConfiguration;

  /**
   * The person who created or approved this version.
   */
  createdBy: string;

  /**
   * The recorded reason for this version.
   */
  reason: string;

  /**
   * The approved change identifier, or null for the initial version.
   */
  changeId: string | null;
}
