# Snapback 4: Run operations outside replica coverage on the server

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-12
Review finding: R14
Evidence: Online-only query reproduced; mutation eligibility path code traced
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

The README says a table without `sync` is online-only and queries run on the
server. The local client instead always invokes its local interpreter. An
unsynced table has no rows there, so a connected client produces an empty
incomplete answer instead of the available server answer.

Reproduction: seed one row in `online`, a table with no `sync`, and define a
query scanning it. `/q/remote` returns one row. The connected local client
returns `[]`, `complete: false`, `fresh: true`. Mutations that read such a row
can refuse locally before ever entering the outbox, even when the server
would accept them.

Implement an explicit eligibility/fallback decision for operations whose
required data is outside replica coverage. Online queries should use the
server as documented; offline state and non-predictable write admission must
remain honest. Cover mixed synced/unsynced reads and reads beyond a horizon.
A local missing row must not be treated as a conclusive server refusal merely
because the replica never acquired it. LLP 3000.003 explores the common policy.

## Implementation locations

- [packages/snapback4/src/local.ts](../../snapback4/packages/snapback4/src/local.ts)
- [packages/snapback4/src/replica/interpreter.ts](../../snapback4/packages/snapback4/src/replica/interpreter.ts)
- [packages/snapback4/README.md](../../snapback4/packages/snapback4/README.md)

## Resolution — 2026-09-13

Operation dependency/coverage checks route online-only reads to authority and admit ineligible writes without false predictions. Offline results use the existing typed refusal/unknown state, with durable retry after reconnect.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [packages/snapback4/test/client-lifecycle.test.mjs](../../snapback4/packages/snapback4/test/client-lifecycle.test.mjs)
