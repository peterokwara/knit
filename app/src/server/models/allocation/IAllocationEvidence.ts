import type { IAllocationInput } from "./IAllocationInput";

/**
 * An allocation pinned to the school policy used at its effective time.
 */
export interface IAllocationEvidence extends IAllocationInput {
  /**
   * The configuration version used for this allocation.
   */
  policyVersion: number;

  /** Original invoice allocation before later reversals, when adjusted. */
  originalAmountMinor?: number;

  /** Amount removed from this allocation by later reversals. */
  reversedMinor?: number;

  /** Provider references for the reversals affecting this payment. */
  reversalReferences?: string[];

  /** Whether a later reversal required the effective invoice allocation to change. */
  reallocatedAfterReversal?: boolean;
}
