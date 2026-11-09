import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import type { IAllocationInvoice } from "../src/server/models/allocation/IAllocationInvoice";
import type { IIngestedPaymentEvent } from "../src/server/models/ingestion/IIngestedPaymentEvent";
import type { IPaymentFamilyMatch } from "../src/server/models/ingestion/IPaymentFamilyMatch";
import type { ISchoolConfiguration } from "../src/server/models/configuration/ISchoolConfiguration";
import { PaymentAllocationService } from "../src/server/services/paymentAllocationService";
import { SchoolConfigurationService } from "../src/server/services/schoolConfigurationService";
import { SqlitePaymentAllocationPlanStore } from "../src/server/services/sqlitePaymentAllocationPlanStore";
import { SqliteSchoolConfigurationService } from "../src/server/services/sqliteSchoolConfigurationService";
import { initializeSchema } from "../src/server/utils/configurationSchema";

const fixturePath = path.resolve(import.meta.dirname, "../../fixtures/school");
const configHistory = JSON.parse(
  readFileSync(path.join(fixturePath, "config_history.json"), "utf8"),
) as Array<{
  school_id: string;
  effective_from: string;
  created_by: string;
  change_reason: string;
  config: ISchoolConfiguration;
}>;
const changeRequest = JSON.parse(
  readFileSync(path.join(fixturePath, "change_requests/CR-118.json"), "utf8"),
) as {
  change_request: string;
  school_id: string;
  requested_by: string;
  approved_by: string;
  effective_from: string;
  reason: string;
  patch: { allocation: { category_priority: string[] } };
};

const invoices: IAllocationInvoice[] = [
  {
    schoolId: "sch_mlima",
    familyId: "fam_201",
    invoiceId: "INV-2001",
    category: "tuition",
    amountMinor: 6_000_000,
    currency: "KES",
    dueOn: "2026-11-05",
  },
  {
    schoolId: "sch_mlima",
    familyId: "fam_201",
    invoiceId: "INV-2002",
    category: "transport",
    amountMinor: 900_000,
    currency: "KES",
    dueOn: "2026-11-05",
  },
];

function payment(
  eventKey: string,
  amountMinor: number,
  schoolId = "sch_mlima",
): IIngestedPaymentEvent {
  return {
    schoolId,
    eventKey,
    fingerprint: `fingerprint-${eventKey}`,
    source: "mpesa",
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

function match(
  event: IIngestedPaymentEvent,
  familyId = "fam_201",
): IPaymentFamilyMatch {
  return {
    schoolId: event.schoolId,
    eventKey: event.eventKey,
    fingerprint: event.fingerprint,
    sourceReference: event.sourceReference,
    paymentReference: event.paymentReference,
    familyId,
    matchType: "admission_number",
    currency: event.currency,
    status: "matched",
    holdReason: null,
  };
}

function setup() {
  const database = new DatabaseSync(":memory:");
  initializeSchema(database, () => new DatabaseSync(":memory:"));
  const configStore = new SqliteSchoolConfigurationService(database);
  const configurations = new SchoolConfigurationService(configStore);
  for (const row of configHistory) {
    configurations.createSchool({
      schoolId: row.school_id,
      effectiveAt: row.effective_from,
      createdBy: row.created_by,
      reason: row.change_reason,
      configuration: row.config,
    });
  }
  const planStore = new SqlitePaymentAllocationPlanStore(database);
  return {
    database,
    configurations,
    allocation: new PaymentAllocationService(configurations, planStore),
  };
}

void describe("payment allocation", () => {
  void it("uses the policy effective at the trusted instant and reads back the saved plan", () => {
    const { database, configurations, allocation } = setup();
    try {
      const before = payment("payment-before-cr118", 100_000);
      const savedV1 = allocation.allocatePayment(
        before,
        match(before),
        invoices,
        "2026-11-03T11:59:59+03:00",
      );
      assert.equal(savedV1.policyVersion, 1);
      assert.deepEqual(
        savedV1.allocations.map(({ invoiceId, amountMinor }) => ({
          invoiceId,
          amountMinor,
        })),
        [{ invoiceId: "INV-2001", amountMinor: 100_000 }],
      );

      configurations.applyChange({
        changeId: changeRequest.change_request,
        schoolId: changeRequest.school_id,
        expectedVersion: 1,
        effectiveAt: changeRequest.effective_from,
        requestedBy: changeRequest.requested_by,
        approvedBy: changeRequest.approved_by,
        reason: changeRequest.reason,
        categoryPriority: changeRequest.patch.allocation.category_priority,
      });

      const atBoundary = payment("payment-at-cr118", 1_000_000);
      const savedV2 = allocation.allocatePayment(
        atBoundary,
        match(atBoundary),
        invoices,
        "2026-11-03T12:00:00+03:00",
      );
      assert.equal(savedV2.policyVersion, 2);
      assert.deepEqual(
        savedV2.allocations.map(({ invoiceId, amountMinor }) => ({
          invoiceId,
          amountMinor,
        })),
        [
          { invoiceId: "INV-2002", amountMinor: 900_000 },
          { invoiceId: "INV-2001", amountMinor: 100_000 },
        ],
      );

      const replay = allocation.allocatePayment(
        before,
        match(before),
        invoices,
        "2026-11-03T12:05:00+03:00",
      );
      assert.deepEqual(replay, savedV1);
      assert.deepEqual(
        allocation.getPlan("sch_mlima", before.eventKey),
        savedV1,
      );
    } finally {
      database.close();
    }
  });

  void it("records overpayment as the school's configured credit", () => {
    const { database, allocation } = setup();
    try {
      const overpayment = payment("payment-over-invoice", 6_100_000);
      const plan = allocation.allocatePayment(
        overpayment,
        match(overpayment),
        [invoices[0]],
        "2026-11-03T11:00:00+03:00",
      );
      assert.equal(plan.allocations[0]?.amountMinor, 6_000_000);
      assert.equal(plan.remainderMinor, 100_000);
      assert.equal(plan.remainderTreatment, "credit");
      assert.deepEqual(
        allocation.getPlan("sch_mlima", overpayment.eventKey),
        plan,
      );
    } finally {
      database.close();
    }
  });

  void it("holds an unmatched payment and applies Pwani's refund policy to a remainder", () => {
    const { database, allocation } = setup();
    try {
      const paymentToReview = payment("payment-held", 100_000);
      assert.throws(
        () =>
          allocation.allocatePayment(
            paymentToReview,
            {
              ...match(paymentToReview),
              status: "held",
              holdReason: "unknown_reference",
            },
            invoices,
            "2026-11-03T11:00:00+03:00",
          ),
        /Only payments matched to a family/,
      );
      assert.throws(
        () => allocation.getPlan("sch_mlima", paymentToReview.eventKey),
        /not found/,
      );

      const pwaniPayment = payment("payment-pwani", 100_000, "sch_pwani");
      const refundHold = allocation.allocatePayment(
        pwaniPayment,
        match(pwaniPayment, "fam_301"),
        [],
        "2026-11-03T11:00:00+03:00",
      );
      assert.equal(refundHold.allocations.length, 0);
      assert.equal(refundHold.remainderMinor, 100_000);
      assert.equal(refundHold.remainderTreatment, "refund_hold");
    } finally {
      database.close();
    }
  });
});
