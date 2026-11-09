import type { IExpectedPaymentAllocationPreview } from "../allocation/IExpectedPaymentAllocationPreview";

/** Bursar's explicit decision for one correctable held payment. */
export interface IPaymentReviewResolutionInput {
  /** Stable provider event identity. */
  eventKey: string;

  /** Fingerprint of the exact event variant shown for review. */
  fingerprint: string;

  /** Family selected by the bursar. */
  familyId: string;

  /** Authenticated staff identifier from the application boundary. */
  actorId: string;

  /** Why the bursar selected this family. */
  reason: string;

  /** Trusted server instant when the bursar confirms the decision. */
  resolvedAt: string;

  /** Policy version the bursar confirmed in the preview. */
  expectedPolicyVersion?: number;

  /** Invoice allocations and remainder shown in the confirmation preview. */
  expectedPlan?: IExpectedPaymentAllocationPreview;
}
