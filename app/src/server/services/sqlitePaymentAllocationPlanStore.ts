import type { IAllocationEvidence } from "../models/allocation/IAllocationEvidence";
import type { IAllocationInvoice } from "../models/allocation/IAllocationInvoice";
import type { IDatabaseRow } from "../models/database/IDatabaseRow";
import type { IPaymentAllocationPlan } from "../models/allocation/IPaymentAllocationPlan";
import type { IPaymentAllocationPlanStore } from "../models/allocation/IPaymentAllocationPlanStore";
import { SqliteHelper } from "../utils/sqliteHelper";
import { readInteger, readText } from "../utils/sqliteValues";
import type { DatabaseSync } from "node:sqlite";
import { SqlitePaymentIngestionService } from "./sqlitePaymentIngestionService";

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

  /** Current school invoice records used to calculate reversal corrections. */
  private readonly _invoices: IAllocationInvoice[];

  /**
   * Create the plan store around an initialized SQLite connection.
   * @param database Connection containing configuration and allocation tables.
   * @param invoices School invoice records used for reversal corrections.
   */
  constructor(database: DatabaseSync, invoices: IAllocationInvoice[]) {
    this._database = database;
    this._invoices = invoices;
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
    const invoice = this._invoices.find(
      (item) => item.schoolId === schoolId && item.invoiceId === invoiceId,
    );
    if (!invoice)
      throw new Error(
        `Invoice ${invoiceId} is missing from the allocation context`,
      );
    const projected = this.reallocationAfterReversal(
      schoolId,
      invoice.familyId,
    );
    if (projected)
      return projected
        .filter((item) => item.invoiceId === invoiceId)
        .reduce((sum, item) => sum + item.amountMinor, 0);
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
   * Read evidence linked to saved plans for this family and invoice set.
   * @param schoolId School that owns the invoices.
   * @param familyId Family that owns the invoices.
   * @param invoiceIds Stable invoice identifiers.
   * @returns Allocation lines ordered by time and stable identifiers.
   */
  getFamilyEvidence(
    schoolId: string,
    familyId: string,
    invoiceIds: string[],
  ): IAllocationEvidence[] {
    if (invoiceIds.length === 0) return [];
    const placeholders = invoiceIds.map(() => "?").join(", ");
    const orphan = SqliteHelper.queryOne(
      this._database,
      `SELECT evidence.id FROM allocation_evidence evidence
      LEFT JOIN payment_allocation_plans plan
        ON plan.school_id = evidence.school_id AND plan.payment_id = evidence.payment_id
      WHERE evidence.school_id = ? AND evidence.invoice_id IN (${placeholders})
        AND (plan.payment_id IS NULL OR plan.family_id != ?) LIMIT 1`,
      schoolId,
      ...invoiceIds,
      familyId,
    );
    if (orphan)
      throw new Error(
        "Invoice allocation evidence is missing its family plan or belongs to another family; its balance cannot be attributed safely",
      );
    const projected = this.reallocationAfterReversal(schoolId, familyId);
    if (projected)
      return projected.filter((item) => invoiceIds.includes(item.invoiceId));
    const rows = SqliteHelper.query(
      this._database,
      `SELECT evidence.* FROM allocation_evidence evidence
      JOIN payment_allocation_plans plan
        ON plan.school_id = evidence.school_id AND plan.payment_id = evidence.payment_id
      WHERE evidence.school_id = ? AND plan.family_id = ? AND evidence.invoice_id IN (${placeholders})
      ORDER BY evidence.effective_at_ms, evidence.payment_id, evidence.invoice_id, evidence.id`,
      schoolId,
      familyId,
      ...invoiceIds,
    ).map(toEvidence);
    return rows;
  }

  /**
   * Recalculate affected family allocations under each saved policy after a reversal.
   * Original plans remain immutable and changed lines identify their reversal evidence.
   * @param schoolId School that owns the payments.
   * @param familyId Family whose payments may need correction.
   * @returns Corrected allocation evidence, or undefined when no correction is needed.
   */
  private reallocationAfterReversal(
    schoolId: string,
    familyId: string,
  ): IAllocationEvidence[] | undefined {
    const rows = SqliteHelper.query(
      this._database,
      "SELECT payment_id FROM payment_allocation_plans WHERE school_id = ? AND family_id = ? ORDER BY effective_at_ms, payment_id",
      schoolId,
      familyId,
    );
    const plans = rows
      .map((row) => this.getPlan(schoolId, readText(row, "payment_id")))
      .filter((plan): plan is IPaymentAllocationPlan => plan !== undefined);
    if (plans.length === 0) return undefined;
    const events = new SqlitePaymentIngestionService(this._database).getEvents(
      schoolId,
    );
    const eventFor = (plan: IPaymentAllocationPlan) =>
      events.find(
        (event) =>
          event.eventKey === plan.paymentId &&
          event.fingerprint === plan.fingerprint,
      );
    for (const plan of plans) {
      const event = eventFor(plan);
      if (event?.conflicted || event?.reversalStatus === "conflicted")
        throw new Error(
          `Payment ${plan.paymentId} has conflicting evidence; its balance needs review`,
        );
    }
    const affected = plans.filter((plan) => {
      const event = eventFor(plan);
      return event && event.netAmountMinor < plan.amountMinor;
    });
    if (affected.length === 0) return undefined;
    const invoices = this._invoices.filter(
      (invoice) =>
        invoice.schoolId === schoolId && invoice.familyId === familyId,
    );
    if (invoices.length === 0)
      throw new Error(
        `Invoice records are needed to correct reversed payments for ${familyId}`,
      );
    const references = affected.flatMap((plan) => {
      const event = eventFor(plan)!;
      return events
        .filter(
          (item) =>
            item.classification === "reversal" &&
            item.source === event.source &&
            item.relatedReference === event.sourceReference &&
            item.reversalStatus === "matched",
        )
        .map((item) => item.sourceReference);
    });
    const paid = new Map(invoices.map((invoice) => [invoice.invoiceId, 0]));
    const result: IAllocationEvidence[] = [];
    for (const plan of plans) {
      const configRow = SqliteHelper.queryOne(
        this._database,
        "SELECT configuration_json FROM school_configuration_versions WHERE school_id = ? AND version = ?",
        schoolId,
        plan.policyVersion,
      );
      if (!configRow) throw new Error("Allocation policy version is missing");
      const config = JSON.parse(readText(configRow, "configuration_json")) as {
        allocation: { category_priority: string[]; tie_break: string[] };
      };
      const policy = config.allocation;
      if (
        invoices.some(
          (invoice) =>
            !policy.category_priority.includes(invoice.category) ||
            invoice.currency !== plan.currency,
        ) ||
        policy.tie_break.some(
          (rule) => rule !== "due_on_asc" && rule !== "invoice_id_asc",
        )
      )
        throw new Error(
          `Invoices cannot be corrected under policy v${plan.policyVersion}`,
        );
      const ordered = [...invoices].sort((a, b) => {
        const difference =
          policy.category_priority.indexOf(a.category) -
          policy.category_priority.indexOf(b.category);
        if (difference) return difference;
        for (const rule of policy.tie_break) {
          if (rule === "due_on_asc" && a.dueOn !== b.dueOn)
            return a.dueOn.localeCompare(b.dueOn);
          if (rule === "invoice_id_asc" && a.invoiceId !== b.invoiceId)
            return a.invoiceId.localeCompare(b.invoiceId);
        }
        return 0;
      });
      const event = eventFor(plan);
      let remaining = Math.min(
        plan.amountMinor,
        event?.netAmountMinor ?? plan.amountMinor,
      );
      const amounts = new Map<string, number>();
      for (const invoice of ordered) {
        const amount = Math.min(
          remaining,
          invoice.amountMinor - paid.get(invoice.invoiceId)!,
        );
        if (amount > 0) {
          amounts.set(invoice.invoiceId, amount);
          paid.set(invoice.invoiceId, paid.get(invoice.invoiceId)! + amount);
          remaining -= amount;
        }
      }
      const invoiceIds = new Set([
        ...plan.allocations.map((line) => line.invoiceId),
        ...amounts.keys(),
      ]);
      for (const invoiceId of invoiceIds) {
        const original = plan.allocations.find(
          (line) => line.invoiceId === invoiceId,
        );
        const amountMinor = amounts.get(invoiceId) ?? 0;
        const originalAmount = original?.amountMinor ?? 0;
        const changed = amountMinor !== originalAmount;
        result.push({
          id:
            original?.id ??
            `correction:${schoolId}:${plan.paymentId}:${invoiceId}`,
          schoolId,
          paymentId: plan.paymentId,
          invoiceId,
          source: plan.source,
          amountMinor,
          effectiveAt: plan.effectiveAt,
          policyVersion: plan.policyVersion,
          ...(changed
            ? {
                originalAmountMinor: originalAmount,
                reversedMinor: affected.includes(plan)
                  ? Math.max(0, originalAmount - amountMinor)
                  : 0,
                reversalReferences: references,
                reallocatedAfterReversal: true,
              }
            : {}),
        });
      }
    }
    return result;
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
