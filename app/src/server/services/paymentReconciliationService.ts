import type { IAllocationInvoice } from "../models/allocation/IAllocationInvoice";
import type { IFamilyReconciliationBalance } from "../models/ingestion/IFamilyReconciliationBalance";
import type { IIngestedPaymentEvent } from "../models/ingestion/IIngestedPaymentEvent";
import type { IPaymentFamilyMatch } from "../models/ingestion/IPaymentFamilyMatch";
import type { IPaymentIngestionFile } from "../models/ingestion/IPaymentIngestionFile";
import type { IPaymentReconciliationContext } from "../models/ingestion/IPaymentReconciliationContext";
import type { IPaymentReconciliationResult } from "../models/ingestion/IPaymentReconciliationResult";
import type { IPaymentReviewResolution } from "../models/ingestion/IPaymentReviewResolution";
import type { IPaymentReviewResolutionStore } from "../models/ingestion/IPaymentReviewResolutionStore";
import { FamilyInvoiceBalanceService } from "./familyInvoiceBalanceService";
import { PaymentAllocationService } from "./paymentAllocationService";
import { PaymentFamilyMatchingService } from "./paymentFamilyMatchingService";
import { PaymentIngestionService } from "./paymentIngestionService";
import { parseInstant, requireText } from "../utils/configurationValidation";
import { isSavedResolutionApplicable } from "../utils/paymentReviewResolutionRules";

/** Connect imported provider evidence to policy allocations and family reads. */
export class PaymentReconciliationService {
  /** Durable importer for normalized payment events. */
  private readonly _ingestion: PaymentIngestionService;

  /** Exact-reference matcher for the school's families. */
  private readonly _matching: PaymentFamilyMatchingService;

  /** Policy-aware, idempotent allocation service. */
  private readonly _allocation: PaymentAllocationService;

  /** Evidence-backed invoice balance reader. */
  private readonly _balances: FamilyInvoiceBalanceService;

  /** School and invoice context used for the full reconciliation pass. */
  private readonly _context: IPaymentReconciliationContext;

  /** Durable bursar decisions that override automated review holds. */
  private readonly _resolutions: IPaymentReviewResolutionStore;

  /**
   * Compose existing service boundaries for a complete reconciliation pass.
   * @param ingestion Provider event importer and persisted event reader.
   * @param matching Exact family matcher.
   * @param allocation School policy allocation service.
   * @param balances Evidence-backed invoice balance reader.
   * @param context School family references and invoice records.
   * @param resolutions Durable bursar decisions for held event variants.
   */
  constructor(
    ingestion: PaymentIngestionService,
    matching: PaymentFamilyMatchingService,
    allocation: PaymentAllocationService,
    balances: FamilyInvoiceBalanceService,
    context: IPaymentReconciliationContext,
    resolutions: IPaymentReviewResolutionStore,
  ) {
    this._ingestion = ingestion;
    this._matching = matching;
    this._allocation = allocation;
    this._balances = balances;
    this._context = context;
    this._resolutions = resolutions;
  }

  /**
   * Import files, match eligible payments, allocate safe positive matches, then
   * read every configured family's invoice balances from persisted evidence.
   * Repeating the call or changing file order preserves existing event plans.
   * @param files Provider file contents already retrieved by the caller.
   * @param allocationAt Trusted server timestamp used for new allocations.
   * @returns Reconciliation decisions, allocation count, and family balances.
   */
  processFiles(
    files: IPaymentIngestionFile[],
    allocationAt: string,
  ): IPaymentReconciliationResult {
    requireText(allocationAt, "allocationAt");
    parseInstant(allocationAt);
    if (this._context.matching.schoolId.trim() === "")
      throw new Error("schoolId must be non-empty text");
    this.validateInvoices(
      this._context.matching.schoolId,
      this._context.invoices,
    );

    this._ingestion.importFiles(files);
    const events = this._ingestion.getEvents();
    const savedResolutions = new Map(
      this._resolutions
        .getResolutions(this._context.matching.schoolId)
        .map((resolution) => [this.resolutionIdentity(resolution), resolution]),
    );
    const eventsByIdentity = new Map(
      events.map((event) => [this.eventIdentity(event), event]),
    );
    const matches = this._matching.matchPayments(events).map((match) => {
      const resolution = savedResolutions.get(this.matchIdentity(match));
      if (!resolution) return match;
      const event = eventsByIdentity.get(this.matchIdentity(match));
      if (
        !event ||
        !isSavedResolutionApplicable(event, match, resolution, this._context)
      )
        return match;
      return {
        ...match,
        familyId: resolution.familyId,
        matchType: "bursar_resolution" as const,
        status: "matched" as const,
        holdReason: null,
      };
    });
    let allocatedPaymentCount = 0;

    for (const match of matches) {
      if (match.status !== "matched") continue;
      if (!match.familyId)
        throw new Error(`Matched event ${match.eventKey} has no family`);
      const event = eventsByIdentity.get(this.matchIdentity(match));
      if (!event)
        throw new Error(`Matched event ${match.eventKey} was not imported`);
      if (event.classification !== "payment" || event.netAmountMinor <= 0)
        continue;
      const familyInvoices = this.invoicesForFamily(match.familyId);
      this._allocation.allocatePayment(
        event,
        match,
        familyInvoices,
        allocationAt,
      );
      allocatedPaymentCount += 1;
    }

    const familyBalances: IFamilyReconciliationBalance[] =
      this._context.matching.families.map((family) => ({
        familyId: family.familyId,
        familyReference: family.familyReference,
        invoices: this._balances.getFamilyBalances(
          this._context.matching.schoolId,
          family.familyId,
          this.invoicesForFamily(family.familyId),
        ),
      }));

    return {
      schoolId: this._context.matching.schoolId,
      eventCount: events.length,
      matches,
      allocatedPaymentCount,
      familyBalances,
    };
  }

  /**
   * Select the school's invoices owned by one family.
   * @param familyId Stable family identifier.
   * @returns Invoice records for the family.
   */
  private invoicesForFamily(familyId: string): IAllocationInvoice[] {
    return this._context.invoices.filter(
      (invoice) => invoice.familyId === familyId,
    );
  }

  /**
   * Validate invoice context before writing any allocation.
   * @param schoolId School being reconciled.
   * @param invoices Invoice reference data.
   */
  private validateInvoices(
    schoolId: string,
    invoices: IAllocationInvoice[],
  ): void {
    if (!Array.isArray(invoices)) throw new Error("invoices must be a list");
    const familyIds = new Set(
      this._context.matching.families.map(({ familyId }) => familyId),
    );
    const invoiceIds = new Set<string>();
    for (const invoice of invoices) {
      requireText(invoice.invoiceId, "invoiceId");
      if (invoiceIds.has(invoice.invoiceId))
        throw new Error(`Duplicate invoice ${invoice.invoiceId}`);
      invoiceIds.add(invoice.invoiceId);
      if (invoice.schoolId !== schoolId || !familyIds.has(invoice.familyId))
        throw new Error(
          `Invoice ${invoice.invoiceId} is outside this school context`,
        );
    }
  }

  /**
   * Build the full persisted identity used to associate a match and event.
   * @param event Persisted event variant.
   * @returns Identity key.
   */
  private eventIdentity(event: IIngestedPaymentEvent): string {
    return JSON.stringify([event.schoolId, event.eventKey, event.fingerprint]);
  }

  /**
   * Build the same identity key from a matching decision.
   * @param match Family decision.
   * @returns Identity key.
   */
  private matchIdentity(match: IPaymentFamilyMatch): string {
    return JSON.stringify([match.schoolId, match.eventKey, match.fingerprint]);
  }

  /**
   * Build the same identity key from a durable resolution.
   * @param resolution Bursar decision for an event variant.
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
