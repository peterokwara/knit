import type { IAllocationInvoice } from "../allocation/IAllocationInvoice";
import type { IPaymentFamilyMatchingContext } from "./IPaymentFamilyMatchingContext";

/** Reference data required to reconcile one school's imported payments. */
export interface IPaymentReconciliationContext {
  /** School and parent-facing references used for exact payment matching. */
  matching: IPaymentFamilyMatchingContext;

  /** Current invoice records used to allocate payments and explain balances. */
  invoices: IAllocationInvoice[];
}
