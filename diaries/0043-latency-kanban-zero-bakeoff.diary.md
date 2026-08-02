# Diary 0043: Latency Kanban — Snapback × Zero

**Date:** 2026-08-01  
**Protocol:** LLP 0138 / `latency-kanban.v1.json` (8 checks; 4 columns,
500 cards, 1,000 ms authority latency)  
**Arms:** Snapback source-local Ibex/SQLite; Zero 1.8.0
`zero-cache-dev` / PostgreSQL 17.10  
**Machine:** frozen program machine, Apple M5 Max, Node 25.9.0, Bun 1.3.12  
**Assistance:** no product credentials or human intervention; the program's
shared dependency install and PostgreSQL process were reused, while this app
owned its Zero database, app id, cache process tree, replica, and API.

## Contract and first-attempt freeze

The frozen question was not merely whether a card appeared to move. It was
whether a prediction painted inside one frame, twenty overlapping intents did
not lose data, a server-locked card rolled back only its own layer, pending
settlement survived a view reload without being called authority, concurrent
moves converged, and an independent observer saw the canonical result.

The first implementation was frozen before comparative results. Snapback used
generated live-query/mutation references, a 500-row deterministic setup
mutation, the first-party React optimistic hook, and explicit `revision`
checks. Zero used its schema builder, ZQL query registry, shared `defineMutator`
client/server implementation, `zeroPostgresJS`, a PostgreSQL compare-and-set,
and first-party `Zero` materialized queries. The 1,000 ms delay lived immediately
before each provider's authoritative mutation call; prediction itself was not
delayed.

## Snapback chronology

The guide path was direct: `guide/index.md`, backend mutations and queries,
live queries, React, offline/retention, and acceptance. Schema and function
generation caught two forbidden dynamic array-index expressions in the inline
fixture handler before runtime; replacing those expressions with closed
branches made the handler admissible.

The React surface's optimistic update and `isAuthoritative` matcher were short
and strongly typed. Rejection arrived as `SNAPBACK_HANDLER_FAILED`; the
underlying `CARD_LOCKED` text is intentionally not a stable public diagnostic,
so the UI must retain enough local context to say “card is locked.” Revision
conflicts gave one committed revision and one refusal. The independent
observer used `live_replace` over the real WebSocket transport.

Authored source/touch count, excluding generated artifacts and locks: 5 files,
355 lines (24 schema, 91 functions, 35 React, 201 acceptance, 4 seed). The
retained final receipt is `apps/latency-kanban/evidence/snapback.v1.json`:
8 pass, 0 GAP, 0 fail. Representative measured samples were 0.009 ms
input-to-projection, 1,014.5 ms acknowledgement, and 1,029.8 ms independent
observer convergence. These are headless projection timings, not browser
compositor traces. The receipt records binary commit
`15a4e35001611a4a73161efc63e527d71b5519f7`, `gitDirty:true`, and the honest
`unpinned-binary` identity verdict for this dirty source-tree run.

## Zero chronology

The authoring model made the optimistic operation unusually legible: the same
named mutator patched the local row immediately and used an authority-only
PostgreSQL `UPDATE ... WHERE revision = expected AND locked = 0` branch on the
server. `query`, `mutate`, schema mapping, and React remained visibly Zero;
there is no neutral backend wrapper.

Two setup failures were operational, not product findings. First,
`zero-cache-dev` spawned `zero-cache` through the shell and required the
package `.bin` directory in `PATH`. Second, app-local Bun installation had
blocked Zero SQLite's native postinstall, while the shared, qualified install
already contained the binary; running the absolute shared `zero-cache-dev`
with its `.bin` first fixed that without fabricating evidence. Unique
`ZERO_APP_ID`s were then required because replication-slot names are
cluster-global even when application databases differ.

The largest API surprise was substantive: `mutation.server` resolves to a
closed `{type:'error', error:{type:'app', ...}}` value for `CARD_LOCKED` and
`CARD_REVISION_CONFLICT`; it does not reject the promise. The first harness
incorrectly counted fulfilled promises and reported two failures even though
Zero logged both application errors and canonical state rebased correctly.
The corrected witness asserts the returned result union and the actual
rollback/convergence.

Authored source/touch count: 6 files, 413 lines (33 schema, 9 queries,
34 mutators, 42 API, 24 React, 271 acceptance). The retained final receipt is
`apps/latency-kanban/evidence/zero.v1.json`: 8 pass, 0 GAP, 0 fail.
Representative measured samples were 2.43 ms local mutation, 1,030.1 ms server
result, and 1,035.8 ms independent-observer convergence.

## Immutable first-pass comparison

Zero won this app's core authoring experience. Its shared mutator made the
prediction visibly the same operation as the server policy, and its local
query store made the predicted row observable without writing a separate
projection reducer. Snapback's hook was safe and well typed, but duplicated
the move transformation in `update` and required a separate matcher to know
when live authority had caught up.

Snapback was better at distinguishing the server call from live authority in
the public React contract, and its structured conflict boundary was easier to
reason about in the backend. Zero's result union is useful once known, but the
fulfilled promise plus loud internal “ApplicationError” logs was initially
counterintuitive.

Observable behavior was effectively tied under this fixture: both painted in
one frame at the projection layer, retained exactly 500 unique cards through
twenty moves, corrected the locked prediction, committed exactly one
concurrent revision, and converged an independent observer near the injected
one-second boundary. The numeric differences are not browser benchmarks.

Reload was weaker than the full product question in both witnesses. The test
destroyed/recreated a view while the original mutation owner remained alive.
It proved no loss and no false authority, but not durable reconstruction of a
pending in-flight optimistic layer. Zero deliberately used `kvStore:'mem'`;
Snapback's Online React hook likewise did not claim pending-layer persistence.

## Findings

- **DX / design:** Zero's shared client/server mutator removes optimistic
  reducer duplication. Witness: `lk.one-frame-local-paint` and source layout.
- **DX:** Snapback locked-card refusal collapses the application reason into
  `SNAPBACK_HANDLER_FAILED`; actionable UI copy must be preserved by the app.
  Witness: `lk.locked-card-correction`.
- **DX:** Zero mutation errors are result values, not rejected `.server`
  promises. The docs/type union are coherent, but this is easy to misuse.
  Witness: `lk.locked-card-correction` and `lk.concurrent-move-convergence`.
- **Operations:** Zero's local stack required PostgreSQL, API, cache, native
  SQLite, app-id/slot isolation, and owned process-tree/slot cleanup. Snapback's
  real server was materially simpler to provision.
- **Capability boundary:** neither arm proved durable pending optimistic-layer
  restoration in this app. Witness: `lk.pending-reload` nonclaim.
- **Guide gap:** the Snapback guide explained optimistic rollback and rebase,
  but did not give a create/move bakeoff recipe that preserves a specific
  application rejection reason for UI copy.

## Dated remediation appendices

### 2026-08-01 — harness and runtime corrections

The first Snapback runner mistakenly read rows from subscription registration
rather than the query snapshot and nulled a stream before a registered cleanup
closed it. The first Zero runner omitted `.bin` from the child shell `PATH`,
then read fulfilled promises as successful mutations. These were harness
defects. They were corrected without changing the frozen checks or first-pass
verdict. Final reruns are zero-skip and retain machine-readable receipts; Zero
cleanup now owns the full cache process group and checks that its database and
replication slot are absent.
