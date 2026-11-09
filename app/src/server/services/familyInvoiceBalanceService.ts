import type { IAllocationInvoice } from "../models/allocation/IAllocationInvoice";
import type { IFamilyInvoiceBalance } from "../models/allocation/IFamilyInvoiceBalance";
import type { IFamilyInvoiceAllocationReader } from "../models/allocation/IFamilyInvoiceAllocationReader";
import { requireText } from "../utils/configurationValidation";

/** Read invoice balances with the payment evidence behind each amount. */
export class FamilyInvoiceBalanceService {
  /** Persisted allocation reader used to explain each invoice balance. */
  private readonly _store: IFamilyInvoiceAllocationReader;

  /**
   * Build the balance service with an allocation evidence reader.
   * @param store Persisted allocation evidence reader.
   */
  constructor(store: IFamilyInvoiceAllocationReader) {
    this._store = store;
  }

  /**
   * Calculate balances for the invoices owned by one family.
   * @param schoolId School that owns the family.
   * @param familyId Family whose account is being opened.
   * @param invoices Invoice records for the family.
   * @returns Every invoice with its paid amount, balance, and allocation trail.
   */
  getFamilyBalances(
    schoolId: string,
    familyId: string,
    invoices: IAllocationInvoice[],
  ): IFamilyInvoiceBalance[] {
    requireText(schoolId, "schoolId");
    requireText(familyId, "familyId");
    if (!Array.isArray(invoices)) throw new Error("invoices must be a list");
    const familyInvoices = this.validateInvoices(schoolId, familyId, invoices);
    const invoiceIds = familyInvoices.map(({ invoiceId }) => invoiceId);
    const evidence = this._store.getFamilyEvidence(
      schoolId,
      familyId,
      invoiceIds,
    );
    const allocationsByInvoice = new Map(
      invoiceIds.map((invoiceId) => [invoiceId, [] as typeof evidence]),
    );
    for (const allocation of evidence) {
      const allocations = allocationsByInvoice.get(allocation.invoiceId);
      if (!allocations)
        throw new Error(
          `Allocation evidence references an unknown family invoice ${allocation.invoiceId}`,
        );
      allocations.push(allocation);
    }

    return familyInvoices.map((invoice) => {
      const allocations = allocationsByInvoice.get(invoice.invoiceId)!;
      const paidMinor = allocations.reduce(
        (sum, allocation) => sum + allocation.amountMinor,
        0,
      );
      if (!Number.isSafeInteger(paidMinor))
        throw new Error(
          `Invoice ${invoice.invoiceId} has an unsafe paid total`,
        );
      if (paidMinor > invoice.amountMinor)
        throw new Error(`Invoice ${invoice.invoiceId} is over-allocated`);
      return {
        ...invoice,
        paidMinor,
        balanceMinor: invoice.amountMinor - paidMinor,
        allocations,
      };
    });
  }

  /**
   * Validate and put supplied invoice records in stable display order.
   * @param schoolId Owning school.
   * @param familyId Owning family.
   * @param invoices Candidate family invoices.
   * @returns Validated invoices sorted by due date and identifier.
   */
  private validateInvoices(
    schoolId: string,
    familyId: string,
    invoices: IAllocationInvoice[],
  ): IAllocationInvoice[] {
    const invoiceIds = new Set<string>();
    for (const invoice of invoices) {
      requireText(invoice.invoiceId, "invoiceId");
      if (invoiceIds.has(invoice.invoiceId))
        throw new Error(`Duplicate invoice ${invoice.invoiceId}`);
      invoiceIds.add(invoice.invoiceId);
      if (invoice.schoolId !== schoolId || invoice.familyId !== familyId)
        throw new Error(`Invoice ${invoice.invoiceId} is outside this family`);
      if (!Number.isSafeInteger(invoice.amountMinor) || invoice.amountMinor < 0)
        throw new Error(`Invoice ${invoice.invoiceId} has an invalid amount`);
      if (!/^[A-Z]{3}$/.test(invoice.currency))
        throw new Error(`Invoice ${invoice.invoiceId} has an invalid currency`);
      if (!this.isCalendarDate(invoice.dueOn))
        throw new Error(`Invoice ${invoice.invoiceId} has an invalid due date`);
    }
    return [...invoices].sort(
      (left, right) =>
        left.dueOn.localeCompare(right.dueOn) ||
        left.invoiceId.localeCompare(right.invoiceId),
    );
  }

  /**
   * Verify an ISO date is a real calendar date.
   * @param value Candidate due date.
   * @returns Whether the date is valid.
   */
  private isCalendarDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }
}
