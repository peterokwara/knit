# Knit Technical Assessment

This repository contains work for the Knit senior/lead engineer technical assessment: a small payment-reconciliation service and a bursar screen for school fees.

## Status

The TanStack Start and SQLite skeleton runs locally. It does not yet import payments, calculate balances, or provide the bursar's finished screen.

## Run the project locally

1. Install [Node.js](https://nodejs.org/) 22.13 or newer. npm is included with Node.js. Open a terminal in this project's root folder and check the versions:

   ```shell
   node --version
   npm --version
   ```

2. Install the exact dependency versions in the lockfile:

   ```shell
   npm ci
   ```

3. Create the local SQLite database file:

   ```shell
   npm run db:init
   ```

   You should see the SQLite version and `data/knit.sqlite`. This step creates an empty database; it does not import the fixtures. Node 22 may print an experimental SQLite warning. No separate SQLite server is needed.

4. Start the application:

   ```shell
   npm run dev
   ```

5. Open the address printed in the terminal, normally [http://localhost:3000](http://localhost:3000). You should see the School fees placeholder. Open [http://localhost:3000/api/health](http://localhost:3000/api/health) to check the server can open SQLite; it should return `{"status":"ok"}`.

Leave the terminal open while using the application. Press **Ctrl+C** in that terminal to stop it. If port 3000 is occupied, use the address printed by Vite instead.

## Check the project

```shell
npm run build
npm run typecheck
```

The build generates the TanStack route tree. TypeScript's `strict` setting is enabled in `tsconfig.json`.

## Project folders

- `src/routes/` contains the React pages and server routes.
- `src/server/db/` contains the server-only SQLite connection.
- `scripts/` contains local setup commands.
- `data/` holds the local database, which Git ignores.
- `fixtures/` holds the assessment's example data when available locally.
- `visuals/` holds problem-framing diagrams and their drawing source.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the working and commit conventions used in this repository.

## Project material

- [Problem-solving notes](./NOTES.md) cover stakeholders, risks, fixture observations, and proposed priorities.
- [Visuals](./visuals/) contain the problem-framing diagrams and their drawing source.
- `fixtures/` contains the assessment's example data when available locally.

## License

Original work in this repository is available under the [MIT License](./LICENSE). The assessment brief and fixtures are supplied by Knit and are not covered by this grant.
