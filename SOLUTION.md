# Solution notes (draft)

## Design and trade-offs

The exercise uses TanStack Start, TypeScript in strict mode, and SQLite. TanStack Start supplies the React screen and server routes in one project. SQLite provides transactions, constraints, and triggers without a separate database server. The fixture loader is the provider boundary; no live provider or authentication integration is included.

Provider records and raw observations are retained separately from family matching. Stable provider transaction identities deduplicate retries and overlapping exports. The matcher accepts only an exact family or admission reference, ignoring case and surrounding whitespace; uncertain references remain for a bursar decision. Money is stored in integer minor units. Allocations retain the source, invoice, effective time, and configuration version. Existing school configurations and allocation plans are append-only; SQLite guards and tests reject ordinary attempts to reset configuration to defaults.

Allocation uses the trusted server time at which a plan is made, not the time printed by the provider. CR-118 applies at noon Nairobi time on 3 November. A replay returns the original plan and policy version. This makes the boundary explicit, but it means a late-arriving payment can receive the policy current when it is allocated rather than the policy current when a parent sent it.

The bursar screen supports family search, invoice evidence, a separate review queue, and an audited resolution. A preview uses the allocation calculation and checks for changed policy or invoice amounts before confirmation. The actor is a labelled demo identity because authentication is outside the exercise.

## Fixture decisions

- `SKD3XH1A01` is repeated with different non-financial callback fields. Record both observations and one payment; conflicting financial variants are held.
- `SKD3XR9Z07` reverses `SKD3XH2B02` and can arrive first. Preserve and link both. **Open issue:** a late reversal after another payment has already been allocated can require explicit reallocation to restore policy priority. The regression test currently exposes this; the submission should not claim order-independent invoice balances until it passes.
- The failed STK result has no successful receipt and is not treated as money received.
- `SKD3XL6E05` and `SKD3XL6F06` share an amount and admission reference but have distinct transaction IDs; they are separate payments. The policy governs any remainder.
- `ADM-1O47` is not silently changed to `ADM-1047`; a bursar must check evidence and choose a family.
- The two bank exports overlap on `FT26307QWE45` and format numbers differently. Normalize amounts and preserve both observations of the single bank transaction.
- Bank charges and the M-Pesa settlement are not counted as additional parent payments.
- `SWIFT-INW-88213` is USD while invoices are KES and no FX rate is supplied. Hold it; do not invent a rate.
- `FAM-202` has siblings and multiple invoices. Match the family first and apply its school's category order across the family's invoices.
- Mlima, Pwani, and platform defaults differ. Keep school-owned versions in the datastore; never replace them with defaults during a routine update.

## Deliberately left out and next steps

There is no live provider adapter, authentication, deployment pipeline, or general multi-school interface. The screen uses fixture family and invoice data. The most important next work is a durable, explicit reversal and reallocation ledger, with tests for interleaved payments, partial reversals, retries, and policy boundaries. Also test the complete balance pipeline against shuffled rows and file order, rather than relying on ingestion-only shuffle tests. New-school default application is not implemented.

At 40 schools, the first likely operational pressure is reconciliation throughput and isolation: SQLite serializes writes, and this prototype reads and processes all events for a school. Provider backlogs, repeated full scans, and school-specific failures could delay other work. Measure backlog age and reconciliation latency; consider a transactional server database, indexed incremental processing, and per-school work queues while keeping idempotency and configuration protections.

## AI use — confirm before submission

The conversation and history provide these candidate rewrites; Peter should confirm the personal account before submission:

1. A proposed database abstraction wrapped SQLite in injected connection interfaces. We compared the style and trade-offs, then chose the concrete SQLite helper; `f03dd339` contains the rewrite. The configuration and payment tests checked the resulting behavior.
2. Retrieval and source adaptation had been coupled. We separated file retrieval from provider-format conversion for distinct responsibilities; `7017127c` adds the retrieval service and a public ingestion test.
3. Family balance evidence needed a stronger ownership check. `b00a6f7d` rejects invoice evidence attached to another family's plan and adds a regression test. Confirm whether this is a consequential AI review/rewrite to include, or replace it with another example from the work.

AI assisted with TypeScript, React, TanStack Start, SQLite, shadcn/ui, test design, and review. We checked generated code against the brief and fixtures, used typechecking, lint, tests, build, and inspected the running screen. This draft should be updated with Peter's specific lookups, what he accepted or rejected, and how he checked them; do not present those details as confirmed until he has reviewed them.
