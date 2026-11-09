import type { IIngestedPaymentEvent } from "../models/ingestion/IIngestedPaymentEvent";
import type {
  IPaymentFamilyMatch,
  PaymentFamilyMatchType,
} from "../models/ingestion/IPaymentFamilyMatch";
import type { IPaymentFamilyMatchingContext } from "../models/ingestion/IPaymentFamilyMatchingContext";
import type { IPaymentFamilyReference } from "../models/ingestion/IPaymentFamilyReference";

/** Match payment references to one family and hold unsafe cases for review. */
export class PaymentFamilyMatchingService {
  /** School and family data used for exact reference matching. */
  private readonly _context: IPaymentFamilyMatchingContext;

  /** Family candidates indexed by normalized parent-facing reference. */
  private readonly _familiesByReference: Map<
    string,
    Map<string, Set<PaymentFamilyMatchType>>
  >;

  /**
   * Build a family reference index for one school.
   * @param context School billing currency and family references.
   */
  constructor(context: IPaymentFamilyMatchingContext) {
    this._context = context;
    this._familiesByReference = this.createReferenceIndex(context.families);
  }

  /**
   * Match confirmed payments without changing the persisted provider events.
   * @param events Persisted event variants from the ingestion service.
   * @returns One matched or held decision per candidate payment variant.
   */
  matchPayments(events: IIngestedPaymentEvent[]): IPaymentFamilyMatch[] {
    return events
      .filter(
        (event) =>
          event.classification === "payment" ||
          (event.classification === "unclassified" && event.amountMinor > 0),
      )
      .map((event) => this.matchPayment(event));
  }

  /**
   * Build an exact, case-insensitive index for family and admission references.
   * @param families School family records.
   * @returns Reference-to-family candidates and matching reference kinds.
   */
  private createReferenceIndex(
    families: IPaymentFamilyReference[],
  ): Map<string, Map<string, Set<PaymentFamilyMatchType>>> {
    const index = new Map<string, Map<string, Set<PaymentFamilyMatchType>>>();
    for (const family of families) {
      this.addReference(
        index,
        family.familyReference,
        family.familyId,
        "family_reference",
      );
      for (const admissionNumber of family.admissionNumbers) {
        this.addReference(
          index,
          admissionNumber,
          family.familyId,
          "admission_number",
        );
      }
    }
    return index;
  }

  /**
   * Add a reference without losing collisions between different families.
   * @param index Reference candidates being built.
   * @param reference Parent-facing family or admission reference.
   * @param familyId Stable family identifier.
   * @param matchType Kind of reference being indexed.
   */
  private addReference(
    index: Map<string, Map<string, Set<PaymentFamilyMatchType>>>,
    reference: string,
    familyId: string,
    matchType: PaymentFamilyMatchType,
  ): void {
    const key = this.normalizeReference(reference);
    if (!key) return;
    const families =
      index.get(key) ?? new Map<string, Set<PaymentFamilyMatchType>>();
    const matchTypes =
      families.get(familyId) ?? new Set<PaymentFamilyMatchType>();
    matchTypes.add(matchType);
    families.set(familyId, matchTypes);
    index.set(key, families);
  }

  /**
   * Make one decision for a confirmed incoming payment.
   * @param event Persisted provider event variant.
   * @returns Exact family match or a review hold with its reason.
   */
  private matchPayment(event: IIngestedPaymentEvent): IPaymentFamilyMatch {
    const base = {
      schoolId: event.schoolId,
      eventKey: event.eventKey,
      fingerprint: event.fingerprint,
      sourceReference: event.sourceReference,
      paymentReference: event.paymentReference,
      currency: event.currency,
    };
    if (event.schoolId !== this._context.schoolId)
      return this.held(base, null, null, "school_mismatch");
    if (event.conflicted || event.reversalStatus === "conflicted")
      return this.held(base, null, null, "event_conflict");

    const reference = this.normalizeReference(event.paymentReference ?? "");
    if (!reference) return this.held(base, null, null, "missing_reference");
    if (event.classification === "unclassified" || event.issue) {
      return this.held(base, null, null, "source_validation_issue");
    }

    const candidates = this._familiesByReference.get(reference);
    if (!candidates) return this.held(base, null, null, "unknown_reference");
    if (candidates.size > 1)
      return this.held(base, null, null, "ambiguous_reference");

    const [familyId, matchTypes] = candidates.entries().next().value as [
      string,
      Set<PaymentFamilyMatchType>,
    ];
    const matchType = this.matchType(matchTypes);
    if (event.currency !== this._context.billingCurrency) {
      return this.held(
        base,
        familyId,
        matchType,
        "currency_conversion_unavailable",
      );
    }
    return {
      ...base,
      familyId,
      matchType,
      status: "matched",
      holdReason: null,
    };
  }

  /**
   * Return a held decision while retaining any safe exact family match.
   * @param event Stable fields shared by all outcomes.
   * @param familyId Exact family, when the reference identifies one.
   * @param matchType Kind of exact reference, when matched.
   * @param holdReason Reason automatic allocation must stop.
   * @returns A review decision.
   */
  private held(
    event: Pick<
      IPaymentFamilyMatch,
      | "schoolId"
      | "eventKey"
      | "fingerprint"
      | "sourceReference"
      | "paymentReference"
      | "currency"
    >,
    familyId: string | null,
    matchType: PaymentFamilyMatchType | null,
    holdReason: IPaymentFamilyMatch["holdReason"],
  ): IPaymentFamilyMatch {
    return { ...event, familyId, matchType, status: "held", holdReason };
  }

  /**
   * Normalize only case and surrounding whitespace; never repair a reference.
   * @param reference Parent-entered identifier.
   * @returns Lookup key.
   */
  private normalizeReference(reference: string): string {
    return reference.trim().toUpperCase();
  }

  /**
   * Describe whether the exact text matched a family reference, admission, or both.
   * @param matchTypes Exact match kinds for the selected family.
   * @returns A concise match description.
   */
  private matchType(
    matchTypes: Set<PaymentFamilyMatchType>,
  ): PaymentFamilyMatchType {
    if (matchTypes.size > 1) return "both";
    return matchTypes.values().next().value as PaymentFamilyMatchType;
  }
}
