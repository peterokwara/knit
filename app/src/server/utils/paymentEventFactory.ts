import path from "node:path";
import type { IPaymentIngestionContext } from "../models/ingestion/IPaymentIngestionContext";
import type { IPaymentEventRecord } from "../models/ingestion/IPaymentEventRecord";
import { fingerprint, stableJson } from "./paymentIngestionValues";

/** Normalized event fields before school and source evidence are attached. */
export type PaymentEventFields = Omit<
  IPaymentEventRecord,
  "schoolId" | "fingerprint" | "sourceFile" | "rawFingerprint" | "rawJson"
>;

/**
 * Attach stable identity and source evidence to a normalized event.
 * @param context The school that owns the event.
 * @param fileName The source file name.
 * @param raw The original source record.
 * @param event Normalized financial event fields.
 * @param identityDetails Additional normalized source fields that affect event identity.
 * @returns The event and its observation evidence.
 */
export function makePaymentEventRecord(
  context: IPaymentIngestionContext,
  fileName: string,
  raw: unknown,
  event: PaymentEventFields,
  identityDetails?: unknown,
): IPaymentEventRecord {
  const normalized = {
    eventKey: event.eventKey,
    source: event.source,
    sourceReference: event.sourceReference,
    eventKind: event.eventKind,
    classification: event.classification,
    amountMinor: event.amountMinor,
    currency: event.currency,
    occurredAt: event.occurredAt,
    occurredOn: event.occurredOn,
    paymentReference: event.paymentReference,
    relatedReference: event.relatedReference,
    issue: event.issue,
  };
  return {
    ...event,
    schoolId: context.schoolId,
    fingerprint: fingerprint(
      identityDetails === undefined
        ? normalized
        : { event: normalized, identityDetails },
    ),
    sourceFile: path.basename(fileName),
    rawFingerprint: fingerprint(raw),
    rawJson: stableJson(raw),
  };
}
