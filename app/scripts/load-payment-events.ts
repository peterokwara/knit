import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { IPaymentFileReference } from '../src/server/models/ingestion/IPaymentFileReference'
import type { IPaymentIngestionContext } from '../src/server/models/ingestion/IPaymentIngestionContext'
import { PaymentFileRetrievalService } from '../src/server/services/paymentFileRetrievalService'
import { PaymentIngestionService } from '../src/server/services/paymentIngestionService'
import { SqlitePaymentIngestionService } from '../src/server/services/sqlitePaymentIngestionService'
import { SqliteHelper } from '../src/server/utils/sqliteHelper'

interface ISchoolFixture {
  school: {
    school_id: string
    timezone: string
    mpesa_paybill: string
    bank_accounts: { account_no: string; currency: string }[]
  }
}

const fixtureDirectory = path.resolve(import.meta.dirname, '../../fixtures')
const schoolFixture = JSON.parse(readFileSync(path.join(fixtureDirectory, 'school/families_and_invoices.json'), 'utf8')) as ISchoolFixture
const context: IPaymentIngestionContext = {
  schoolId: schoolFixture.school.school_id,
  timeZone: schoolFixture.school.timezone,
  mpesaPaybill: schoolFixture.school.mpesa_paybill,
  bankAccounts: schoolFixture.school.bank_accounts.map((account) => ({ accountNo: account.account_no, currency: account.currency })),
}
const fileReferences: IPaymentFileReference[] = [
  {
    fileName: 'mpesa_events.json', fileType: 'mpesa-json',
    location: path.join(fixtureDirectory, 'mpesa_events.json'),
  },
  ...['export_2026-11-03.csv', 'export_2026-11-04.csv'].map((fileName): IPaymentFileReference => ({
    fileName,
    fileType: 'bank-csv',
    location: path.join(fixtureDirectory, 'bank', fileName),
  })),
]

const database = SqliteHelper.openConnection()
try {
  const service = new PaymentIngestionService(new SqlitePaymentIngestionService(database), context)
  const files = new PaymentFileRetrievalService().retrieveFiles(fileReferences)
  service.importFiles(files)
  const events = service.getEvents()
  console.log(`Stored ${events.length} payment event variants for ${context.schoolId}; ${events.filter((event) => event.conflicted).length} are conflicted.`)
} finally {
  SqliteHelper.closeConnection(database)
}
