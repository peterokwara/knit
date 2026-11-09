# School configuration

The configuration service uses documented `I`-prefixed model interfaces, services for behavior, and utilities for SQLite schema and validation. `SqliteHelper` is the concrete database helper: it opens and initializes SQLite connections, runs common queries and writes, wraps transactions, and closes connections. The SQLite-backed services use the concrete `DatabaseSync` connection, while the higher-level configuration service still depends on its `ISchoolConfigurationStore` model contract. The fixture-loading script composes the services. Configuration fields such as `category_priority` retain the supplied fixture's spelling because the complete configuration is stored unchanged.

## Protection and history

- School settings are stored as full, immutable versions. The initial version is inserted only once per school; updates, deletes, replacement inserts, and reset-style upserts are rejected by SQLite triggers.
- A later version requires an explicit change record with a requester, approver, reason, expected prior version, effective time, and category-priority patch. SQLite checks that the new version matches that patch and leaves the rest of the settings unchanged. The service writes the approval and new version in one transaction.
- The SQLite connection verifies the expected tables and protection triggers at startup. A missing or altered guard causes startup to fail. A schema marker also prevents a previously initialized database with dropped tables from silently appearing new.
- `PaymentAllocationService` selects the effective policy using a trusted allocation time, then saves one immutable payment plan with its invoice evidence, remainder treatment, and policy version. SQLite writes the plan and its invoice lines in one transaction, checks that the policy was effective at that time, and rejects later updates or deletion. Exactly at noon Nairobi time on 3 November, CR-118's new version applies. A retry reads the saved plan before looking up current configuration, so it cannot silently reallocate the payment under a later version.
- A change that would take effect at or before an already-recorded allocation is rejected. It needs a separate, explicit correction process rather than silently changing that history.

## Decisions and limits

`PaymentAllocationService` accepts a normalized payment, its exact family match, that family's invoices, and a trusted allocation time. It orders invoices by configured category priority and tie-break rules. It leaves unmatched payments for review and records overpayments as school-configured credit or refund holds. `FamilyInvoiceBalanceService` reads the supplied family invoices with persisted allocation evidence and reports paid and outstanding minor-unit amounts. `PaymentReconciliationService` connects fixture ingestion through balance reads; it passes the trusted allocation time explicitly rather than substituting a delayed provider timestamp.

The SQLite protections defend against ordinary data writes and detect schema drift on opening the database. Someone with direct control over the database file or schema can remove and restore guards or alter both data and evidence. SQLite does not provide user-level authorization here. Requester and approver fields record fixture metadata; they do not authenticate a person. The application boundary must supply the authenticated bursar's ID to `PaymentReviewResolutionService`; the service records that ID but does not authenticate it. Future schema migrations require an explicit, reviewed migration approach rather than changing the expected schema in place.

## Try it

From `app/`, run `pnpm db:init`, then `pnpm config:load` to load both school configurations and CR-118 from the repository fixtures. The loader checks existing versions rather than replacing them. Run `pnpm test` to exercise reset attempts, schema drift, approval validation, persistence, and the policy change boundary. Tests use temporary or in-memory databases; they do not change the local application database.
