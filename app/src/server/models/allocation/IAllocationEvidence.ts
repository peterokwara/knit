import type { IAllocationInput } from "./IAllocationInput";

/**
 * An allocation pinned to the school policy used at its effective time.
 */
export interface IAllocationEvidence extends IAllocationInput {
  /**
   * The configuration version used for this allocation.
   */
  policyVersion: number;
}
