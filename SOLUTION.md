# Solution

## Design and trade-offs

The exercise uses TanStack Start, TypeScript in strict mode, and SQLite. TanStack Start supplies the React screen and server routes in one project. SQLite provides transactions, constraints, and triggers without a separate database server. The fixture loader is the provider boundary; no live provider or authentication integration is included.

Provider records and raw observations are retained separately from family matching. Stable provider transaction identities deduplicate retries and overlapping exports. The matcher accepts only an exact family or admission reference, ignoring case and surrounding whitespace; uncertain references remain for a bursar decision. Money is stored in integer minor units. Allocations retain the source, invoice, effective time, and configuration version. Existing school configurations and allocation plans are append-only; SQLite guards and tests reject ordinary attempts to reset configuration to defaults.

The configuration safety demonstration is in `app/test/schoolConfiguration.test.ts`: it attempts direct updates, deletes, replacement inserts, and an upsert using the supplied platform defaults for both schools, then verifies that their configurations remain unchanged. The guards also check for missing or altered protection triggers at startup. They do not protect against someone with unrestricted control of the SQLite file or schema.

Allocation uses the trusted server time at which a plan is made, not the time printed by the provider. CR-118 applies at noon Nairobi time on 3 November. A replay returns the original plan and policy version. This makes the boundary explicit, but it means a late-arriving payment can receive the policy current when it is allocated rather than the policy current when a parent sent it.

The bursar screen supports family search, invoice evidence, a separate review queue, and an audited resolution. A preview uses the allocation calculation and checks for changed policy or invoice amounts before confirmation. The actor is a labelled demo identity because authentication is outside the exercise.

When a reversal arrives after allocation, the balance reader derives corrected family allocations from the retained events and immutable plans. It processes plans by original allocation time and payment ID, using each plan's saved policy version. The screen identifies changed lines and the reversal references. The original plan is not overwritten. This is an on-demand projection, not a separately persisted correction journal; it does not provide a full point-in-time history of corrections or an updated credit ledger.

## Fixture decisions

- `SKD3XH1A01` is repeated with different non-financial callback fields. Record both observations and one payment; conflicting financial variants are held.
- `SKD3XR9Z07` reverses `SKD3XH2B02` and can arrive first. Preserve and link both. A late reversal triggers a labelled correction of affected invoice allocations; tests cover full and partial reversals, an intervening payment, retries, and the CR-118 boundary.
- The failed STK result has no successful receipt and is not treated as money received.
- `SKD3XL6E05` and `SKD3XL6F06` share an amount and admission reference but have distinct transaction IDs; they are separate payments. The policy governs any remainder.
- `ADM-1O47` is not silently changed to `ADM-1047`; a bursar must check evidence and choose a family.
- The two bank exports overlap on `FT26307QWE45` and format numbers differently. Normalize amounts and preserve both observations of the single bank transaction.
- Bank charges and the M-Pesa settlement are not counted as additional parent payments.
- `SWIFT-INW-88213` is USD while invoices are KES and no FX rate is supplied. Hold it; do not invent a rate.
- `FAM-202` has siblings and multiple invoices. Match the family first and apply its school's category order across the family's invoices.
- Mlima, Pwani, and platform defaults differ. Keep school-owned versions in the datastore; never replace them with defaults during a routine update.

## Deliberately left out and next steps

There is no live provider adapter, authentication, deployment pipeline, or general multi-school interface. The screen uses fixture family and invoice data. The most important next work is a durable correction and credit ledger with point-in-time reads, transaction and concurrency tests, and broader reversal scenarios. The full balance pipeline now has a test for reversed fixture rows, bank file order, and three replays, in addition to the incremental reversal tests. New-school default application is not implemented.

At 40 schools, the first likely operational pressure is reconciliation throughput and isolation: SQLite serializes writes, and this prototype reads and processes all events for a school. Provider backlogs, repeated full scans, and school-specific failures could delay other work. Measure backlog age and reconciliation latency; consider a transactional server database, indexed incremental processing, and per-school work queues while keeping idempotency and configuration protections.

## AI use

1. The AI proposed injected SQLite connection interfaces. I asked to organize the backend around models, services, and utilities and preferred a concrete SQLite helper. This was a readability and substitution trade-off, not proof that an interface was incorrect. Commits `63a7cca0` and `f03dd339` contain the changes; configuration tests exercise the resulting helper and protections.
2. File retrieval was embedded in the fixture-loading script. I asked to separate obtaining files from adapting provider formats, so each responsibility can change independently. Commit `7017127c` adds the retrieval service and a test that retrieves files before importing and reading events.
3. During review of the AI-assisted reconciliation, we identified that events arriving out of order could leave a fully reversed KES 70,000 payment on invoices. A regression test reproduced it. Commit `237de749` changes the balance calculation; tests cover late reversals, an intervening payment, and the original policy versions.

I leaned on AI for TypeScript and React implementation, including TanStack Start routes and shadcn/ui composition. I checked the result against the brief and fixtures, TypeScript's strict typechecker, lint, the test suite, a production build, and the running bursar screen.
