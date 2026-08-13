# LLP 0008: Local-first sync and realtime

**Type:** RFC
**Status:** Draft
**Systems:** Sync, Realtime, Storage, API, Auth, Client integration, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-08-12 (matcher-capture sufficiency: dependency summaries must prove both entry and exit; owner-visibility fields participate like filters; delta-applied membership and Row dependencies advance atomically; an incomplete fine-grained capture may not shadow a correct table-granular host-plan proof). 2026-08-10 (LLP 0222 connected-client witness amendment: action-only, session-authenticated, fixed-budget, transport-attested, and non-durable). 2026-08-08 (post-commit fan-out coalescing: backlogged commits'
data fan-out may be merged into one pending frame delivered once at the
latest version — LLP 0191 §1 rung 1, evidence-driven by the zb5-hot 74 s
median; see the dated decision section for the deferral rule, exclusions,
and starvation bounds; resyncs/authorization events and cheap frames stay
per-commit inline.) 2026-08-05 (DK-9 diagnostic-spelling reconciliation: the LLP 0166
successor RQS store keeps `SNAPBACK_RQS_STORE_LOCK_UNAVAILABLE` as its
authoritative emitted code; DK-9's generic
`SNAPBACK_CLIENT_STORE_LOCK_UNAVAILABLE` text is the owner-level semantic alias
and remains emitted only by the predecessor localStorage adapter; no shipped
diagnostic is renamed or dual-emitted.) 2026-08-03 (`single_table_v1@1` boundary: its class binding
consumes DK-3's additive-delivery ceiling; `live_delta` keeps the honest
`live_replace` fallback, ordered/limited results remain replace, and no wire
bytes or implementation/capability claim change.) 2026-08-03 (DK-9 dated amendment landed with Accepted
LLP 0166: the store may hold LLP 0157 materialization records, and
`result-transform-snapshot-v1` plans admit LLP 0166 §D7's closed
result-transform profile over a single address's fragments; the
contract stays the observable-state list, not SQL; normalization stays
unadmitted.) 2026-08-02 (Accepted LLP 0135 mutation-replay fold: changesets
requiring sequence-projected placement are withheld atomically until
settlement); 2026-08-02 (DK-9 dated note: Accepted LLP 0155 commissions a
semantic amendment — local plan evaluation over retained query-result
fragments, and normalization only if later admitted — as deliberate new
author policy, explicitly not the SQL-specific revisit trigger firing,
which LLP 0051 already answered without SQL; DK-9's text governs unchanged
until the dated amendment lands with the Move 1/2 owning Spec);
2026-07-24 (LLP 0090 resume-scoping reconciliation: §Retention and Resume records that the online-reconnect-only delta-resume scoping is widened by Accepted LLP 0090 to relaunch-from-disk resume, with the pending-mutation reason preserved by 0090's outbox rule — a non-empty outbox takes the LLP 0043 full-resync path, never `resumeFromToken` — and the retention reason preserved by the journal floor, which answers below-floor resumes with a fresh snapshot; auth-scoped fresh-snapshot-on-resume is unchanged); 2026-07-23 (LLP 0086 CC-8 citation absorptions from the prior-art batch: §Realtime Delivery records that bookmarkable versions stay on the wire, with D1's Sessions API as the copyable prior art for a future regional/cacheable read lane and the output-gate durability vocabulary cross-referenced to LLP 0007 — row 2; §Mutation Replay cites Ditto's read-time-derivation guidance as the from-inside-the-camp source for keeping semantic merge out of the sync core — row 9 — and the Jazz 2026-04-18 retreat trilogy plus Electric's pivot as primary-source evidence for the server-authoritative foundation — row 10; §Subscription Contract records the ceremony budget against Instant's query-scoped cache model — row 12); 2026-07-21 (DK-3 delivery-lane hardening: membership-gated plans are excluded fail-closed from `live_delta` at candidacy and inside `compute_live_delta`, and the L4 convergence assertion also runs at `NoChange` settles — closes LLP 0067 §F2a; same day: the DK-3 fan-out figures are marked superseded fixture results per the `37f1a2f` corrections, LLP 0035's 2026-07-21 note); 2026-07-16 (ENG-24920 companion amendment); 2026-07-14 (auth-program implementation reconciliation: the local target now implements negotiated item-6 authorization invalidation and item-8 signed-lease retained authorization, with the card-game proof exercising disjoint live delivery, logout blanking, cold-process retention, and equality-expiry deletion; this does not broaden the claim to arbitrary opaque-query retention or hosted auth). 2026-07-13 (narrow authorization-invalidation amendment: LLP 0053, once Accepted, controls coarse events versus witnessed shrinking-delivery obligations, fail-closed protected inputs, mandatory fresh auth-scoped resume, and ACK-backed negative delivery while preserving server authorization and fresh snapshots; earlier 2026-07-12: ENG-24493/ENG-24496 harden the first web client store: uninterpretable durable bytes fail closed in place until explicit reset/migration, and every localStorage transaction is serialized across same-origin contexts through a crash-releasing Web Lock; earlier 2026-07-02: §Decision DK-9 added — store-agnostic client-store interface with SQLite reference impl, LLP 0032 X4; same day: LLP 0032 M3 re-measurement after DK-4: §Decision DK-3 records the revisit trigger *fired* — op-log deltas for the analyzable subset are ~5 200× cheaper than the warm re-query, the sanctioned next fan-out lever, wire/client half coordinated with LLP 0034; earlier 2026-07-01: §Reactivity recorded the initial DK-3 v1 replace/WS pin and trigger, and L3 retention status)
**Related:** LLP 0000, LLP 0001, LLP 0003, LLP 0004, LLP 0006, LLP 0007, LLP 0009, LLP 0010, LLP 0011, LLP 0013, LLP 0039, LLP 0043, LLP 0053, LLP 0059, LLP 0082, LLP 0083, LLP 0084, LLP 0085, LLP 0086, LLP 0090

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

**Ceremony budget (2026-07-23, LLP 0086 CC-8 row 12).** InstantDB ships the
weaker version of this contract and it sells: its partial sync is query-scoped
caching, Firebase-style — the client holds the union of mounted-query results,
with no declared synced subset, no capability classes, and no surfaced durable
client-cursor story ([LLP 0082](./0082-instantdb.research.md) §InstaQL — live
queries by default). Snapback's declared contract (the syncable-live subset,
sync policies, capability flags, durable cursors) buys authoritative resume,
honest offline claims, and authorization-aware retention — but that purchase
has a budget: the declarations must not cost the author more ceremony than the
added guarantee is worth. For an ordinary analyzable query the paved path must
stay at Instant's altitude — subscribe to a query and go, with the syncable-live
classification derived rather than hand-authored — and extra declarations are
demanded only where a stronger guarantee (retention, resume, bulk) is actually
being bought. Treat this as a standing constraint on the authoring surface,
re-evaluated whenever the subscription contract grows a new required input.

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

**Capture sufficiency applies to exits as well as entries.** A row id retained
in the current result is itself a dependency: if the changed image no longer
passes an ordinary filter or owner-visibility predicate, the matcher must wake
so the row can be removed. Owner fields therefore participate in update
membership detection exactly like filter fields. On the incremental lane, an
emitted add/remove updates both the query membership set and its corresponding
`Row` dependency (and an update advances the row dependency's version) in the
same guarded publication cut. A coarse, correct host-plan proof must remain
reachable when no finer serializable predicate exists: in particular, live
search records no predicate-less `Query` dependency that would force the
missing-plan fallback before the `SearchQuery` table check. An incomplete
fine-grained fact may cause fallback, but may not shadow a sound coarser proof.

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

> **Revisit fired (2026-07-02, after DK-4).** The named trigger — "warm-VM
> fan-out still exceeds the target at a real subscriber count" — is met. With
> the warm VM landed, whole-query re-query-per-affected-subscriber still costs
> ~1 680–1 970 µs/sub, a ceiling of **~5–6 subscribers per commit** within a
> 10 ms budget (a 100-watcher query is ~170–200 ms/commit — past budget for the
> read-heavy reference apps). M3 measured the op-log-delta alternative for the
> analyzable subset (classify each `ChangedRow` against the captured predicate
> with the live matcher, no VM, no re-query) at **~0.32–0.36 µs/sub**, a
> ~5 200× reduction and a ceiling of **~28 000+ subscribers/commit**
> ([LLP 0035](./0035-local-target-benchmarks.research.md) §M3) *(figures
> superseded 2026-07-21: the `37f1a2f` fixture corrections invalidated the
> pre-correction measurements and no full-scale rerun is recorded — see
> LLP 0035's superseded-fixtures note; the mechanism and decision stand, the
> numbers are history)*. Op-log deltas
> for the analyzable syncable-live subset are therefore the sanctioned next
> fan-out lever. The **delta shape** (this RFC) and the **server** emission are
> ours; the **wire kind and client apply** are shared surface with the LLP 0034
> provider-side kit — the implementation adds a `live_delta` alongside the
> honest `live_replace` fallback as an additive capability class (never a
> breaking change to the `replace` path), and must be sequenced with the LLP
> 0034 delivery/wire work rather than pinned unilaterally. The cacheable-HTTP
> read lane (LLP 0022) stays the deferred, larger option behind its own trigger
> (the hosted/multi-instance target); op-log deltas are the cheaper immediate
> win because the matcher already computes membership.
>
> **Landed (2026-07-02) — `live_delta` as an additive wire kind.** The op-log
> delta path is wired end to end for the analyzable subset, resolving this RFC's
> Open Question 1 (row diffs) and LLP 0034's OQ1:
>
> - **Server** (`notify_live_subscriptions`): a subscription is delta-eligible
>   iff its function is a `HostPlan` single-table `Query` (predicate directly
>   available), the commit has changed rows, and `compute_live_delta`
>   (`src/live_matcher.rs`) returns `Delta` (not `Replace`). Eligible
>   subscriptions get a `live_delta` payload built from the classified ops and
>   the commit version; the server maintains that subscription's membership by
>   applying the ops to its captured `Query` dependency's `rows` (and refreshing
>   the dependency's table-change version) — **no re-query**. Everything else —
>   Ibex queries, ordered/limited windows, un-analyzable predicates, the
>   empty-changes seed refresh — keeps the honest re-query + `live_replace`
>   path, unchanged. `live_delta` is strictly additive: `live_replace` remains
>   the fallback and the wire default, so no client that only understands
>   `live_replace` breaks (LLP 0012 read-path guardrail honoured).
> - **Correctness gate:** delta-applied state must be byte-identical to what a
>   re-query + replace would produce. Three guards enforce it: the conservative
>   eligibility (only the subset where `compute_live_delta` is exact); a
>   **debug-build convergence assertion** that re-runs the query on every emitted
>   delta and asserts the delta-maintained member set equals the fresh member set
>   (the L4 parity pattern — free in release, fails any drift in test); and a
>   multi-commit convergence test plus a client acceptance test.
> - **Load-bearing invariant (from this arc's adversarial review):** the matcher
>   predicate (`row_matches_query_filters`) MUST agree with the SQL `WHERE`
>   (`build_query_sql`) on every operator, or delta membership diverges from a
>   real query. The review caught a HIGH here — `NULL < x` read as true in the
>   matcher but SQL excludes NULL rows, so a NULL range-filtered field phantomed
>   into the result and drifted permanently. Fixed by giving the matcher SQL
>   three-valued logic (a NULL operand matches no comparison); regression-tested
>   with a `priority < 3` + NULL-priority row. Two more review findings fixed:
>   same-id opposing changes in one commit (collapse to the last change per id,
>   so an insert-then-delete nets to nothing) and the empty-changes `seed()`
>   refresh (only real commits take the delta path; seed keeps re-query +
>   replace).
> - **Wire shape:** `{ kind: "live_delta", subscription_id, function, version,
>   ops: [{ op: "add"|"update"|"remove", id, row? }] }`. `add`/`update` carry the
>   row (client upserts by `_id`); `remove` drops by id. Unordered by contract
>   (ordered queries fall back to `replace`), so row order is not load-bearing.
> - **Client** (`demos/_kit/client.mjs` `applyDurable`): a `live_delta` branch
>   applies the ops to `handle.rows` under the same subscription-id and
>   version-non-decreasing guards as `live_replace`.
>
> **Boundary hardened (2026-07-21).** LLP 0067 §F2a found the eligibility list
> above did not exclude **membership-gated (semi-join) queries** in code: an
> unordered, below-cap plan with `membership_filters` took the delta lane even
> though classification evaluates only ordinary filters and membership-table
> commits net zero ops (`NoChange` — freezing visibility transitions,
> including revocation, before the convergence assertion could run). The lane
> assignment LLP 0056 requires is now enforced fail-closed at both delta
> candidacy and inside `compute_live_delta`, and the debug convergence
> assertion also runs at `NoChange` settles. Semi-join delta eligibility
> remains future work behind a certified evaluator (LLP 0056).

> **Dated boundary note (2026-08-03, `single_table_v1@1` owner
> acceptance):** the accepted class binding consumes this section's DK-3
> additive-delivery ceiling. An `mset1` class member may bind
> `live_delta` only when the served function carries the exact schema-derived
> `documents(table)` result contract and no other shipped delta exclusion
> applies; the shipped runtime retains its honest `live_replace` fallback
> whenever the implicit cap is reached or another per-delivery proof cannot
> be made. `seq1`, ordered, and limited results bind `live_replace`. This is a
> boundary acknowledgment only: DK-3's fallback and wire bytes do not change,
> and semantic acceptance grants no implementation or capability claim.

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

**From inside the CRDT camp (2026-07-23, LLP 0086 CC-8 row 9).** The stance
above — semantic merge stays out of the sync core — now has a citable source
from the camp's most successful practitioner. Ditto, the CRDT vendor whose
mesh business actually works at scale, tells its own users in its
best-practices guidance to "accept every write using add-wins maps, then
derive the correct business state at read time" in application logic: the
CRDT layer guarantees *convergence*, not *correctness*
([LLP 0084](./0084-triplit-ditto.research.md) §Ditto — CRDTs where the mesh
is the product). That is LLP 0022 §1's "automatic semantic conflict
resolution is the wall" restated from inside the camp — even where CRDTs are
the product, business-rule resolution is read-time application logic, not
merge-layer behavior — which is exactly the division this RFC pins.

**The retreats, cited (2026-07-23, LLP 0086 CC-8 row 10).** The
server-authoritative foundation now rests on two dated, first-party retreats,
not only on convergence-by-survey. Jazz's founder published a three-post
retrospective on 2026-04-18 announcing a ground-up rewrite in his own words:
"Permissions moved away from cryptographic enforcement around the whole
system toward a trusted server applying richer policies at sync time," and
"Concurrent history moved away from CRDT replay and toward a more git-like
snapshot model" — after 2.5 years invested, landing on a shape convergent
with this RFC (declared relational schema, server-enforced policies, a
server-side live query graph pushing deltas, field-level LWW)
([LLP 0085](./0085-jazz.research.md) §The retreat — in their own words,
§Jazz v2 — the convergent replacement). ElectricSQL's 2024 pivot post
walking back generic CRDT sync is the earlier of the pair
([LLP 0022](./0022-electric-powersync-turso.research.md)). Two independent
funded teams abandoned "the data structure is the authority" in public,
dated, first-party writing, and the destination each retreated *to* is the
model proposed here — materially stronger evidence than arriving by thesis.

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
- **Durable state never becomes empty success by parse fallback.** Once bytes
  exist, corrupt JSON, a future format version, and an unsupported legacy
  version are typed invalid-state diagnostics. The implementation preserves
  the exact bytes in place and refuses ordinary reads and writes until an
  explicit migration or caller-authorized reset. A downgrade therefore cannot
  load a future queue as empty and overwrite the only copy.
- **Serialization covers independently constructed same-origin clients.** The
  monotonic outbox sequence and retained-query compare/write are transactions,
  not instance-local promise ordering. The localStorage implementation takes
  one exclusive Web Lock per storage key around every load/modify/save and
  records a durable generation on writes; context loss releases the platform
  lock for takeover. If Web Locks are unavailable, this adapter reports
  `SNAPBACK_CLIENT_STORE_LOCK_UNAVAILABLE` and fails closed rather than using a
  timeout lease or last-writer-wins storage. Native/SQLite implementations keep
  the existing single-connection mutex and transaction requirement.

> **Diagnostic-spelling reconciliation (2026-08-05):** the successor RQS
> store implemented under LLP 0166 authoritatively emits
> `SNAPBACK_RQS_STORE_LOCK_UNAVAILABLE`; that is the canonical spelling for
> that carrier and is not renamed. DK-9's generic
> `SNAPBACK_CLIENT_STORE_LOCK_UNAVAILABLE` envelope text is the semantic and
> documentation alias when this owner decision is applied to the successor;
> it remains the actual emitted code only for the predecessor
> `createLocalStorageSnapbackClientStore` adapter. This is not runtime
> dual-emission: each shipped adapter keeps its existing code, and consumers
> must match the code emitted by the carrier they use.

Revisit trigger: if parity-class offline execution (local handler replay)
ever requires query capabilities the interface cannot express without
SQL — reopen with that evidence rather than mandating SQLite pre-emptively.

> **Dated note (2026-08-02):** LLP 0155 (Accepted) commissions a semantic
> amendment to this decision as a **deliberate new author policy**, not as
> the revisit trigger firing — the trigger above is SQL-specific and
> LLP 0051 already answered it without SQL (parity-class execution arrives
> via the IR). LLP 0155's Move 2 keeps its opaque query-result-fragment
> baseline inside this decision's current envelope; what the commissioned
> amendment must admit before it ships is local plan evaluation over
> retained fragments (and, only if its projection-aware authority design
> is later admitted, cross-query canonical-row normalization). The
> amendment lands here, dated, alongside the Move 1/2 owning Spec; until
> it does, this decision's text governs unchanged.

> **Dated amendment (2026-08-03, with LLP 0166's acceptance):** the
> commissioned widening above lands. The client-store semantic contract
> is widened by deliberate new author policy (LLP 0155's commission; not
> the SQL revisit trigger, which LLP 0051 answered without SQL): in
> addition to the document/result cache plus outbox, the store may hold
> LLP 0157 materialization records — opaque authorized query-result
> fragments with completeness proofs — and, for plans carrying the
> LLP 0080 `result-transform-snapshot-v1` class, a conformance-proved
> evaluator may apply LLP 0166 §D7's closed `result-transform.v1`
> profile over a single materialization address's fragments. The
> contract remains the observable-state list, not SQL; nothing in the
> wire contract may require SQL semantics client-side; cross-query
> canonical-row normalization remains unadmitted (LLP 0157 §D7's gate).
> LLP 0166 owns the store-policy layer (registration, grace, budgets,
> the demand broker) over this contract; evaluation additionally gates
> on LLP 0166 §D7's conformance corpus and acceptance oracles.

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

The recommended v1 model from LLP 0011 is **server-directed fail-closed
reauthorization**, not universal precise per-row permission evaluation. As
narrowly refined below, ordinary matcher-observed writes re-query normally and
protect any potential shrink with a witnessed delivery obligation; declared
permission-backing and writeless authorization events advance the authorization
version. The client applies the resulting disposition before a fresh authorized
snapshot, and every non-live auth-scoped resume fresh-snapshots regardless of
epoch equality. This is stricter than Valet's stale-until-manual-resubscribe
behavior while avoiding a global resync for every permission-shaped row write.

### Authorization-invalidation amendment — 2026-07-13

The paragraph above records the 2026-07-02 direction, but its universal
mechanism is too coarse. The root ratification ledger authorizes this narrow
precedence rule: **LLP 0053 is Accepted and now controls this RFC's
authorization-invalidation mechanics.** ENG-24592's review blocker is closed;
items 6 and 8 still obey the dependency order and implementation gates in LLP
0039.

What remains ratified here: authorization is server-side; initial/live data is
filtered before delivery; stale or uncertain authority fails closed; a
non-live auth-scoped resume takes a fresh authorized snapshot; and permission
behavior is explainable. What is superseded on acceptance of 0053:

- not every permission-affecting row write advances an authorization epoch;
  matcher-observed ordinary writes use the normal re-query/delta path, while a
  result shrink is protected by a persistent composite-witness delivery
  obligation;
- permission-backing and enumerated writeless events advance the durable global
  authorization version and project query/room obligations;
- a generic lossy `resync_required` is not the security carrier: disposition,
  durable client fence/tombstone, revision-bound ACK, and authenticated
  retirement are;
- reconnect never treats equal epoch as sufficient proof for an auth-scoped
  live result; every non-live resume fresh-snapshots; and
- protected query inputs that cannot produce a matcher wake, activation event,
  or authority transition are denied by 0053's default-deny admission profile.

This preserves the false-negative bar of this RFC while avoiding a global
resync storm on ordinary writes.

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

**Relaunch-from-disk resume widening (2026-07-24, LLP 0090).**
[LLP 0090](./0090-resumable-query-snapshots.rfc.md) (Accepted) widens the
scoping above: resume is no longer confined to the online-reconnect case. A
relaunching client may render a persisted snapshot first and then resume from
a server-minted token (0090 Channel B), and the delta-resume consumer this
section's L3 note names as missing is exactly what 0090's D1.3 admission
ladder specifies. The widening does **not** discard either reason behind the
narrow rule; each is preserved by name:

- **The pending-mutation reason** (Valet's wrong-results hazard when replaying
  mutations against incompletely delta-synced state) is preserved by **0090's
  outbox rule** (0090 D3, co-owned with LLP 0043): a relaunching client with a
  non-empty mutation outbox does not send `resumeFromToken` at all — it takes
  the LLP 0043 path (full resync, then replay). "Delta-resume *with* pending
  offline replay" remains the explicit later milestone, exactly as this
  section demands.
- **The retention reason** (do not let resume pin the change journal) is
  preserved by **the journal floor**: the monotonic pruning watermark and
  `journal_resume_requires_resnapshot` stay authoritative — a resume from
  below the floor is answered with a fresh `LiveReplace` (0090's rung 3, the
  always-available fallback), so honoring relaunch-gap resumes never
  reintroduces Valet's unbounded-log trap. 0090's token refresh keeps
  persisted cursors near head, *shrinking* typical journal distance rather
  than stretching retention.

Scope also stays honest in the other dimension: 0090 v1 restricts token
resume and render-before-resume to `rqsEligible` (authority-independent +
closed-inputs) queries, so LLP 0053's mandatory fresh-snapshot-on-resume for
auth-scoped subscriptions — echoed in §Authorization-Aware Sync — is
untouched by the widening.

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

**Bookmarkable versions stay on the wire (2026-07-23, LLP 0086 CC-8 row 2).**
The committed-changeset version on every durable envelope is not just internal
ordering metadata — keep it a client-visible, comparable bookmark. The copyable
prior art is D1's Sessions API, which attaches lexically comparable bookmarks
to each query in a session and derives sequential consistency (monotonic
reads, read-your-writes) across regional read replicas by comparing them;
Durable Objects' 30-day point-in-time recovery likewise "was an accidental
feature" of bookmarks over log-plus-snapshot storage
([LLP 0083](./0083-cloudflare-do-d1-prior-art.research.md) §D1 — the managed
sibling, §The storage engine's design lessons). Snapback already has the
primitive — versions ride every snapshot and delta, and the client cursor is
durable — so the obligation is mostly negative: do not strip or make opaque
the version as the wire protocol evolves, because a future regional or
cacheable read lane (the DK-3 preserved option, LLP 0022) needs
client-comparable bookmarks to offer read-your-writes without a sticky
primary. The other half of this absorption — the output-gate vocabulary,
"synchronous inside, gated at the boundary," for per-target durability
claims — lands in [LLP 0007](./0007-storage-portability.spec.md), which owns
per-target durability language (LLP 0086 CC-8 row 2).

> **v1 wire protocol as shipped (LLP 0032 P4 close-out, 2026-07-02).** The
> local target now implements this section's contract as follows (design
> owned by [LLP 0034](./0034-contract-source-seam-provider-side.rfc.md) §2,
> landed as the D1/D2 arc):
>
> - **Addressed envelopes, multiplexed lanes.** Durable `live_replace` /
>   `live_delta` / `resync_required` envelopes carry a `subscription_id`; a
>   connection's outbox carries every lane's traffic and the client's per-connection lane
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
>   `resume_live` remains a same-connection operation. Since this close-out
>   was first written, DK-3's op-log-delta leg landed as the additive
>   `live_delta` wire kind (see the Landed 2026-07-02 note above): in-flight
>   updates can ride row deltas, but *resume across a reconnect* is still a
>   fresh snapshot — the version-based delta-resume consumer remains future
>   work (§Retention and Resume note).
> - **Resync sentinels.** A subscription-scoped `resync_required` re-snapshots
>   one handle; the connection-wide sentinel (no `subscription_id` — outbox
>   overflow) re-snapshots every handle on the connection. Ephemeral overlays
>   record `needsResync` and recovery is consumer-driven (the adapter
>   resubscribes on the change signal). `app.reset` drops every durable
>   subscription, so it enqueues a subscription-scoped `resync_required`
>   (reason `reset`) per dropped subscription — after the ephemeral runtime
>   reset, whose outbox wipe would otherwise discard the signal — plus a
>   global `disposed` receipt mirroring disconnect's markers; a connected
>   tab re-snapshots the post-reset state instead of freezing on pre-reset
>   data (ENG-23333).
> - **Positive-data loss on a dying socket is recovered by snapshot, not
>   requeue** (the S5.D4/S5.D5 class): a send failure tears the socket down,
>   reconnect fresh-snapshots, and per-subscription non-decreasing versions
>   filter staleness — "nothing silently lost" is pinned by
>   `regression-fake-live` and the kill-socket legs. The 2026-07-13 amendment is
>   narrow but load-bearing: an auth-scoped removal/potential shrink is negative
>   information and, once LLP 0053 is Accepted, remains a witnessed
>   level-triggered obligation until ACK or authenticated retirement. Fresh
>   reconnect still closes the dead-socket window; destructive drain alone is
>   no longer the authorization guarantee.
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
- authorization-invalidation fixtures from LLP 0053: an ordinary
  matcher-observed result shrink advances no coarse authz epoch but remains
  obligation-backed through ACK; a `permissionBacking`/enumerated event advances
  the authz version; uncertainty quarantines before read, proof deletes, and
  every non-live auth-scoped resume takes a fresh authorized snapshot;
- a diagnostic explaining one invalid or non-subscribable query.

## Dated constraints: additive wire, adapter-owned lifecycle (2026-07-23, LLP 0079 SC-3)

Two rules remain standing:

1. Wire evolution is additive. New delta or read lanes ship beside existing
   snapshot/replace and WebSocket behavior rather than breaking it.
2. App code never owns connection lifecycle. Schema, handlers, and generated
   callers see declarative live queries, not socket handles, reconnect hooks,
   or per-connection message handlers. Connection lifecycle and lane selection
   belong to the framework and adapter.

LLP 0078 F2a/F2e records the external evidence: exposing connection lifecycle
created a deprecation cycle, and protocol streamlining imposed a breaking
downstream tax. This section preserves the LLP 0079 SC-3 amendment alongside
the prior-art absorptions already recorded above.

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

## Dated follow-on: membership semi-joins (2026-07-16)

The analyzable sync subset may grow a membership semi-join lane keyed by the
stable declaration id. Fixed resource bindings capture the exact
principal/resource range. The follow-on must replace v1's conservative
table-level row-field capture with a proven finer dependency before claiming
incremental fan-out for that case. Role-gated live replacement does not imply
retained eligibility: retained role-gated queries remain refused in v1 until
the authorized-lease proof can bind the membership dependency and expiry
floor.

## Dated decision — post-commit fan-out coalescing (2026-08-08)

**Problem measured.** The Zerobugs control (LLP 0183 Stage 0.5 /
LLP 0191 §1) put a number on this RFC's "fan-out ceiling" unknown: at a
5.5M-row store with six streaming observers, one full re-evaluation frame
costs ~1.3 s per observer, and a 16-mutation burst produced settle latencies
of 111 ms–148 s (median ~74 s) because every backlogged commit re-ran every
observer's handler — evaluation × subscribers × queue-depth
(`snapback-control-hot.zb5.v10.json`;
`issues/20260808-live-query-reevaluation-cost-at-scale.md`).

**Decision.** The server may coalesce the *data* fan-out of backlogged
commits: when a commit's fan-out dispatch detects backlog (the previous
frame's measured evaluation cost exceeded a floor, currently 25 ms, and this
commit arrived within one evaluation-cost of that frame finishing — under
the fair-FIFO global writer lock that means the commit literally queued
behind the evaluation), the commit's changed rows are merged into one
pending frame instead of evaluated immediately. A later flush delivers the
pending frame once, at the latest committed version. This is rung 1 of
LLP 0191 §1's ladder — scheduling only: no query-shape change, no wire
change.

**Why semantics hold.** A coalesced flush is exactly one multi-write commit
frame, a shape the delivery machinery already handles:

- The affected-gate is a union: a subscription affected by any merged commit
  is included in the flush frame.
- The `live_delta` classifier collapses to the last change per row id before
  classifying against the subscription's current membership (the DK-3
  finding-B rule for a single commit that touches one row twice), so merged
  change lists classify to the same final ops a per-commit delivery sequence
  converges to. Whole-document deltas keep application idempotent.
- The `live_replace` lane re-queries current state, which is always the
  latest post-merge truth.
- Ordering stays monotonic: the flush frame carries a version ≥ every merged
  commit's version, and this section's contract has always been ordered
  changesets with idempotent application plus honest resnapshot — clients
  were never promised one frame per commit (the change-notification seam
  above already "coalesces and tolerates spurious wakeups").
- Elided intermediate frames are exactly the redundant re-resolutions the
  invalidation-repair evidence showed carry no information (676 → 12 frames
  for the same workload).

**Exclusions (never deferred).** Permission resyncs and authorization
invalidation events always run inline per commit (LLP 0053/0058 own those
obligations). Refresh signals (empty change list — seed, auth activation,
protected-record erasure) always run inline; a refresh frame re-queries and
replaces every subscription from current state, so it strictly supersedes
and discards any pending deferred frame (the delta lane requires non-empty
changes). A subscription resynced *while* a frame is pending is pinned to
the replace lane at flush — its captured membership is newer than the older
merged changes, so deltas computed against them could mistype an op; replace
is the honest superset.

**Delivery guarantee and starvation bounds.** Deferral is a scheduling
decision only; correctness never depends on the heuristics. Every deferral
signals a backstop flusher task (installed together with the coalescer by
the serving process — one does not exist without the other), whose requests
are sticky, so a deferred frame is flushed within a small delay (currently
10 ms) plus one lock queue even if no further commit arrives. Under a
sustained write stream the fair FIFO lock gives the flusher a turn each
drain cycle, so deliveries happen at least once per evaluation-cost
interval; explicit bounds (pending frame count, merged-row count, absolute
hold age) additionally force an inline flush on the next commit if the
backstop cannot run. Cheap frames (below the cost floor) never defer, so
per-commit delivery is fully preserved wherever re-evaluation is not the
bottleneck — including the delta fast path and every small store.
`SNAPBACK_LIVE_COALESCE_DISABLED=1` restores strict per-commit fan-out for
A/B measurement. Observation-honesty note (LLP 0167): all frames of one
coalesced flush share one commit-egress basis admitted at flush time, the
same "frames from one real commit share the basis" rule applied to the
merged frame.

**What this does not claim.** Rungs 2 and 3 of LLP 0191 §1 (shared
evaluation across same-query observers; incremental view maintenance for
admitted shapes) remain the D2/D4 owner-Spec work — coalescing bounds the
cost at one evaluation per observer per drain cycle, not below it.

## Dated decision — off-turn evaluation scheduler and convergence watermarks (2026-08-08)

LLP 0200 Phase 1 moved served-mode fan-out off the commit turn onto an
evaluation scheduler (settlement no longer implies delivery; the mutate
response carries the committed version) and added the **subscription-scoped
`current_as_of` convergence watermark**: matcher-skip and evaluated
no-change dispositions emit (or piggyback) a rows-free `current_as_of(V)`
envelope, latest-value-coalescible, never overtaking an undelivered
content frame, and counting as one delivery in `liveDelivery` accounting.
Optimistic-suppression release moves from settlement-gated to
watermark-gated per subscription (release-after-apply). The coalescing
decision above is otherwise unchanged; its inline-flush starvation rule is
superseded by scheduler-enforced bounds. Contracts, classifier, fence, and
gate: LLP 0200 §2. The strict per-commit inline path remains behind
`SNAPBACK_LIVE_SCHEDULER_DISABLED=1` (A/B and embedder fallback).

## Dated amendment — handler-visible fresh-client witnesses (2026-08-10)

LLP 0222 adds an action-only observation over this managed transport lane:
`ctx.realtime.hasFreshClient({ principalId })`. The local authority indexes
only session-authenticated client-originated activity, with a fixed 15-second
monotonic freshness budget. Its semantics version 2 counts the managed
WebSocket and authenticated poll lanes; anonymous and scoped-service carriers
do not create a principal witness.

The index is process-local, generation/grant fenced, bounded, and cleared on
restart/reset. Known socket close and grant/session retirement remove the
exact witness immediately. It is not a subscription, durable presence row,
read-set input, or delivery acknowledgment, and it never advances the durable
database version. A target may advertise it only when client traffic and
actions share one authority (including explicit single-authority routing); no
cross-instance union may be inferred from a process-local index.

## Status

Draft. The Valet retrospective ([LLP 0006](./0006-valet-retrospective.research.md))
is now folded in, so the replay, suppression, retention, conflict, and delivery
contracts above are grounded in a shipped system rather than proposed cold. This
RFC should be revised again after the first local prototype measures subscription
matching, retention, reconnect, and offline replay — especially the fan-out ceiling,
which remains the key unmeasured unknown. The 2026-07-13 authorization amendment
is ratified at the root and active now that LLP 0053 is Accepted. The local
target now implements the negotiated item-6 live-invalidation and item-8
retained-authorization surfaces under those gates. That implementation evidence
does not make this broad RFC Accepted, does not admit retained opaque JavaScript
queries, and does not claim hosted auth.

## LLP 0135 acceptance fold — 2026-08-02

Mutation replay preserves all-or-nothing presentation at changeset scope when
sequence allocation is involved. If any row's visible placement depends on an
authoritative sequence value, every row in that changeset is withheld from
the optimistic overlay until settlement. This is a withholding extension,
not a local sequence allocator, and it neither weakens server authority nor
claims the sequence projection is implemented.
