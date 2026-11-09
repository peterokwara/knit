/** A caller-selected allocation whose policy must remain explainable. */
export interface AllocationInput {
  id: string
  schoolId: string
  paymentId: string
  invoiceId: string
  source: string
  amountMinor: number
  /** Allocation time supplied by trusted server code, with a time zone. */
  effectiveAt: string
}

/** An allocation pinned to the school policy used at its effective time. */
export interface AllocationEvidence extends AllocationInput {
  policyVersion: number
}

/** Persistence contract for immutable allocation evidence. */
export interface IAllocationEvidenceStore {
  record(input: AllocationInput, effectiveAtMs: number, policyVersion: number): AllocationEvidence
  get(id: string): AllocationEvidence | undefined
}
