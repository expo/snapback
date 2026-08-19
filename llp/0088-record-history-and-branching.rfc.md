# LLP 0088: Record history and branching as product surface

**Type:** RFC
**Status:** Draft
**Systems:** Storage, Sync, API
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-23
**Related:** LLP 0004, LLP 0007, LLP 0008, LLP 0011, LLP 0053, LLP 0083, LLP 0085, LLP 0086

## Summary

Should Snapback expose per-record history and/or branch-and-merge as
application API, or keep change history internal to sync? This RFC
decomposes "history and branching" into seven separately costed
capabilities and recommends a narrow shape: **pursue read-only per-record
history** as an opt-in, bounded-retention read surface built entirely from
Snapback-owned changeset machinery ([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)),
and **defer or decline everything else** — retained losing versions,
branch creation, and merge policy. LLP 0007's portable storage contract
does not change for the recommended phase; the derivation is in
§Portability impact.

## Motivation — the demand evidence, precisely characterized

[LLP 0085](./0085-jazz.research.md) §Jazz v2 records the one demand signal
from the 2026-07 research batch that no existing Snapback surface absorbs
(LLP 0086 §CC-7): when Jazz retreated from its crypto-structural model and
rewrote from scratch, **deep per-record history — a per-row snapshot DAG
retaining losing versions — and first-class branch/merge survived the
rewrite because users demonstrably wanted them.** Jazz's own retrospective
lists "deep history" among what adopters actually valued, alongside
instant local reads and sync — "the experience," not the cryptography.

Characterized precisely, the evidence is:

- **First-party and costly**, which gives it weight: a funded team kept
  these features through a ground-up rewrite that discarded most of its
  original thesis.
- **Qualitative and unquantified**: one retrospective's claim about what
  adopters valued, from a product whose v2 launch drew near-zero public
  reception. There is no usage data, no revenue signal, and no second
  vendor corroborating record-level history as demanded product surface.
- **Paired with a named failure mode**: both Jazz generations are silent
  on history GC and retention cost. Unbounded history as the state
  representation, with no GC story, is a wall Jazz hit, not a feature to
  import (LLP 0085 §What to learn; LLP 0008's retention rule and the
  Valet change-log trap already guard against it).

So the honest posture is: real enough to evaluate seriously, not strong
enough to justify anything expensive. That calibration drives the
per-capability recommendations below.

## Ingredients inventory

Per LLP 0086 CC-7, the existing ingredients divide into two categories
that must not be conflated.

**Snapback-owned machinery (portable).**

- **Ordered changesets by commit version** — the product contract of
  LLP 0008 and the minimum changeset contract of
  [LLP 0007](./0007-storage-portability.spec.md): every committed
  mutation produces a versioned changeset; `_version` on every row is the
  global commit version that last changed it.
- **The bounded change journal** — `_snapback_changes` exists on both
  shipped targets (local Rust SQLite, `crates/snapback/src/storage.rs`; Cloudflare DO
  coordinator, `targets/cloudflare/src/coordinator.js`) with the same essential
  shape: `(version, table_name, row_id, op, row_json)` — a **per-row
  post-image per committed version**. This is already, mechanically, a
  record history store within its retention window.
- **The retention rule** — LLP 0008 §Retention and Resume: the journal is
  pruned by max versions *or* max age, with a monotonic replay-floor
  watermark and forced resnapshot below the floor; never "GC only after
  all consumers advance" (the Valet trap).
- **The op-log delta path (DK-3)** — `live_delta` already reads the
  journal to deliver deltas, so a journal read path with authorization
  admission (membership-gated plans excluded fail-closed) exists.

**Provider-owned capability (Cloudflare-only).**

- **DO PITR** — 30-day point-in-time recovery via lexically comparable
  bookmarks, an accidental property of SRS's log-plus-snapshot storage
  ([LLP 0083](./0083-cloudflare-do-d1-prior-art.research.md)). It is
  whole-database, fixed-window, recovery-grade, and exists on exactly one
  target.
- **D1 Sessions bookmarks** — consistency tokens for read-your-writes
  across replicas, not a history mechanism; LLP 0083's conclusion (keep
  bookmarkable versions on the wire) is already absorbed into LLP 0008.

The load-bearing observation: **everything a read-only history surface
needs is in the first category.** The second category is prior art for
wire-format discipline and an ops-level recovery capability — LLP 0083
records it as a property of Cloudflare's SRS to preserve, not a Snapback
API — and building product surface on it would be a Cloudflare-only
feature at the wrong granularity (whole database, not record).

## Per-capability analysis and recommendations

### 1. History reads — **pursue**

**What.** A read API returning a record's retained versions: ordered
`(version, op, post-image)` entries for one `(table, _id)`, newest-first,
cursor-paginated, with an explicit "horizon" marker when older history has
been pruned.

**What it would take.** A `(table_name, row_id, version)` index on the
journal (the `(table_name, version)` index exists for read-set
validation); a server-evaluated read surface (shape owned by LLP 0004's
API layer, semantics here); per-table opt-in in the schema
(`history: true` plus declared retention); authorization admission (§6);
and the retention answer (§5). No app-table schema change; both shipped
targets already hold the data.

**What it costs.** Small and bounded: one index, one read path reusing
DK-3's journal-read machinery, schema-surface and manifest work for the
opt-in. The real cost is the contract cost — once history is product
surface, its window is a promise apps see, which is exactly why it must
be opt-in and declared rather than an accident of resume tuning (§5).

**Recommendation: pursue**, as the only phase-1 capability. It is the
cheapest possible answer to the demand signal, portable by construction,
and reversible (an opt-in read surface can be shelved without a data
migration). Matching the evidence's weight: a small bet on a qualitative
signal.

### 2. Retained losing versions — **do not pursue** (as a distinct capability)

**What.** Jazz v2 retains LWW losers in its per-row snapshot DAG because
concurrent writers both commit and one loses at merge time.

**Analysis.** Snapback has no LWW losers to retain: the server serializes
commits, so every committed write is a winner in the version order, and
the journal already retains the *overwritten* post-images — which is what
"see the previous value" means here. The only Snapback analog of a losing
version is a **rejected optimistic mutation** (read-set validation or
replay failure, LLP 0008 §Mutation Replay). Retaining those is a
client-side diagnostics/UX concern ("your offline edit was rejected; here
is what it would have written"), not a server data-model capability.

**Cost if pursued anyway.** A parallel store of never-committed writes
with its own retention, authorization, and privacy questions (rejected
writes may contain data the writer was not entitled to commit).

**Recommendation: do not pursue** as server surface. Overwritten states
are subsumed by capability 1; rejected-mutation retention, if ever, is a
client diagnostics feature to docket separately.

### 3. Branch creation — **defer**

**What.** First-class branches of application data (drafts, environments,
what-if edits) with sync on each branch.

**What it would take.** Branch identity in the data model; branch-scoped
commit-version streams (breaking LLP 0007's single per-app gap-free
stream, DK-2); copy-on-write row storage in the portable layer; live
queries, subscriptions, resume, and the matcher becoming branch-aware;
per-branch authorization; branch lifecycle GC. Every load-bearing
invariant in LLP 0007 and LLP 0008 acquires a branch dimension.

**What it costs.** The largest item in this RFC by an order of magnitude,
against the weakest slice of the evidence (Jazz's branch/merge shipped in
an alpha nobody has adopted yet — there is a retrospective claim that
users valued *history*; branch demand is thinner still). The provider
shortcut (fork a DO from a PITR bookmark) is whole-app, Cloudflare-only,
and 30-day-bounded — usable someday for *preview environments* at the
ops/deploy layer, but not record branching and not portable, so it cannot
anchor product surface.

**Recommendation: defer.** Do not design it now; record the revisit
trigger: reopen if history reads ship and produce concrete user asks for
draft/branch workflows, or a second independent demand signal appears.

### 4. Merge policy — **do not pursue in the sync core**

**What.** Per-type merge strategies for reconciling branches (Jazz v2's
per-type merge; field-level LWW).

**Analysis.** Without capability 3 there is nothing to merge, so this
inherits the deferral. But the stance is worth ratifying independently:
LLP 0008 already cites Ditto's read-time-derivation guidance as the
from-inside-the-camp source for **keeping semantic merge out of the sync
core**. If branching ever lands, merge should be an application-level
operation — handler code reading two branches (and history, capability 1)
and committing ordinary serialized mutations — not a sync-core primitive
with per-type strategy tables.

**Recommendation: do not pursue** as core machinery, ever; any future
merge is app-level code over ordinary reads and writes.

### 5. GC and retention — **pursue** (precondition of capability 1)

Unbounded history with no GC story is the named Jazz failure mode; no
capability in this RFC ships without an explicit retention answer.

**The interaction with LLP 0008's rule.** The journal currently serves
resume/delta with retention tuned for reconnect windows and idle cost,
pruned by max versions or max age with a monotonic replay floor. History
as product surface wants *longer, per-table, app-declared* retention. The
governing constraints:

- **History retention must never pin the replay floor.** Resume retention
  stays governed by LLP 0008's rule and advances on its own schedule; a
  history opt-in that blocked journal pruning for resume purposes would
  recreate the Valet change-log trap with a new consumer.
- **History retention is bounded and declared**: per-table max versions
  per record **and** max age, both finite, in the schema next to the
  opt-in, surfaced in the manifest. **No unbounded option in v1.**
- **Horizon is a normal condition, not an error**: reads past the horizon
  return a marker, mirroring resume-outside-retention forcing resnapshot.

Whether retained history rows live in the journal under a second prune
predicate or are copied to a segregated store at prune time is an
implementation decision (§Open questions); the constraint that the two
retention clocks are independent is not.

**Recommendation: pursue** as a mandatory component of capability 1.

### 6. Authorization — **pursue** (precondition of capability 1), fail-closed per version

History must not become an authorization bypass: historical post-images
can contain values from when the row's visibility differed, and rows move
in and out of a reader's authorized result set.

**Rule.** History reads are server-evaluated under LLP 0011/0053's
machinery: the reader must be authorized for the record **now**, and the
read policy is additionally evaluated against **each historical
post-image**, dropping versions that fail — fail closed, matching the
`live_delta` precedent of excluding membership-gated plans fail-closed.
Dropped versions are elided, not disclosed. Cost: one policy evaluation
per returned version over an already-paginated read — acceptable.

**Recommendation: pursue** with the per-version fail-closed rule; a
cheaper current-row-only gate is rejected because it leaks
formerly-visible field values.

### 7. Target portability — **pursue via Snapback-owned machinery only**

The journal is part of the sync machinery every target must implement
(LLP 0007's minimum changeset contract; LLP 0008's retention/resume), and
both shipped targets already materialize it, so history reads inherit
portability, including across the Postgres graduation. Provider PITR
stays what LLP 0083 says it is: an SRS property preserved on the wire and
an ops-level recovery capability — never exposed as app API (wrong
granularity, wrong window, one provider).

**Recommendation: pursue** history reads on Snapback-owned machinery
exclusively; record provider PITR as ops/recovery, not product.

## Overall recommendation

Adopt the shape LLP 0086 open question 3 suggests — the analysis supports
it. **History-read-only first**: per-table opt-in, declared bounded
retention independent of the resume window, per-version fail-closed
authorization, built from the existing journal on all targets. Branching
deferred with a named revisit trigger; merge ratified as app-level if
ever; losing-version retention declined as server surface. If the
LLP 0085 evidence review (the LLP 0086 commitment gate) downgrades the
demand signal, the fallback the plan names — a dated amendment to
LLP 0008 acknowledging the evidence and declining — remains cheap,
because nothing here commits implementation.

## Portability impact — LLP 0007 does not change (derived)

The recommended phase adds no portable type, no id or `_version`
semantics change, no new index class on app tables, no transaction
behavior change, and no second commit-version stream. It **consumes** the
changeset/journal contract LLP 0007 §Scope already requires ("the minimum
transaction and changeset contract that sync and realtime consume") and
adds a read surface whose semantics live here and in LLP 0004/0008
territory, with a per-table declared retention in the schema manifest —
schema-surface work, not storage-contract work. Therefore: **no change to
LLP 0007** for phase 1. Conversely, branch creation *would* force LLP
0007 changes (branch-scoped version streams break DK-2's per-app gap-free
stream; copy-on-write identity) — an additional reason capability 3 is
deferred rather than partially started.

## Status

Draft. Authored 2026-07-23 under LLP 0086 CC-7, by author direction,
**ahead of** the LLP 0085 evidence review that the plan sets as CC-7's
commitment gate; the early start is recorded in LLP 0086's close-out
note. Acceptance of this RFC waits on that gate plus this document's own
review. No implementation is committed by this document.

## Open questions

- **Storage layout for history retention**: second prune predicate on
  `_snapback_changes` vs copy-out to a segregated history store at prune
  time. Cost/complexity trade to be measured, not asserted; the
  independent-clocks constraint (§5) holds either way.
- **Concrete retention defaults** for history-enabled tables (max
  versions per record, max age) — needs reference-app data, like LLP 0008's
  own open retention-horizon question.
- **API shape and naming** (`db.history(...)` vs a system-table idiom)
  — owned by LLP 0004's surface conventions; needs a guide-page design
  pass before implementation.
- **Whether history reads participate in live queries** (subscribe to a
  record's history) or ship read-only-on-demand first. On-demand-only is
  the assumed v1; live history would touch the matcher and should be
  costed separately if asked for.
- **The revisit trigger for branching**: what counts as the "second
  independent demand signal" — worth making concrete when history reads
  ship.
