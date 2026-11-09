/** How an exact payment reference identified a family. */
export type PaymentFamilyMatchType = 'family_reference' | 'admission_number' | 'both'

/** Why a payment must wait for a bursar decision. */
export type PaymentFamilyHoldReason =
  | 'school_mismatch'
  | 'event_conflict'
  | 'source_validation_issue'
  | 'missing_reference'
  | 'unknown_reference'
  | 'ambiguous_reference'
  | 'currency_conversion_unavailable'

/** Family matching decision for one persisted payment event variant. */
export interface IPaymentFamilyMatch {
  /** School that owns the event. */
  schoolId: string

  /** Stable provider event identity. */
  eventKey: string

  /** Fingerprint distinguishes conflicting financial variants. */
  fingerprint: string

  /** Provider transaction or bank statement reference. */
  sourceReference: string

  /** Exact parent-entered reference retained from the source. */
  paymentReference: string | null

  /** Matched family, even when another issue holds the payment for review. */
  familyId: string | null

  /** Kind of exact reference that identified the family. */
  matchType: PaymentFamilyMatchType | null

  /** Currency that must be reconciled before invoice allocation. */
  currency: string

  /** Whether the event can proceed to policy-based allocation. */
  status: 'matched' | 'held'

  /** Human-readable category for the hold, when held. */
  holdReason: PaymentFamilyHoldReason | null
}
