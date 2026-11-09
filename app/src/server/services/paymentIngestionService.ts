import type { IIngestedPaymentEvent } from '../models/ingestion/IIngestedPaymentEvent'
import type { IPaymentIngestionContext } from '../models/ingestion/IPaymentIngestionContext'
import type { IPaymentIngestionFile } from '../models/ingestion/IPaymentIngestionFile'
import type { IPaymentIngestionStore } from '../models/ingestion/IPaymentIngestionStore'
import { adaptBankStatement } from '../utils/bankStatementAdapter'
import { adaptMpesaEvents } from '../utils/mpesaEventAdapter'
import type { IPaymentEventRecord } from '../models/ingestion/IPaymentEventRecord'

/** Validate source files and append their normalized evidence. */
export class PaymentIngestionService {
  /**
   * Persistence for normalized payment events and source observations.
   */
  private readonly _store: IPaymentIngestionStore

  /**
   * School identifiers used to validate provider records.
   */
  private readonly _context: IPaymentIngestionContext

  /**
   * Create the importer with its school context and event store.
   * @param store - Persistence for normalized events and observations.
   * @param context - The school's provider identifiers and accounts.
   */
  constructor(store: IPaymentIngestionStore, context: IPaymentIngestionContext) {
    this._store = store
    this._context = context
  }

  /**
   * Import provider files atomically and idempotently.
   * @param files - Provider export files to import.
   */
  importFiles(files: IPaymentIngestionFile[]): void {
    if (this._context.schoolId.trim() === '') throw new Error('schoolId must be non-empty text')
    if (this._context.timeZone.trim() === '') throw new Error('timeZone must be non-empty text')
    if (this._context.mpesaPaybill.trim() === '') throw new Error('mpesaPaybill must be non-empty text')
    if (files.length === 0) throw new Error('At least one payment file is required')
    const records: IPaymentEventRecord[] = []
    for (const file of files) {
      if (!file.fileName.trim()) throw new Error('fileName must be non-empty text')
      if (file.fileType === 'mpesa-json') records.push(...adaptMpesaEvents(file.contents, file.fileName, this._context))
      else if (file.fileType === 'bank-csv') records.push(...adaptBankStatement(file.contents, file.fileName, this._context))
      else throw new Error(`Unsupported payment file type for ${file.fileName}`)
    }
    this._store.saveEvents(records)
  }

  /**
   * Read persisted events and their original provider observations.
   * @returns Events for the configured school in stable order.
   */
  getEvents(): IIngestedPaymentEvent[] {
    return this._store.getEvents(this._context.schoolId)
  }
}
