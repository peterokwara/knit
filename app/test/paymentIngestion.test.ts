import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { PaymentIngestionService } from '../src/server/services/paymentIngestionService'
import { SqlitePaymentIngestionService } from '../src/server/services/sqlitePaymentIngestionService'
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
      assert.equal(paymentEvent?.amountMinor, 7_000_000)
      assert.equal(paymentEvent?.paymentReference, 'FAM-202')
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
      assert.equal(event.paymentReference, 'ADM-1044')
    } finally {
      database.close()
    }
  })
})
