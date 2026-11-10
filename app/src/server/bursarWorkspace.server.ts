import { readFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { IAllocationInvoice } from "./models/allocation/IAllocationInvoice";
import type { IPaymentFamilyMatchingContext } from "./models/ingestion/IPaymentFamilyMatchingContext";
import type { IPaymentReconciliationContext } from "./models/ingestion/IPaymentReconciliationContext";
import { FamilyInvoiceBalanceService } from "./services/familyInvoiceBalanceService";
import { PaymentAllocationService } from "./services/paymentAllocationService";
import { PaymentFamilyMatchingService } from "./services/paymentFamilyMatchingService";
import { PaymentIngestionService } from "./services/paymentIngestionService";
import { PaymentReviewResolutionService } from "./services/paymentReviewResolutionService";
import { SqlitePaymentAllocationPlanStore } from "./services/sqlitePaymentAllocationPlanStore";
import { SqlitePaymentIngestionService } from "./services/sqlitePaymentIngestionService";
import { SqlitePaymentReviewResolutionStore } from "./services/sqlitePaymentReviewResolutionStore";
import { SchoolConfigurationService } from "./services/schoolConfigurationService";
import { SqliteSchoolConfigurationService } from "./services/sqliteSchoolConfigurationService";
import { SqliteHelper } from "./utils/sqliteHelper";

interface ISchoolFixture {
  school: {
    school_id: string;
    name: string;
    timezone: string;
    billing_currency: string;
    mpesa_paybill: string;
    bank_accounts: { account_no: string; currency: string }[];
  };
  families: {
    family_id: string;
    family_ref: string;
    learners: { admission_no: string; first_name: string }[];
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

const fixturePath = path.resolve(
  import.meta.dirname,
  "../../../fixtures/school/families_and_invoices.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as ISchoolFixture;
const matching: IPaymentFamilyMatchingContext = {
  schoolId: fixture.school.school_id,
  billingCurrency: fixture.school.billing_currency,
  families: fixture.families.map((family) => ({
    familyId: family.family_id,
    familyReference: family.family_ref,
    admissionNumbers: family.learners.map((learner) => learner.admission_no),
  })),
};
const invoices: IAllocationInvoice[] = fixture.invoices.map((invoice) => ({
  schoolId: fixture.school.school_id,
  familyId: invoice.family_id,
  invoiceId: invoice.invoice_id,
  category: invoice.category,
  amountMinor: invoice.amount_minor,
  currency: invoice.currency,
  dueOn: invoice.due_on,
}));
const reconciliation: IPaymentReconciliationContext = { matching, invoices };

/**
 * Return serialized family and payment data for the bursar screen.
 * @returns Fixture-backed family accounts and persisted payment evidence.
 */
export function getBursarWorkspace() {
  return withServices((services) => {
    const events = services.ingestion.getEvents();
    const eventsById = new Map(events.map((event) => [event.eventKey, event]));
    const decisionsByPayment = new Map(
      services.reviewStore
        .getResolutions(matching.schoolId)
        .map((decision) => [decision.eventKey, decision]),
    );
    const families = fixture.families.map((family) => {
      const balances = services.balances.getFamilyBalances(
        matching.schoolId,
        family.family_id,
        invoices.filter((invoice) => invoice.familyId === family.family_id),
      );
      return {
        familyId: family.family_id,
        familyReference: family.family_ref,
        learners: family.learners,
        outstandingMinor: balances.reduce(
          (sum, invoice) => sum + invoice.balanceMinor,
          0,
        ),
        invoices: balances.map((invoice) => ({
          invoiceId: invoice.invoiceId,
          category: invoice.category,
          dueOn: invoice.dueOn,
          currency: invoice.currency,
          dueMinor: invoice.amountMinor,
          paidMinor: invoice.paidMinor,
          remainingMinor: invoice.balanceMinor,
          payments: invoice.allocations.map((allocation) => {
            const event = eventsById.get(allocation.paymentId);
            return {
              source: allocation.source,
              reference: event?.sourceReference ?? allocation.paymentId,
              date:
                event?.occurredAt ??
                event?.occurredOn ??
                allocation.effectiveAt,
              amountMinor: allocation.amountMinor,
              originalAmountMinor: allocation.originalAmountMinor ?? null,
              reversedMinor: allocation.reversedMinor ?? 0,
              reversalReferences: allocation.reversalReferences ?? [],
              reallocatedAfterReversal:
                allocation.reallocatedAfterReversal ?? false,
              policyVersion: allocation.policyVersion,
              decision: decisionsByPayment.get(allocation.paymentId) ?? null,
              raw:
                event?.observations.map((observation) => ({
                  file: observation.sourceFile,
                  data: observation.rawJson,
                })) ?? [],
            };
          }),
        })),
      };
    });
    const holds = services.resolutions
      .listHeldPayments()
      .map((hold) => ({
        ...hold,
        raw:
          eventsById.get(hold.eventKey)?.observations.map((observation) => ({
            file: observation.sourceFile,
            data: observation.rawJson,
          })) ?? [],
      }))
      .sort((left, right) =>
        (left.occurredAt ?? left.occurredOn ?? "9999").localeCompare(
          right.occurredAt ?? right.occurredOn ?? "9999",
        ),
      );
    return {
      schoolName: fixture.school.name,
      currency: fixture.school.billing_currency,
      bursar: "Assessment demo bursar",
      eventCount: events.length,
      families,
      holds,
    };
  });
}

/**
 * Preview the policy allocation for an eligible held payment and family.
 * @param input Payment identity and selected family.
 * @param input.eventKey Stable provider event identity.
 * @param input.fingerprint Fingerprint of the exact event variant.
 * @param input.familyId Selected school family.
 * @returns The allocation plan and instant used to select school policy.
 */
export function previewBursarResolution(input: {
  eventKey: string;
  fingerprint: string;
  familyId: string;
}) {
  return withServices((services) => {
    const event = services.ingestion
      .getEvents()
      .find(
        (candidate) =>
          candidate.eventKey === input.eventKey &&
          candidate.fingerprint === input.fingerprint,
      );
    if (!event) throw new Error("Payment evidence is no longer available");
    const family = matching.families.find(
      (candidate) => candidate.familyId === input.familyId,
    );
    if (!family) throw new Error("Choose a family from this school");
    const match = services.matcher.matchPayments([event])[0];
    if (
      !match ||
      match.status !== "held" ||
      !match.holdReason ||
      ![
        "missing_reference",
        "unknown_reference",
        "ambiguous_reference",
      ].includes(match.holdReason)
    )
      throw new Error("This payment cannot be assigned from this screen");
    const resolvedMatch = {
      ...match,
      familyId: family.familyId,
      matchType: "bursar_resolution" as const,
      status: "matched" as const,
      holdReason: null,
    };
    const now = new Date().toISOString();
    const plan = services.allocation.previewPayment(
      event,
      resolvedMatch,
      invoices.filter((invoice) => invoice.familyId === family.familyId),
      now,
    );
    return { plan, previewedAt: now };
  });
}

/**
 * Record the bursar decision and allocate using the confirmed policy version.
 * @param input Confirmed payment, family, reason, and preview version.
 * @param input.eventKey Stable provider event identity.
 * @param input.fingerprint Fingerprint of the exact event variant.
 * @param input.familyId Family selected by the bursar.
 * @param input.reason Evidence-based reason for the family decision.
 * @param input.expectedPolicyVersion Policy version shown in the preview.
 * @returns Saved audit decision, allocation plan, and updated family balance.
 */
export function confirmBursarResolution(input: {
  eventKey: string;
  fingerprint: string;
  familyId: string;
  reason: string;
  expectedPolicyVersion?: number;
}) {
  return withServices((services) =>
    services.resolutions.resolvePayment({
      ...input,
      actorId: "assessment-demo-bursar",
      resolvedAt: new Date().toISOString(),
    }),
  );
}

function withServices<T>(
  action: (services: {
    ingestion: PaymentIngestionService;
    balances: FamilyInvoiceBalanceService;
    matcher: PaymentFamilyMatchingService;
    allocation: PaymentAllocationService;
    resolutions: PaymentReviewResolutionService;
    reviewStore: SqlitePaymentReviewResolutionStore;
  }) => T,
): T {
  const database: DatabaseSync = SqliteHelper.openConnection();
  try {
    const planStore = new SqlitePaymentAllocationPlanStore(database, invoices);
    const configurations = new SchoolConfigurationService(
      new SqliteSchoolConfigurationService(database),
    );
    const ingestion = new PaymentIngestionService(
      new SqlitePaymentIngestionService(database),
      {
        schoolId: fixture.school.school_id,
        timeZone: fixture.school.timezone,
        mpesaPaybill: fixture.school.mpesa_paybill,
        bankAccounts: fixture.school.bank_accounts.map((account) => ({
          accountNo: account.account_no,
          currency: account.currency,
        })),
      },
    );
    const balances = new FamilyInvoiceBalanceService(planStore);
    const allocation = new PaymentAllocationService(configurations, planStore);
    const matcher = new PaymentFamilyMatchingService(matching);
    const reviewStore = new SqlitePaymentReviewResolutionStore(database);
    const resolutions = new PaymentReviewResolutionService(
      ingestion,
      matcher,
      allocation,
      balances,
      reviewStore,
      reconciliation,
    );
    return action({
      ingestion,
      balances,
      matcher,
      allocation,
      resolutions,
      reviewStore,
    });
  } finally {
    SqliteHelper.closeConnection(database);
  }
}
