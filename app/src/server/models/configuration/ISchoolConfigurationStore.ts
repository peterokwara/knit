import type { IApprovedPolicyChange } from "./IApprovedPolicyChange";
import type { IInitialSchoolConfiguration } from "./IInitialSchoolConfiguration";
import type { ISchoolConfigurationVersion } from "./ISchoolConfigurationVersion";

/**
 * The persistence operations required by the configuration service.
 */
export interface ISchoolConfigurationStore {
  /**
   * Save the initial settings for a new school.
   * @param input The settings and onboarding metadata.
   * @param effectiveAtMs The effective instant in milliseconds.
   * @returns The stored configuration version.
   */
  createInitial(
    input: IInitialSchoolConfiguration,
    effectiveAtMs: number,
  ): ISchoolConfigurationVersion;

  /**
   * Atomically append an approved configuration change.
   * @param input The approved change and expected previous version.
   * @param effectiveAtMs The effective instant in milliseconds.
   * @returns The stored configuration version.
   */
  applyChange(
    input: IApprovedPolicyChange,
    effectiveAtMs: number,
  ): ISchoolConfigurationVersion;

  /**
   * Find an approved change by its identifier.
   * @param changeId The change identifier.
   * @returns The change, or undefined when absent.
   */
  getChange(changeId: string): IApprovedPolicyChange | undefined;

  /**
   * Find a specific configuration version for a school.
   * @param schoolId The school that owns the configuration.
   * @param version The version number.
   * @returns The version, or undefined when absent.
   */
  getVersion(
    schoolId: string,
    version: number,
  ): ISchoolConfigurationVersion | undefined;

  /**
   * Find the version effective at an instant.
   * @param schoolId The school that owns the configuration.
   * @param effectiveAtMs The instant in milliseconds.
   * @returns The effective version, or undefined when absent.
   */
  getVersionAt(
    schoolId: string,
    effectiveAtMs: number,
  ): ISchoolConfigurationVersion | undefined;
}
