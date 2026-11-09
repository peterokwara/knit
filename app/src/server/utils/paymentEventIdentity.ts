import type { IIngestedPaymentEvent } from "../models/ingestion/IIngestedPaymentEvent";

/**
 * Build the stable key shared by event, match, and resolution records.
 * @param eventIdentity Provider event fields that identify one variant.
 * @returns JSON tuple suitable for exact map lookups.
 */
export function paymentEventIdentity(
  eventIdentity: Pick<
    IIngestedPaymentEvent,
    "schoolId" | "eventKey" | "fingerprint"
  >,
): string {
  return JSON.stringify([
    eventIdentity.schoolId,
    eventIdentity.eventKey,
    eventIdentity.fingerprint,
  ]);
}
