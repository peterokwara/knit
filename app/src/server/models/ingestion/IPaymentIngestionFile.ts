/** The supported file formats for payment-provider evidence. */
export type PaymentIngestionFileType = 'mpesa-json' | 'bank-csv'

/** Contents and source type of one provider export. */
export interface IPaymentIngestionFile {
  /**
   * Stable source file name retained with each imported observation.
   */
  fileName: string

  /**
   * The file format selected by the caller.
   */
  fileType: PaymentIngestionFileType

  /**
   * The complete file contents.
   */
  contents: string
}
