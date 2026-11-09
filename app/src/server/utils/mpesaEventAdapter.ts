import type { IPaymentIngestionContext } from "../models/ingestion/IPaymentIngestionContext";
import type { IPaymentEventRecord } from "../models/ingestion/IPaymentEventRecord";
import {
  fingerprint,
  parseAmountMinor,
  parseLocalTransactionTime,
} from "./paymentIngestionValues";
import { makePaymentEventRecord } from "./paymentEventFactory";

/** Parsed JSON object from a provider callback. */
type JsonObject = Record<string, unknown>;

/**
 * Require a JSON object and reject arrays or primitive values.
 * @param value Parsed JSON value.
 * @param label Field label for validation errors.
 * @returns The value as a JSON object.
 */
function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as JsonObject;
}

/**
 * Require a non-empty string or numeric identifier.
 * @param value Provider-supplied value.
 * @param label Field label for validation errors.
 * @returns Trimmed text representation.
 */
function requiredText(value: unknown, label: string): string {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    String(value).trim() === ""
  )
    throw new Error(`${label} must be non-empty text`);
  return String(value).trim();
}

/**
 * Convert an optional string or numeric identifier to trimmed text.
 * @param value Provider-supplied value.
 * @returns Trimmed text, or null when the value is absent or unsupported.
 */
function optionalText(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

/**
 * Normalize one M-Pesa callback file while retaining each original callback.
 * @param contents The JSON file contents.
 * @param fileName The provider file name.
 * @param context School and provider identifiers used to validate events.
 * @returns Normalized events and their original observations.
 */
export function adaptMpesaEvents(
  contents: string,
  fileName: string,
  context: IPaymentIngestionContext,
): IPaymentEventRecord[] {
  const parsed: unknown = JSON.parse(contents);
  if (!Array.isArray(parsed))
    throw new Error(`${fileName} must contain a JSON array`);
  return parsed.map((rawValue: unknown): IPaymentEventRecord => {
    const raw = object(rawValue, "M-Pesa event");
    if (raw.source !== "mpesa")
      throw new Error("M-Pesa event source must be mpesa");
    const eventName = requiredText(raw.event, "M-Pesa event type");
    const payload = object(raw.payload, "M-Pesa payload");

    if (eventName === "c2b.confirmation") {
      const sourceReference = requiredText(payload.TransID, "TransID");
      const paybill = requiredText(
        payload.BusinessShortCode,
        "BusinessShortCode",
      );
      if (paybill !== context.mpesaPaybill)
        throw new Error(
          `M-Pesa paybill ${paybill} does not belong to ${context.schoolId}`,
        );
      const amountMinor = parseAmountMinor(payload.TransAmount, "TransAmount");
      if (amountMinor <= 0)
        throw new Error("TransAmount must be greater than zero");
      return makePaymentEventRecord(context, fileName, raw, {
        eventKey: `mpesa:c2b:${sourceReference}`,
        source: "mpesa",
        sourceReference,
        eventKind: "payment",
        classification: "payment",
        amountMinor,
        currency: "KES",
        occurredAt: parseLocalTransactionTime(
          payload.TransTime,
          context.timeZone,
        ),
        occurredOn: null,
        paymentReference: optionalText(payload.BillRefNumber),
        relatedReference: null,
        issue: null,
      });
    }

    if (eventName === "reversal") {
      const sourceReference = requiredText(payload.TransID, "reversal TransID");
      const amountMinor = parseAmountMinor(
        payload.TransAmount,
        "reversal TransAmount",
      );
      if (amountMinor <= 0)
        throw new Error("reversal TransAmount must be greater than zero");
      return makePaymentEventRecord(context, fileName, raw, {
        eventKey: `mpesa:reversal:${sourceReference}`,
        source: "mpesa",
        sourceReference,
        eventKind: "reversal",
        classification: "reversal",
        amountMinor: -amountMinor,
        currency: "KES",
        occurredAt: parseLocalTransactionTime(
          payload.TransTime,
          context.timeZone,
        ),
        occurredOn: null,
        paymentReference: null,
        relatedReference: requiredText(
          payload.OriginalTransID,
          "OriginalTransID",
        ),
        issue: null,
      });
    }

    if (eventName === "stk.result") {
      const sourceReference = requiredText(
        payload.CheckoutRequestID,
        "CheckoutRequestID",
      );
      const resultCode = payload.ResultCode;
      if (typeof resultCode !== "number" && typeof resultCode !== "string")
        throw new Error("ResultCode must be a number or numeric string");
      const numericResultCode = Number(resultCode);
      if (!Number.isSafeInteger(numericResultCode))
        throw new Error("ResultCode must be an integer");
      const failed = numericResultCode !== 0;
      return makePaymentEventRecord(context, fileName, raw, {
        eventKey: `mpesa:stk:${sourceReference}`,
        source: "mpesa",
        sourceReference,
        eventKind: "stk_result",
        classification: failed ? "failed" : "unclassified",
        amountMinor: 0,
        currency: "KES",
        occurredAt: null,
        occurredOn: null,
        paymentReference: optionalText(payload.AccountReference),
        relatedReference: null,
        issue: failed
          ? null
          : "An STK result alone does not confirm a settled payment.",
      });
    }

    const sourceReference =
      optionalText(payload.TransID) ??
      optionalText(payload.CheckoutRequestID) ??
      fingerprint(raw);
    return makePaymentEventRecord(context, fileName, raw, {
      eventKey: `mpesa:other:${sourceReference}`,
      source: "mpesa",
      sourceReference,
      eventKind: "other",
      classification: "unclassified",
      amountMinor: 0,
      currency: "KES",
      occurredAt: null,
      occurredOn: null,
      paymentReference: null,
      relatedReference: null,
      issue: `Unsupported M-Pesa event type: ${eventName}`,
    });
  });
}
