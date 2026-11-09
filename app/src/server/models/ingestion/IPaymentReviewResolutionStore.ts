import type { IPaymentReviewResolution } from "./IPaymentReviewResolution";

/** Durable append-only storage for bursar payment decisions. */
export interface IPaymentReviewResolutionStore {
  /**
   * Read the decision for one exact event variant.
   * @param schoolId School that owns the payment.
   * @param eventKey Stable provider event identity.
   * @param fingerprint Exact event variant fingerprint.
   * @returns Saved decision, when one exists.
   */
  getResolution(
    schoolId: string,
    eventKey: string,
    fingerprint: string,
  ): IPaymentReviewResolution | undefined;

  /**
   * Read every saved decision for a school in stable event order.
   * @param schoolId School whose resolutions should be read.
   * @returns Immutable decisions.
   */
  getResolutions(schoolId: string): IPaymentReviewResolution[];

  /**
   * Append a decision or return an identical decision after a retry.
   * @param resolution Bursar decision and event identity.
   * @returns The durable decision.
   */
  recordResolution(
    resolution: IPaymentReviewResolution,
  ): IPaymentReviewResolution;
}
