# Review of PR #142

**Decision: request changes.** The workflow is useful, but the migration and payment resolution can overwrite school settings or apply money to the wrong account. Please address the blocking comments before merging.

## Comments

1. **Blocking — `apps/api/migrations/0042_ensure_school_config.sql:14`**: `ON CONFLICT ... DO UPDATE` replaces every existing school's configuration with the hard-coded defaults, even though the migration intends to fill missing rows. That can change allocation priorities, accepted currencies, and grace periods across schools. Please insert only missing rows, preserve existing JSON, and add a migration test with two different existing configurations and a missing row.

2. **Blocking — `apps/api/src/ingest/mpesa.ts:21` and `apps/api/src/lib/matchAccountRef.ts:23`**: an edit distance of two does not establish ownership. Similar admission numbers can identify different learners, and ties select whichever number appears first. This can silently credit the wrong family. Please keep the original reference and hold non-exact or ambiguous matches for a bursar; suggestions can be shown as unconfirmed evidence.

3. **Blocking — `apps/api/src/routes/suspense.ts:23`**: the lookup uses only the item ID, although `req.schoolId` is the authenticated school. A bursar who knows another school's ID could act on that item. The supplied `familyId` is also not checked against the item's school. Scope the lookup and update to `req.schoolId`, and verify the selected family belongs to that same school before allocation.

4. **Blocking — `apps/api/src/routes/suspense.ts:27`**: allocation and the status update are separate operations, with no check for an existing resolution or lock. A double-click, concurrent request, or retry after allocation succeeds but the update fails can call `allocatePayment` twice. The supplied allocator explicitly says it is not idempotent. Please use a durable unique payment identity and an atomic transaction that records the decision, allocation, and resolution state; identical retries should return the saved result and conflicting retries should fail.

5. **Blocking — `apps/api/src/routes/suspense.ts:21`**: the caller supplies `amount`, which is converted from a floating-point major-unit number and passed to the allocator without checking against `item.amount_minor`. A client can change the amount, and the code ignores whether the item's currency is compatible with the school's invoices. Use the stored integer amount and currency as the source of truth; hold unsupported currency until a documented conversion is available.

6. **Should fix — `apps/api/src/routes/suspense.test.ts:35`**: this test only checks the second HTTP status. The mocked allocator accepts every call, so the test passes even if the payment is allocated twice. Please assert the saved ledger and decision after sequential and concurrent retries, and simulate a failure between allocation and status update. Also cover cross-school IDs and altered amounts.

7. **Should fix — `apps/web/src/features/family/FamilyBalance.tsx:12`**: removing cancellation and state resets lets an earlier family request finish after a later one and overwrite the current screen. An old error also remains after a successful subsequent request. A bursar could see the wrong family's balance while deciding where to put money. Restore cancellation or guard responses by request identity, clear stale state, and test a slow first response followed by a fast second response.

8. **Should fix — `apps/web/src/features/suspense/SuspenseQueue.tsx:10`**: a failed queue request has no error state and an empty list renders nothing, making a failure look like there are no items to review. Allocation failures are also unhandled, and the button remains active during a request. Show loading and failure states, disable the relevant action while it is in flight, and refresh from the server after a successful decision.

9. **Should fix — `apps/api/src/routes/suspense.ts:36`**: the status records an actor and timestamp but no evidence or reason for choosing the family. A parent dispute needs the original reference, chosen family, actor, time, and the reason for the decision together with the resulting allocation. Please capture the reason and preserve the decision as durable audit evidence.

## Most important lesson

Trace a payment through retries, failures, school boundaries, and changing configuration before trusting a green happy-path test. A payment decision must preserve both the money and the evidence needed to explain who changed what and why.
