import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import path from 'node:path'
import { PaymentIngestionService } from '../src/server/services/paymentIngestionService'
import { PaymentFileRetrievalService } from '../src/server/services/paymentFileRetrievalService'
import { SqlitePaymentIngestionService } from '../src/server/services/sqlitePaymentIngestionService'
import type { IPaymentFileReference } from '../src/server/models/ingestion/IPaymentFileReference'
import { initializeSchema } from '../src/server/utils/configurationSchema'

const context = {
  schoolId: 'sch_mlima',
  timeZone: 'Africa/Nairobi',
  mpesaPaybill: '888001',
  bankAccounts: [
    { accountNo: '0110234567', currency: 'KES' },
    { accountNo: '0110234599', currency: 'USD' },
  ],
}

const createReference = () => new DatabaseSync(':memory:')
const fixtureDirectory = path.resolve(import.meta.dirname, '../../fixtures')
const fixtureSchool = JSON.parse(readFileSync(path.join(fixtureDirectory, 'school/families_and_invoices.json'), 'utf8')) as {
  school: {
    school_id: string
    timezone: string
    mpesa_paybill: string
    bank_accounts: { account_no: string; currency: string }[]
  }
}
const fixtureContext = {
  schoolId: fixtureSchool.school.school_id,
  timeZone: fixtureSchool.school.timezone,
  mpesaPaybill: fixtureSchool.school.mpesa_paybill,
  bankAccounts: fixtureSchool.school.bank_accounts.map((account) => ({ accountNo: account.account_no, currency: account.currency })),
}

function reverseCsvRows(contents: string): string {
  const [header, ...rows] = contents.trim().split(/\r?\n/)
  return [header, ...rows.reverse()].join('\n')
}

function loadFixtureEvents(files: { fileName: string; fileType: 'mpesa-json' | 'bank-csv'; contents: string }[], replays: number) {
  const database = new DatabaseSync(':memory:')
  initializeSchema(database, createReference)
  try {
    const service = new PaymentIngestionService(new SqlitePaymentIngestionService(database), fixtureContext)
    for (let index = 0; index < replays; index += 1) service.importFiles(files)
    return service.getEvents()
  } finally {
    database.close()
  }
}

void describe('payment ingestion', () => {
  void it('deduplicates a retried M-Pesa payment while retaining both callback observations', () => {
    const database = new DatabaseSync(':memory:')
    initializeSchema(database, createReference)
    try {
      const service = new PaymentIngestionService(new SqlitePaymentIngestionService(database), context)
      const first = {
        source: 'mpesa',
        event: 'c2b.confirmation',
        received_at: '2026-11-03T07:15:03Z',
        payload: {
          TransID: 'SKD3XH1A01',
          TransTime: '20261103101500',
          TransAmount: '30000.00',
          BusinessShortCode: '888001',
          BillRefNumber: 'ADM-1041',
          OrgAccountBalance: '30000.00',
        },
      }
      const retry = {
        ...first,
        received_at: '2026-11-03T12:31:07Z',
        payload: { ...first.payload, OrgAccountBalance: '96000.00' },
      }
      const file = {
        fileName: 'mpesa_events.json',
        fileType: 'mpesa-json' as const,
        contents: JSON.stringify([first, retry]),
      }

      service.importFiles([file])
      const beforeReplay = service.getEvents()
      service.importFiles([file])
      const afterReplay = service.getEvents()

      assert.deepEqual(afterReplay, beforeReplay)
      assert.equal(afterReplay.length, 1)
      assert.equal(afterReplay[0].sourceReference, 'SKD3XH1A01')
      assert.equal(afterReplay[0].amountMinor, 3_000_000)
      assert.equal(afterReplay[0].currency, 'KES')
      assert.equal(afterReplay[0].occurredAt, '2026-11-03T07:15:00.000Z')
      assert.equal(afterReplay[0].observations.length, 2)
      const balances = afterReplay[0].observations.map((observation) =>
        (JSON.parse(observation.rawJson) as { payload: { OrgAccountBalance: string } }).payload.OrgAccountBalance)
      assert.deepEqual(balances.sort(), ['30000.00', '96000.00'])
    } finally {
      database.close()
    }
  })

  void it('holds conflicting financial variants of the same M-Pesa reference', () => {
    const database = new DatabaseSync(':memory:')
    initializeSchema(database, createReference)
    try {
      const service = new PaymentIngestionService(new SqlitePaymentIngestionService(database), context)
      const original = {
        source: 'mpesa', event: 'c2b.confirmation', received_at: '2026-11-03T07:15:03Z',
        payload: {
          TransID: 'SKD3XH1A01', TransTime: '20261103101500', TransAmount: '30000.00',
          BusinessShortCode: '888001', BillRefNumber: 'ADM-1041',
        },
      }
      const conflict = { ...original, payload: { ...original.payload, TransAmount: '31000.00' } }
      service.importFiles([{
        fileName: 'mpesa_events.json', fileType: 'mpesa-json', contents: JSON.stringify([original, conflict]),
      }])

      const events = service.getEvents()
      assert.equal(events.length, 2)
      assert.ok(events.every((event) => event.conflicted))
      assert.deepEqual(events.map((event) => event.amountMinor).sort((left, right) => left - right), [3_000_000, 3_100_000])
    } finally {
      database.close()
    }
  })

  void it('retains a reversal that arrives before its original payment', () => {
    const database = new DatabaseSync(':memory:')
    initializeSchema(database, createReference)
    try {
      const service = new PaymentIngestionService(new SqlitePaymentIngestionService(database), context)
      const reversal = {
        source: 'mpesa', event: 'reversal', received_at: '2026-11-03T11:30:14Z',
        payload: {
          TransID: 'SKD3XR9Z07', OriginalTransID: 'SKD3XH2B02',
          TransTime: '20261103143010', TransAmount: '70000.00',
        },
      }
      service.importFiles([{
        fileName: 'mpesa_events.json', fileType: 'mpesa-json', contents: JSON.stringify([reversal]),
      }])
      assert.equal(service.getEvents()[0].reversalStatus, 'unmatched')
      const original = {
        source: 'mpesa', event: 'c2b.confirmation', received_at: '2026-11-03T08:03:07Z',
        payload: {
          TransID: 'SKD3XH2B02', TransTime: '20261103110305', TransAmount: '70000.00',
          BusinessShortCode: '888001', BillRefNumber: 'FAM-202',
        },
      }
      service.importFiles([{
        fileName: 'mpesa_events.json', fileType: 'mpesa-json', contents: JSON.stringify([original]),
      }])

      const events = service.getEvents()
      const reversalEvent = events.find((event) => event.sourceReference === 'SKD3XR9Z07')
      const paymentEvent = events.find((event) => event.sourceReference === 'SKD3XH2B02')
      assert.equal(events.length, 2)
      assert.equal(reversalEvent?.relatedReference, 'SKD3XH2B02')
      assert.equal(reversalEvent?.amountMinor, -7_000_000)
      assert.equal(reversalEvent?.reversalStatus, 'matched')
      assert.equal(paymentEvent?.amountMinor, 7_000_000)
      assert.equal(paymentEvent?.netAmountMinor, 0)
      assert.equal(paymentEvent?.paymentReference, 'FAM-202')
    } finally {
      database.close()
    }
  })

  void it('holds an over-reversed payment at zero and marks all linked records conflicted', () => {
    const database = new DatabaseSync(':memory:')
    initializeSchema(database, createReference)
    try {
      const service = new PaymentIngestionService(new SqlitePaymentIngestionService(database), context)
      const payment = {
        source: 'mpesa', event: 'c2b.confirmation',
        payload: {
          TransID: 'OVER-1', TransTime: '20261103101500', TransAmount: '70000.00',
          BusinessShortCode: '888001', BillRefNumber: 'FAM-202',
        },
      }
      const reversals = ['OVER-R1', 'OVER-R2'].map((transactionId) => ({
        source: 'mpesa', event: 'reversal',
        payload: { TransID: transactionId, OriginalTransID: 'OVER-1', TransTime: '20261103143010', TransAmount: '40000.00' },
      }))
      service.importFiles([{
        fileName: 'mpesa_events.json', fileType: 'mpesa-json', contents: JSON.stringify([...reversals, payment]),
      }])

      const events = service.getEvents()
      const original = events.find((event) => event.sourceReference === 'OVER-1')
      const linkedReversals = events.filter((event) => event.classification === 'reversal')
      assert.equal(original?.netAmountMinor, 0)
      assert.equal(original?.reversalStatus, 'conflicted')
      assert.match(original?.issue ?? '', /exceed the original payment amount/)
      assert.ok(linkedReversals.every((event) => event.reversalStatus === 'conflicted'))
    } finally {
      database.close()
    }
  })

  void it('records a failed STK request with no payment amount', () => {
    const database = new DatabaseSync(':memory:')
    initializeSchema(database, createReference)
    try {
      const service = new PaymentIngestionService(new SqlitePaymentIngestionService(database), context)
      const failed = {
        source: 'mpesa', event: 'stk.result', received_at: '2026-11-03T07:12:31Z',
        payload: {
          CheckoutRequestID: 'ws_CO_03112026101201837', ResultCode: 1,
          AccountReference: 'ADM-1044', Amount: '60000.00', MpesaReceiptNumber: null,
        },
      }
      service.importFiles([{
        fileName: 'mpesa_events.json', fileType: 'mpesa-json', contents: JSON.stringify([failed]),
      }])

      const [event] = service.getEvents()
      assert.equal(event.classification, 'failed')
      assert.equal(event.amountMinor, 0)
      assert.equal(event.netAmountMinor, 0)
      assert.equal(event.paymentReference, 'ADM-1044')
    } finally {
      database.close()
    }
  })

  void it('reads a bank transfer from a reordered CSV with quoted thousands separators', () => {
    const database = new DatabaseSync(':memory:')
    initializeSchema(database, createReference)
    try {
      const service = new PaymentIngestionService(new SqlitePaymentIngestionService(database), context)
      service.importFiles([{
        fileName: 'bank/export_changed.csv',
        fileType: 'bank-csv',
        contents: [
          '"Transaction Reference","Credit Amount","Account Number","Currency","Posting Date","Value Date","Description","Debit Amount","Balance"',
          'FT26307QWE45,"30,000.00",0110234567,KES,2026-11-03,2026-11-03,"EFT P OTIENO ADM-1049 FEES",,1339650.00',
        ].join('\n'),
      }])

      const [event] = service.getEvents()
      assert.equal(event.source, 'bank')
      assert.equal(event.sourceReference, 'FT26307QWE45')
      assert.equal(event.classification, 'payment')
      assert.equal(event.amountMinor, 3_000_000)
      assert.equal(event.currency, 'KES')
      assert.equal(event.occurredOn, '2026-11-03')
      assert.equal(event.paymentReference, 'ADM-1049')
    } finally {
      database.close()
    }
  })

  void it('reads an alternate bank layout with a single amount and explicit direction', () => {
    const database = new DatabaseSync(':memory:')
    initializeSchema(database, createReference)
    try {
      const service = new PaymentIngestionService(new SqlitePaymentIngestionService(database), context)
      service.importFiles([{
        fileName: 'bank/alternate-layout.csv', fileType: 'bank-csv',
        contents: [
          'Acct No,Currency,Transaction Date,Ref,Details,Amount,Dr/Cr',
          '0110234567,KES,2026-11-03,ALT-001,EFT P OTIENO ADM-1049 FEES,30000.00,CR',
        ].join('\n'),
      }])
      const [event] = service.getEvents()
      assert.equal(event.classification, 'payment')
      assert.equal(event.amountMinor, 3_000_000)
      assert.equal(event.paymentReference, 'ADM-1049')
    } finally {
      database.close()
    }
  })

  void it('holds bank credits that have no recognizable parent reference', () => {
    const database = new DatabaseSync(':memory:')
    initializeSchema(database, createReference)
    try {
      const service = new PaymentIngestionService(new SqlitePaymentIngestionService(database), context)
      service.importFiles([{
        fileName: 'bank/unrelated-credit.csv', fileType: 'bank-csv',
        contents: [
          'account_no,currency,value_date,posting_date,reference,narrative,debit,credit',
          '0110234567,KES,2026-11-03,2026-11-03,INT-001,INTEREST CREDIT,,1000.00',
        ].join('\n'),
      }])
      const [event] = service.getEvents()
      assert.equal(event.classification, 'unclassified')
      assert.equal(event.amountMinor, 100_000)
      assert.equal(event.netAmountMinor, 0)
      assert.match(event.issue ?? '', /no recognizable admission or family reference/)
      assert.equal(event.paymentReference, null)
    } finally {
      database.close()
    }
  })

  void it('deduplicates overlapping bank exports without counting fees or M-Pesa settlement as parent payments', () => {
    const database = new DatabaseSync(':memory:')
    initializeSchema(database, createReference)
    try {
      const service = new PaymentIngestionService(new SqlitePaymentIngestionService(database), context)
      const exportOne = {
        fileName: 'export_2026-11-03.csv', fileType: 'bank-csv' as const,
        contents: [
          'account_no,currency,value_date,posting_date,reference,narrative,debit,credit,balance',
          '0110234567,KES,2026-11-03,2026-11-03,FT26307QWE45,EFT P OTIENO ADM-1049 FEES,,30000.00,1339650.00',
          '0110234567,KES,2026-11-02,2026-11-02,CHG-0211,MONTHLY SERVICE CHARGE,350.00,,1309650.00',
        ].join('\n'),
      }
      const exportTwo = {
        fileName: 'export_2026-11-04.csv', fileType: 'bank-csv' as const,
        contents: [
          'account_no,currency,value_date,posting_date,reference,narrative,debit,credit,balance',
          '0110234567,KES,2026-11-03,2026-11-03,FT26307QWE45,EFT P OTIENO ADM-1049 FEES,,"30,000.00","1,339,650.00"',
          '0110234567,KES,2026-11-04,2026-11-04,MPS-SWP-888001-031126,MPESA PAYBILL 888001 SETTLEMENT 03/11/2026,,"251,000.00","1,590,650.00"',
          '0110234599,USD,2026-11-04,2026-11-04,SWIFT-INW-88213,INWARD SWIFT O HANSEN ADM-1046 T3 FEES,,465.00,12465.00',
        ].join('\n'),
      }

      service.importFiles([exportTwo, exportOne])
      const firstImport = service.getEvents()
      service.importFiles([exportOne, exportTwo])
      const replay = service.getEvents()
      const transfer = replay.find((event) => event.sourceReference === 'FT26307QWE45')
      const fee = replay.find((event) => event.sourceReference === 'CHG-0211')
      const settlement = replay.find((event) => event.sourceReference === 'MPS-SWP-888001-031126')
      const dollarTransfer = replay.find((event) => event.sourceReference === 'SWIFT-INW-88213')

      assert.deepEqual(replay, firstImport)
      assert.equal(replay.length, 4)
      assert.equal(transfer?.classification, 'payment')
      assert.equal(transfer?.observations.length, 2)
      assert.equal(fee?.classification, 'fee')
      assert.equal(fee?.amountMinor, -35_000)
      assert.equal(fee?.netAmountMinor, 0)
      assert.equal(settlement?.classification, 'settlement')
      assert.equal(settlement?.amountMinor, 25_100_000)
      assert.equal(settlement?.netAmountMinor, 0)
      assert.equal(dollarTransfer?.classification, 'payment')
      assert.equal(dollarTransfer?.amountMinor, 46_500)
      assert.equal(dollarTransfer?.currency, 'USD')
      assert.equal(dollarTransfer?.paymentReference, 'ADM-1046')
    } finally {
      database.close()
    }
  })

  void it('imports all fixtures identically across replays, shuffled rows, and either bank file order', () => {
    const mpesaFile = {
      fileName: 'mpesa_events.json', fileType: 'mpesa-json' as const,
      contents: readFileSync(path.join(fixtureDirectory, 'mpesa_events.json'), 'utf8'),
    }
    const mpesaRows = JSON.parse(mpesaFile.contents) as unknown[]
    const shuffledMpesa = { ...mpesaFile, contents: JSON.stringify([...mpesaRows].reverse()) }
    const bankOnePath = path.join(fixtureDirectory, 'bank/export_2026-11-03.csv')
    const bankTwoPath = path.join(fixtureDirectory, 'bank/export_2026-11-04.csv')
    const bankOne = { fileName: path.basename(bankOnePath), fileType: 'bank-csv' as const, contents: readFileSync(bankOnePath, 'utf8') }
    const bankTwo = { fileName: path.basename(bankTwoPath), fileType: 'bank-csv' as const, contents: readFileSync(bankTwoPath, 'utf8') }
    const expected = loadFixtureEvents([mpesaFile, bankOne, bankTwo], 4)
    const shuffled = loadFixtureEvents([
      { ...bankTwo, contents: reverseCsvRows(bankTwo.contents) },
      shuffledMpesa,
      { ...bankOne, contents: reverseCsvRows(bankOne.contents) },
    ], 4)

    assert.deepEqual(shuffled, expected)
    assert.equal(expected.length, 17)
    assert.ok(expected.every((event) => !event.conflicted))
    assert.equal(expected.filter((event) => event.classification === 'payment').length, 12)
    assert.equal(expected.filter((event) => event.classification === 'fee').length, 2)
    assert.equal(expected.filter((event) => event.classification === 'settlement').length, 1)
    assert.equal(expected.filter((event) => event.classification === 'failed').length, 1)
    assert.equal(expected.filter((event) => event.sourceReference === 'FT26307QWE45').length, 1)
    assert.equal(expected.find((event) => event.sourceReference === 'FT26307QWE45')?.observations.length, 2)
    assert.equal(expected.find((event) => event.paymentReference === 'ADM-1O47')?.paymentReference, 'ADM-1O47')
    const mpesaNet = expected.filter((event) => event.source === 'mpesa' && event.classification === 'payment')
      .reduce((total, event) => total + event.netAmountMinor, 0)
    const settlement = expected.find((event) => event.classification === 'settlement')
    assert.equal(mpesaNet, 25_100_000)
    assert.equal(settlement?.amountMinor, mpesaNet)
  })

  void it('retrieves source files separately before importing and reading normalized events', () => {
    const database = new DatabaseSync(':memory:')
    initializeSchema(database, createReference)
    try {
      const references: IPaymentFileReference[] = [
        { fileName: 'mpesa_events.json', fileType: 'mpesa-json', location: path.join(fixtureDirectory, 'mpesa_events.json') },
        { fileName: 'export_2026-11-03.csv', fileType: 'bank-csv', location: path.join(fixtureDirectory, 'bank/export_2026-11-03.csv') },
        { fileName: 'export_2026-11-04.csv', fileType: 'bank-csv', location: path.join(fixtureDirectory, 'bank/export_2026-11-04.csv') },
      ]
      const files = new PaymentFileRetrievalService().retrieveFiles(references)
      const service = new PaymentIngestionService(new SqlitePaymentIngestionService(database), fixtureContext)
      service.importFiles(files)

      const events = service.getEvents()
      assert.equal(files.length, 3)
      assert.equal(events.length, 17)
      assert.equal(events.find((event) => event.sourceReference === 'SKD3XH1A01')?.paymentReference, 'ADM-1041')
      assert.equal(events.filter((event) => event.source === 'mpesa' && event.classification === 'payment')
        .reduce((total, event) => total + event.netAmountMinor, 0), 25_100_000)
    } finally {
      database.close()
    }
  })

  void it('does not persist earlier files when a later file is malformed', () => {
    const database = new DatabaseSync(':memory:')
    initializeSchema(database, createReference)
    try {
      const service = new PaymentIngestionService(new SqlitePaymentIngestionService(database), context)
      const payment = {
        source: 'mpesa', event: 'c2b.confirmation',
        payload: {
          TransID: 'ATOMIC-1', TransTime: '20261103101500', TransAmount: '500.00',
          BusinessShortCode: '888001', BillRefNumber: 'ADM-1041',
        },
      }
      assert.throws(() => service.importFiles([
        { fileName: 'mpesa_events.json', fileType: 'mpesa-json', contents: JSON.stringify([payment]) },
        { fileName: 'bank.csv', fileType: 'bank-csv', contents: 'not,a,complete,statement' },
      ]), /header and at least one bank row/)
      assert.deepEqual(service.getEvents(), [])
    } finally {
      database.close()
    }
  })
})
