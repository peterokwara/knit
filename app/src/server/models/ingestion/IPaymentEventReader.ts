import type { IIngestedPaymentEvent } from "./IIngestedPaymentEvent";

/** Read normalized payment events from one configured school. */
export interface IPaymentEventReader {
  /**
   * Read persisted event variants and their source observations.
   * @returns Events in stable provider identity order.
   */
  getEvents(): IIngestedPaymentEvent[];
}
