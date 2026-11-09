/** A bank account owned by the school and its statement currency. */
export interface IPaymentIngestionAccount {
  /**
   * The account number as it appears in the bank export.
   */
  accountNo: string;

  /**
   * The currency used by transactions on this account.
   */
  currency: string;
}

/** School identifiers needed to recognize its payment-provider records. */
export interface IPaymentIngestionContext {
  /**
   * The school that owns the imported payment records.
   */
  schoolId: string;

  /**
   * The time zone used by M-Pesa's local transaction timestamps.
   */
  timeZone: string;

  /**
   * The school's M-Pesa Paybill number.
   */
  mpesaPaybill: string;

  /**
   * Bank accounts that belong to the school.
   */
  bankAccounts: IPaymentIngestionAccount[];
}
