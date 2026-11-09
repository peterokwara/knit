import { readFileSync } from 'node:fs'
import type { IPaymentFileReference } from '../models/ingestion/IPaymentFileReference'
import type { IPaymentIngestionFile } from '../models/ingestion/IPaymentIngestionFile'

/** Retrieve provider file contents without interpreting their formats. */
export class PaymentFileRetrievalService {
  /**
   * Read each referenced local file as UTF-8 text.
   * @param references - File names, formats, and local locations to retrieve.
   * @returns Provider files ready for format adaptation.
   */
  retrieveFiles(references: IPaymentFileReference[]): IPaymentIngestionFile[] {
    if (references.length === 0) throw new Error('At least one payment file reference is required')
    return references.map((reference) => {
      if (!reference.fileName.trim()) throw new Error('fileName must be non-empty text')
      if (!reference.location.trim()) throw new Error(`location must be non-empty for ${reference.fileName}`)
      return {
        fileName: reference.fileName,
        fileType: reference.fileType,
        contents: readFileSync(reference.location, 'utf8'),
      }
    })
  }
}
