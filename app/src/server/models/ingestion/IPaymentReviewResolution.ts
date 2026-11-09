import type { PaymentFamilyHoldReason } from "./IPaymentFamilyMatch";

/** One immutable bursar decision for a held payment event variant. */
export interface IPaymentReviewResolution {
  /** School that owns the provider event. */
  schoolId: string;

  /** Stable provider event identity. */
  eventKey: string;

  /** Fingerprint of the exact financial event variant being resolved. */
  fingerprint: string;

  /** Family chosen by the bursar. */
  familyId: string;

  /** Provider transaction reference retained with the decision. */
  sourceReference: string;

  /** Original automated reason the event was held. */
  originalHoldReason: Extract<
    PaymentFamilyHoldReason,
    "missing_reference" | "unknown_reference" | "ambiguous_reference"
  >;

  /** Authenticated staff identifier supplied by the caller. */
  actorId: string;

  /** Bursar's explanation for choosing this family. */
  reason: string;

  /** Trusted instant when the bursar made the decision. */
  resolvedAt: string;
}
