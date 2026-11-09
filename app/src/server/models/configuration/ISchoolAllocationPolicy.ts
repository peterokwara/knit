/**
 * The school's invoice allocation rules, using the supplied configuration's field names.
 */
export interface ISchoolAllocationPolicy {
  /**
   * The order in which invoice categories receive payments.
   */
  category_priority: string[]

  /**
   * The rules used to order invoices within a category.
   */
  tie_break: string[]

  /**
   * Additional allocation settings retained from the school's configuration.
   */
  [key: string]: unknown
}
