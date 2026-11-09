/**
 * An approved change to a school's invoice-category ordering.
 */
export interface IApprovedPolicyChange {
  /**
   * The unique change request identifier.
   */
  changeId: string

  /**
   * The school whose policy will change.
   */
  schoolId: string

  /**
   * The current version the approver expected to change.
   */
  expectedVersion: number

  /**
   * The instant the new policy takes effect, with a time zone.
   */
  effectiveAt: string

  /**
   * The person or role that requested the change.
   */
  requestedBy: string

  /**
   * The person recorded as approving the change.
   */
  approvedBy: string

  /**
   * The recorded reason for the change.
   */
  reason: string

  /**
   * The new priority order for invoice categories.
   */
  categoryPriority: string[]
}
