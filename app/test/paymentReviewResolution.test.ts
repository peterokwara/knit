import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
import { PaymentReviewResolutionService } from "../src/server/services/paymentReviewResolutionService";
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

function createServices(database: DatabaseSync) {
  const configurationStore = new SqliteSchoolConfigurationService(database);
  const configurations = new SchoolConfigurationService(configurationStore);
  for (const row of configurationHistory.filter((item) => item.version === 1)) {
    if (!configurationStore.getVersion(row.school_id, row.version)) {
      configurations.createSchool({
        schoolId: row.school_id,
        effectiveAt: row.effective_from,
        createdBy: row.created_by,
        reason: row.change_reason,
        configuration: row.config,
      });
    }
  }
  if (!configurationStore.getVersion(changeRequest.school_id, 2))
    configurations.applyChange(applyChange());

  const planStore = new SqlitePaymentAllocationPlanStore(database, invoices);
  const resolutionStore = new SqlitePaymentReviewResolutionStore(database);
  const ingestion = new PaymentIngestionService(
    new SqlitePaymentIngestionService(database),
    {
      schoolId: schoolFixture.school.school_id,
      timeZone: schoolFixture.school.timezone,
      mpesaPaybill: schoolFixture.school.mpesa_paybill,
      bankAccounts: schoolFixture.school.bank_accounts.map((account) => ({
        accountNo: account.account_no,
        currency: account.currency,
      })),
    },
  );
  const matching = new PaymentFamilyMatchingService(matchingContext);
  const allocation = new PaymentAllocationService(configurations, planStore);
  const balances = new FamilyInvoiceBalanceService(planStore);
  return {
    ingestion,
    matching,
    allocation,
    balances,
    resolutionStore,
    review: new PaymentReviewResolutionService(
      ingestion,
      matching,
      allocation,
      balances,
      resolutionStore,
      { matching: matchingContext, invoices },
    ),
    reconciliation: new PaymentReconciliationService(
      ingestion,
      matching,
      allocation,
      balances,
      { matching: matchingContext, invoices },
      resolutionStore,
    ),
  };
}

void describe("payment review resolution", () => {
  void it("resolves a correctable hold once, records its audit, and preserves it on replay", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "knit-review-resolution-"),
    );
    const databasePath = path.join(directory, "knit.sqlite");
    let database = new DatabaseSync(databasePath);
    initializeSchema(database, () => new DatabaseSync(":memory:"));
    try {
      const services = createServices(database);
      const files = new PaymentFileRetrievalService().retrieveFiles(
        fileReferences,
      );
      services.ingestion.importFiles(files);

      const held = services.review.listHeldPayments();
      const mistyped = held.find(
        (payment) => payment.sourceReference === "SKD3XM7G07",
      );
      const usdPayment = held.find(
        (payment) => payment.sourceReference === "SWIFT-INW-88213",
      );
      assert.ok(mistyped);
      assert.ok(usdPayment);
      assert.equal(mistyped?.holdReason, "unknown_reference");
      assert.equal(mistyped?.resolutionEligible, true);
      assert.equal(mistyped?.netAmountMinor, 6_000_000);
      assert.equal(usdPayment?.holdReason, "currency_conversion_unavailable");
      assert.equal(usdPayment?.resolutionEligible, false);

      const input = {
        eventKey: mistyped.eventKey,
        fingerprint: mistyped.fingerprint,
        familyId: "fam_206",
        actorId: "bursar-17",
        reason: "Verified against the parent's bank transfer receipt.",
        resolvedAt: "2026-11-10T09:00:00+03:00",
      };
      assert.throws(
        () =>
          services.review.resolvePayment({
            ...input,
            expectedPolicyVersion: 1,
          }),
        /policy changed after preview/,
      );
      assert.equal(
        services.review.getResolution(input.eventKey, input.fingerprint),
        undefined,
      );
      assert.throws(
        () =>
          services.review.resolvePayment({
            ...input,
            expectedPolicyVersion: 2,
            expectedPlan: {
              policyVersion: 2,
              allocations: [],
              remainderMinor: 0,
              remainderTreatment: "none",
            },
          }),
        /invoice balances changed after preview/,
      );
      assert.equal(
        services.review.getResolution(input.eventKey, input.fingerprint),
        undefined,
      );
      const resolved = services.review.resolvePayment(input);
      assert.equal(resolved.resolution.familyId, "fam_206");
      assert.equal(resolved.resolution.actorId, "bursar-17");
      assert.equal(resolved.resolution.reason, input.reason);
      assert.equal(resolved.resolution.originalHoldReason, "unknown_reference");
      assert.equal(resolved.allocationPlan.policyVersion, 2);
      assert.ok(
        resolved.familyBalance.some((invoice) =>
          invoice.allocations.some((line) => line.paymentId === input.eventKey),
        ),
      );
      assert.ok(
        !services.review
          .listHeldPayments()
          .some((payment) => payment.eventKey === input.eventKey),
      );
      assert.ok(
        services.review
          .listHeldPayments()
          .some((payment) => payment.sourceReference === "SWIFT-INW-88213"),
      );

      assert.deepEqual(services.review.resolvePayment(input), resolved);
      assert.deepEqual(
        services.review.resolvePayment({
          ...input,
          resolvedAt: "2026-11-10T09:00:01+03:00",
        }),
        resolved,
      );
      assert.throws(
        () =>
          services.review.resolvePayment({
            ...input,
            familyId: "fam_205",
          }),
        /different resolution already exists/,
      );
      assert.throws(
        () =>
          services.review.resolvePayment({
            eventKey: usdPayment.eventKey,
            fingerprint: usdPayment.fingerprint,
            familyId: "fam_205",
            actorId: "bursar-17",
            reason: "Assign to this family.",
            resolvedAt: input.resolvedAt,
          }),
        /cannot be safely resolved/,
      );

      database.close();
      database = new DatabaseSync(databasePath);
      initializeSchema(database, () => new DatabaseSync(":memory:"));
      const restartedServices = createServices(database);
      assert.deepEqual(
        restartedServices.review.getResolution(
          input.eventKey,
          input.fingerprint,
        ),
        resolved.resolution,
      );
      const replay = restartedServices.reconciliation.processFiles(
        [...files].reverse(),
        "2026-11-11T09:00:00+03:00",
      );
      const replayMatch = replay.matches.find(
        (match) => match.eventKey === input.eventKey,
      );
      assert.equal(replayMatch?.status, "matched");
      assert.equal(replayMatch?.familyId, "fam_206");
      assert.equal(replayMatch?.matchType, "bursar_resolution");
      const replayedFamily = replay.familyBalances.find(
        (family) => family.familyId === "fam_206",
      );
      assert.ok(
        replayedFamily?.invoices.some((invoice) =>
          invoice.allocations.some((line) => line.paymentId === input.eventKey),
        ),
      );
      assert.equal(replay.allocatedPaymentCount, 10);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
