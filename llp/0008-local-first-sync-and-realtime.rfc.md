# LLP 0008: Local-first sync and realtime

**Type:** RFC
**Status:** Draft
**Systems:** Sync, Realtime, Storage, API, Auth, Client integration, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-07-02 (§Decision DK-9 added — store-agnostic client-store interface with SQLite reference impl, LLP 0032 X4; §Realtime Delivery gained the P4 shipped-protocol note earlier same day; earlier: 2026-07-01 (LLP 0032 M3: §Reactivity records the DK-3 decision — v1 replace/WS pin with a named revisit trigger, on the M1 fan-out evidence in LLP 0035; L3 retention status noted in §Retention and Resume)
**Related:** LLP 0000, LLP 0001, LLP 0003, LLP 0004, LLP 0006, LLP 0007, LLP 0009, LLP 0010, LLP 0011, LLP 0013

## Summary

Snapback should treat local-first sync and realtime live updates as one system:
clients subscribe to named queries, keep the authorized results locally, run UI
from that local state, and receive server-authoritative changes as mutations
commit. Offline mutation replay and realtime invalidation should use the same
logical changeset and version contract, not two unrelated mechanisms.

This RFC proposes query-result sync backed by server changesets as the first
product model. The local core may implement it with SQLite triggers, a change
table, a tailer, and a matcher, but application semantics should be expressed in
terms of live queries, authorized result sets, mutation changesets, and durable
client cursors.

Valet shipped this subsystem, so much of what follows is grounded in its
implementation rather than proposed from first principles. Contracts marked
`[observed - Valet LLP NNNN]` are decisions Valet reached in production;
`[confirmed - Valet diaries]` marks behavior a builder hit firsthand. See
[LLP 0006](./0006-valet-retrospective.research.md) for the recovered record. The
two contracts most worth adopting verbatim — the replay environment and the
retention rule — and the one trap most worth avoiding — unbounded change-log
growth — are called out below.

## Motivation

LLP 0000 requires both local-first partial sync and realtime updates. The
reference apps make those inseparable:

- messaging needs old messages offline and new messages live;
- a kanban board needs optimistic edits and realtime reordering;
- a card game needs each player to sync only authorized hidden state;
- a collaborative rich-text pad needs one explicit answer for text operations,
  cursor/selection presence, offline replay, and convergence across platforms;
- a desktop workspace may sync a much larger working set than a phone;
- the whiteboard and community-hub cases stress fan-out and presence.

LLP 0001 notes that prior systems converge on query subscriptions, reactive
local stores, optimistic mutation replay, and authorization-aware sync. Snapback
should make that convergence explicit.

## Proposal

The named query from LLP 0004 is the unit of sync and realtime subscription.
When a client subscribes to a query, Snapback returns an initial authorized
result set, tracks enough dependency information to know when the result may
change, and then delivers ordered changesets as server mutations commit.

The same subscription can serve three modes:

- online live query: keep UI current while connected;
- partial local-first sync: retain authorized results for offline use;
- reconnect/resume: advance from the last durable version when possible.

The server remains authoritative. Clients may optimistically apply local
mutations, but the server accepts, rejects, orders, and publishes the committed
changeset.

## Alternatives Considered

### Table Replication

Replicating whole tables is simple and maps directly to database changes. It is
too broad for the mobile partial-sync requirement and too weak for the card-game
authorization case. It can exist as an admin or desktop bulk mode, but it should
not be the default product model.

### Event Log Sync

An event log is attractive for replay, conflict explanation, and client-side
derivation. It may still be useful internally. As the primary app model, it risks
making ordinary apps author events and projections instead of straightforward
queries and mutations.

### Query-Result Sync

Query-result sync best matches Snapback's API direction: subscribe to what the
app reads, store that authorized result locally, and update it when committed
mutations affect it. This is the proposed first product model.

## Subscription Contract

A subscription is identified by:

- generated query reference;
- validated args;
- authenticated session or impersonated test context;
- target capabilities;
- client id and local-store cursor;
- optional sync policy such as online-only, retain, or bulk.

The server returns:

- a result snapshot;
- the database version represented by the snapshot;
- capability flags;
- diagnostics for unsupported query forms, missing indexes, or permission gaps.

The subscription request must identify whether the query is actually
**syncable-live**. A callable server query is not automatically eligible for
retained local results or incremental deltas. The v1 syncable-live subset is:
one primary table, structured query-builder predicates, declared index/cursor
ordering, declared auth variables, bounded result size or explicit retention
policy, and a generated dependency summary that the matcher can inspect. Queries
outside that subset may still be callable and may still use an online live
`replace`/resnapshot mode, but adapters must surface them as online-only or
replace-only capability classes rather than presenting them as fully local-first.

After the snapshot, the server sends ordered deltas or resnapshot instructions.
Messages are idempotent. Clients must be able to apply the same committed
changeset more than once without corrupting local state.

**The initial result must be authoritative, not a race.** A subscription's first
emission must be the current authorized result — read locally for an offline-first
client, from the server's `subscribe_response` when connected — delivered as one
"current value plus subscription" seam. Every Valet/Contract demo independently hit
a cold-start `subscribe` that stayed `loading` until the *next* change and had to
prime speculatively from `getAllDocs`, a race that "hides a future flicker bug"
([LLP 0006](./0006-valet-retrospective.research.md),
`[confirmed - Valet diaries, 2026-06-25]`). Snapback must not ship that gap.

**Deltas carry whole documents, not field diffs.** Valet sends the complete
document on every insert/update (remove carries only the `_id`), which is *why*
re-applying a changeset is idempotent — re-applying a full document is safe, while
re-applying a diff is not — and it lets the client evaluate filters locally
(`[observed - Valet LLP 0013]`). If Snapback ever prefers field-diffs for wire
size, it must design idempotent diff application separately; state the tradeoff
rather than assuming diffs.

**Delta *type* is a function of subscription membership, not the database
operation.** The same committed write is an `insert` to a subscription that did not
previously contain the row and an `update` to one that did. Each subscription holds
a membership set updated atomically with delta emission; membership can drift if
messages are lost, recovered by an explicit resync that re-evaluates all rows and
sends correction deltas (`[observed - Valet LLP 0001/0013/0021]`). The "resync
required" message below is wired to this mechanism.

## Reactivity and Read Sets

The server must know when a committed changeset may affect a live query. The
first implementation can be conservative, but it must be explicit.

For analyzable query-builder expressions, Snapback should record a dependency
summary:

- tables read;
- indexes or predicates used;
- row ids read where known;
- fields used for filtering, sorting, and projection;
- auth predicates that affected visibility.

When a changeset commits, the matcher uses this dependency summary to decide
which subscriptions need re-evaluation. If the matcher cannot prove a change is
irrelevant, it may re-run the query. False positives are acceptable early; false
negatives are correctness bugs.

Opaque server-executed query functions are not automatically safe for retained
local-first, authorization-aware sync. Valet's empirical answer sharpens the v1
line (`[observed - Valet LLP 0013/0021/0032]`): analyzable single-table filter
expressions get **true incremental deltas** via the membership matcher; opaque
"server-query" handlers (joins, aggregations) get **no read-set extraction** — when
any row in a referenced table changes, Valet re-ran the whole handler and shipped
the full result as a `replace` delta. That is correct but does not scale to large
result sets and cannot produce fine-grained, auth-filtered deltas. So: ship the
brute-force `replace` path as the honest fallback for un-analyzable queries,
reserve syncable-live incremental deltas for the declared subset above, and treat
read-set extraction for richer queries as the value Valet never captured rather
than an assumed capability. This answers "which query forms are live-syncable in
v1": analyzable single-table filters get retained local state and deltas;
everything else gets online-only or resnapshot/`replace`, depending on target
capabilities.

### Decision DK-3 — delta shape and read lane (2026-07-01)

The M1 benchmarks ([LLP 0035](./0035-local-target-benchmarks.research.md))
measured live fan-out at **~4.9 ms per affected subscription** — a fan-out
ceiling of ~2 affected subscribers per commit within a 10 ms budget. The cost is
almost entirely the **fresh-VM re-query** the current implementation runs for
each affected subscription on every commit
(`invoke_query_with_dependencies` in the fan-out loop); the matcher that
*decides* to re-run is ~2 700× cheaper. So the fan-out ceiling is a VM problem
first and a delta-shape problem second.

Decision, made deliberately per LLP 0032's DK-3 (and its guardrail not to pin
further wire-protocol surface before this is settled):

- **v1 pin: whole-document `replace` per affected subscription, WS-only read
  path.** Keep the honest brute-force `replace` fallback and the stateful-WS
  delivery for v1. Op-log deltas and a cacheable read lane are **not** built
  now — but the decision to defer them is explicit, not an accident.
- **The higher-leverage immediate fix is DK-4 (warm VM), not the delta shape.**
  Because the ~4.9 ms is dominated by the fresh-VM re-query, a warm VM
  ([LLP 0009](./0009-code-execution-security.rfc.md) DK-4) raises the fan-out
  ceiling without changing the wire format. Op-log deltas (send the changed
  rows, not a whole re-query) are the *next* lever after warm VM, for the
  analyzable syncable-live subset above.
- **Preserve the cacheable-read-lane option; do not preclude it.** LLP 0022
  calls an Electric-style cacheable HTTP read lane "the most actionable single
  idea," and it is hard to retrofit once the wire protocol hardens — which is
  why it is decided now: **keep it open.** Do not pin
  [LLP 0012](./0012-headless-integration-contract.spec.md) read-path surface in
  a way that assumes WS-only; a cacheable HTTP read lane must be addable later
  as a new read-path capability class beside the WS path, not a breaking change.
- **Revisit trigger (named):** revisit op-log deltas and the cacheable read lane
  when (a) warm-VM fan-out *still* exceeds the target latency at a real
  subscriber count (re-measure with M1 after DK-4 lands), or (b) the hosted /
  multi-subscriber target lands — whichever comes first. The M1 ceiling of ~2
  subs/commit is the current baseline the trigger is measured against.

Ledgered in [LLP 0000](./0000-snapback.explainer.md); numbers in LLP 0035; the
LLP 0012 wire guardrail is recorded there.

## Mutation Replay and Conflict Semantics

Clients may enqueue mutations while offline. Each queued mutation has:

- generated function reference;
- validated args;
- client mutation id and a client-local monotonic **sequence** number (ordering
  uses the sequence, never a wall clock — wall-clock ordering breaks under clock
  skew, `[observed - Valet LLP 0016]`);
- auth/session context available to the client;
- a captured **environment**, and an optimistic changeset if the target supports
  local simulation.

**Replay environment contract (adopt verbatim from Valet, `[observed - Valet LLP
0001/0016]`).** A mutation is replayed as *function + args + captured environment*,
never as a document snapshot. The client captures `{generatedIds, randomValues,
now}` locally, but the wire transmits **only `{generatedIds, now}`**:

- `generatedIds` and `now` are transmitted because divergent ids or timestamps
  between the optimistic run and the server run would corrupt data;
- `randomValues` are deliberately **not** replayed deterministically — the server
  is authoritative and the client rebases on whatever the server produces, so
  `Math.random()` diverging does no harm.

Handler authors should therefore derive any value that must survive replay from
ids/args/`now`, not from fresh `Date.now()`/`Math.random()`. (The runtime patches
`Date.now()` for replay; note that Valet did **not** patch `new Date()`, a parity
gap worth closing or documenting — see [LLP 0010](./0010-agent-dx-and-acceptance.spec.md).)

When connectivity returns, the client does a full resync, waits for the local
replica to reach current, then replays each pending mutation **in sequence order**
against fresh server state. A mutation whose handler throws on replay is **dropped
and marked failed, not retried** — if it fails against current server state it would
also fail on the server — and the failure is surfaced as observable client state,
not swallowed (`[observed - Valet LLP 0016]`).

**Optimistic delta suppression is by document id, not by version
(`[observed - Valet LLP 0001/0016]`).** While a document has an unconfirmed local
mutation, incoming server deltas for that document are dropped — **even deltas with
a higher version** — because a higher-version delta may be another client's
intervening write that would flicker the UI back before the local mutation
confirms. The suppression set is cleared incrementally as each write is confirmed,
and entirely on disconnect or user switch. This is a separate mechanism from the
"apply only `version > cursor`" dedup rule; a correct client needs both.

**Multi-row mutations must apply atomically on the client too.** Valet applied a
multi-row move as several separate optimistic writes, letting another tab render a
half-applied state; the fix was to route multi-row changes through one
server-authoritative changeset
([LLP 0006](./0006-valet-retrospective.research.md),
`[confirmed - Valet diaries, 2026-06-25]`). Optimistic application of a changeset
is all-or-nothing locally, matching the server's atomic boundary
([LLP 0007](./0007-storage-portability.spec.md) §Transactions).

The first conflict model is server-authoritative replay, not CRDT merge. Pin the
v1 default to **last-write-wins per field, with delete-wins**: the server applies
each mutation's partial update field by field, so two clients editing *different*
fields of one row both survive, and two writes to the *same* field resolve
last-to-arrive; deletes bypass version checks (`[observed - Valet LLP 0001]`).
`_version` is optimistic-locking metadata (used by an explicit
`delete_with_version`-style call), not the conflict mechanism. Field-level CRDTs,
collaborative text, and whiteboard merge are deferred — and Valet's record is
strong evidence the deferral is right: it *designed* CRDTs and semantic conflict
policies in full and still never shipped them (`[observed - Valet LLP
0044/0080/0048]`). The collaborative rich-text pad reference app should later
force one good, explicit approach to editor collaboration; it should not be
treated as proof that generic row-level sync automatically solves arbitrary
per-character merge semantics. When conflicts do surface to clients or agents,
use a **typed conflict payload**, not a generic error.

## Local Store

The local store is a target-specific implementation detail with a shared logical
contract. React Native, web, desktop, and Contract/Exact may use different
physical storage, but they must expose the same observable subscription state:

- snapshot version;
- retained query results;
- pending local mutations;
- replay failures;
- connection state;
- resync-required state;
- permission-denied state.

Desktop clients may retain broad working sets. Mobile clients may retain narrow
slices. The sync policy must not assume one local data size profile.

Valet's lived answer to "what is the local store" is **SQLite on every platform**
for the data replica — wa-sqlite in the browser (proven across many demos,
`[confirmed - Valet diaries, 2026-06-25]`), expo-sqlite on native — with the
mutation log in IndexedDB (web) or SQLite (native). Two non-negotiable carry-overs
if Snapback's local store is SQLite (`[observed - Valet LLP 0002]`): (1) all local
DB access is serialized through a single-connection mutex — this is a **correctness
requirement, not an optimization**; bypassing it caused silent corruption — and
transactions need explicit `BEGIN/COMMIT` plus a reentrancy guard, because some
platforms' own transaction APIs deadlock against the mutex; (2) change tracking is
native (`update_hook`) where available and SQL triggers + a changes table
elsewhere, so the *mechanism* differs per platform even though the observable
contract does not. If a persistent store is unavailable (e.g. IndexedDB quota), the
client should degrade to in-memory rather than fail silently.

### Decision DK-9 — client local-store mandate (2026-07-02)

**Decided: a store-agnostic client-store interface, with SQLite as the
reference implementation — "SQLite on every client platform" is Valet
inheritance, not a Snapback mandate.** Ratified by Charlie (applied by
Claude under Charlie's same-day delegation); LLP 0032 X4, ledgered in
LLP 0000, taken now — before any client local store exists — because it is
cheap now and expensive after a store ships.

What the decision pins:

- **The contract is the observable-state list above, not SQL.** Under the
  ratified server-authoritative query-result sync model (this document's
  §Proposal; no CRDT core), the client store holds retained query results,
  the snapshot version / `(stream, version)` cursors
  ([LLP 0007](./0007-storage-portability.spec.md) §Commit-version
  graduation), authorization epochs, the pending-mutation queue, and the
  stale/resync flags — a document/result cache plus an outbox, not a
  relational replica. Nothing in the wire contract may require SQL
  semantics client-side.
- **SQLite is the reference implementation** (expo-sqlite / wa-sqlite),
  carrying Valet's two non-negotiables verbatim (single-connection mutex as
  a correctness requirement; explicit transactions with a reentrancy
  guard). Web targets may instead sit on IndexedDB/OPFS; capability reports
  **name the store implementation** so an agent can see which physical
  store and degradation mode (persistent vs in-memory fallback) is in
  force.
- **The interface is pinned before the first implementation**: when the
  first client store lands (the LLP 0016 Phase 6 React/Expo pressure test
  is the likely forcing demo), it lands as an implementation of the
  store-agnostic interface, and a second store (or the in-memory fallback)
  exercises the seam in the same change — the conformance habit that kept
  the ephemeral backend honest (LLP 0026 Phase 1).

Revisit trigger: if parity-class offline execution (local handler replay)
ever requires query capabilities the interface cannot express without
SQL — reopen with that evidence rather than mandating SQLite pre-emptively.

## Authorization-Aware Sync

Authorization is not a visual filter. The server must apply visibility rules
before data syncs to a client. The same row may be visible to one subscription
and invisible to another, depending on auth context and query args.

LLP 0011 owns the permission language. This RFC requires that the permission
result feed the sync system:

- initial snapshots include only authorized data;
- live deltas do not leak unauthorized rows;
- permission changes can invalidate or remove rows from local stores;
- test tools can explain why a row was included, excluded, or removed.

The recommended v1 model from LLP 0011 is **server-directed resubscribe on
permission change**, not universal per-row live permission re-evaluation. A
permission-affecting write advances an authorization epoch for the affected
scope. The server sends `resync_required` to subscriptions whose auth or
permission dependencies may have changed; the client immediately marks the
result stale, clears the affected retained slice if the data may now be
forbidden, and resubscribes to receive a fresh authorized snapshot. Reconnect
and resume always filter through the current permissions and epoch. This is
stricter than Valet's stale-until-manual-resubscribe behavior while avoiding a
v1 requirement that every permission dependency be incrementally re-evaluated
for every connected subscription.

## Retention and Resume

The server retains enough change history to resume clients from recent versions.
If a client resumes from a version still inside the retention window, the server
streams the missing changesets. If not, the server instructs the client to
resnapshot affected subscriptions.

The retention rule must balance:

- idle cost;
- disk growth;
- reconnect reliability;
- offline duration;
- reference-app expectations.

Draft default: retention is version-based **plus** time-based, with diagnostics
when a client falls outside the window, and a forced per-subscription resnapshot
below the floor.

> **Implementation status (2026-07-01, LLP 0032 L3):** the local target now
> bounds the `_snapback_changes` journal — a periodic prune keeps the last N
> commit versions *or* anything newer than a time window and drops the rest
> (`LocalDatabase::prune_change_journal`), except that a table's **high-water
> change is never pruned** so read-set validation's `MAX(version) WHERE
> table_name` never collapses for a cold table (a review caught that as a
> spurious-conflict bug). The replay floor is a **monotonic persisted
> watermark** — the highest version pruning has removed — so it stays
> authoritative even though old per-table high-water rows linger for
> validation; `resume_requires_resnapshot(from_version)` compares against it. The journal also gained a
> `(table_name, version)` index so the per-mutation read-set validation no
> longer full-scans. What is *not* built yet is a version-based **delta-resume
> consumer**: today live delivery re-runs queries rather than replaying the
> journal, so the floor primitive has no client caller until the wire
> delta/resume path lands ([LLP 0032](./0032-decision-and-implementation-hardening.plan.md)
> P4 / DK-3). Pruning is safe for the current sole journal consumer (the
> `MAX(version)` validation check, which pruning old rows does not affect). This is deliberately the fix for the concrete trap Valet hit:
Valet garbage-collected the change log only after **every** active subscription had
advanced past a version (a `min_last_sync_version()` watermark), with **no time
bound and no resnapshot escape valve** — so one slow, stuck, or zombie subscription
pinned the change log and it grew without limit
([LLP 0006](./0006-valet-retrospective.research.md),
`[observed - Valet LLP 0013/0021]`). Do **not** adopt "GC only after all
subscriptions advance" as the sole rule; cap the log by max versions *or* max age
and force resnapshot for clients below the floor.

Scope resume honestly. Valet never shipped delta-resume for the offline case: when
a reconnecting client had any pending mutations it forced a **full** resubscribe
(cost bounded by the subscription's result-set size, not the whole database),
because replaying mutations against an incompletely delta-synced state produces
wrong results (`[observed - Valet LLP 0012/0016]`). So v1 should target cheap
delta-resume only for the online-reconnect-with-no-pending-mutations case, full
resnapshot when a mutation log exists, and treat "delta-resume *with* pending
offline replay" as an explicit later milestone rather than an assumed v1 capability.

## Realtime Delivery

Realtime delivery is ordered by committed changeset version. Transport may be
WebSocket locally and something else on future targets, but generated clients
should see:

- snapshot;
- delta;
- remove;
- resync required;
- mutation accepted or rejected;
- subscription error;
- capability gap.

The change-notification mechanism is a swappable implementation detail behind this
ordered-changeset contract, **not** part of the product surface. Valet polled the
change table every 50ms after rejecting `update_hook` (fires synchronously, blocks
the writer), WAL tailing (fragile), and Postgres `LISTEN/NOTIFY` (engine-specific)
— but polling does not port to Cloudflare, where Workers cannot poll and Durable
Objects use alarms (`[observed - Valet LLP 0013/0040]`). Keep the trigger / change
table / tailer / matcher as a local detail behind a change-notification seam that
coalesces and tolerates spurious wakeups (recover by re-reading the current
version); the product contract is ordered changesets by version, regardless of how
a target learns a change happened.

> **v1 wire protocol as shipped (LLP 0032 P4 close-out, 2026-07-02).** The
> local target now implements this section's contract as follows (design
> owned by [LLP 0034](./0034-contract-source-seam-provider-side.rfc.md) §2,
> landed as the D1/D2 arc):
>
> - **Addressed envelopes, multiplexed lanes.** Durable `live_replace` /
>   `resync_required` envelopes carry a `subscription_id`; a connection's
>   outbox carries every lane's traffic and the client's per-connection lane
>   registry routes durable envelopes to durable consumers and ephemeral
>   envelopes to overlays — two handles on one connection advance
>   independently, and no consumer discards another's messages
>   (`regression-multiplexed-lanes`, `regression-gc-starvation`,
>   `regression-mixed-transport`).
> - **Reconnect is a fresh subscribe, never a resume.** The server drops a
>   connection's durable subscriptions at socket close and the outbox dies
>   with the connection — decided with P4. The client re-enters through
>   `subscribe_live` with explicit supersession and bounded exponential
>   backoff, and only promotes its connection state after a success.
>   `resume_live` remains a same-connection operation; the version-based
>   delta-resume consumer stays future work behind DK-3's revisit trigger
>   (§Retention and Resume note).
> - **Resync sentinels.** A subscription-scoped `resync_required` re-snapshots
>   one handle; the connection-wide sentinel (no `subscription_id` — outbox
>   overflow) re-snapshots every handle on the connection. Ephemeral overlays
>   record `needsResync` and recovery is consumer-driven (the adapter
>   resubscribes on the change signal).
> - **Loss on a dying socket is recovered by snapshot, not requeue** (the
>   S5.D4/S5.D5 class): a send failure tears the socket down, reconnect
>   fresh-snapshots, and per-subscription non-decreasing versions filter
>   staleness — "nothing silently lost" is pinned by `regression-fake-live`
>   and the kill-socket legs.
> - **Liveness** is an application-level ping plus a client freshness budget;
>   the server-side delivery is event-driven with a defensive 30 s heartbeat
>   (L8).

**Backpressure must be designed, and over-limit messages must be recoverable.**
Valet gave each client a dedicated bounded queue (an mpsc of 256, *not* a broadcast
channel — a broadcast lets one slow consumer block delivery to all others) and
batched a client's deltas into one message per tick (`[observed - Valet LLP
0013/0021]`). But its default wire limit of **50 messages/second silently dropped**
a 52-write burst and left those mutations **pending forever** with no recovery
([LLP 0006](./0006-valet-retrospective.research.md),
`[confirmed - Valet diaries, 2026-06-25]`). Snapback must keep the per-client
bounded queue and per-tick batching, provide a bulk/multi-row write path so a single
logical operation is not dozens of messages, and ensure that hitting a limit
applies backpressure or a recoverable error — never a silent drop that strands a
pending mutation.

Measured Valet baselines, usable as acceptance targets for
[LLP 0010](./0010-agent-dx-and-acceptance.spec.md) until Snapback measures its own
(`[observed - Valet LLP 0012/0013/0021]`): median write→delta 50–100ms, P95 ~150ms,
P99 up to ~1s under contention or many subscriptions; 100 subscriptions/client;
10s auth timeout; 5-min idle timeout; reconnect backoff 1s→30s over ~10 attempts.

Presence and cursor-style high-frequency ephemeral state are not ordinary table
sync by default. The collaborative whiteboard reference app is useful as a
stress test, but fast-twitch realtime games remain a non-goal under LLP 0000.
Valet showed two-client cursor presence working as plain rows, but never
stress-tested many simultaneous high-frequency clients.
[LLP 0013](./0013-ephemeral-realtime-state.rfc.md) proposes the app-facing
carrier for this class: typed, scoped, TTL-bound ephemeral collections with
snapshot-plus-delta subscriptions, coalescing, and adapter-specific backends. The
fan-out ceiling LLP 0000 flags remains unmeasured.

## Validation Requirements

The first sync/realtime validation should include:

- a tiny todo app with retained offline results;
- a cold-start subscription that returns existing local rows immediately, with no
  `getAllDocs`-style speculative prime (the gap every Valet demo hit);
- a capability distinction where an ordinary callable query is rejected or marked
  replace-only for local-first sync, while a restricted syncable-live query gets
  retained results and incremental deltas;
- a two-client realtime mutation that updates a live query;
- a multi-row mutation delivered as one observable changeset, applied atomically on
  the optimistic client (no half-applied state visible in another tab);
- an optimistic write whose row is not flickered by a higher-version delta from
  another client until it confirms (doc-id suppression);
- a write burst larger than the per-client message limit that applies backpressure
  without stranding a pending mutation forever;
- a reconnect test from a retained version;
- a reconnect test outside retention requiring resnapshot;
- an auth-aware test where one client sees a row another client must not receive;
- a permission-changing write that advances the authz epoch, forces
  `resync_required`, clears stale retained data when required, and resubscribes
  to a fresh authorized snapshot;
- a diagnostic explaining one invalid or non-subscribable query.

## Open Questions

Several earlier open questions are now answered by the Valet record and folded in
above: which query forms are live-syncable in v1 (analyzable single-table filters
get retained local state and deltas, opaque queries are online-only or `replace`
depending on capability); the client local store (SQLite on every platform,
mutation log in IndexedDB/SQLite); and how much optimistic execution to ship (the
full loop, with delta-resume-while-pending deferred). What remains:

- What is the exact retained-history horizon (max versions and max age) for the
  local target, and what diagnostics fire at the floor?
- What is the cursor/sequence encoding across client local stores?
- What are the concrete limits and validation results for the LLP 0013 ephemeral
  realtime carrier — TTLs, payload size, publish rate, subscribers per scope,
  adapter behavior, and fan-out ceiling?
- Which analyzable permission rules, if any, should later graduate from
  server-directed resubscribe to precise live `remove` deltas?
- The realtime **fan-out ceiling** (LLP 0000's mouse-position question): Valet's
  baselines bound single-client latency, but the many-simultaneous-high-frequency-
  clients ceiling is unmeasured and is the key empirical unknown.
- Acceptable matcher cost under fan-out at scale.

## Status

Draft. The Valet retrospective ([LLP 0006](./0006-valet-retrospective.research.md))
is now folded in, so the replay, suppression, retention, conflict, and delivery
contracts above are grounded in a shipped system rather than proposed cold. This
RFC should be revised again after the first local prototype measures subscription
matching, retention, reconnect, and offline replay — especially the fan-out ceiling,
which remains the key unmeasured unknown.
