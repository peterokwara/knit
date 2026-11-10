import { readFileSync } from "node:fs";
import path from "node:path";
import type { IPaymentFileReference } from "../src/server/models/ingestion/IPaymentFileReference";
import type { IPaymentIngestionContext } from "../src/server/models/ingestion/IPaymentIngestionContext";
import type { IPaymentFamilyMatchingContext } from "../src/server/models/ingestion/IPaymentFamilyMatchingContext";
import type { IAllocationInvoice } from "../src/server/models/allocation/IAllocationInvoice";
import { FamilyInvoiceBalanceService } from "../src/server/services/familyInvoiceBalanceService";
import { PaymentAllocationService } from "../src/server/services/paymentAllocationService";
import { PaymentFileRetrievalService } from "../src/server/services/paymentFileRetrievalService";
import { PaymentFamilyMatchingService } from "../src/server/services/paymentFamilyMatchingService";
import { PaymentIngestionService } from "../src/server/services/paymentIngestionService";
import { PaymentReconciliationService } from "../src/server/services/paymentReconciliationService";
import { SchoolConfigurationService } from "../src/server/services/schoolConfigurationService";
import { SqlitePaymentAllocationPlanStore } from "../src/server/services/sqlitePaymentAllocationPlanStore";
import { SqlitePaymentIngestionService } from "../src/server/services/sqlitePaymentIngestionService";
import { SqlitePaymentReviewResolutionStore } from "../src/server/services/sqlitePaymentReviewResolutionStore";
import { SqliteSchoolConfigurationService } from "../src/server/services/sqliteSchoolConfigurationService";
import { SqliteHelper } from "../src/server/utils/sqliteHelper";

interface ISchoolFixture {
  school: {
    school_id: string;
    timezone: string;
    billing_currency: string;
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
}

const fixtureDirectory = path.resolve(import.meta.dirname, "../../fixtures");
const schoolFixture = JSON.parse(
  readFileSync(
    path.join(fixtureDirectory, "school/families_and_invoices.json"),
    "utf8",
  ),
) as ISchoolFixture;
const context: IPaymentIngestionContext = {
  schoolId: schoolFixture.school.school_id,
  timeZone: schoolFixture.school.timezone,
  mpesaPaybill: schoolFixture.school.mpesa_paybill,
  bankAccounts: schoolFixture.school.bank_accounts.map((account) => ({
    accountNo: account.account_no,
    currency: account.currency,
  })),
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

const database = SqliteHelper.openConnection();
try {
  const planStore = new SqlitePaymentAllocationPlanStore(database, invoices);
  const configurations = new SchoolConfigurationService(
    new SqliteSchoolConfigurationService(database),
  );
  const service = new PaymentReconciliationService(
    new PaymentIngestionService(
      new SqlitePaymentIngestionService(database),
      context,
    ),
    new PaymentFamilyMatchingService(matchingContext),
    new PaymentAllocationService(configurations, planStore),
    new FamilyInvoiceBalanceService(planStore),
    { matching: matchingContext, invoices },
    new SqlitePaymentReviewResolutionStore(database),
  );
  const files = new PaymentFileRetrievalService().retrieveFiles(fileReferences);
  const reconciliation = service.processFiles(files, new Date().toISOString());
  const matchedCount = reconciliation.matches.filter(
    (match) => match.status === "matched",
  ).length;
  const heldCount = reconciliation.matches.filter(
    (match) => match.status === "held",
  ).length;
  const conflictCount = reconciliation.matches.filter(
    (match) => match.holdReason === "event_conflict",
  ).length;
  console.log(
    `Stored ${reconciliation.eventCount} payment event variants for ${context.schoolId}; ${conflictCount} matching decisions are conflicted.`,
  );
  console.log(
    `Matched ${matchedCount} payments to a family; allocated ${reconciliation.allocatedPaymentCount}; ${heldCount} are held for review.`,
  );
  for (const family of reconciliation.familyBalances) {
    console.log(`\n${family.familyReference} (${family.familyId})`);
    for (const invoice of family.invoices) {
      console.log(
        `  ${invoice.invoiceId}: due ${invoice.amountMinor} ${invoice.currency} minor units, paid ${invoice.paidMinor}, balance ${invoice.balanceMinor}`,
      );
      for (const evidence of invoice.allocations) {
        console.log(
          `    ${evidence.source} payment ${evidence.paymentId}: ${evidence.amountMinor}; policy v${evidence.policyVersion}; applied ${evidence.effectiveAt}`,
        );
      }
    }
  }
  const held = reconciliation.matches.filter(
    (match) => match.status === "held",
  );
  if (held.length > 0) {
    console.log("\nHeld for review:");
    for (const match of held) {
      console.log(
        `  ${match.sourceReference} (${match.currency}): ${match.holdReason}`,
      );
    }
  }
} finally {
  SqliteHelper.closeConnection(database);
}
