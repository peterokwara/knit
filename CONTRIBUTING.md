# Contributing

Keep changes focused and make the reasoning behind important decisions easy to follow. This repository is an assessment submission, so preserve the work as it happens.

## New tasks

Create a branch from `main` for a new task. Commit or set aside unrelated work before switching branches. Use the `feature/` prefix, the task number when one exists, and a short description.

For example, a task numbered `1` to protect school configuration could use `feature/1_Protect_Configuration`. Without a task number, use a descriptive name such as `feature/protect-configuration`.

```shell
git switch main
git switch -c feature/1_Protect_Configuration
```

## Bug fixes

Use the `fix/` prefix for a bug, followed by its task number when available and a short description. For example, `fix/2_Duplicate_Callback`.

```shell
git switch main
git switch -c fix/2_Duplicate_Callback
```

## Commits

- Commit meaningful steps with a short message describing the change.
- Keep the actual history; the assessment asks that commits are not squashed.
- When rejecting or rewriting a consequential AI suggestion, record what was wrong, how it was checked, and the commit containing the correction for `SOLUTION.md`.

## Checks

Run the relevant checks from the `app/` folder. The README documents setup, lint, build, and type-checking commands. Check that payment and configuration changes preserve the behavior required by the assessment, including replay safety and policy history.

## JSDoc comments

Document exported functions and classes with a `/** ... */` comment. Describe what the code does and any important conditions or side effects. ESLint checks the description and requires `@param` and `@returns` descriptions where applicable. Keep types in TypeScript rather than repeating them in the comment.

```ts
/**
 * Format a family identifier for display.
 * @param familyId - The family identifier to display.
 * @returns A label containing the identifier.
 */
export function formatFamilyLabel(familyId: string): string {
  return `Family ${familyId}`
}
```

The generated `src/routeTree.gen.ts` file is excluded from linting. Local, unexported helpers do not need a JSDoc comment just to satisfy this rule; add one when it helps explain a non-obvious decision. Run `npm run lint` from `app/` before committing.

## Creating a pull request

When a task is ready for review:

1. Commit the changes on the task branch.
2. Bring the branch up to date with `main` and resolve any conflicts.
3. Run the relevant checks and describe the changes and results in the pull request.
4. Request review when a reviewer is available. Address feedback in additional commits.

Keep the commit history as it happened when merging; do not squash it. For a local-only assessment, a branch and its commits can be reviewed without opening a pull request.

## Assessment material

Treat the supplied fixtures and brief as assessment material. Keep original evidence available when working on ingestion, and document assumptions or unresolved decisions in `SOLUTION.md`.
