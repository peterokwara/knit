# Knit Technical Assessment

This repository contains work for the Knit senior/lead engineer technical assessment: a small payment-reconciliation service and a bursar screen for school fees.

## Status

The app stores protected school configuration versions, ingests the supplied M-Pesa callbacks and bank exports, derives exact family matches, allocates confirmed payments under the effective school policy, and reports evidence-backed invoice balances. Allocation plans preserve invoice lines, remainder treatment, and the policy version effective at the trusted allocation time. The single-screen bursar workspace supports family search, invoice and payment evidence, held-payment review, exact allocation previews, and durable audited resolution.

## Run the project locally

1. Install [Node.js](https://nodejs.org/) 22.13 or newer and [pnpm](https://pnpm.io/installation) 11.20.0. Open a terminal in this project's root folder and check the versions:

   ```shell
   node --version
   pnpm --version
   ```

2. Enter the application folder and install the exact dependency versions in the lockfile:

   ```shell
   cd app
   pnpm install --frozen-lockfile
   ```

3. Create the local SQLite database file:

   ```shell
   pnpm db:init
   ```

   You should see the SQLite version and `data/knit.sqlite` (inside `app/`). This step creates the protected schema but does not import the fixtures. Node 22 may print an experimental SQLite warning. No separate SQLite server is needed.

   To load both schools and the approved CR-118 policy change, run:

   ```shell
   pnpm config:load
   ```

   Running this command again checks the existing versions against the fixtures; it does not overwrite them.

   To import M-Pesa and bank payment events, run:

   ```shell
   pnpm payments:load
   ```

   This command is safe to rerun. It preserves provider evidence, reports exact family matches and held cases, allocates eligible payments under the current effective school policy, and prints every family's invoice balances with payment and policy evidence. Existing allocation plans retain their original policy version when the command runs again.

4. Start the application:

   ```shell
   pnpm dev
   ```

5. Open the address printed in the terminal, normally [http://localhost:3000](http://localhost:3000). Choose a family to inspect its invoice balances and payment trail. Review unknown or ambiguous references in the payment queue; unsupported currencies and conflicting records appear in the blocked follow-up section without an assignment action. Open [http://localhost:3000/api/health](http://localhost:3000/api/health) to check the server can open SQLite; it should return `{"status":"ok"}`.

Leave the terminal open while using the application. Press **Ctrl+C** in that terminal to stop it. If port 3000 is occupied, use the address printed by Vite instead.

## Check the project

From the `app/` folder, run:

```shell
pnpm lint
pnpm format:check
pnpm build
pnpm typecheck
pnpm test
```

The lint command checks code and JSDoc comments. The build generates the TanStack route tree. TypeScript's `strict` setting is enabled in `app/tsconfig.json`. See [CONTRIBUTING.md](./CONTRIBUTING.md#jsdoc-comments) for the documentation convention.

## Project folders

- `app/src/routes/` contains the bursar screen and server routes.
- `app/src/components/ui/` contains the shadcn/ui controls used by the screen.
- `app/src/server/models/` defines configuration, allocation-evidence, and ingestion data contracts.
- `app/src/server/services/` contains configuration, payment-file retrieval, payment ingestion, family matching, allocation, balances, and resolution services.
- `app/src/server/utils/` contains the SQLite helper, schema guards, and provider adapters.
- `app/scripts/` contains local setup commands.
- `app/test/` contains configuration safety and payment-ingestion checks.
- `app/data/` holds the local database, which Git ignores.
- `fixtures/` holds the assessment's example data.
- `docs/NOTES.md` holds problem-solving notes; `docs/visuals/` holds diagrams and their drawing source.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the working and commit conventions used in this repository.

## Project material

- [Problem-solving notes](./docs/NOTES.md) cover stakeholders, risks, fixture observations, and proposed priorities.
- [Visuals](./docs/visuals/) contain the problem-framing diagrams and their drawing source.
- [Configuration design](./docs/configuration.md) explains the policy history and its limits.
- [Payment ingestion](./docs/payment-ingestion.md) explains replay safety, event evidence, and current limits.
- `fixtures/` contains the assessment's example data.

## License

Original work in this repository is available under the [MIT License](./LICENSE). The assessment brief and fixtures are supplied by Knit and are not covered by this grant.
