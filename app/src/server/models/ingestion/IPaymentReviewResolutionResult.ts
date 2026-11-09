import type { IFamilyInvoiceBalance } from "../allocation/IFamilyInvoiceBalance";
import type { IPaymentAllocationPlan } from "../allocation/IPaymentAllocationPlan";
import type { IPaymentReviewResolution } from "./IPaymentReviewResolution";

/** Saved bursar decision with its resulting allocation and family balances. */
export interface IPaymentReviewResolutionResult {
  /** Durable audit decision. */
  resolution: IPaymentReviewResolution;

  /** Policy-versioned plan created from the decision. */
  allocationPlan: IPaymentAllocationPlan;

  /** Updated balances and allocation evidence for the selected family. */
  familyBalance: IFamilyInvoiceBalance[];
}
