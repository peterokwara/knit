import type { IAllocationEvidence } from "../models/allocation/IAllocationEvidence";
import type { IAllocationInvoice } from "../models/allocation/IAllocationInvoice";
import type { IPaymentAllocationPlan } from "../models/allocation/IPaymentAllocationPlan";
import type { IPaymentAllocationPlanStore } from "../models/allocation/IPaymentAllocationPlanStore";
import type { IIngestedPaymentEvent } from "../models/ingestion/IIngestedPaymentEvent";
import type { IPaymentFamilyMatch } from "../models/ingestion/IPaymentFamilyMatch";
import type { ISchoolConfigurationReader } from "../models/configuration/ISchoolConfigurationReader";
import { parseInstant, requireText } from "../utils/configurationValidation";

/** Apply the school's effective policy to a confirmed family payment. */
export class PaymentAllocationService {
  /** Versioned school settings used to select the policy for a new plan. */
  private readonly _configurations: ISchoolConfigurationReader;

  /** Atomic storage for plans and their invoice evidence. */
  private readonly _store: IPaymentAllocationPlanStore;

  /**
   * Build the allocation service with explicit configuration and storage.
   * @param configurations Versioned school configuration reader.
   * @param store Immutable payment plan storage.
   */
  constructor(
    configurations: ISchoolConfigurationReader,
    store: IPaymentAllocationPlanStore,
  ) {
    this._configurations = configurations;
    this._store = store;
  }

  /**
   * Allocate a matched payment using the policy effective at allocation time.
   * A replay returns the original plan, even after the school changes policy.
   * @param event Persisted normalized payment event.
   * @param match Exact family match for this payment variant.
   * @param invoices Open invoices belonging to the matched family.
   * @param allocationAt Trusted server time with an explicit time zone.
   * @returns The atomically saved plan, including its policy version.
   */
  allocatePayment(
    event: IIngestedPaymentEvent,
    match: IPaymentFamilyMatch,
    invoices: IAllocationInvoice[],
    allocationAt: string,
  ): IPaymentAllocationPlan {
    this.validateMatchedPayment(event, match);
    requireText(allocationAt, "allocationAt");
    const effectiveAtMs = parseInstant(allocationAt);
    const existing = this._store.getPlan(event.schoolId, event.eventKey);
    if (existing) {
      this.assertReplayMatches(existing, event, match);
      return existing;
    }

    const policyVersion = this._configurations.getVersionAt(
      event.schoolId,
      allocationAt,
    );
    const policy = policyVersion.configuration.allocation;
    const acceptedCurrencies = policyVersion.configuration.accepted_currencies;
    if (
      !Array.isArray(acceptedCurrencies) ||
      !acceptedCurrencies.includes(event.currency)
    ) {
      throw new Error(
        `Currency ${event.currency} is not accepted by the school`,
      );
    }
    const familyId = match.familyId;
    if (!familyId) throw new Error("Matched payment has no family");
    this.validateInvoices(invoices, event, familyId, policy);

    let remaining = event.netAmountMinor;
    const allocations: IAllocationEvidence[] = [];
    for (const invoice of this.orderInvoices(invoices, policy)) {
      const alreadyAllocated = this._store.getAllocatedAmount(
        event.schoolId,
        invoice.invoiceId,
      );
      if (alreadyAllocated > invoice.amountMinor) {
        throw new Error(`Invoice ${invoice.invoiceId} is over-allocated`);
      }
      const outstanding = invoice.amountMinor - alreadyAllocated;
      const amountMinor = Math.min(remaining, outstanding);
      if (amountMinor <= 0) continue;
      allocations.push({
        id: this.allocationId(
          event.schoolId,
          event.eventKey,
          invoice.invoiceId,
        ),
        schoolId: event.schoolId,
        paymentId: event.eventKey,
        invoiceId: invoice.invoiceId,
        source: event.source,
        amountMinor,
        effectiveAt: allocationAt,
        policyVersion: policyVersion.version,
      });
      remaining -= amountMinor;
      if (remaining === 0) break;
    }

    const remainderTreatment = this.remainderTreatment(
      remaining,
      policyVersion.configuration.overpayment,
    );
    const plan: IPaymentAllocationPlan = {
      schoolId: event.schoolId,
      paymentId: event.eventKey,
      fingerprint: event.fingerprint,
      familyId,
      source: event.source,
      amountMinor: event.netAmountMinor,
      currency: event.currency,
      effectiveAt: allocationAt,
      policyVersion: policyVersion.version,
      allocations,
      remainderMinor: remaining,
      remainderTreatment,
    };
    const saved = this._store.recordPlan(
      plan,
      effectiveAtMs,
      invoices.map(({ invoiceId, amountMinor }) => ({
        invoiceId,
        amountMinor,
      })),
    );
    this.assertReplayMatches(saved, event, match);
    return saved;
  }

  /**
   * Read the durable allocation plan for a provider payment.
   * @param schoolId School that owns the payment.
   * @param paymentId Stable provider event identity.
   * @returns The saved plan.
   */
  getPlan(schoolId: string, paymentId: string): IPaymentAllocationPlan {
    requireText(schoolId, "schoolId");
    requireText(paymentId, "paymentId");
    const plan = this._store.getPlan(schoolId, paymentId);
    if (!plan) throw new Error(`Allocation plan for ${paymentId} not found`);
    return plan;
  }

  /**
   * Reject events that cannot safely proceed to invoice allocation.
   * @param event Normalized persisted payment.
   * @param match Family matching decision.
   */
  private validateMatchedPayment(
    event: IIngestedPaymentEvent,
    match: IPaymentFamilyMatch,
  ): void {
    if (match.status !== "matched" || !match.familyId)
      throw new Error("Only payments matched to a family can be allocated");
    if (
      event.classification !== "payment" ||
      event.issue !== null ||
      event.conflicted ||
      event.reversalStatus === "conflicted" ||
      event.reversalStatus === "unmatched"
    ) {
      throw new Error("Payment event is not safe for allocation");
    }
    if (
      event.schoolId !== match.schoolId ||
      event.eventKey !== match.eventKey ||
      event.fingerprint !== match.fingerprint ||
      event.sourceReference !== match.sourceReference ||
      event.currency !== match.currency
    ) {
      throw new Error("Family match does not belong to this payment variant");
    }
    requireText(event.schoolId, "schoolId");
    requireText(event.eventKey, "eventKey");
    requireText(event.fingerprint, "fingerprint");
    if (
      !Number.isSafeInteger(event.netAmountMinor) ||
      event.netAmountMinor <= 0
    )
      throw new Error("Payment must have a positive safe net amount");
    if (!/^[A-Z]{3}$/.test(event.currency))
      throw new Error("Payment currency must be a three-letter code");
  }

  /**
   * Ensure a retry cannot change the identity or financial meaning of a plan.
   * @param plan Previously saved plan.
   * @param event Current event variant.
   * @param match Current exact family decision.
   */
  private assertReplayMatches(
    plan: IPaymentAllocationPlan,
    event: IIngestedPaymentEvent,
    match: IPaymentFamilyMatch,
  ): void {
    if (
      plan.fingerprint !== event.fingerprint ||
      plan.familyId !== match.familyId ||
      plan.source !== event.source ||
      plan.amountMinor !== event.netAmountMinor ||
      plan.currency !== event.currency
    ) {
      throw new Error(
        "Payment identity conflicts with its saved allocation plan",
      );
    }
  }

  /**
   * Check that every supplied invoice belongs to this matched payment.
   * @param invoices Invoice candidates for the family.
   * @param event Payment event.
   * @param familyId Matched family identifier.
   * @param policy Effective invoice ordering policy.
   * @param policy.category_priority Configured invoice-category order.
   * @param policy.tie_break Configured invoice order within each category.
   */
  private validateInvoices(
    invoices: IAllocationInvoice[],
    event: IIngestedPaymentEvent,
    familyId: string,
    policy: {
      category_priority: string[];
      tie_break: string[];
    },
  ): void {
    if (!Array.isArray(invoices)) throw new Error("invoices must be a list");
    if (
      policy.tie_break.some(
        (rule) => rule !== "due_on_asc" && rule !== "invoice_id_asc",
      )
    )
      throw new Error(
        "Allocation policy contains an unsupported tie-break rule",
      );
    const ids = new Set<string>();
    for (const invoice of invoices) {
      requireText(invoice.invoiceId, "invoiceId");
      if (ids.has(invoice.invoiceId))
        throw new Error(`Duplicate invoice ${invoice.invoiceId}`);
      ids.add(invoice.invoiceId);
      if (invoice.schoolId !== event.schoolId || invoice.familyId !== familyId)
        throw new Error(
          `Invoice ${invoice.invoiceId} is outside the matched family`,
        );
      if (invoice.currency !== event.currency)
        throw new Error(
          `Invoice ${invoice.invoiceId} uses a different currency`,
        );
      if (!policy.category_priority.includes(invoice.category))
        throw new Error(
          `Invoice category ${invoice.category} is missing from policy`,
        );
      if (!Number.isSafeInteger(invoice.amountMinor) || invoice.amountMinor < 0)
        throw new Error(`Invoice ${invoice.invoiceId} has an invalid amount`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(invoice.dueOn))
        throw new Error(`Invoice ${invoice.invoiceId} has an invalid due date`);
    }
  }

  /**
   * Sort invoices by configured category order and tie-break rules.
   * @param invoices Eligible family invoices.
   * @param policy Effective allocation policy.
   * @param policy.category_priority Configured invoice-category order.
   * @param policy.tie_break Configured invoice order within each category.
   * @returns Ordered invoice list.
   */
  private orderInvoices(
    invoices: IAllocationInvoice[],
    policy: { category_priority: string[]; tie_break: string[] },
  ): IAllocationInvoice[] {
    const categoryOrder = new Map(
      policy.category_priority.map((category, index) => [category, index]),
    );
    return [...invoices].sort((left, right) => {
      const categoryDifference =
        categoryOrder.get(left.category)! - categoryOrder.get(right.category)!;
      if (categoryDifference !== 0) return categoryDifference;
      for (const rule of policy.tie_break) {
        if (rule === "due_on_asc" && left.dueOn !== right.dueOn)
          return left.dueOn.localeCompare(right.dueOn);
        if (rule === "invoice_id_asc" && left.invoiceId !== right.invoiceId)
          return left.invoiceId.localeCompare(right.invoiceId);
      }
      return 0;
    });
  }

  /**
   * Map the school's overpayment policy to the saved remainder treatment.
   * @param remainderMinor Unallocated amount.
   * @param overpaymentPolicy Configured school policy value.
   * @returns Explicit plan treatment.
   */
  private remainderTreatment(
    remainderMinor: number,
    overpaymentPolicy: unknown,
  ): IPaymentAllocationPlan["remainderTreatment"] {
    if (remainderMinor === 0) return "none";
    if (overpaymentPolicy === "carry_forward_as_credit") return "credit";
    if (overpaymentPolicy === "hold_for_refund") return "refund_hold";
    throw new Error("School has an unsupported overpayment policy");
  }

  /**
   * Create a stable evidence identifier for one payment and invoice pair.
   * @param schoolId Owning school.
   * @param paymentId Stable provider event identity.
   * @param invoiceId Stable invoice identifier.
   * @returns Globally unique allocation evidence identifier.
   */
  private allocationId(
    schoolId: string,
    paymentId: string,
    invoiceId: string,
  ): string {
    return `allocation:${encodeURIComponent(schoolId)}:${encodeURIComponent(paymentId)}:${encodeURIComponent(invoiceId)}`;
  }
}
