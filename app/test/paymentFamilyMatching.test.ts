import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import path from "node:path";
import type { IIngestedPaymentEvent } from "../src/server/models/ingestion/IIngestedPaymentEvent";
import type { IPaymentFamilyMatchingContext } from "../src/server/models/ingestion/IPaymentFamilyMatchingContext";
import type { IPaymentIngestionContext } from "../src/server/models/ingestion/IPaymentIngestionContext";
import { PaymentFileRetrievalService } from "../src/server/services/paymentFileRetrievalService";
import { PaymentFamilyMatchingService } from "../src/server/services/paymentFamilyMatchingService";
import { PaymentIngestionService } from "../src/server/services/paymentIngestionService";
import { SqlitePaymentIngestionService } from "../src/server/services/sqlitePaymentIngestionService";
import { initializeSchema } from "../src/server/utils/configurationSchema";

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
}

const fixtureDirectory = path.resolve(import.meta.dirname, "../../fixtures");
const schoolFixture = JSON.parse(
  readFileSync(
    path.join(fixtureDirectory, "school/families_and_invoices.json"),
    "utf8",
  ),
) as ISchoolFixture;
const matchingContext: IPaymentFamilyMatchingContext = {
  schoolId: schoolFixture.school.school_id,
  billingCurrency: schoolFixture.school.billing_currency,
  families: schoolFixture.families.map((family) => ({
    familyId: family.family_id,
    familyReference: family.family_ref,
    admissionNumbers: family.learners.map((learner) => learner.admission_no),
  })),
};
const ingestionContext: IPaymentIngestionContext = {
  schoolId: schoolFixture.school.school_id,
  timeZone: schoolFixture.school.timezone,
  mpesaPaybill: schoolFixture.school.mpesa_paybill,
  bankAccounts: schoolFixture.school.bank_accounts.map((account) => ({
    accountNo: account.account_no,
    currency: account.currency,
  })),
};

const context: IPaymentFamilyMatchingContext = {
  schoolId: "sch_mlima",
  billingCurrency: "KES",
  families: [
    {
      familyId: "fam_201",
      familyReference: "FAM-201",
      admissionNumbers: ["ADM-1041"],
    },
    {
      familyId: "fam_202",
      familyReference: "FAM-202",
      admissionNumbers: ["ADM-1042", "ADM-1043"],
    },
  ],
};

function createPayment(
  overrides: Partial<IIngestedPaymentEvent> = {},
): IIngestedPaymentEvent {
  return {
    schoolId: "sch_mlima",
    eventKey: "mpesa:c2b:TX-1",
    fingerprint: "fingerprint-1",
    source: "mpesa",
    sourceReference: "TX-1",
    eventKind: "payment",
    classification: "payment",
    amountMinor: 3_000_000,
    netAmountMinor: 3_000_000,
    currency: "KES",
    occurredAt: "2026-11-03T07:15:00.000Z",
    occurredOn: null,
    paymentReference: "ADM-1041",
    relatedReference: null,
    issue: null,
    conflicted: false,
    reversalStatus: "not_reversal",
    observations: [],
    ...overrides,
  };
}

function loadFixtureEvents(): IIngestedPaymentEvent[] {
  const database = new DatabaseSync(":memory:");
  initializeSchema(database, () => new DatabaseSync(":memory:"));
  try {
    const references = [
      {
        fileName: "mpesa_events.json",
        fileType: "mpesa-json" as const,
        location: path.join(fixtureDirectory, "mpesa_events.json"),
      },
      ...["export_2026-11-03.csv", "export_2026-11-04.csv"].map((fileName) => ({
        fileName,
        fileType: "bank-csv" as const,
        location: path.join(fixtureDirectory, "bank", fileName),
      })),
    ];
    const files = new PaymentFileRetrievalService().retrieveFiles(references);
    const ingestion = new PaymentIngestionService(
      new SqlitePaymentIngestionService(database),
      ingestionContext,
    );
    ingestion.importFiles(files);
    return ingestion.getEvents();
  } finally {
    database.close();
  }
}

void describe("payment family matching", () => {
  void it("matches exact admission and family references to one family", () => {
    const service = new PaymentFamilyMatchingService(context);
    const admissionPayment = createPayment();
    const familyPayment = createPayment({
      eventKey: "mpesa:c2b:TX-2",
      fingerprint: "fingerprint-2",
      sourceReference: "TX-2",
      paymentReference: "FAM-202",
    });
    const siblingPayment = createPayment({
      eventKey: "mpesa:c2b:TX-3",
      fingerprint: "fingerprint-3",
      sourceReference: "TX-3",
      paymentReference: "ADM-1043",
    });

    const decisions = service.matchPayments([
      admissionPayment,
      familyPayment,
      siblingPayment,
    ]);

    assert.deepEqual(decisions, [
      {
        schoolId: "sch_mlima",
        eventKey: "mpesa:c2b:TX-1",
        fingerprint: "fingerprint-1",
        sourceReference: "TX-1",
        paymentReference: "ADM-1041",
        currency: "KES",
        familyId: "fam_201",
        matchType: "admission_number",
        status: "matched",
        holdReason: null,
      },
      {
        schoolId: "sch_mlima",
        eventKey: "mpesa:c2b:TX-2",
        fingerprint: "fingerprint-2",
        sourceReference: "TX-2",
        paymentReference: "FAM-202",
        currency: "KES",
        familyId: "fam_202",
        matchType: "family_reference",
        status: "matched",
        holdReason: null,
      },
      {
        schoolId: "sch_mlima",
        eventKey: "mpesa:c2b:TX-3",
        fingerprint: "fingerprint-3",
        sourceReference: "TX-3",
        paymentReference: "ADM-1043",
        currency: "KES",
        familyId: "fam_202",
        matchType: "admission_number",
        status: "matched",
        holdReason: null,
      },
    ]);
  });

  void it("holds missing, mistyped, and ambiguous references without guessing", () => {
    const service = new PaymentFamilyMatchingService({
      ...context,
      families: [
        ...context.families,
        {
          familyId: "fam_203",
          familyReference: "FAM-203",
          admissionNumbers: ["ADM-1047"],
        },
        {
          familyId: "fam_204",
          familyReference: "FAM-204",
          admissionNumbers: ["ADM-1047"],
        },
      ],
    });
    const typo = createPayment({ paymentReference: "ADM-1O47" });
    const missing = createPayment({
      eventKey: "bank:0110234567:TX-2",
      fingerprint: "fingerprint-2",
      sourceReference: "TX-2",
      source: "bank",
      eventKind: "bank_line",
      classification: "unclassified",
      amountMinor: 100_000,
      netAmountMinor: 0,
      paymentReference: null,
    });
    const ambiguous = createPayment({
      eventKey: "mpesa:c2b:TX-3",
      fingerprint: "fingerprint-3",
      sourceReference: "TX-3",
      paymentReference: "ADM-1047",
    });
    const unvalidatedBankCredit = createPayment({
      eventKey: "bank:unmatched:TX-4",
      fingerprint: "fingerprint-4",
      sourceReference: "TX-4",
      source: "bank",
      eventKind: "bank_line",
      classification: "unclassified",
      paymentReference: "ADM-1041",
      issue: "The statement account does not match the school configuration.",
    });

    const decisions = service.matchPayments([
      typo,
      missing,
      ambiguous,
      unvalidatedBankCredit,
    ]);

    assert.deepEqual(
      decisions.map(({ status, holdReason, familyId }) => ({
        status,
        holdReason,
        familyId,
      })),
      [
        { status: "held", holdReason: "unknown_reference", familyId: null },
        { status: "held", holdReason: "missing_reference", familyId: null },
        { status: "held", holdReason: "ambiguous_reference", familyId: null },
        {
          status: "held",
          holdReason: "source_validation_issue",
          familyId: null,
        },
      ],
    );
  });

  void it("matches the exact family but holds a non-billing currency without inventing an exchange rate", () => {
    const service = new PaymentFamilyMatchingService(context);
    const usdPayment = createPayment({
      currency: "USD",
      paymentReference: "ADM-1041",
    });

    const [decision] = service.matchPayments([usdPayment]);

    assert.equal(decision.familyId, "fam_201");
    assert.equal(decision.matchType, "admission_number");
    assert.equal(decision.status, "held");
    assert.equal(decision.holdReason, "currency_conversion_unavailable");
  });

  void it("holds conflicting event variants even when their references otherwise match", () => {
    const service = new PaymentFamilyMatchingService(context);
    const conflictedPayment = createPayment({ conflicted: true });
    const overReversedPayment = createPayment({ reversalStatus: "conflicted" });

    const decisions = service.matchPayments([
      conflictedPayment,
      overReversedPayment,
    ]);

    assert.deepEqual(
      decisions.map(({ status, holdReason, familyId }) => ({
        status,
        holdReason,
        familyId,
      })),
      [
        { status: "held", holdReason: "event_conflict", familyId: null },
        { status: "held", holdReason: "event_conflict", familyId: null },
      ],
    );
  });

  void it("does not treat reversals, failed attempts, fees, or settlements as family payments", () => {
    const service = new PaymentFamilyMatchingService(context);
    const excluded = [
      createPayment({
        eventKind: "reversal",
        classification: "reversal",
        amountMinor: -3_000_000,
      }),
      createPayment({
        eventKey: "mpesa:stk:FAIL",
        sourceReference: "FAIL",
        eventKind: "stk_result",
        classification: "failed",
        amountMinor: 0,
      }),
      createPayment({
        eventKey: "bank:CHG-1",
        sourceReference: "CHG-1",
        eventKind: "bank_line",
        classification: "fee",
        amountMinor: -35_000,
      }),
      createPayment({
        eventKey: "bank:SET-1",
        sourceReference: "SET-1",
        eventKind: "bank_line",
        classification: "settlement",
      }),
    ];

    assert.deepEqual(service.matchPayments(excluded), []);
  });

  void it("matches the supplied fixtures and holds the mistyped reference and unconvertible USD payment", () => {
    const decisions = new PaymentFamilyMatchingService(
      matchingContext,
    ).matchPayments(loadFixtureEvents());
    const familyPayment = decisions.find(
      (decision) => decision.sourceReference === "SKD3XH2B02",
    );
    const mistypedReference = decisions.find(
      (decision) => decision.sourceReference === "SKD3XM7G07",
    );
    const usdPayment = decisions.find(
      (decision) => decision.sourceReference === "SWIFT-INW-88213",
    );

    assert.equal(familyPayment?.familyId, "fam_202");
    assert.equal(familyPayment?.status, "matched");
    assert.equal(mistypedReference?.familyId, null);
    assert.equal(mistypedReference?.holdReason, "unknown_reference");
    assert.equal(usdPayment?.familyId, "fam_205");
    assert.equal(usdPayment?.status, "held");
    assert.equal(usdPayment?.holdReason, "currency_conversion_unavailable");
  });
});
