import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import type { AllocationEvidence, AllocationInput, IAllocationEvidenceStore } from '../models/allocationEvidence'
import { readInteger, readText } from '../utils/sqliteValues'

function toEvidence(row: Record<string, SQLOutputValue>): AllocationEvidence {
  return {
    id: readText(row, 'id'), schoolId: readText(row, 'school_id'),
    paymentId: readText(row, 'payment_id'), invoiceId: readText(row, 'invoice_id'),
    source: readText(row, 'source'), amountMinor: readInteger(row, 'amount_minor'),
    effectiveAt: new Date(readInteger(row, 'effective_at_ms')).toISOString(),
    policyVersion: readInteger(row, 'policy_version'),
  }
}

/** Persist immutable allocation evidence in SQLite. */
export class SqliteAllocationEvidenceService implements IAllocationEvidenceStore {
  /**
   * Create the storage service around an initialized connection.
   * @param database - SQLite connection with configuration schema installed.
   */
  constructor(private readonly database: DatabaseSync) {}

  /**
   * Store a caller-selected allocation with its effective policy version.
   * @param input - Allocation details.
   * @param effectiveAtMs - Allocation time in milliseconds.
   * @param policyVersion - Policy version selected by the configuration service.
   * @returns The stored evidence.
   */
  record(input: AllocationInput, effectiveAtMs: number, policyVersion: number): AllocationEvidence {
    this.database.prepare(`INSERT INTO allocation_evidence
      (id, school_id, payment_id, invoice_id, source, amount_minor, effective_at_ms, policy_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.id, input.schoolId, input.paymentId, input.invoiceId, input.source, input.amountMinor, effectiveAtMs, policyVersion)
    const stored = this.get(input.id)
    if (!stored) throw new Error('Allocation evidence was not stored')
    return stored
  }

  /**
   * Retrieve allocation evidence by its identifier.
   * @param id - Allocation identifier.
   * @returns The stored evidence, or undefined if absent.
   */
  get(id: string): AllocationEvidence | undefined {
    const row = this.database.prepare('SELECT * FROM allocation_evidence WHERE id = ?').get(id)
    return row ? toEvidence(row) : undefined
  }
}
