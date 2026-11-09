import type { ISchoolAllocationPolicy } from './ISchoolAllocationPolicy'

/**
 * The full school-owned configuration; additional settings are preserved.
 */
export interface ISchoolConfiguration {
  /**
   * The school's invoice allocation rules.
   */
  allocation: ISchoolAllocationPolicy

  /**
   * Additional school settings retained without modification.
   */
  [key: string]: unknown
}
