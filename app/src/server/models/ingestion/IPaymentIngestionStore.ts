import type { IIngestedPaymentEvent } from './IIngestedPaymentEvent'
import type { IPaymentEventRecord } from './IPaymentEventRecord'

/** Persistence operations used by the payment ingestion service. */
export interface IPaymentIngestionStore {
  /**
   * Append normalized events and their observations idempotently.
   * @param events Normalized event variants and source evidence.
   */
  saveEvents(events: IPaymentEventRecord[]): void

  /**
   * Read persisted events and all supporting observations for one school.
   * @param schoolId The school whose events should be read.
   * @returns Events sorted by stable provider identity.
   */
  getEvents(schoolId: string): IIngestedPaymentEvent[]
}
