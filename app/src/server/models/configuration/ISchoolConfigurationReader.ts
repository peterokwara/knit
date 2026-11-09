import type { ISchoolConfigurationVersion } from "./ISchoolConfigurationVersion";

/**
 * The policy lookup required when recording an allocation.
 */
export interface ISchoolConfigurationReader {
  /**
   * Find the configuration effective at an allocation time.
   * @param schoolId The school that owns the configuration.
   * @param effectiveAt The allocation time with a time zone.
   * @returns The configuration effective at that time.
   */
  getVersionAt(
    schoolId: string,
    effectiveAt: string,
  ): ISchoolConfigurationVersion;
}
