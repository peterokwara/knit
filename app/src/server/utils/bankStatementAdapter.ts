import type { IPaymentIngestionContext } from '../models/ingestion/IPaymentIngestionContext'
import type { IPaymentEventRecord } from '../models/ingestion/IPaymentEventRecord'
import { fingerprint, parseAmountMinor } from './paymentIngestionValues'
import { makePaymentEventRecord } from './paymentEventFactory'

/** One bank CSV row paired with the file's header names. */
interface ICsvRow {
  headers: string[]
  values: string[]
}

/**
 * Parse quoted CSV fields and validate the file's row shape.
 * @param contents CSV text to parse.
 * @param fileName Source name included in validation errors.
 * @returns Header names and values for each data row.
 */
function parseCsv(contents: string, fileName: string): ICsvRow[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let afterQuote = false
  const input = contents.replace(/^\uFEFF/, '')
  const finishField = () => {
    row.push(field)
    field = ''
    afterQuote = false
  }
  const finishRow = () => {
    finishField()
    if (row.some((value) => value.trim() !== '')) rows.push(row)
    row = []
  }

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
        afterQuote = true
      } else {
        field += character
      }
      continue
    }

    if (afterQuote && character !== ',' && character !== '\n' && character !== '\r' && !/\s/.test(character)) {
      throw new Error(`${fileName} has unexpected text after a quoted CSV field`)
    }
    if (character === '"' && field.length === 0 && !afterQuote) {
      quoted = true
    } else if (character === ',' ) {
      finishField()
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index += 1
      finishRow()
    } else if (!afterQuote) {
      if (character === '"') throw new Error(`${fileName} contains a quote inside an unquoted CSV field`)
      field += character
    }
  }
  if (quoted) throw new Error(`${fileName} ends inside a quoted CSV field`)
  if (field.length > 0 || row.length > 0 || afterQuote) finishRow()
  if (rows.length < 2) throw new Error(`${fileName} must contain a header and at least one bank row`)

  const headers = rows[0].map((header) => header.trim())
  const normalizedHeaders = headers.map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''))
  if (headers.some((header) => !header) || new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new Error(`${fileName} has blank or duplicate CSV headers`)
  }
  return rows.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) throw new Error(`${fileName} row ${rowIndex + 2} has ${values.length} fields, expected ${headers.length}`)
    return { headers, values }
  })
}

/**
 * Normalize a column heading for alias matching.
 * @param value Original heading.
 * @returns Lowercase alphanumeric heading.
 */
function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Find the unique column matching a set of supported aliases.
 * @param headers CSV column headings.
 * @param names Normalized aliases for the requested field.
 * @returns Matching column index, or undefined when absent.
 */
function columnIndex(headers: string[], names: string[]): number | undefined {
  const normalized = headers.map(normalizeHeader)
  const matches = normalized.flatMap((header, index) => names.includes(header) ? [index] : [])
  if (matches.length > 1) throw new Error('Bank statement contains multiple columns for the same field')
  return matches[0]
}

/**
 * Read and trim a cell when its column exists.
 * @param row Parsed CSV row.
 * @param index Column index.
 * @returns Trimmed text, or an empty string when the column is absent.
 */
function textAt(row: ICsvRow, index: number | undefined): string {
  return index === undefined ? '' : row.values[index].trim()
}

/**
 * Parse a populated amount cell into minor units.
 * @param row Parsed CSV row.
 * @param index Column index.
 * @param label Field label for validation errors.
 * @returns Parsed amount, or zero when the cell is blank or absent.
 */
function amountAt(row: ICsvRow, index: number | undefined, label: string): number {
  const value = textAt(row, index)
  return value === '' ? 0 : parseAmountMinor(value, label)
}

/**
 * Validate an optional ISO calendar date.
 * @param value Date text from the statement.
 * @param label Field label for validation errors.
 * @returns Valid date text, or null when blank.
 */
function validDate(value: string, label: string): string | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must use a valid YYYY-MM-DD date`)
  }
  return value
}

/**
 * Extract an admission or family reference from a bank narrative.
 * @param narrative Bank-provided transaction description.
 * @returns The exact matching reference, or null when absent.
 */
function paymentReference(narrative: string): string | null {
  return /\b(?:ADM|FAM)-[A-Z0-9]+\b/i.exec(narrative)?.[0] ?? null
}

/**
 * Normalize bank statement rows and retain their original CSV fields.
 * @param contents The CSV file contents.
 * @param fileName The provider file name.
 * @param context School and bank account details used to validate rows.
 * @returns Normalized events and their original observations.
 */
export function adaptBankStatement(contents: string, fileName: string, context: IPaymentIngestionContext): IPaymentEventRecord[] {
  const rows = parseCsv(contents, fileName)
  const headers = rows[0].headers
  const indexes = {
    account: columnIndex(headers, ['accountno', 'accountnumber', 'account', 'acctno', 'acctnumber', 'accountid']),
    currency: columnIndex(headers, ['currency', 'ccy']),
    valueDate: columnIndex(headers, ['valuedate']),
    postingDate: columnIndex(headers, ['postingdate', 'postdate', 'transactiondate', 'date']),
    reference: columnIndex(headers, ['reference', 'transactionreference', 'bankreference', 'transactionid', 'transactionref', 'ref']),
    narrative: columnIndex(headers, ['narrative', 'description', 'details', 'particulars', 'transactiondescription']),
    debit: columnIndex(headers, ['debit', 'debitamount', 'withdrawal', 'withdrawalamount', 'moneyout']),
    credit: columnIndex(headers, ['credit', 'creditamount', 'deposit', 'depositamount', 'moneyin']),
    amount: columnIndex(headers, ['amount', 'transactionamount']),
    direction: columnIndex(headers, ['direction', 'drcr', 'creditdebit', 'debitcredit', 'transactiondirection', 'entrytype']),
  }
  if (indexes.account === undefined || indexes.currency === undefined || indexes.narrative === undefined ||
      (indexes.valueDate === undefined && indexes.postingDate === undefined) ||
      ((indexes.debit === undefined && indexes.credit === undefined) && (indexes.amount === undefined || indexes.direction === undefined))) {
    throw new Error(`${fileName} is missing required bank statement columns`)
  }

  return rows.map((row, rowIndex) => {
    const accountNo = textAt(row, indexes.account)
    const currencyValue = textAt(row, indexes.currency).toUpperCase()
    const currency = /^[A-Z]{3}$/.test(currencyValue) ? currencyValue : 'XXX'
    const valueDate = validDate(textAt(row, indexes.valueDate), `${fileName} row ${rowIndex + 2} value date`)
    const postingDate = validDate(textAt(row, indexes.postingDate), `${fileName} row ${rowIndex + 2} posting date`)
    const occurredOn = postingDate ?? valueDate
    if (!occurredOn) throw new Error(`${fileName} row ${rowIndex + 2} has no transaction date`)
    const reference = textAt(row, indexes.reference)
    const narrative = textAt(row, indexes.narrative)
    let debitMinor = amountAt(row, indexes.debit, `${fileName} row ${rowIndex + 2} debit`)
    let creditMinor = amountAt(row, indexes.credit, `${fileName} row ${rowIndex + 2} credit`)
    let directionIssue: string | null = null
    if (indexes.debit === undefined && indexes.credit === undefined) {
      const amountMinor = amountAt(row, indexes.amount, `${fileName} row ${rowIndex + 2} amount`)
      const direction = textAt(row, indexes.direction).toUpperCase().replace(/[^A-Z]/g, '')
      if (['CREDIT', 'CR', 'DEPOSIT', 'IN', 'INCOMING'].includes(direction)) creditMinor = amountMinor
      else if (['DEBIT', 'DR', 'WITHDRAWAL', 'OUT', 'OUTGOING'].includes(direction)) debitMinor = amountMinor
      else directionIssue = 'The statement amount direction is missing or unrecognized.'
    }
    const raw = Object.fromEntries(row.headers.map((header, index) => [header, row.values[index]]))
    const account = context.bankAccounts.find((candidate) => candidate.accountNo === accountNo)
    const sourceReference = reference || `UNREFERENCED-${fingerprint({ fileName, accountNo, currency, occurredOn, narrative, debitMinor, creditMinor })}`
    const eventKey = `bank:${accountNo}:${sourceReference}`
    const referenceInNarrative = paymentReference(narrative)
    let classification: 'payment' | 'reversal' | 'failed' | 'settlement' | 'fee' | 'debit' | 'unclassified' = 'unclassified'
    let issue: string | null = directionIssue
    let amountMinor = directionIssue ? 0 : creditMinor - debitMinor
    const isSettlement = /\bmpesa\b.*\bsettlement\b/i.test(narrative)

    if (directionIssue) {
      issue = directionIssue
    } else if (debitMinor > 0 && creditMinor > 0) {
      amountMinor = 0
      issue = 'The statement row contains both a debit and a credit.'
    } else if (!reference) {
      issue = 'The statement row has no stable bank reference; held to avoid collapsing distinct transfers.'
    } else if (currency === 'XXX') {
      issue = 'The statement row has an invalid currency code.'
    } else if (!account || account.currency !== currency) {
      issue = 'The account or currency does not match the configured school bank accounts.'
    } else if (isSettlement && creditMinor > 0) {
      classification = 'settlement'
    } else if (creditMinor > 0) {
      if (referenceInNarrative) classification = 'payment'
      else issue = 'The credit has no recognizable admission or family reference; held for review.'
    } else if (debitMinor > 0 && /\bfee\b|\bcharge\b/i.test(narrative)) {
      classification = 'fee'
    } else if (debitMinor > 0) {
      classification = 'debit'
    } else {
      issue = 'The statement row has no debit or credit amount.'
    }

    const fingerprintNarrative = narrative.replace(/\s+/g, ' ').trim().toUpperCase()
    return makePaymentEventRecord(context, fileName, raw, {
      eventKey, source: 'bank', sourceReference, eventKind: 'bank_line', classification,
      amountMinor, currency, occurredAt: null, occurredOn,
      paymentReference: referenceInNarrative, relatedReference: null, issue,
    }, fingerprintNarrative)
  })
}
