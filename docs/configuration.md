# School configuration

Configuration work uses interfaces to describe data and storage needs, services own behavior, and utilities handle SQLite schema and validation. Domain services receive storage dependencies rather than opening database connections. The fixture-loading script composes the services.

## Protection and history

- School settings are stored as full, immutable versions. The initial version is inserted only once per school; updates, deletes, replacement inserts, and reset-style upserts are rejected by SQLite triggers.
- A later version requires an explicit change record with a requester, approver, reason, expected prior version, effective time, and category-priority patch. SQLite checks that the new version matches that patch and leaves the rest of the settings unchanged. The service writes the approval and new version in one transaction.
- The SQLite connection verifies the expected tables and protection triggers at startup. A missing or altered guard causes startup to fail. A schema marker also prevents a previously initialized database with dropped tables from silently appearing new.
- Each allocation-evidence record stores the school and policy version alongside the caller-selected payment, invoice, source, amount, and allocation time. The database checks the version was effective at that time, and rejects later updates or deletion. Exactly at noon Nairobi time on 3 November, CR-118's new version applies.
- A change that would take effect at or before an already-recorded allocation is rejected. It needs a separate, explicit correction process rather than silently changing that history.

## Decisions and limits

`AllocationEvidenceService` records an allocation chosen by its caller; it does not match payments, decide invoice order, validate invoice ownership, or calculate balances. Those are later tasks. The caller must supply the actual allocation time from trusted server code. A delayed event's provider transaction time must not be silently substituted for the allocation time.

The SQLite protections defend against ordinary data writes and detect schema drift on opening the database. Someone with direct control over the database file or schema can remove and restore guards or alter both data and evidence. SQLite does not provide user-level authorization here. Requester and approver fields record fixture metadata; they do not authenticate a person. Future schema migrations require an explicit, reviewed migration approach rather than changing the expected schema in place.

## Try it

From `app/`, run `pnpm db:init`, then `pnpm config:load` to load both school configurations and CR-118 from the repository fixtures. The loader checks existing versions rather than replacing them. Run `pnpm test` to exercise reset attempts, schema drift, approval validation, persistence, and the policy change boundary. Tests use temporary or in-memory databases; they do not change the local application database.
