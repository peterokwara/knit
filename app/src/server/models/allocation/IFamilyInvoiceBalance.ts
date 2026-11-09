import type { IAllocationEvidence } from "./IAllocationEvidence";
import type { IAllocationInvoice } from "./IAllocationInvoice";

/** One invoice balance with the allocation evidence behind its paid amount. */
export interface IFamilyInvoiceBalance extends IAllocationInvoice {
  /** Sum of immutable payment allocations applied to the invoice. */
  paidMinor: number;
  /** Remaining invoice amount in minor currency units. */
  balanceMinor: number;
  /** Payment source and policy evidence that make up the paid amount. */
  allocations: IAllocationEvidence[];
}
