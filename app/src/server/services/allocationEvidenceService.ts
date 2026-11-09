import type { AllocationEvidence, AllocationInput, IAllocationEvidenceStore } from '../models/allocationEvidence'
import { parseInstant, requireText } from '../utils/configurationValidation'
import type { ISchoolConfigurationReader } from '../models/schoolConfiguration'

/** Record an allocation with the policy version used to explain it later. */
export class AllocationEvidenceService {
  /**
   * Create the service with configuration and evidence dependencies.
   * @param configurations - Service that selects an effective configuration.
   * @param store - Persistence for immutable allocation evidence.
   */
  constructor(private readonly configurations: ISchoolConfigurationReader, private readonly store: IAllocationEvidenceStore) {}

  /**
   * Record a caller-selected invoice allocation under its effective policy.
   * @param input - Payment, invoice, amount and allocation-time details.
   * @returns The stored allocation with its policy version.
   */
  record(input: AllocationInput): AllocationEvidence {
    for (const [name, value] of Object.entries({ id: input.id, schoolId: input.schoolId, paymentId: input.paymentId, invoiceId: input.invoiceId, source: input.source })) requireText(value, name)
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error('amountMinor must be a positive safe integer')
    const effectiveAtMs = parseInstant(input.effectiveAt)
    const policy = this.configurations.getVersionAt(input.schoolId, input.effectiveAt)
    return this.store.record(input, effectiveAtMs, policy.version)
  }

  /**
   * Retrieve previously recorded allocation evidence.
   * @param id - Allocation identifier.
   * @returns The allocation and its original policy version.
   */
  get(id: string): AllocationEvidence {
    requireText(id, 'id')
    const result = this.store.get(id)
    if (!result) throw new Error(`Allocation ${id} not found`)
    return result
  }
}
