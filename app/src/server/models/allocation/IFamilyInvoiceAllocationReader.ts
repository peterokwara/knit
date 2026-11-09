import type { IAllocationEvidence } from "./IAllocationEvidence";

/** Read immutable allocation evidence for invoices belonging to a family. */
export interface IFamilyInvoiceAllocationReader {
  /**
   * Read allocation lines tied to this family and its school invoices.
   * @param schoolId School that owns the invoices.
   * @param familyId Family that owns the invoices.
   * @param invoiceIds Stable identifiers of the family's invoices.
   * @returns Allocation lines in deterministic order.
   */
  getFamilyEvidence(
    schoolId: string,
    familyId: string,
    invoiceIds: string[],
  ): IAllocationEvidence[];
}
