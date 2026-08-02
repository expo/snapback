# Diary 0046: Field Notebook — Snapback × Zero, with Replicache control

**Date:** 2026-08-01  
**Protocol:** LLP 0138 / `field-notebook.v1.json` (11 checks; 200 records; 900,000 ms stretch profile)  
**Arms:** Snapback source-local Ibex/SQLite; Zero 1.8.0 local PostgreSQL 17; Replicache 15.3.0 with app-owned push/pull  
**Machine:** frozen program machine, Apple M5 Max, Node 25.9.0, Bun 1.3.12  
**Assistance:** no hosted keys or human intervention; shared dependencies and PostgreSQL were reused, while each provider arm owned its mutable runtime resources.

## Contract and first-attempt freeze

The core contract asks what a field worker sees and can safely do when the
backend disappears: cold retained reads, honest freshness, a short interrupted
write, preserved application draft, exactly one record after reconnect, and
an explicit logout cache policy. The stretch asks for a create plus update
across the 15-minute profile, speculative state after restart, and a visible
concurrent-edit rebase. The deterministic local run compresses the wall-clock
outage; it does not claim a literal 15-minute soak.

The frozen provider split matters. Zero is scored for its current partial-sync
offline contract and is not silently credited with Replicache semantics.
Replicache gets a separate control with mutation IDs, version cookies,
idempotent app-owned push/pull, and replay. Snapback uses its public,
authority-independent retained query and durable mutation outbox.

## Snapback chronology

The relevant guide pages were offline/retention, backend functions and live
queries, React, and acceptance. Declaring the notebook query public and
`authorityIndependent` made it eligible for the JS retained store without
weakening protected-data policy. Codegen produced one table and three
operations without warnings; its two mutation result contracts were
appropriately marked degraded.

With the backend stopped, a newly constructed client read all 200 rows from
the durable file store and labeled them `freshness:'retained'` with a stale
connection. Offline create and update intents were durably queued with
`SNAPBACK_OFFLINE_MUTATION_QUEUED`; after restart authority contained 201 rows
and one created ID. Application-owned logout deletion left zero retained
entries.

The boundary was equally clear. LLP 0090's D3 policy deliberately refuses to
reconstruct speculative render state while an outbox is pending, so intent
survived but the pending row did not reappear speculatively after restart. The
closed-IR handler replays server-authoritatively and exposes no semantic
three-way text merge or conflict object. Those are product gaps, not harness
failures.

Authored source/touch count: 7 Snapback/runtime files and 236 lines (11 schema,
25 functions, 7 seed, 149 acceptance, 18 React, 7 draft store, 19 shared README
allocation). The retained receipt is
`apps/field-notebook/evidence/snapback.v1.json`: 9 pass, 2 GAP, 0 fail, cleanup
green. It observed 200 cold rows, two durable pending mutations, 201
authoritative rows, and 816.9 ms reconnect reconciliation. The final rerun
records startup commit `15a4e35001611a4a73161efc63e527d71b5519f7`,
`gitDirty:true`, and verdict `unpinned-binary`. The commit matches the checkout;
the dirty stamp means it is honest behavioral evidence, not a clean pinned
publication artifact.

## Zero chronology

The Zero arm used the real 1.8.0 client, ZQL query/mutator registries,
`zeroPostgresJS`, PostgreSQL 17, and `zero-cache-dev`. Its connected path was
compact. During a stopped cache, a direct mutation produced a local prediction
whose `.server` result remained pending; the UI surface therefore disables
save when disconnected and does not call local prediction authoritative. On
reconnect the server contained exactly one new row. `zero.delete()` supplied a
clear logout policy.

The headless `fake-indexeddb` carrier restored zero cold rows even though Zero
documents cached offline reads. This is recorded as a browser-carrier evidence
GAP, not a Zero product failure. The same rule prevents this run from claiming
browser persistence. The three Replicache-class stretch checks are explicit
provider-inapplicable GAPs. A first successful receipt left Bun alive because
an intentionally unresolved offline `.server` retry retained a timer; cleanup
had already succeeded. The bounded runner now exits after suite cleanup.

Authored source/touch count: 8 Zero/runtime files and 88 lines (8 schema, 6
queries, 14 mutators, 31 runtime, 2 SQL, 3 validation, 24 acceptance, plus the
shared 20-line React surface). The retained receipt is
`apps/field-notebook/evidence/zero.v1.json`: 7 pass, 4 GAP, 0 fail, cleanup
green. It proves honest unknown freshness, no false authoritative settlement,
one authoritative reconnect row, and zero retained rows after explicit delete;
it does not prove a standards-real browser cold read.

## Replicache control

Replicache required the most application protocol. The control implements a
PostgreSQL record table, per-client last mutation IDs, a monotonic version
cookie, full-view patches, mutation-gap detection, idempotent duplicate push,
and explicit conflict materialization. That is more code than either provider
backend, but every rebase decision is owned and visible.

The real Replicache queue gave a sub-millisecond local create in the headless
run, exposed two pending mutation records, reconciled a duplicated push to one
server row, and surfaced both bodies when a remote revision raced an offline
local edit. The app-owned policy stored a conflict object with remote/local
bodies and both revisions, then pulled revision 3. This was the strongest
semantic conflict result in the app.

As with Zero, `fake-indexeddb` did not restore a closed client, so cold restart
and durable 15-minute custody are evidence GAPs rather than product failures.
The official persistence capability is recorded separately from this arm's
proof. The retained receipt is
`apps/field-notebook/evidence/replicache.v1.json`: 8 pass, 3 GAP, 0 fail,
cleanup green. The control authored 104 protocol/acceptance lines plus a
16-line React surface.

## Immutable first-pass comparison

Snapback won the practical offline core on this machine. It was the only arm
that produced certified cold retained rows after a fresh client with the
backend down, and it labeled them retained rather than current. Its durable
outbox and file-store diagnostics also required far less server protocol than
Replicache. This is a result about the tested carriers, not a claim that Zero
or Replicache lack documented browser persistence.

Replicache won offline mutation semantics. Its queue is directly inspectable,
its replay model naturally re-applies pending mutators over pulled authority,
and the app-owned server can preserve a meaningful concurrent-edit conflict.
That power comes with substantial protocol responsibility: idempotence,
cookies, mutation ordering, patch production, conflict policy, and poke/pull
coordination belong to the application.

Zero was best understood as a connected partial-sync product in this frozen
version. Its ZQL and shared mutator ergonomics were excellent, and its
reconnect result was correct, but disconnected mutation behavior was easy to
misread: a direct call could paint locally and remain pending even though the
declared product profile says disconnected writes are unsupported. A guarded
UI and explicit draft store are safer than treating that local effect as a
durable queue.

Snapback's main shortfall is the gap between custody and UX. It preserves the
intent safely but intentionally withholds speculative state after restart, and
it lacks a semantic rebase/conflict interface. A better design would preserve
the safety invariant while exposing a typed pending-intent projection and an
application-defined rebase hook after authoritative full resync.

## Findings

- **Capability:** Snapback certifies durable retained reads and honest freshness in this local arm. Witnesses: `fn.cold-retained-read` and `fn.honest-freshness`.
- **Capability gap:** Snapback does not reconstruct pending speculative UI after restart. Witness: `fn.stretch-offline-restart`.
- **Capability gap:** Snapback exposes no semantic concurrent-text rebase/conflict hook. Witness: `fn.stretch-concurrent-rebase`.
- **Capability:** Replicache's mutation protocol supports explicit idempotence and application-owned semantic conflict materialization. Witnesses: `fn.reconnect-no-duplicate` and `fn.stretch-concurrent-rebase`.
- **Evidence gap:** fake-indexeddb cannot certify either Zero or Replicache browser persistence. Witnesses: `fn.cold-retained-read` and `fn.stretch-offline-restart` in those receipts.
- **DX friction:** Zero's direct offline mutation can create a local prediction with a pending server promise despite the frozen profile's unsupported-disconnected-write declaration. Witness: `fn.disconnected-write-contract`.
- **Operations:** Zero needs cache/logical-replication lifecycle; Replicache needs a bespoke sync protocol; Snapback needs the smallest local stack.
- **Guide assessment:** the Snapback guide correctly predicted retained eligibility, stale labeling, outbox behavior, and D3's speculative restart limitation. No guide-gap ticket was needed.

## Dated remediation appendices

### 2026-08-01 — carrier and runner corrections

The first headless Zero run treated zero restored fake-IDB rows as a product
failure and then lingered after cleanup on an unresolved retry. It is now an
explicit carrier evidence GAP, cleanup ignores `ESRCH` only for an already-gone
owned cache process, and the runner exits after bounded cleanup. The first
Replicache control similarly overclaimed fake-IDB persistence; the final
receipt separates same-session queue/rebase proof from standards-real browser
custody. These corrections retain the first-pass product verdict.
