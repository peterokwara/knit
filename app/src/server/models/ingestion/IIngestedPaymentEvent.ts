import type { IPaymentEventObservation } from "./IPaymentEventObservation";
import type {
  PaymentEventClassification,
  PaymentEventKind,
  PaymentEventSource,
} from "./IPaymentEventRecord";

/** A persisted normalized event variant with its source evidence. */
export interface IIngestedPaymentEvent {
  /**
   * School that owns the event.
   */
  schoolId: string;

  /**
   * Stable provider-specific event identity.
   */
  eventKey: string;

  /**
   * Normalized event fingerprint that distinguishes conflicting variants.
   */
  fingerprint: string;

  /**
   * Provider that supplied the event.
   */
  source: PaymentEventSource;

  /**
   * Provider transaction or bank statement reference.
   */
  sourceReference: string;

  /**
   * Provider event kind.
   */
  eventKind: PaymentEventKind;

  /**
   * Financial meaning assigned to the event.
   */
  classification: PaymentEventClassification;

  /**
   * Signed transaction amount in minor currency units.
   */
  amountMinor: number;

  /**
   * Amount eligible for payment totals after linked reversals. Held events return zero.
   */
  netAmountMinor: number;

  /**
   * Three-letter ISO currency code.
   */
  currency: string;

  /**
   * Exact transaction instant, when supplied by the source.
   */
  occurredAt: string | null;

  /**
   * Calendar date, when the source supplies date-only precision.
   */
  occurredOn: string | null;

  /**
   * Parent-entered admission or family reference, when present.
   */
  paymentReference: string | null;

  /**
   * Original provider transaction reference for a reversal.
   */
  relatedReference: string | null;

  /**
   * Reason the event requires a human or later reconciliation step.
   */
  issue: string | null;

  /**
   * True when the same event identity has conflicting financial variants.
   */
  conflicted: boolean;

  /**
   * How reversals relate to this event.
   */
  reversalStatus: "not_reversal" | "matched" | "unmatched" | "conflicted";

  /**
   * Original provider observations retained for this variant.
   */
  observations: IPaymentEventObservation[];
}
