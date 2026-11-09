import type { PaymentIngestionFileType } from './IPaymentIngestionFile'

/** Local source details needed to retrieve one provider export. */
export interface IPaymentFileReference {
  /** Name retained as evidence when the file is imported. */
  fileName: string

  /** Provider format that the ingestion stage should adapt. */
  fileType: PaymentIngestionFileType

  /** Local filesystem location to read. */
  location: string
}
