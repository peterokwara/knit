/** One open school invoice that can receive a matched payment. */
export interface IAllocationInvoice {
  /** School that issued the invoice. */
  schoolId: string;
  /** Family that owes the invoice. */
  familyId: string;
  /** Stable invoice identifier. */
  invoiceId: string;
  /** Invoice category used by the school's allocation policy. */
  category: string;
  /** Total invoice amount in minor currency units. */
  amountMinor: number;
  /** Three-letter invoice currency code. */
  currency: string;
  /** ISO calendar date when the invoice is due. */
  dueOn: string;
}
