/**
 * A caller-selected allocation whose policy must remain explainable.
 */
export interface IAllocationInput {
  /**
   * The allocation's unique identifier.
   */
  id: string

  /**
   * The school that owns the invoice and policy.
   */
  schoolId: string

  /**
   * The payment associated with the allocation.
   */
  paymentId: string

  /**
   * The invoice selected by the caller.
   */
  invoiceId: string

  /**
   * The source from which the payment was recorded.
   */
  source: string

  /**
   * The positive allocation amount in minor currency units.
   */
  amountMinor: number

  /**
   * The allocation time supplied by trusted server code, with a time zone.
   */
  effectiveAt: string
}
