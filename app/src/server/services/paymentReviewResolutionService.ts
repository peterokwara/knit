import type { IAllocationInvoice } from "../models/allocation/IAllocationInvoice";
import type { IHeldPaymentReviewItem } from "../models/ingestion/IHeldPaymentReviewItem";
import type { IIngestedPaymentEvent } from "../models/ingestion/IIngestedPaymentEvent";
import type {
  IPaymentFamilyMatch,
  PaymentFamilyHoldReason,
} from "../models/ingestion/IPaymentFamilyMatch";
import type { IPaymentEventReader } from "../models/ingestion/IPaymentEventReader";
import type { IPaymentReviewResolution } from "../models/ingestion/IPaymentReviewResolution";
import type { IPaymentReviewResolutionInput } from "../models/ingestion/IPaymentReviewResolutionInput";
import type { IPaymentReviewResolutionResult } from "../models/ingestion/IPaymentReviewResolutionResult";
import type { IPaymentReviewResolutionStore } from "../models/ingestion/IPaymentReviewResolutionStore";
import type { IPaymentReconciliationContext } from "../models/ingestion/IPaymentReconciliationContext";
import { FamilyInvoiceBalanceService } from "./familyInvoiceBalanceService";
import { PaymentAllocationService } from "./paymentAllocationService";
import { PaymentFamilyMatchingService } from "./paymentFamilyMatchingService";
import { parseInstant, requireText } from "../utils/configurationValidation";
import {
  isPaymentResolutionEligible,
  isSavedResolutionApplicable,
} from "../utils/paymentReviewResolutionRules";

type CorrectableHoldReason = Extract<
  PaymentFamilyHoldReason,
  "missing_reference" | "unknown_reference" | "ambiguous_reference"
>;

function isCorrectableHoldReason(
  reason: PaymentFamilyHoldReason | null,
): reason is CorrectableHoldReason {
  return (
    reason === "missing_reference" ||
    reason === "unknown_reference" ||
    reason === "ambiguous_reference"
  );
}

/** Record a bursar's family decision for eligible held payment events. */
export class PaymentReviewResolutionService {
  /** Persisted provider events shown in the review queue. */
  private readonly _ingestion: IPaymentEventReader;

  /** Automated decisions used to identify correctable holds. */
  private readonly _matching: PaymentFamilyMatchingService;

  /** Policy allocator used after a human confirms a family. */
  private readonly _allocation: PaymentAllocationService;

  /** Evidence-backed family balance reader. */
  private readonly _balances: FamilyInvoiceBalanceService;

  /** Append-only storage for decisions and audit fields. */
  private readonly _store: IPaymentReviewResolutionStore;

  /** School, family, and invoice reference data for safe decisions. */
  private readonly _context: IPaymentReconciliationContext;

  /**
   * Build the resolution service with explicit data and allocation dependencies.
   * @param ingestion Persisted provider event reader.
   * @param matching Automated family matching service.
   * @param allocation Policy-based payment allocation service.
   * @param balances Evidence-backed invoice balance service.
   * @param store Immutable resolution store.
   * @param context School family references and invoice records.
   */
  constructor(
    ingestion: IPaymentEventReader,
    matching: PaymentFamilyMatchingService,
    allocation: PaymentAllocationService,
    balances: FamilyInvoiceBalanceService,
    store: IPaymentReviewResolutionStore,
    context: IPaymentReconciliationContext,
  ) {
    this._ingestion = ingestion;
    this._matching = matching;
    this._allocation = allocation;
    this._balances = balances;
    this._store = store;
    this._context = context;
  }

  /**
   * List held payment candidates and mark which can safely receive a family decision.
   * Already resolved events are omitted from the queue.
   * @returns Review items in the matcher's stable event order.
   */
  listHeldPayments(): IHeldPaymentReviewItem[] {
    const schoolId = this._context.matching.schoolId;
    const events = this._ingestion.getEvents();
    const eventsByIdentity = new Map(
      events.map((event) => [this.eventIdentity(event), event]),
    );
    const resolutions = new Map(
      this._store
        .getResolutions(schoolId)
        .map((resolution) => [this.resolutionIdentity(resolution), resolution]),
    );

    return this._matching
      .matchPayments(events)
      .filter((match) => match.status === "held")
      .flatMap((match) => {
        const event = eventsByIdentity.get(this.matchIdentity(match));
        if (!event || !match.holdReason) return [];
        const resolution = resolutions.get(this.matchIdentity(match));
        if (
          resolution &&
          isSavedResolutionApplicable(event, match, resolution, this._context)
        )
          return [];
        return [
          {
            schoolId: event.schoolId,
            eventKey: event.eventKey,
            fingerprint: event.fingerprint,
            source: event.source,
            sourceReference: event.sourceReference,
            amountMinor: event.amountMinor,
            netAmountMinor: event.netAmountMinor,
            currency: event.currency,
            occurredAt: event.occurredAt,
            occurredOn: event.occurredOn,
            paymentReference: event.paymentReference,
            holdReason: match.holdReason,
            resolutionEligible: isPaymentResolutionEligible(
              event,
              match,
              this._context,
            ),
          },
        ];
      });
  }

  /**
   * Read a saved resolution and its audit fields after the original request ends.
   * @param eventKey Stable provider event identity.
   * @param fingerprint Exact event variant fingerprint.
   * @returns Saved bursar decision, when one exists.
   */
  getResolution(
    eventKey: string,
    fingerprint: string,
  ): IPaymentReviewResolution | undefined {
    requireText(eventKey, "eventKey");
    requireText(fingerprint, "fingerprint");
    return this._store.getResolution(
      this._context.matching.schoolId,
      eventKey,
      fingerprint,
    );
  }

  /**
   * Save an explicit family assignment and allocate under the policy effective
   * when the bursar resolved the payment. An identical retry returns the same
   * immutable audit decision and allocation plan.
   * @param input Event, family, actor, reason, and trusted resolution instant.
   * @returns Saved decision, policy allocation, and updated family balances.
   */
  resolvePayment(
    input: IPaymentReviewResolutionInput,
  ): IPaymentReviewResolutionResult {
    requireText(input.eventKey, "eventKey");
    requireText(input.fingerprint, "fingerprint");
    requireText(input.familyId, "familyId");
    requireText(input.actorId, "actorId");
    requireText(input.reason, "reason");
    const resolvedAt = new Date(parseInstant(input.resolvedAt)).toISOString();
    const family = this._context.matching.families.find(
      (candidate) => candidate.familyId === input.familyId,
    );
    if (!family)
      throw new Error(`Family ${input.familyId} is not in this school`);

    const events = this._ingestion.getEvents();
    const event = events.find(
      (candidate) =>
        candidate.schoolId === this._context.matching.schoolId &&
        candidate.eventKey === input.eventKey &&
        candidate.fingerprint === input.fingerprint,
    );
    if (!event)
      throw new Error(`Payment event ${input.eventKey} was not found`);
    const match = this._matching
      .matchPayments([event])
      .find(
        (candidate) =>
          this.matchIdentity(candidate) === this.eventIdentity(event),
      );
    if (
      !match ||
      !isPaymentResolutionEligible(event, match, this._context) ||
      !isCorrectableHoldReason(match.holdReason)
    )
      throw new Error("Payment event cannot be safely resolved");

    const resolution: IPaymentReviewResolution = {
      schoolId: event.schoolId,
      eventKey: event.eventKey,
      fingerprint: event.fingerprint,
      familyId: family.familyId,
      sourceReference: event.sourceReference,
      originalHoldReason: match.holdReason,
      actorId: input.actorId.trim(),
      reason: input.reason.trim(),
      resolvedAt,
    };
    const saved = this._store.recordResolution(resolution);
    const resolvedMatch: IPaymentFamilyMatch = {
      ...match,
      familyId: saved.familyId,
      matchType: "bursar_resolution",
      status: "matched",
      holdReason: null,
    };
    const familyInvoices = this.invoicesForFamily(saved.familyId);
    const allocationPlan = this._allocation.allocatePayment(
      event,
      resolvedMatch,
      familyInvoices,
      saved.resolvedAt,
    );
    const familyBalance = this._balances.getFamilyBalances(
      saved.schoolId,
      saved.familyId,
      familyInvoices,
    );

    return { resolution: saved, allocationPlan, familyBalance };
  }

  /**
   * Select invoices owned by one configured family.
   * @param familyId Stable family identifier.
   * @returns Family invoice records.
   */
  private invoicesForFamily(familyId: string): IAllocationInvoice[] {
    return this._context.invoices.filter(
      (invoice) => invoice.familyId === familyId,
    );
  }

  /**
   * Build the exact provider-event identity used across service boundaries.
   * @param event Persisted payment event.
   * @returns Identity key.
   */
  private eventIdentity(event: IIngestedPaymentEvent): string {
    return JSON.stringify([event.schoolId, event.eventKey, event.fingerprint]);
  }

  /**
   * Build the same identity from an automated match.
   * @param match Family matching decision.
   * @returns Identity key.
   */
  private matchIdentity(match: IPaymentFamilyMatch): string {
    return JSON.stringify([match.schoolId, match.eventKey, match.fingerprint]);
  }

  /**
   * Build the same identity from a saved resolution.
   * @param resolution Durable resolution record.
   * @returns Identity key.
   */
  private resolutionIdentity(resolution: IPaymentReviewResolution): string {
    return JSON.stringify([
      resolution.schoolId,
      resolution.eventKey,
      resolution.fingerprint,
    ]);
  }
}
