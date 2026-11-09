import type { IAllocationEvidence } from '../models/allocation/IAllocationEvidence'
import type { IAllocationEvidenceStore } from '../models/allocation/IAllocationEvidenceStore'
import type { IAllocationInput } from '../models/allocation/IAllocationInput'
import { parseInstant, requireText } from '../utils/configurationValidation'
import type { ISchoolConfigurationReader } from '../models/configuration/ISchoolConfigurationReader'

/** Record an allocation with the policy version used to explain it later. */
export class AllocationEvidenceService {
  /**
   * The service used to select the applicable configuration version.
   */
  private readonly _configurations: ISchoolConfigurationReader

  /**
   * The storage service used for allocation evidence.
   */
  private readonly _store: IAllocationEvidenceStore

  /**
   * Create the service with configuration and evidence dependencies.
   * @param configurations - Service that selects an effective configuration.
   * @param store - Persistence for immutable allocation evidence.
   */
  constructor(configurations: ISchoolConfigurationReader, store: IAllocationEvidenceStore) {
    this._configurations = configurations
    this._store = store
  }

  /**
   * Record a caller-selected invoice allocation under its effective policy.
   * @param input - Payment, invoice, amount and allocation-time details.
   * @returns The stored allocation with its policy version.
   */
  record(input: IAllocationInput): IAllocationEvidence {
    for (const [name, value] of Object.entries({ id: input.id, schoolId: input.schoolId, paymentId: input.paymentId, invoiceId: input.invoiceId, source: input.source })) requireText(value, name)
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error('amountMinor must be a positive safe integer')
    const effectiveAtMs = parseInstant(input.effectiveAt)
    const policy = this._configurations.getVersionAt(input.schoolId, input.effectiveAt)
    return this._store.record(input, effectiveAtMs, policy.version)
  }

  /**
   * Retrieve previously recorded allocation evidence.
   * @param id - Allocation identifier.
   * @returns The allocation and its original policy version.
   */
  get(id: string): IAllocationEvidence {
    requireText(id, 'id')
    const result = this._store.get(id)
    if (!result) throw new Error(`Allocation ${id} not found`)
    return result
  }
}
