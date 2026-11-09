import type { IFamilyInvoiceBalance } from "../allocation/IFamilyInvoiceBalance";

/** One family's invoice balances and the evidence applied to each invoice. */
export interface IFamilyReconciliationBalance {
  /** Stable family identifier. */
  familyId: string;

  /** Parent-facing family reference. */
  familyReference: string;

  /** Invoice balances and their source and policy evidence. */
  invoices: IFamilyInvoiceBalance[];
}
