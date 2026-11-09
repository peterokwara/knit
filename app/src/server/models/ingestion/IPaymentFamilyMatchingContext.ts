import type { IPaymentFamilyReference } from "./IPaymentFamilyReference";

/** School and family data needed to make a payment match decision. */
export interface IPaymentFamilyMatchingContext {
  /** School that owns the payments and family records. */
  schoolId: string;

  /** Currency used to state the school's invoice balances. */
  billingCurrency: string;

  /** Exact family and learner references that identify payment owners. */
  families: IPaymentFamilyReference[];
}
