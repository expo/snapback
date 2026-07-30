# Diary 0039: Snapback × Convex current-main workout report

**Period:** 2026-07-30
**Matrix:** 7 application contracts × 2 native backends = 14 arms
**Snapback revision:** `01e941730306973aadaf21cd50b4c1613d171075`
**External evidence commit:** `45d2455d74323643e92f1a8b9e950c4ae0c4a374`
**External workspace:** `/Users/ccheever/projects/snapback-workout-matrix-20260729`
**Related diaries:** 0032–0038

## Executive answer

Convex is still the better default backend for a conventional TypeScript
application, but the comparison is now close rather than lopsided.

My practical score for the exact local workloads tested is roughly **55/45 in
Convex's favor**. Another honest description is four slight Convex wins, one
large Snapback win, and two near ties:

| App | Result |
| --- | --- |
| Streak Lab | Convex slight edge in ordinary authoring; Snapback stronger owner/constraint evidence |
| Relay Board | Near tie; Convex infers more, Snapback proves more |
| Campfire | Convex slight edge in the reactive TypeScript loop |
| Cursor Garden | Snapback clear win because presence is truly ephemeral |
| Split Ledger | Convex slight edge from typed nested mutation input |
| Pantry Search | Convex edge from reactive search and broader filters; indexed-search capability is no longer one-sided |
| Dispatch | Near tie; Convex wins one-off scheduling, Snapback wins recurring-work proof |

This is a major change from the earlier result. Current Snapback main now
ships the things whose absence dominated that comparison:

- schema-declared, real indexed full-text search;
- colocated inline handlers;
- exact recursive result contracts;
- an indexed range/order/take path for shared pagination;
- table-scoped relation IDs and a stable narrow relational query surface; and
- manifest-only generated artifact custody.

The remaining difference is less “Snapback cannot express normal apps” and
more “Convex has a mature, installed, inferred TypeScript product loop while
Snapback asks for more explicit contracts and still exposes framework/runtime
edges.”

## Evidence and method

The same seven contracts were rebuilt in four parallel lanes, then verified
again through one aggregate serial run. Every arm has native schema/functions,
deterministic reset/seed, generated bindings or review artifacts, and
acceptance through the provider's real client against a real local backend.

Final aggregate evidence:

- Snapback: **40/40 checks**, seven of seven apps;
- Convex: **38/38 checks**, seven of seven apps;
- Convex TypeScript: seven of seven projects clean under direct `tsc --noEmit`;
- Snapback codegen: seven complete graphs regenerated before aggregate
  acceptance;
- generated custody: seven committed Snapback review manifests, zero other
  committed Snapback graph projections; and
- both workspaces pass `git diff --check` and retain no credentials or local
  backend state.

The differing check totals are app semantics, not points. Cursor uses an extra
Snapback check for its generated ephemeral descriptor; Pantry uses one extra
Snapback check to prove that search is explicitly non-live.

The comparison is intentionally bounded. It tests local development,
authoring, generated contracts, transactions, realtime, ephemeral state,
search, and scheduled work. It is not a hosted deployment, production
operations, cost, load, latency, disaster recovery, mobile, or UI benchmark.
The Convex arm uses anonymous local agent mode; the Snapback arm uses the exact
current-main source checkout and binary.

## Results by workout

### 1. Streak Lab — owner scope and derived analytics

Both arms passed 5/5. Current Snapback removed the legacy handler registry and
gave the computed dashboard an exact closed result, including bounded date
arrays and table-scoped IDs. Its schema-level compound uniqueness and
server-derived local owner are stronger boundaries than the anonymous Convex
fixture's caller-supplied owner.

Convex still feels easier for the ordinary implementation because helper
functions can be shared naturally and return types flow from TypeScript. A
self-contained Snapback handler cannot capture the calendar helper, so the
logic is duplicated between query and mutation. Convex wins narrowly on
authoring; Snapback wins constraint and authority evidence.

### 2. Relay Board — related data and atomic audit

Both arms passed 6/6, including invalid-move rollback and second-client
delivery. Snapback now colocates the handlers, brands foreign IDs, and
publishes precise nested view/summary/mutation results. It also proves the card
patch and audit insert share commit version 2.

Convex gets nearly the same application result from a more natural inferred
TypeScript shape. Snapback's stable relational query is too narrow for this
one-board/many-columns/many-cards aggregate, while its more fitting bounded
children/write-activity profiles remain experimental and were correctly not
claimed. This is a near tie: Convex is terser; Snapback is more inspectable.

### 3. Campfire — pagination, reactions, and realtime

Both arms passed 6/6. The old conclusion that Snapback had to materialize a
whole room before slicing is stale. Current main can perform the shared
message page through indexed range/order/take before collection, and exact
result contracts cover pages, summaries, reactions, and mutations.

Convex still has the smoother default: ordinary queries become reactive
without a separate live classification, and the generated TypeScript loop
requires less explicit schema repetition. Snapback's live boundary and
declared read/write/result contracts are clearer evidence, but Convex keeps a
small developer-experience lead.

### 4. Cursor Garden — high-frequency presence

Snapback passed 6/6; the intentionally different Convex approximation passed
5/5. This remains Snapback's decisive win.

Snapback models presence as a typed, TTL-bounded, connection-owned,
rate-budgeted latest-state room. Twenty-four cursor publications produced the
latest sample, disappeared on disconnect, and left the durable storage version
exactly unchanged.

Convex models the same UI as durable heartbeat rows. It works and reacts, but
cursor-rate traffic writes the durable database and requires app-authored
expiry/leave behavior. This is not semantic parity. Snapback's current managed
stream and overlay publisher also remove most of the lower-level plumbing from
the first experiment.

The important nonclaim remains: the proven Snapback presence target is local
and process-resident, not hosted or multi-instance fanout.

### 5. Split Ledger — nested inputs, atomic rows, and aggregation

Both arms passed 5/5. Snapback now precisely types the deeply nested ledger
result and retains explicit integer-cent bounds, uniqueness, read/write
declarations, and atomic commit behavior.

Convex wins the input boundary. Its `v.array(v.object(...))` validates and
types the split vector. Snapback's `v.array` is result-contract-only, so
mutation arguments still use `v.json()` and the handler manually validates
structure. The ledger derivation is also an imperative N+1-shaped aggregation
that the current stable relational surface does not express.

This is a slight Convex win, with Snapback stronger at emitted transaction and
constraint evidence.

### 6. Pantry Search — indexed text search

Snapback passed 7/7 and Convex passed 6/6. The central correction is simple:
**Snapback does have full-text search on current main.** The arm uses a
schema-level search index, `defineSearchQuery`, the portable query AST, and
`client.search`. It proves title/ingredient/tag prefixes, deterministic rank,
highlights, equality filters, cursors, synchronous maintenance, and a fresh
post-mutation search. No JS scan remains.

Snapback's portable scoring/highlight/cursor contract and fail-closed
authoritative digest are compelling. Convex remains better for this product
shape because its indexed search composes with the ordinary reactive query
model and supports the app's filter combination without an explicit
client-side numeric projection.

The rerun also found a Snapback correctness papercut. An integral `minutes`
value accepted under `v.number()`/Real and included in stored search fields
failed authoritative digest recheck as `SNAPBACK_SEARCH_INDEX_CORRUPT`.
Declaring the actual domain `v.integer()` stabilized it. The final schema is
better, but an accepted ordinary value should not surface as opaque index
corruption.

Snapback search v1 is honestly local, non-live, equality-filter-only, and
without hosted/offline/native-FTS claims. So indexed search is now close;
reactive and target breadth are the remaining Convex advantages.

### 7. Dispatch — actions and scheduled work

Both arms passed 5/5. Current Snapback colocates query, mutation, and action
handlers; precisely types counts, IDs, and the completion union; and uses the
documented authenticated cron inspection shape. Its forced tick proves the
whole recurring path—action, atomic mutation, durable event, live delivery,
and successful run ledger—without sleeping.

Convex's `ctx.scheduler.runAfter(0, ...)` is the better everyday primitive. It
transactionally schedules one-off durable work with very little ceremony, and
the live query observes completion. Snapback has the stronger deterministic
recurring-work test seam, but the app surface lacks an equally obvious
transactional one-off scheduler. This is a near tie with different winners:
Convex for composition, Snapback for proof.

## Quantitative shape

The current measurement counts JS/TS backend and acceptance source. For
Snapback it separately measures the full materialized graph and the committed
review projection.

| Provider | Authored | Full generated graph | Generated state committed |
| --- | ---: | ---: | ---: |
| Snapback | 23 files, 2,196 lines, 71,925 bytes | 152 files, 18,742 lines, 595,206 bytes | 7 manifests, 2,509 lines, 84,914 bytes |
| Convex | 24 files, 2,176 lines, 72,510 bytes | 35 files, 2,613 lines, 87,158 bytes | the same 35 files / 87,158 bytes |

Three conclusions matter:

1. **Authored size is effectively tied.** Snapback is 20 lines larger but 585
   bytes smaller across the whole matrix. The current issue is shape and
   explicitness, not raw code volume.
2. **Snapback's complete graph is much larger.** It is about 4.3× the files,
   7.2× the lines, and 6.8× the bytes because it carries operation schemas,
   runtime artifacts, Contract/provider projections, capabilities, result
   contracts, identity, and custody.
3. **The source-control penalty is gone.** Only seven deterministic
   `artifacts.json` manifests are committed. Their total bytes are slightly
   lower than Convex's committed generated tree, although each dense JSON
   manifest is still a substantial review object.

The goal should not be to remove Snapback's evidence graph. It should be to
make cache generation fast, diff the semantic review projection well, and
avoid requiring ordinary consumers to navigate internal projections.

## Where Convex is better

### Installed, coherent TypeScript workflow

Schema, validators, functions, server contexts, return inference, generated
references, local backend, and client subscriptions feel like one product.
There is no native framework link step and no checkout-relative import into
the Convex source tree.

### Input typing and helper composition

Convex supports nested array/object validators at mutation boundaries and lets
ordinary TypeScript helpers be shared. Snapback's exact output contracts are
now competitive, but structured inputs still fall to `v.json()`, and direct
self-contained handlers trade registry wiring for helper duplication.

### Reactive-by-default data and search

Convex's normal query model is reactive, including indexed search. Snapback
requires a deliberate live-query subset, and portable search v1 is explicitly
non-live. Convex also offers the more useful one-off durable scheduling
primitive in this matrix.

### Fewer framework-specific operational edges

Anonymous local ports still require coordination across parallel projects, and
the mode is beta, but every final Convex arm started cleanly. Snapback required
native artifact diagnosis and an ordering-sensitive relink before JS handlers
could run.

## Where Snapback is better

### Ephemeral state is a first-class semantic lane

No other result was close to Cursor Garden. Typed transient rooms, connection
ownership, TTL, value and rate budgets, latest-state delivery, cleanup, and
zero durable amplification are meaningful product capabilities rather than
extra metadata around a heartbeat table.

### Evidence and fail-closed boundaries

Snapback makes result shapes, read/write reach, capabilities, index semantics,
artifact identity, commit versions, and runtime degradation visible. It
refuses stale/tampered/corrupt state with named diagnostics instead of silently
guessing. Some of those diagnostics need improvement, but the philosophy is a
real differentiator.

### Deterministic acceptance and server ownership

The harness gives each app an isolated real server, owned cleanup,
machine-readable non-vacuous checks, forced cron ticks, and authenticated
inspection. Convex acceptance is effective, but local project ports had to be
isolated or the final runs serialized.

### Explicit authority, constraints, and portable contracts

Server-derived local owners, trusted runtime time/IDs, table-scoped IDs,
schema-level uniqueness, structured mutation receipts, portable search
ranking/highlights, and capability nonclaims make application boundaries more
reviewable than the equivalent inferred code.

## What current main fixed from the first bakeoff

The first report's highest-profile gaps should be retired, not carried into a
new backlog:

- **Full-text search:** shipped locally and used successfully.
- **Declaration/handler duplication:** direct inline form shipped and used by
  Streak, Relay, Campfire, Split, and Dispatch.
- **Unknown computed outputs:** exact recursive result contracts shipped and
  closed the major query/mutation/action result holes.
- **Committed generated-tree explosion:** manifest-only custody shipped; this
  external repository migrated to seven review manifests.
- **Shared pagination:** Campfire now uses an indexed bounded path.
- **Cron inspection ambiguity:** current authenticated admin inspection matches
  the guide.
- **Binary/check-out mismatch:** the final binary and checkout identify the same
  commit.

Relational composition is partly improved, not fully closed: branded IDs and a
narrow stable relational query exist, while common bounded-children,
multi-table aggregate, and write-with-activity shapes remain limited or
experimental.

## New prioritized Snapback pain points

### P0 — Make external adoption and runtime readiness boring

1. **Prove the public external package/starter loop.** These apps still import
   codegen, clients, admin clients, and test helpers through paths into a
   sibling Snapback checkout and invoke its binary. Ship and exercise a public
   package/runtime/starter path from a clean repository.
2. **Qualify a real armed handler VM during bootstrap.** Link and server launch
   both passed while `ex_hermes_create_no_eval()` refused the first app
   function. Bootstrap must run after the final framework selection, create and
   destroy the actual handler VM, and bind binary/framework digests into one
   readiness receipt.
3. **Keep doctor, bootstrap, and harness on one recovery model.** Presence of
   files and an exact git stamp do not prove native artifact coherence.

The runtime incident was recovered and all checks passed, but it was the
largest first-hour confidence cost in the rerun.

### P1 — Finish input and search type fidelity

4. **Ship structured collection validators for arguments and stored fields.**
   `v.array(v.object(...))` should work for mutation inputs, not only result
   contracts. Split, Pantry, and arbitrary payloads expose this repeatedly.
5. **Type the portable search query AST.** The client has a concrete AST, while
   provider introspection publishes the search argument as `unknown`.
6. **Make precise mutation results the paved default.** Cursor's `updateNote`
   and Pantry's `addRecipe` still admit omitted/degraded result contracts even
   though current codegen can explain the repair.

### P1 — Generalize composition without losing evidence

7. **Support safe helper reuse or bounded module bundling for inline
   handlers.** Self-contained expressions remove registry wiring but duplicate
   calendar and indexed-read helpers.
8. **Stabilize common children, aggregate, and activity shapes.** Relay and
   Split still use imperative multi-query handlers because the stable
   relational surface is intentionally narrow.
9. **Add transactional one-off scheduling.** Pair Snapback's excellent cron
   evidence with a `runAfter`-class primitive that composes with mutations.

### P1 — Mature portable search

10. **Fix numeric canonicalization at the search digest boundary.** Accepted
    Real/integral values must round-trip or fail early with a precise model
    diagnostic, never masquerade as index corruption.
11. **Add a live/re-execution story.** Preserve the current ordinary-search
    honesty until a real reactive implementation exists.
12. **Expand portable filters and targets.** Bounded ranges are the first
    practical filter; hosted, offline, and additional database targets need
    their own evidence before capability claims expand.

### P2 — Polish the guide and review loop

13. **Make inline handlers primary in “Your first backend.”** The
    intent-specific query/mutation pages are current, but the getting-started
    page still front-loads `handlers.mjs`.
14. **Improve semantic review of dense manifests.** Manifest-only custody fixes
    source-control volume, but reviewers need a concise change summary over the
    85 KiB matrix review projection.
15. **Resolve the `unpinned` harness wording for explicitly configured exact
    binaries.** The underlying commit evidence was exact, but the label is easy
    to misread as weak provenance.

## Filed follow-ups

- `issues/20260730-bootstrap-smoke-does-not-create-armed-handler-vm.md`
- `issues/20260730-search-real-integral-digest-corruption.md`
- `issues/20260730-guide-gap-first-backend-front-loads-legacy-handlers.md`

The old “Snapback lacks full-text search” issue is not repeated because current
main disproves it.

## Final recommendation

Choose Convex today for a conventional TypeScript product when the priority is
the shortest path from schema to hosted reactive application, especially when
you need nested input typing, reactive search, or transactional one-off
scheduling.

Choose Snapback when its differentiators are central: cursor-rate ephemeral
state without durable writes, explicit capability/evidence boundaries,
deterministic scheduled-work proof, portable search contracts, or
server-derived local authority and inspectable commit behavior.

The best next Snapback sequence is:

**external install/runtime qualification → structured inputs and helper
composition → aggregate/children/scheduling primitives → live and broader
portable search → guide/review polish.**

That sequence is different from the first bakeoff because current main already
did the hard catch-up work on search, handler colocation, result contracts,
pagination, and generated custody.
