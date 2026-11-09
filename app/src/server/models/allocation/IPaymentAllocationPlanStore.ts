import type { IPaymentAllocationPlan } from "./IPaymentAllocationPlan";
import type { IAllocationInvoice } from "./IAllocationInvoice";
import type { IFamilyInvoiceAllocationReader } from "./IFamilyInvoiceAllocationReader";

/** Persistence operations for immutable payment allocation plans. */
export interface IPaymentAllocationPlanStore extends IFamilyInvoiceAllocationReader {
  /**
   * Read the plan already recorded for one provider event.
   * @param schoolId School that owns the payment.
   * @param paymentId Stable provider event identity.
   * @returns The saved plan, or undefined when not allocated.
   */
  getPlan(
    schoolId: string,
    paymentId: string,
  ): IPaymentAllocationPlan | undefined;

  /**
   * Read the total amount already allocated to one invoice.
   * @param schoolId School that owns the invoice.
   * @param invoiceId Stable invoice identifier.
   * @returns Allocated minor currency units.
   */
  getAllocatedAmount(schoolId: string, invoiceId: string): number;

  /**
   * Atomically persist the plan and its invoice evidence.
   * @param plan Plan calculated under one immutable policy version.
   * @param effectiveAtMs Trusted plan time in epoch milliseconds.
   * @returns The saved plan.
   */
  recordPlan(
    plan: IPaymentAllocationPlan,
    effectiveAtMs: number,
    invoices: Pick<IAllocationInvoice, "invoiceId" | "amountMinor">[],
  ): IPaymentAllocationPlan;
}
