import type { IAllocationEvidence } from "../models/allocation/IAllocationEvidence";
import type { IAllocationInvoice } from "../models/allocation/IAllocationInvoice";
import type { IDatabaseRow } from "../models/database/IDatabaseRow";
import type { IPaymentAllocationPlan } from "../models/allocation/IPaymentAllocationPlan";
import type { IPaymentAllocationPlanStore } from "../models/allocation/IPaymentAllocationPlanStore";
import { SqliteHelper } from "../utils/sqliteHelper";
import { readInteger, readText } from "../utils/sqliteValues";
import type { DatabaseSync } from "node:sqlite";

function toEvidence(row: IDatabaseRow): IAllocationEvidence {
  return {
    id: readText(row, "id"),
    schoolId: readText(row, "school_id"),
    paymentId: readText(row, "payment_id"),
    invoiceId: readText(row, "invoice_id"),
    source: readText(row, "source"),
    amountMinor: readInteger(row, "amount_minor"),
    effectiveAt: new Date(readInteger(row, "effective_at_ms")).toISOString(),
    policyVersion: readInteger(row, "policy_version"),
  };
}

/** Persist complete payment allocation plans and invoice evidence atomically. */
export class SqlitePaymentAllocationPlanStore implements IPaymentAllocationPlanStore {
  /** Database connection that owns the protected allocation schema. */
  private readonly _database: DatabaseSync;

  /**
   * Create the plan store around an initialized SQLite connection.
   * @param database Connection containing configuration and allocation tables.
   */
  constructor(database: DatabaseSync) {
    this._database = database;
  }

  /**
   * Read a saved plan and its invoice evidence.
   * @param schoolId Owning school.
   * @param paymentId Stable provider event identity.
   * @returns The persisted plan, or undefined when no plan exists.
   */
  getPlan(
    schoolId: string,
    paymentId: string,
  ): IPaymentAllocationPlan | undefined {
    const row = SqliteHelper.queryOne(
      this._database,
      "SELECT * FROM payment_allocation_plans WHERE school_id = ? AND payment_id = ?",
      schoolId,
      paymentId,
    );
    if (!row) return undefined;
    const allocations = SqliteHelper.query(
      this._database,
      "SELECT * FROM allocation_evidence WHERE school_id = ? AND payment_id = ? ORDER BY rowid",
      schoolId,
      paymentId,
    ).map(toEvidence);
    return {
      schoolId: readText(row, "school_id"),
      paymentId: readText(row, "payment_id"),
      fingerprint: readText(row, "fingerprint"),
      familyId: readText(row, "family_id"),
      source: readText(row, "source"),
      amountMinor: readInteger(row, "amount_minor"),
      currency: readText(row, "currency"),
      effectiveAt: new Date(readInteger(row, "effective_at_ms")).toISOString(),
      policyVersion: readInteger(row, "policy_version"),
      allocations,
      remainderMinor: readInteger(row, "remainder_minor"),
      remainderTreatment: readText(
        row,
        "remainder_treatment",
      ) as IPaymentAllocationPlan["remainderTreatment"],
    };
  }

  /**
   * Sum immutable evidence already assigned to an invoice.
   * @param schoolId Owning school.
   * @param invoiceId Invoice identifier.
   * @returns Total allocated minor units.
   */
  getAllocatedAmount(schoolId: string, invoiceId: string): number {
    const row = SqliteHelper.queryOne(
      this._database,
      "SELECT COALESCE(SUM(amount_minor), 0) AS amount_minor FROM allocation_evidence WHERE school_id = ? AND invoice_id = ?",
      schoolId,
      invoiceId,
    );
    if (!row) throw new Error("Invoice allocation total was not returned");
    return readInteger(row, "amount_minor");
  }

  /**
   * Atomically record the plan header and every invoice allocation.
   * @param plan Calculated plan, including policy version and remainder.
   * @param effectiveAtMs Trusted plan instant in epoch milliseconds.
   * @param invoices Invoices and face amounts used to validate current balances.
   * @returns The stored plan read back from SQLite.
   */
  recordPlan(
    plan: IPaymentAllocationPlan,
    effectiveAtMs: number,
    invoices: Pick<IAllocationInvoice, "invoiceId" | "amountMinor">[],
  ): IPaymentAllocationPlan {
    return SqliteHelper.inTransaction(this._database, () => {
      const existing = this.getPlan(plan.schoolId, plan.paymentId);
      if (existing) return existing;
      const allocated = plan.allocations.reduce(
        (sum, allocation) => sum + allocation.amountMinor,
        0,
      );
      if (
        !Number.isSafeInteger(allocated) ||
        allocated + plan.remainderMinor !== plan.amountMinor
      ) {
        throw new Error(
          "Allocation plan does not account for the full payment",
        );
      }
      const invoiceIds = new Set<string>();
      const invoiceAmounts = new Map(
        invoices.map(({ invoiceId, amountMinor }) => [invoiceId, amountMinor]),
      );
      for (const allocation of plan.allocations) {
        if (
          allocation.schoolId !== plan.schoolId ||
          allocation.paymentId !== plan.paymentId ||
          allocation.source !== plan.source ||
          allocation.effectiveAt !== plan.effectiveAt ||
          allocation.policyVersion !== plan.policyVersion ||
          invoiceIds.has(allocation.invoiceId) ||
          !invoiceAmounts.has(allocation.invoiceId)
        ) {
          throw new Error("Allocation evidence does not belong to its plan");
        }
        const alreadyAllocated = this.getAllocatedAmount(
          plan.schoolId,
          allocation.invoiceId,
        );
        if (
          alreadyAllocated + allocation.amountMinor >
          invoiceAmounts.get(allocation.invoiceId)!
        ) {
          throw new Error(
            `Invoice ${allocation.invoiceId} changed while the payment was being allocated`,
          );
        }
        invoiceIds.add(allocation.invoiceId);
      }
      SqliteHelper.execute(
        this._database,
        `INSERT INTO payment_allocation_plans
        (school_id, payment_id, fingerprint, family_id, source, amount_minor, currency, effective_at_ms, policy_version, remainder_minor, remainder_treatment)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        plan.schoolId,
        plan.paymentId,
        plan.fingerprint,
        plan.familyId,
        plan.source,
        plan.amountMinor,
        plan.currency,
        effectiveAtMs,
        plan.policyVersion,
        plan.remainderMinor,
        plan.remainderTreatment,
      );
      for (const allocation of plan.allocations) {
        SqliteHelper.execute(
          this._database,
          `INSERT INTO allocation_evidence
          (id, school_id, payment_id, invoice_id, source, amount_minor, effective_at_ms, policy_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          allocation.id,
          allocation.schoolId,
          allocation.paymentId,
          allocation.invoiceId,
          allocation.source,
          allocation.amountMinor,
          effectiveAtMs,
          allocation.policyVersion,
        );
      }
      const stored = this.getPlan(plan.schoolId, plan.paymentId);
      if (!stored) throw new Error("Payment allocation plan was not stored");
      return stored;
    });
  }
}
