import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import type { IApprovedPolicyChange } from "../src/server/models/configuration/IApprovedPolicyChange";
import type { ISchoolConfiguration } from "../src/server/models/configuration/ISchoolConfiguration";
import type { IAllocationInvoice } from "../src/server/models/allocation/IAllocationInvoice";
import type { IPaymentFileReference } from "../src/server/models/ingestion/IPaymentFileReference";
import type { IPaymentFamilyMatchingContext } from "../src/server/models/ingestion/IPaymentFamilyMatchingContext";
import { FamilyInvoiceBalanceService } from "../src/server/services/familyInvoiceBalanceService";
import { PaymentAllocationService } from "../src/server/services/paymentAllocationService";
import { PaymentFamilyMatchingService } from "../src/server/services/paymentFamilyMatchingService";
import { PaymentFileRetrievalService } from "../src/server/services/paymentFileRetrievalService";
import { PaymentIngestionService } from "../src/server/services/paymentIngestionService";
import { PaymentReconciliationService } from "../src/server/services/paymentReconciliationService";
import { SchoolConfigurationService } from "../src/server/services/schoolConfigurationService";
import { SqlitePaymentAllocationPlanStore } from "../src/server/services/sqlitePaymentAllocationPlanStore";
import { SqlitePaymentIngestionService } from "../src/server/services/sqlitePaymentIngestionService";
import { SqlitePaymentReviewResolutionStore } from "../src/server/services/sqlitePaymentReviewResolutionStore";
import { SqliteSchoolConfigurationService } from "../src/server/services/sqliteSchoolConfigurationService";
import { initializeSchema } from "../src/server/utils/configurationSchema";

const fixtureDirectory = path.resolve(import.meta.dirname, "../../fixtures");
const schoolFixture = JSON.parse(
  readFileSync(
    path.join(fixtureDirectory, "school/families_and_invoices.json"),
    "utf8",
  ),
) as {
  school: {
    school_id: string;
    billing_currency: string;
    timezone: string;
    mpesa_paybill: string;
    bank_accounts: { account_no: string; currency: string }[];
  };
  families: {
    family_id: string;
    family_ref: string;
    learners: { admission_no: string }[];
  }[];
  invoices: {
    invoice_id: string;
    family_id: string;
    category: string;
    amount_minor: number;
    currency: string;
    due_on: string;
  }[];
};
const configurationHistory = JSON.parse(
  readFileSync(
    path.join(fixtureDirectory, "school/config_history.json"),
    "utf8",
  ),
) as {
  school_id: string;
  version: number;
  effective_from: string;
  created_by: string;
  change_reason: string;
  config: ISchoolConfiguration;
}[];
const changeRequest = JSON.parse(
  readFileSync(
    path.join(fixtureDirectory, "school/change_requests/CR-118.json"),
    "utf8",
  ),
) as {
  change_request: string;
  school_id: string;
  requested_by: string;
  approved_by: string;
  effective_from: string;
  reason: string;
  patch: { allocation: { category_priority: string[] } };
};
const matchingContext: IPaymentFamilyMatchingContext = {
  schoolId: schoolFixture.school.school_id,
  billingCurrency: schoolFixture.school.billing_currency,
  families: schoolFixture.families.map((family) => ({
    familyId: family.family_id,
    familyReference: family.family_ref,
    admissionNumbers: family.learners.map((learner) => learner.admission_no),
  })),
};
const invoices: IAllocationInvoice[] = schoolFixture.invoices.map(
  (invoice) => ({
    schoolId: schoolFixture.school.school_id,
    familyId: invoice.family_id,
    invoiceId: invoice.invoice_id,
    category: invoice.category,
    amountMinor: invoice.amount_minor,
    currency: invoice.currency,
    dueOn: invoice.due_on,
  }),
);
const fileReferences: IPaymentFileReference[] = [
  {
    fileName: "mpesa_events.json",
    fileType: "mpesa-json",
    location: path.join(fixtureDirectory, "mpesa_events.json"),
  },
  ...["export_2026-11-03.csv", "export_2026-11-04.csv"].map(
    (fileName): IPaymentFileReference => ({
      fileName,
      fileType: "bank-csv",
      location: path.join(fixtureDirectory, "bank", fileName),
    }),
  ),
];
const allocationAt = "2026-11-10T09:00:00+03:00";

function applyChange(): IApprovedPolicyChange {
  return {
    changeId: changeRequest.change_request,
    schoolId: changeRequest.school_id,
    expectedVersion: 1,
    effectiveAt: changeRequest.effective_from,
    requestedBy: changeRequest.requested_by,
    approvedBy: changeRequest.approved_by,
    reason: changeRequest.reason,
    categoryPriority: changeRequest.patch.allocation.category_priority,
  };
}

function setup() {
  const database = new DatabaseSync(":memory:");
  initializeSchema(database, () => new DatabaseSync(":memory:"));
  const configurationStore = new SqliteSchoolConfigurationService(database);
  const configurations = new SchoolConfigurationService(configurationStore);
  for (const row of configurationHistory.filter((item) => item.version === 1)) {
    configurations.createSchool({
      schoolId: row.school_id,
      effectiveAt: row.effective_from,
      createdBy: row.created_by,
      reason: row.change_reason,
      configuration: row.config,
    });
  }
  configurations.applyChange(applyChange());

  const planStore = new SqlitePaymentAllocationPlanStore(database, invoices);
  const service = new PaymentReconciliationService(
    new PaymentIngestionService(new SqlitePaymentIngestionService(database), {
      schoolId: schoolFixture.school.school_id,
      timeZone: schoolFixture.school.timezone,
      mpesaPaybill: schoolFixture.school.mpesa_paybill,
      bankAccounts: schoolFixture.school.bank_accounts.map((account) => ({
        accountNo: account.account_no,
        currency: account.currency,
      })),
    }),
    new PaymentFamilyMatchingService(matchingContext),
    new PaymentAllocationService(configurations, planStore),
    new FamilyInvoiceBalanceService(planStore),
    { matching: matchingContext, invoices },
    new SqlitePaymentReviewResolutionStore(database),
  );
  return { database, service, planStore };
}

void describe("payment reconciliation", () => {
  void it("preserves invoice balances across shuffled fixture rows, bank order, and three replays", () => {
    const files = new PaymentFileRetrievalService().retrieveFiles(
      fileReferences,
    );
    const shuffled = [...files].reverse().map((file) => {
      if (file.fileType === "mpesa-json") {
        const events = JSON.parse(file.contents) as unknown[];
        return { ...file, contents: JSON.stringify(events.reverse()) };
      }
      const [header, ...rows] = file.contents.trim().split(/\r?\n/);
      return { ...file, contents: [header, ...rows.reverse()].join("\n") };
    });
    const balances = (order: typeof files) => {
      const { database, service } = setup();
      try {
        let result = service.processFiles(order, allocationAt);
        for (let index = 0; index < 3; index++)
          result = service.processFiles(order, allocationAt);
        return result.familyBalances.map((family) => ({
          familyId: family.familyId,
          invoices: family.invoices.map(
            ({ invoiceId, paidMinor, balanceMinor }) => ({
              invoiceId,
              paidMinor,
              balanceMinor,
            }),
          ),
        }));
      } finally {
        database.close();
      }
    };
    assert.deepEqual(balances(shuffled), balances(files));
  });
  void it("applies the remaining payment to policy priorities after an earlier payment is reversed", () => {
    const { database, service, planStore } = setup();
    try {
      const events = JSON.parse(
        readFileSync(path.join(fixtureDirectory, "mpesa_events.json"), "utf8"),
      ) as { payload: { TransID?: string } }[];
      const payment = events.find(
        (event) => event.payload.TransID === "SKD3XH2B02",
      );
      const reversal = events.find(
        (event) => event.payload.TransID === "SKD3XR9Z07",
      );
      assert.ok(payment);
      assert.ok(reversal);
      const eventFile = (event: unknown) => ({
        fileName: "mpesa_events.json",
        fileType: "mpesa-json" as const,
        contents: JSON.stringify([event]),
      });
      const csv = readFileSync(
        path.join(fixtureDirectory, "bank/export_2026-11-04.csv"),
        "utf8",
      )
        .trim()
        .split(/\r?\n/);
      const bankRow = csv.find((row) => row.includes("FT26308LMN90"));
      assert.ok(bankRow);
      service.processFiles([eventFile(payment)], "2026-11-03T11:59:59+03:00");
      const savedOriginalPlan = planStore.getPlan(
        "sch_mlima",
        "mpesa:c2b:SKD3XH2B02",
      );
      assert.equal(savedOriginalPlan?.policyVersion, 1);
      service.processFiles(
        [
          {
            fileName: "export_2026-11-04.csv",
            fileType: "bank-csv",
            contents: `${csv[0]}\n${bankRow}\n`,
          },
        ],
        allocationAt,
      );
      const savedBankPlan = planStore.getPlan(
        "sch_mlima",
        "bank:0110234567:FT26308LMN90",
      );
      assert.ok(savedBankPlan);
      const result = service.processFiles([eventFile(reversal)], allocationAt);
      const family = result.familyBalances.find(
        (item) => item.familyId === "fam_202",
      );
      assert.deepEqual(
        family?.invoices.map((invoice) => [
          invoice.invoiceId,
          invoice.paidMinor,
        ]),
        [
          ["INV-2003", 1_400_000],
          ["INV-2004", 0],
          ["INV-2005", 600_000],
        ],
      );
      assert.deepEqual(
        planStore.getPlan("sch_mlima", "bank:0110234567:FT26308LMN90"),
        savedBankPlan,
      );
      assert.deepEqual(
        planStore.getPlan("sch_mlima", "mpesa:c2b:SKD3XH2B02"),
        savedOriginalPlan,
      );
      const tuition = family?.invoices.find(
        (invoice) => invoice.invoiceId === "INV-2003",
      );
      const corrected = tuition?.allocations.find(
        (line) => line.paymentId === "bank:0110234567:FT26308LMN90",
      );
      assert.equal(corrected?.amountMinor, 1_400_000);
      assert.equal(corrected?.reallocatedAfterReversal, true);
      assert.deepEqual(corrected?.reversalReferences, ["SKD3XR9Z07"]);
      assert.equal(corrected?.policyVersion, 2);
      for (let attempt = 0; attempt < 3; attempt++) {
        const replay = service.processFiles(
          [eventFile(reversal)],
          allocationAt,
        );
        const replayedFamily = replay.familyBalances.find(
          (item) => item.familyId === "fam_202",
        );
        assert.deepEqual(replayedFamily?.invoices, family?.invoices);
      }
    } finally {
      database.close();
    }
  });
  void it("restores invoice balances when a full reversal arrives after allocation", () => {
    const { database, service } = setup();
    try {
      const events = JSON.parse(
        readFileSync(path.join(fixtureDirectory, "mpesa_events.json"), "utf8"),
      ) as { event: string; payload: { TransID?: string } }[];
      const payment = events.find(
        (event) => event.payload.TransID === "SKD3XH2B02",
      );
      const reversal = events.find(
        (event) => event.payload.TransID === "SKD3XR9Z07",
      );
      assert.ok(payment);
      assert.ok(reversal);
      const file = (event: unknown) => ({
        fileName: "mpesa_events.json",
        fileType: "mpesa-json" as const,
        contents: JSON.stringify([event]),
      });
      const first = service.processFiles([file(payment)], allocationAt);
      const family = first.familyBalances.find(
        (item) => item.familyId === "fam_202",
      );
      assert.equal(
        family?.invoices.reduce((sum, invoice) => sum + invoice.paidMinor, 0),
        7_000_000,
      );
      const reversed = service.processFiles([file(reversal)], allocationAt);
      const after = reversed.familyBalances.find(
        (item) => item.familyId === "fam_202",
      );
      assert.equal(
        after?.invoices.reduce((sum, invoice) => sum + invoice.paidMinor, 0),
        0,
      );
    } finally {
      database.close();
    }
  });

  void it("keeps balances correct when a partial reversal arrives before or after its payment", () => {
    const events = JSON.parse(
      readFileSync(path.join(fixtureDirectory, "mpesa_events.json"), "utf8"),
    ) as {
      event: string;
      payload: { TransID?: string; TransAmount?: string };
    }[];
    const payment = events.find(
      (event) => event.payload.TransID === "SKD3XH2B02",
    );
    const originalReversal = events.find(
      (event) => event.payload.TransID === "SKD3XR9Z07",
    );
    assert.ok(payment);
    assert.ok(originalReversal);
    const reversal = {
      ...originalReversal,
      payload: { ...originalReversal.payload, TransAmount: "20000.00" },
    };
    const file = (event: unknown) => ({
      fileName: "mpesa_events.json",
      fileType: "mpesa-json" as const,
      contents: JSON.stringify([event]),
    });
    for (const ordered of [
      [payment, reversal],
      [reversal, payment],
    ]) {
      const { database, service } = setup();
      try {
        for (const event of ordered)
          service.processFiles([file(event)], allocationAt);
        for (let attempt = 0; attempt < 3; attempt++) {
          const result = service.processFiles(ordered.map(file), allocationAt);
          const family = result.familyBalances.find(
            (item) => item.familyId === "fam_202",
          );
          assert.equal(
            family?.invoices.reduce(
              (sum, invoice) => sum + invoice.paidMinor,
              0,
            ),
            5_000_000,
          );
          assert.deepEqual(
            family?.invoices.map((invoice) => [
              invoice.invoiceId,
              invoice.paidMinor,
            ]),
            [
              ["INV-2003", 4_400_000],
              ["INV-2004", 0],
              ["INV-2005", 600_000],
            ],
          );
        }
      } finally {
        database.close();
      }
    }
  });

  void it("allocates supplied fixtures and returns stable explained family balances on replay", () => {
    const { database, service } = setup();
    try {
      const files = new PaymentFileRetrievalService().retrieveFiles(
        fileReferences,
      );
      const first = service.processFiles(files, allocationAt);
      const replay = service.processFiles(
        [...files].reverse(),
        "2026-11-11T09:00:00+03:00",
      );

      assert.equal(first.eventCount, 17);
      assert.equal(first.allocatedPaymentCount, 9);
      assert.deepEqual(replay, first);
      assert.equal(first.familyBalances.length, 8);
      assert.equal(
        first.familyBalances.reduce(
          (count, family) => count + family.invoices.length,
          0,
        ),
        11,
      );

      const family201 = first.familyBalances.find(
        (family) => family.familyId === "fam_201",
      );
      const tuition201 = family201?.invoices.find(
        (invoice) => invoice.invoiceId === "INV-2001",
      );
      assert.equal(tuition201?.paidMinor, 2_600_000);
      assert.equal(tuition201?.balanceMinor, 3_400_000);
      assert.deepEqual(
        tuition201?.allocations.map((line) => ({
          source: line.source,
          amountMinor: line.amountMinor,
          policyVersion: line.policyVersion,
        })),
        [
          { source: "mpesa", amountMinor: 2_100_000, policyVersion: 2 },
          { source: "mpesa", amountMinor: 500_000, policyVersion: 2 },
        ],
      );

      const family202 = first.familyBalances.find(
        (family) => family.familyId === "fam_202",
      );
      const lunch202 = family202?.invoices.find(
        (invoice) => invoice.invoiceId === "INV-2005",
      );
      const tuition202 = family202?.invoices.find(
        (invoice) => invoice.invoiceId === "INV-2003",
      );
      assert.equal(lunch202?.balanceMinor, 0);
      assert.equal(lunch202?.allocations[0]?.policyVersion, 2);
      assert.equal(tuition202?.paidMinor, 2_000_000);
      assert.equal(tuition202?.allocations[0]?.source, "bank");

      const held = first.matches.filter((match) => match.status === "held");
      assert.ok(
        held.some(
          (match) =>
            match.sourceReference === "SKD3XM7G07" &&
            match.holdReason === "unknown_reference",
        ),
      );
      assert.ok(
        held.some(
          (match) =>
            match.sourceReference === "SWIFT-INW-88213" &&
            match.holdReason === "currency_conversion_unavailable",
        ),
      );
      assert.ok(
        !first.matches.some((match) => match.sourceReference === "SKD3XR9Z07"),
      );
    } finally {
      database.close();
    }
  });
});
