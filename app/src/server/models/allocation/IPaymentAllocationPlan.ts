import type { IAllocationEvidence } from "./IAllocationEvidence";

/** The immutable result of applying one payment to a family's invoices. */
export interface IPaymentAllocationPlan {
  /** School that owns the payment and invoices. */
  schoolId: string;
  /** Stable provider event identity. */
  paymentId: string;
  /** Fingerprint that distinguishes conflicting event variants. */
  fingerprint: string;
  /** Family selected by exact payment-reference matching. */
  familyId: string;
  /** Provider that supplied the payment. */
  source: string;
  /** Payment amount available for allocation, in minor currency units. */
  amountMinor: number;
  /** Payment currency. */
  currency: string;
  /** Trusted instant when the school allocation policy was applied. */
  effectiveAt: string;
  /** Version of the school's policy used to create the plan. */
  policyVersion: number;
  /** Immutable invoice allocations made by the plan. */
  allocations: IAllocationEvidence[];
  /** Amount left after all eligible invoice balances were filled. */
  remainderMinor: number;
  /** School policy treatment for any remainder. */
  remainderTreatment: "none" | "credit" | "refund_hold";
}
