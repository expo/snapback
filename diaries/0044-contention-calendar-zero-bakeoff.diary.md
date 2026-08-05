# Diary 0044: Contention Calendar — Snapback × Zero

**Date:** 2026-08-01  
**Protocol:** LLP 0138 / `contention-calendar.v1.json` (7 checks; 20 resources,
2 contenders)  
**Arms:** Snapback source-local Ibex/SQLite; Zero 1.8.0
`zero-cache-dev` / PostgreSQL 17.10  
**Assistance:** no credentials or human intervention; shared PostgreSQL and
installed packages only. Each arm owned all app-specific processes and state.

## Contract and first-attempt freeze

Two clients predicted the last unit of one resource/time slot. The authority
had to commit exactly one, visibly correct the loser, make ambiguous retry
idempotent, accept nonoverlapping reservations, and converge an independent
observer. Client availability reads were never allowed to stand in for the
invariant.

Before results, Snapback placed authority in a compound unique index on the
materialized `resourceSlotKey` plus a unique idempotency key. Zero placed it in
PostgreSQL `UNIQUE(resource_id, slot_key)` plus a unique idempotency key. Both
React surfaces showed stable slot, action, state, error, and alternative IDs.

## Snapback chronology

Snapback's backend was concise: two tables, two live queries, and two
mutations. The simultaneous insert race produced one success and one exact
`SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION`; the final schedule contained one row.
Sequential redelivery of the same idempotency key returned the same Snapback
reservation ID and created no duplicate. A real WebSocket observer converged.

The sharp edge was optimistic create typing. `useSnapbackMutation` can safely
project over a generated result, but this mutation's row ID is minted only by
the server. Constructing a fake pending row violated the branded generated
`Id<'reservations'>` type, which TypeScript caught. The honest surface therefore
uses component-local pending presentation and the first-party mutation hook,
then removes it on settlement. That proves provisional UX, but it is less
composable than a provider-owned optimistic insert.

Authored source/touch count: 5 files, 322 lines (23 schema, 64 functions,
30 React, 177 acceptance, 28 seed). Final retained receipt:
`apps/contention-calendar/evidence/snapback.v1.json`, 7 pass, 0 GAP, 0 fail.
The provisional projection was 0.003 ms and its delayed acknowledgement
1,039.4 ms. The direct observer witness converged in 12.1 ms after a separate
non-delayed authoritative mutation; that figure must not be compared with the
injected contention path. The receipt records binary commit
`15a4e35001611a4a73161efc63e527d71b5519f7`, `gitDirty:true`, and the honest
`unpinned-binary` identity verdict for this dirty source-tree run.

## Zero chronology

Zero's shared mutator could insert the complete client-chosen reservation row
locally, then run the authority branch against PostgreSQL. This made
provisional create feel native rather than like a UI sidecar. PostgreSQL chose
one winner and surfaced the losing constraint as an application-error result;
both clients subsequently held the same one canonical row. Client-chosen IDs
also made retry identity straightforward.

The first harness again expected `.server` to reject. Zero instead fulfilled
both promises with one `{type:'success'}` and one `{type:'error',
error:{type:'app', message:'duplicate key...'}}`. Canonical state was already
correct. The corrected suite asserted the result union and waited for both
client stores to rebase to the same winner.

Operations repeated the Latency Kanban friction: cache/API/PostgreSQL/native
SQLite lifecycle, `.bin` discovery, unique app id for cluster-global slot
names, and explicit slot/database teardown. These are real local-DX costs even
though the product behavior was correct.

Authored source/touch count: 6 files, 344 lines (22 schema, 9 queries,
31 mutators, 34 API, 23 React, 225 acceptance). Final retained receipt:
`apps/contention-calendar/evidence/zero.v1.json`, 7 pass, 0 GAP, 0 fail.
Measured provisional mutation was 10.71 ms and delayed server result 1,051.6
ms; observer convergence on the delayed path was 1,035.6 ms.

## Immutable first-pass comparison

Snapback won invariant declaration and diagnostic stability. The unique index
was colocated with application schema, the loser returned a product code
rather than a raw database constraint name, and the local runtime required far
less infrastructure.

Zero won optimistic create ergonomics. Client-chosen IDs plus the shared
mutator let the query store contain the exact provisional reservation with no
separate React pending collection. The same mutator made the prediction/server
policy boundary easy to locate, although its server branch necessarily used
PostgreSQL-specific SQL for compare-and-insert behavior.

Both were correct: exactly one winner, one visible correction, one idempotent
retry result, two nonoverlapping successes, and observer convergence. The
important difference was where complexity went: Snapback kept authority and
operations simple but pushed server-ID create prediction into UI state; Zero
made prediction elegant but required more server/operational assembly.

## Findings

- **Capability / DX:** Snapback lacks a first-class typed optimistic-create
  story when the server mints the row ID. Witness: TypeScript refusal in the
  initial React surface and `cc.provisional-render`'s app-local sidecar.
- **Strength:** Snapback structural uniqueness returns the stable
  `SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION`. Witness: `cc.exactly-one-winner`.
- **Strength:** Zero shared mutators plus client-selected IDs make speculative
  insertion and rebase natural. Witness: `cc.provisional-render` and
  `cc.loser-correction`.
- **DX:** Zero exposes the PostgreSQL constraint name in the application-error
  message and returns the error as a fulfilled result union. Application code
  should map that to stable product copy. Witness: `cc.exactly-one-winner`.
- **Operations:** Zero app-id and replication-slot isolation must be explicit
  for parallel local bakeoffs. Witness: the initial slot collision.
- **Guide gap:** Snapback React docs cover updating authoritative rows but not
  the server-ID optimistic-create case; this experiment needed an app-local
  workaround the type system correctly forced into view.

## Dated remediation appendices

### 2026-08-01 — result-union and cleanup correction

The first Zero verdict showed five passes and two apparent failures because
the harness treated promise fulfillment as mutation success. Reading the 1.8
`MutatorResultDetails` union and inspecting canonical stores showed both were
harness mistakes. The suite now asserts one success value, one application
error value, exact-one canonical state, and loser rebase. App-specific Zero
IDs eliminate slot collisions; process-group ownership prevents the spawned
cache from outliving its runner, and final cleanup verifies absence of both
the owned database and replication slot. The immutable comparison above was
not rewritten to erase the surprise.

### 2026-08-04 — write-rung-2 shipping arm

W4 replaced the Snapback arm's JS reservation handler and component-local
`pending` array with one generated `Insert` plan and the shipped optimistic
mutation view. The provisional reservation now participates in the same
typed filter, sort, count, React list, and resource-title projection as
canonical reservations. Its UI identity is the durable protocol
`clientMutationId`; the branded reservation id appears only after a generated
schedule row supplies the authoritative value. No cast or client-side id
admission bridges that distinction.

The W1 sizing result held: Calendar needed no new evaluator verb. Inline
`Concat` derives the structural resource-slot key, the server unique index
chooses the race winner, a rejection retires only the losing private layer,
and the existing LLP 0133 id map replaces the winner's logical mint. Ambiguous
retry is now exercised as response loss after commit followed by replay of
the exact durable protocol identity; the repeated response must carry the
same result and id map and create only one canonical row. The unused
`clearReservations` JS utility remains outside the frozen common path.

Compared with the first bakeoff, Snapback now reaches Zero's important shared
projection property while retaining server-minted canonical ids and a stable
constraint diagnostic. The cost is that the shipping React surface composes
the framework-neutral optimistic view directly; this is more explicit and
lower-level than Zero's shared mutator and than the current Snapback React
hooks. The already-filed optimistic-create/app-error guide gap still captures
that missing authoring guidance.

This lane authored the transcribed rung-2 gate but did not execute its served
runtime. The orchestrator owns the controlled run and dated receipt. The
Option-C decision lab, its frozen manifests, and Field Notebook were not
changed or used as evidence.
