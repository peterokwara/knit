/** The provider that supplied the event. */
export type PaymentEventSource = "mpesa" | "bank";

/** The source-level event kind retained during normalization. */
export type PaymentEventKind =
  "payment" | "reversal" | "failed" | "bank_line" | "stk_result" | "other";

/** The financial meaning assigned to an imported provider event. */
export type PaymentEventClassification =
  | "payment"
  | "reversal"
  | "failed"
  | "settlement"
  | "fee"
  | "debit"
  | "unclassified";

/** One normalized provider event and one source observation. */
export interface IPaymentEventRecord {
  /**
   * The school that owns the event.
   */
  schoolId: string;

  /**
   * Stable provider-specific identity for this event.
   */
  eventKey: string;

  /**
   * Hash of normalized fields that affect the event's financial meaning.
   */
  fingerprint: string;

  /**
   * Provider that supplied the event.
   */
  source: PaymentEventSource;

  /**
   * Provider's transaction or statement reference.
   */
  sourceReference: string;

  /**
   * The provider event kind, retained independently from its classification.
   */
  eventKind: PaymentEventKind;

  /**
   * Financial meaning used by later reconciliation and allocation steps.
   */
  classification: PaymentEventClassification;

  /**
   * Signed transaction amount in minor currency units.
   */
  amountMinor: number;

  /**
   * Three-letter ISO currency code.
   */
  currency: string;

  /**
   * Exact transaction instant when the source supplies a time.
   */
  occurredAt: string | null;

  /**
   * Calendar date when the source supplies only a date.
   */
  occurredOn: string | null;

  /**
   * Parent-entered admission or family reference, when present.
   */
  paymentReference: string | null;

  /**
   * Original transaction reference for a reversal, when present.
   */
  relatedReference: string | null;

  /**
   * Reason the source record must remain outside automatic payment totals.
   */
  issue: string | null;

  /**
   * Name of the source file containing this observation.
   */
  sourceFile: string;

  /**
   * Hash of the stable serialization of the original source record.
   */
  rawFingerprint: string;

  /**
   * Stable JSON serialization of the original source record.
   */
  rawJson: string;
}
