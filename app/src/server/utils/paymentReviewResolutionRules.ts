import type { IIngestedPaymentEvent } from "../models/ingestion/IIngestedPaymentEvent";
import type { IPaymentFamilyMatch } from "../models/ingestion/IPaymentFamilyMatch";
import type { IPaymentReconciliationContext } from "../models/ingestion/IPaymentReconciliationContext";
import type { IPaymentReviewResolution } from "../models/ingestion/IPaymentReviewResolution";

/**
 * Check whether a held payment can receive a safe family assignment.
 * @param event Persisted payment event.
 * @param match Automated decision.
 * @param context School family and billing context.
 * @returns Whether a bursar may resolve the event.
 */
export function isPaymentResolutionEligible(
  event: IIngestedPaymentEvent,
  match: IPaymentFamilyMatch,
  context: IPaymentReconciliationContext,
): boolean {
  return (
    match.status === "held" &&
    (match.holdReason === "missing_reference" ||
      match.holdReason === "unknown_reference" ||
      match.holdReason === "ambiguous_reference") &&
    event.schoolId === context.matching.schoolId &&
    event.classification === "payment" &&
    event.issue === null &&
    !event.conflicted &&
    event.reversalStatus !== "conflicted" &&
    event.reversalStatus !== "unmatched" &&
    event.netAmountMinor > 0 &&
    event.currency === context.matching.billingCurrency
  );
}

/**
 * Check that a saved decision still matches the held provider evidence.
 * @param event Persisted provider event.
 * @param match Current automated decision.
 * @param resolution Durable bursar decision.
 * @param context School family and billing context.
 * @returns Whether the old decision remains safe to apply.
 */
export function isSavedResolutionApplicable(
  event: IIngestedPaymentEvent,
  match: IPaymentFamilyMatch,
  resolution: IPaymentReviewResolution,
  context: IPaymentReconciliationContext,
): boolean {
  return (
    isPaymentResolutionEligible(event, match, context) &&
    resolution.schoolId === event.schoolId &&
    resolution.eventKey === event.eventKey &&
    resolution.fingerprint === event.fingerprint &&
    resolution.sourceReference === event.sourceReference &&
    resolution.originalHoldReason === match.holdReason &&
    context.matching.families.some(
      (family) => family.familyId === resolution.familyId,
    )
  );
}
