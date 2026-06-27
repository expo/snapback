# Review Note: LLP 0004 Application Data API, Round 2

**Reviewed:** 2026-06-25
**Reviewer:** Codex
**Target:** `llp/0004-application-data-api.rfc.md`
**Status:** Author-maintenance audit, not an independent LLP 0005 review artifact.

## Scope

This pass was requested as `$llp-review 0004`, with special attention to Valet
diaries and API lessons from Convex and InstantDB. Because this Codex session
authored and revised the draft, it is not recorded under `llp/reviews/` as an
independent LLP 0005 review. The existing Claude review in
`llp/reviews/0004-application-data-api.claude.md` remains the formal recorded
cross-family review.

## Inputs Checked

- `~/projects/valet/diaries/0005-demo-contract-kanban.diary.md`
- `~/projects/valet/diaries/0007-demo-contract-klondike-codex.diary.md`
- `~/projects/valet/diaries/0008-demo-contract-pong.diary.md`
- Convex docs: schemas (`https://docs.convex.dev/database/schemas`), reading
  data/indexes (`https://docs.convex.dev/database/reading-data/`), writing
  data/transactions (`https://docs.convex.dev/database/writing-data`), best
  practices (`https://docs.convex.dev/understanding/best-practices/`), and
  Codex/AI setup (`https://docs.convex.dev/ai/using-codex`).
- InstantDB docs: recommended workflow (`https://www.instantdb.com/docs/workflow`),
  using LLMs (`https://www.instantdb.com/docs/using-llms`), modeling data
  (`https://www.instantdb.com/docs/modeling-data`), reading data
  (`https://www.instantdb.com/docs/instaql`), writing data
  (`https://www.instantdb.com/docs/instaml`), backend impersonation
  (`https://www.instantdb.com/docs/backend`), and platform/schema-permission
  workflow (`https://www.instantdb.com/docs/platform-api`).

## Findings

Valet shows the failure modes Snapback should design out early: schema codegen
that silently drops fields, copied bridge glue, auth context differences between
local optimistic execution and server replay, partial multi-row optimistic state,
and burst writes that exceed transport limits while leaving clients with pending
mutations.

Convex reinforces an index-first, generated-type, function-first shape. The most
relevant API lessons are explicit index usage for predictable query behavior,
single-transaction mutation functions, schema-backed end-to-end TypeScript
types, and lintable async/database rules.

InstantDB reinforces source-authored schema and permissions, typed
queries/transactions, agent-readable rules/MCP integration, scoped tokens,
permission-aware impersonation, and a sandbox that reports raw outputs,
permission checks, and performance timing.

For agents, the main conclusion is that the API should bias toward explicit
guarantees over clever flexibility: fail closed, expose generated manifests,
prefer structured query/transaction forms, provide a local sandbox/doctor, and
make local/server capability gaps inspectable before app code relies on them.

## Revisions Applied

- Added `Design Inputs And Bias` to LLP 0004.
- Required schema/codegen to fail closed on unsupported schema syntax rather than
  silently omitting fields.
- Added handler dependency/replay requirements.
- Added `withIndex`, index-first query guidance, and structured-filter
  language constraints.
- Required multi-row mutations to commit and publish as one changeset.
- Required generated runtime adapters instead of copied per-demo bridge glue.
- Added permission-aware debugging and a local sandbox/doctor requirement.
- Expanded agent feedback, implementation sketch, deferred work, and open
  questions around diagnostics, lints, indexes, handler replay, and changesets.
