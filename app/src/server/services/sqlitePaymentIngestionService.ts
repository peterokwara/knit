import type { DatabaseSync } from 'node:sqlite'
import type { IIngestedPaymentEvent } from '../models/ingestion/IIngestedPaymentEvent'
import type { IPaymentEventObservation } from '../models/ingestion/IPaymentEventObservation'
import type { IPaymentEventRecord, PaymentEventClassification, PaymentEventSource } from '../models/ingestion/IPaymentEventRecord'
import type { IPaymentIngestionStore } from '../models/ingestion/IPaymentIngestionStore'
import type { IDatabaseRow } from '../models/database/IDatabaseRow'
import { SqliteHelper } from '../utils/sqliteHelper'
import { readInteger, readText } from '../utils/sqliteValues'

function nullableText(row: IDatabaseRow, column: string): string | null {
  const value = row[column]
  if (value !== null && typeof value !== 'string') throw new Error(`Invalid database column ${column}`)
  return value
}

function paymentSource(value: string): PaymentEventSource {
  if (value !== 'mpesa' && value !== 'bank') throw new Error('Invalid payment event source in database')
  return value
}

function eventClassification(value: string): PaymentEventClassification {
  const values: PaymentEventClassification[] = ['payment', 'reversal', 'failed', 'settlement', 'fee', 'debit', 'unclassified']
  if (!values.includes(value as PaymentEventClassification)) throw new Error('Invalid payment event classification in database')
  return value as PaymentEventClassification
}

/** Persist immutable payment events and their source observations in SQLite. */
export class SqlitePaymentIngestionService implements IPaymentIngestionStore {
  /**
   * Initialized SQLite connection for the school payment data.
   */
  private readonly _database: DatabaseSync

  /**
   * Create the payment event store around an initialized connection.
   * @param database - SQLite connection with the payment schema installed.
   */
  constructor(database: DatabaseSync) {
    this._database = database
  }

  /**
   * Append normalized events and their source observations idempotently.
   * @param events - Normalized event variants and source evidence.
   */
  saveEvents(events: IPaymentEventRecord[]): void {
    SqliteHelper.inTransaction(this._database, () => {
      for (const event of events) {
        SqliteHelper.execute(this._database, `INSERT INTO payment_ingestion_events
          (school_id, event_key, fingerprint, source, source_reference, event_kind, classification,
           amount_minor, currency, occurred_at, occurred_on, payment_reference, related_reference, issue)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(school_id, event_key, fingerprint) DO NOTHING`,
        event.schoolId, event.eventKey, event.fingerprint, event.source, event.sourceReference,
        event.eventKind, event.classification, event.amountMinor, event.currency, event.occurredAt,
        event.occurredOn, event.paymentReference, event.relatedReference, event.issue)
        SqliteHelper.execute(this._database, `INSERT INTO payment_ingestion_observations
          (school_id, event_key, fingerprint, source_file, raw_fingerprint, raw_json)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(school_id, event_key, fingerprint, source_file, raw_fingerprint) DO NOTHING`,
        event.schoolId, event.eventKey, event.fingerprint, event.sourceFile, event.rawFingerprint, event.rawJson)
      }
    })
  }

  /**
   * Read events and their source observations for one school.
   * @param schoolId - The school whose events should be read.
   * @returns Events sorted by stable provider identity.
   */
  getEvents(schoolId: string): IIngestedPaymentEvent[] {
    const observations = SqliteHelper.query(this._database, `SELECT event_key, fingerprint, source_file, raw_fingerprint, raw_json
      FROM payment_ingestion_observations WHERE school_id = ? ORDER BY event_key, fingerprint, source_file, raw_fingerprint`, schoolId)
    const observationsByVariant = new Map<string, IPaymentEventObservation[]>()
    for (const row of observations) {
      const eventKey = readText(row, 'event_key')
      const fingerprint = readText(row, 'fingerprint')
      const key = `${eventKey}\u001f${fingerprint}`
      const items = observationsByVariant.get(key) ?? []
      items.push({ sourceFile: readText(row, 'source_file'), rawFingerprint: readText(row, 'raw_fingerprint'), rawJson: readText(row, 'raw_json') })
      observationsByVariant.set(key, items)
    }

    return SqliteHelper.query(this._database, `SELECT event.*,
        COUNT(*) OVER (PARTITION BY event.school_id, event.event_key) AS variant_count
      FROM payment_ingestion_events event
      WHERE school_id = ? ORDER BY event_key, fingerprint`, schoolId)
      .map((row) => this.toEvent(row, observationsByVariant))
  }

  /**
   * Convert one persisted event variant into the public read model.
   * @param row Database event row.
   * @param observationsByVariant Source observations indexed by event identity.
   * @returns The event with conflict state and source observations.
   */
  private toEvent(row: IDatabaseRow, observationsByVariant: Map<string, IPaymentEventObservation[]>): IIngestedPaymentEvent {
    const eventKey = readText(row, 'event_key')
    const fingerprint = readText(row, 'fingerprint')
    const eventKind = readText(row, 'event_kind')
    if (!['payment', 'reversal', 'failed', 'bank_line', 'stk_result', 'other'].includes(eventKind)) throw new Error('Invalid payment event kind in database')
    return {
      schoolId: readText(row, 'school_id'), eventKey, source: paymentSource(readText(row, 'source')),
      sourceReference: readText(row, 'source_reference'), eventKind: eventKind as IIngestedPaymentEvent['eventKind'],
      classification: eventClassification(readText(row, 'classification')), amountMinor: readInteger(row, 'amount_minor'),
      currency: readText(row, 'currency'), occurredAt: nullableText(row, 'occurred_at'), occurredOn: nullableText(row, 'occurred_on'),
      paymentReference: nullableText(row, 'payment_reference'), relatedReference: nullableText(row, 'related_reference'),
      issue: nullableText(row, 'issue'), conflicted: readInteger(row, 'variant_count') > 1,
      observations: observationsByVariant.get(`${eventKey}\u001f${fingerprint}`) ?? [],
    }
  }
}
