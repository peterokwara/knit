/** Family identifiers that a parent may enter as a payment reference. */
export interface IPaymentFamilyReference {
  /** Stable identifier for the family record. */
  familyId: string;

  /** Parent-facing family reference. */
  familyReference: string;

  /** Admission numbers for learners in this family. */
  admissionNumbers: string[];
}
