import type { PaymentFamilyHoldReason } from "./IPaymentFamilyMatch";
import type { PaymentEventSource } from "./IPaymentEventRecord";

/** Payment evidence and actionability shown in the bursar review queue. */
export interface IHeldPaymentReviewItem {
  /** School that owns the event. */
  schoolId: string;

  /** Stable provider event identity. */
  eventKey: string;

  /** Fingerprint of the exact event variant. */
  fingerprint: string;

  /** Provider that supplied the payment. */
  source: PaymentEventSource;

  /** Provider transaction or bank statement reference. */
  sourceReference: string;

  /** Source amount in minor currency units. */
  amountMinor: number;

  /** Amount remaining after any linked reversals. */
  netAmountMinor: number;

  /** Three-letter transaction currency code. */
  currency: string;

  /** Provider timestamp, when supplied. */
  occurredAt: string | null;

  /** Provider date, when supplied without a time. */
  occurredOn: string | null;

  /** Exact parent-entered reference retained from the provider. */
  paymentReference: string | null;

  /** Current automated reason the event is held. */
  holdReason: PaymentFamilyHoldReason;

  /** Whether this event can be safely assigned to a family now. */
  resolutionEligible: boolean;
}
