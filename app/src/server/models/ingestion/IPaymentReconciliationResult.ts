import type { IPaymentFamilyMatch } from "./IPaymentFamilyMatch";
import type { IFamilyReconciliationBalance } from "./IFamilyReconciliationBalance";

/** Result of ingesting, matching, allocating, and reading school balances. */
export interface IPaymentReconciliationResult {
  /** School whose payment evidence was reconciled. */
  schoolId: string;

  /** Number of persisted provider event variants after import. */
  eventCount: number;

  /** Exact family decisions and review holds for eligible payment events. */
  matches: IPaymentFamilyMatch[];

  /** Number of positive matched payments submitted to allocation. */
  allocatedPaymentCount: number;

  /** Balance and evidence view for every configured family. */
  familyBalances: IFamilyReconciliationBalance[];
}
