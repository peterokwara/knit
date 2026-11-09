/** Financial consequences shown to the bursar before confirming a decision. */
export interface IExpectedPaymentAllocationPreview {
  /** School policy version used to calculate the preview. */
  policyVersion: number;

  /** Invoice and amount pairs shown in the preview. */
  allocations: IExpectedPaymentAllocationLine[];

  /** Amount left after applying the previewed invoice allocations. */
  remainderMinor: number;

  /** School policy treatment for the previewed remainder. */
  remainderTreatment: "none" | "credit" | "refund_hold";
}

/** One invoice and amount included in a payment allocation preview. */
export interface IExpectedPaymentAllocationLine {
  /** Invoice that would receive part of the payment. */
  invoiceId: string;

  /** Amount that would be applied to this invoice in minor units. */
  amountMinor: number;
}
