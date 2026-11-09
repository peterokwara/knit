import type { IAllocationEvidence } from "./IAllocationEvidence";
import type { IAllocationInput } from "./IAllocationInput";

/**
 * The persistence operations required for immutable allocation evidence.
 */
export interface IAllocationEvidenceStore {
  /**
   * Record evidence for an allocation and its policy version.
   * @param input The caller-selected payment and invoice details.
   * @param effectiveAtMs The allocation time in milliseconds.
   * @param policyVersion The applicable school policy version.
   * @returns The stored evidence.
   */
  record(
    input: IAllocationInput,
    effectiveAtMs: number,
    policyVersion: number,
  ): IAllocationEvidence;

  /**
   * Find allocation evidence by identifier.
   * @param id The allocation identifier.
   * @returns The evidence, or undefined when absent.
   */
  get(id: string): IAllocationEvidence | undefined;
}
