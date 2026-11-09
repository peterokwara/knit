/** Original source evidence attached to a normalized event variant. */
export interface IPaymentEventObservation {
  /**
   * Name of the file containing this observation.
   */
  sourceFile: string

  /**
   * Stable hash of the original source record.
   */
  rawFingerprint: string

  /**
   * Original source record serialized as JSON.
   */
  rawJson: string
}
