import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import type { IAllocationInvoice } from "../src/server/models/allocation/IAllocationInvoice";
import type { IIngestedPaymentEvent } from "../src/server/models/ingestion/IIngestedPaymentEvent";
import type { IPaymentFamilyMatch } from "../src/server/models/ingestion/IPaymentFamilyMatch";
import type { ISchoolConfiguration } from "../src/server/models/configuration/ISchoolConfiguration";
import { FamilyInvoiceBalanceService } from "../src/server/services/familyInvoiceBalanceService";
import { PaymentAllocationService } from "../src/server/services/paymentAllocationService";
import { SchoolConfigurationService } from "../src/server/services/schoolConfigurationService";
import { SqlitePaymentAllocationPlanStore } from "../src/server/services/sqlitePaymentAllocationPlanStore";
import { SqliteSchoolConfigurationService } from "../src/server/services/sqliteSchoolConfigurationService";
import { initializeSchema } from "../src/server/utils/configurationSchema";

const fixtureDirectory = path.resolve(import.meta.dirname, "../../fixtures");
const schoolFixture = JSON.parse(
  readFileSync(
    path.join(fixtureDirectory, "school/families_and_invoices.json"),
    "utf8",
  ),
) as {
  invoices: Array<{
    invoice_id: string;
    family_id: string;
    category: string;
    amount_minor: number;
    currency: string;
    due_on: string;
  }>;
};
const configurationFixture = JSON.parse(
  readFileSync(
    path.join(fixtureDirectory, "school/config_history.json"),
    "utf8",
  ),
) as Array<{
  school_id: string;
  version: number;
  effective_from: string;
  created_by: string;
  change_reason: string;
  config: ISchoolConfiguration;
}>;
const familyInvoices: IAllocationInvoice[] = schoolFixture.invoices
  .filter((invoice) => invoice.family_id === "fam_201")
  .map((invoice) => ({
    schoolId: "sch_mlima",
    familyId: invoice.family_id,
    invoiceId: invoice.invoice_id,
    category: invoice.category,
    amountMinor: invoice.amount_minor,
    currency: invoice.currency,
    dueOn: invoice.due_on,
  }));

function payment(
  eventKey: string,
  amountMinor: number,
  source: IIngestedPaymentEvent["source"] = "mpesa",
): IIngestedPaymentEvent {
  return {
    schoolId: "sch_mlima",
    eventKey,
    fingerprint: `fingerprint-${eventKey}`,
    source,
    sourceReference: eventKey,
    eventKind: "payment",
    classification: "payment",
    amountMinor,
    netAmountMinor: amountMinor,
    currency: "KES",
    occurredAt: null,
    occurredOn: null,
    paymentReference: "ADM-1041",
    relatedReference: null,
    issue: null,
    conflicted: false,
    reversalStatus: "not_reversal",
    observations: [],
  };
}

function match(event: IIngestedPaymentEvent): IPaymentFamilyMatch {
  return {
    schoolId: event.schoolId,
    eventKey: event.eventKey,
    fingerprint: event.fingerprint,
    sourceReference: event.sourceReference,
    paymentReference: event.paymentReference,
    familyId: "fam_201",
    matchType: "admission_number",
    currency: event.currency,
    status: "matched",
    holdReason: null,
  };
}

function setup() {
  const database = new DatabaseSync(":memory:");
  initializeSchema(database, () => new DatabaseSync(":memory:"));
  const row = configurationFixture.find(
    (item) => item.school_id === "sch_mlima" && item.version === 1,
  );
  assert.ok(row);
  const configurationStore = new SqliteSchoolConfigurationService(database);
  const configurations = new SchoolConfigurationService(configurationStore);
  configurations.createSchool({
    schoolId: row.school_id,
    effectiveAt: row.effective_from,
    createdBy: row.created_by,
    reason: row.change_reason,
    configuration: row.config,
  });
  const planStore = new SqlitePaymentAllocationPlanStore(
    database,
    familyInvoices,
  );
  return {
    database,
    allocation: new PaymentAllocationService(configurations, planStore),
    balances: new FamilyInvoiceBalanceService(planStore),
  };
}

void describe("family invoice balances", () => {
  void it("returns each fixture invoice with its saved payment and policy evidence", () => {
    const { database, allocation, balances } = setup();
    try {
      for (const [eventKey, amountMinor, source, allocationAt] of [
        ["balance-payment-1", 3_000_000, "mpesa", "2026-11-03T09:00:00+03:00"],
        ["balance-payment-2", 3_000_000, "mpesa", "2026-11-03T10:00:00+03:00"],
        ["balance-bank-payment", 450_000, "bank", "2026-11-03T10:30:00+03:00"],
      ] as const) {
        const event = payment(eventKey, amountMinor, source);
        allocation.allocatePayment(
          event,
          match(event),
          familyInvoices,
          allocationAt,
        );
      }

      const result = balances.getFamilyBalances(
        "sch_mlima",
        "fam_201",
        familyInvoices,
      );

      assert.deepEqual(
        result.map((invoice) => ({
          invoiceId: invoice.invoiceId,
          amountMinor: invoice.amountMinor,
          paidMinor: invoice.paidMinor,
          balanceMinor: invoice.balanceMinor,
          allocations: invoice.allocations.map((allocation) => ({
            paymentId: allocation.paymentId,
            source: allocation.source,
            amountMinor: allocation.amountMinor,
            policyVersion: allocation.policyVersion,
          })),
        })),
        [
          {
            invoiceId: "INV-2001",
            amountMinor: 6_000_000,
            paidMinor: 6_000_000,
            balanceMinor: 0,
            allocations: [
              {
                paymentId: "balance-payment-1",
                source: "mpesa",
                amountMinor: 3_000_000,
                policyVersion: 1,
              },
              {
                paymentId: "balance-payment-2",
                source: "mpesa",
                amountMinor: 3_000_000,
                policyVersion: 1,
              },
            ],
          },
          {
            invoiceId: "INV-2002",
            amountMinor: 900_000,
            paidMinor: 450_000,
            balanceMinor: 450_000,
            allocations: [
              {
                paymentId: "balance-bank-payment",
                source: "bank",
                amountMinor: 450_000,
                policyVersion: 1,
              },
            ],
          },
        ],
      );
    } finally {
      database.close();
    }
  });

  void it("shows unpaid invoices at their full amount and rejects another family's invoices", () => {
    const { database, balances } = setup();
    try {
      const [invoice] = balances.getFamilyBalances(
        "sch_mlima",
        "fam_201",
        familyInvoices,
      );
      assert.ok(invoice);
      assert.equal(invoice.paidMinor, 0);
      assert.equal(invoice.balanceMinor, invoice.amountMinor);

      assert.throws(
        () =>
          balances.getFamilyBalances("sch_mlima", "fam_201", [
            ...familyInvoices,
            {
              ...familyInvoices[0],
              familyId: "fam_202",
              invoiceId: "INV-WRONG-FAMILY",
            },
          ]),
        /outside this family/,
      );
    } finally {
      database.close();
    }
  });

  void it("rejects evidence for an invoice ID stored under a different family", () => {
    const { database, allocation, balances } = setup();
    try {
      const event = payment("family-collision-payment", 100_000);
      allocation.allocatePayment(
        event,
        match(event),
        familyInvoices,
        "2026-11-03T09:00:00+03:00",
      );
      const invoiceClaimedByAnotherFamily = {
        ...familyInvoices[0],
        familyId: "fam_202",
      };

      assert.throws(
        () =>
          balances.getFamilyBalances("sch_mlima", "fam_202", [
            invoiceClaimedByAnotherFamily,
          ]),
        /belongs to another family/,
      );
    } finally {
      database.close();
    }
  });
});
