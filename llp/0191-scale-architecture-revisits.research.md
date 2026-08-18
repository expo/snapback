# LLP 0191: Architectural revisits the Zerobugs control earned

**Type:** Research
**Status:** Review
**Systems:** Live queries, Local sync, Storage, Auth, Schema, Relational queries, Client SDK, Effects, Deployment, Performance
**Author:** Claude Fable 5 (analysis and synthesis; commissioned by Charlie Cheever, 2026-08-08)
**Date:** 2026-08-08
**Revised:** 2026-08-08 (§1 dated notes: a production rung-1 coalescing
lane landed the same day via the ticket sweep under LLP 0008's dated
decision, behind `SNAPBACK_LIVE_COALESCE_DISABLED` as the A/B control arm,
with synthetic reduced-scale evidence; later the same day the OQ4
measurement spike ran all predeclared axes at 5.5M rows — hypothesis not
confirmed, settlement isolation ranked as the dominant lever, 521-vs-12
resolved — unblocking the D2/D4 owner-Specs; rungs 2–5 remain open).
Same day, earlier (rounds 1–2 super-refine revisions, design-partner
lens. Round 1: ladder revised to five rungs; settlement isolation added;
§§3–6 decisions restructured on the trust-domain and ownership boundaries
the two review families converged on; open questions carry the
cross-family recommendations and remaining fault lines. Round 2: both
families caught the round-1 reconciliation of the delivery counts
misreading the open-loop receipt — the two measurements are now stated
exactly as the artifacts record them and their discrepancy declared an
open question the OQ4 spike resolves; the current-architecture paragraph
now describes the captured-dependency matcher `crates/snapback/src/live_matcher.rs`
actually implements, and rung 2 is extend-and-measure, not build.
Post-loop repair after round 3 closed the budget: the 8-trigger/
8-non-trigger inventory partition replaces the false "all 16 touch the
list" claim, the `live_delta` lane scopes the no-IVM categorical, and
four review minors are applied — this final repair is **unreviewed**;
the round-3 verdicts bind to commit `9f30acdb1`)
**Related:** LLP 0008, LLP 0043, LLP 0053, LLP 0057, LLP 0107, LLP 0108, LLP 0130, LLP 0146, LLP 0155, LLP 0157, LLP 0158, LLP 0166, LLP 0182, LLP 0183, LLP 0189, LLP 0190

## Summary

The Zerobugs control (LLP 0183 Stage 0.5) is the first application big
enough — 5.5M rows, six concurrent live windows, sixteen mutators, a real
browser — to show where Snapback's architecture bends. This document takes
the evidence that program produced (immutable receipts, the diary's
attempt ladders, the stream-diagnosis traces, and eleven recorded guide
gaps) and explores six candidate architectural revisits in enough depth to
commission design work. It proposes no single design and changes no
contract; each section ends in the decision the evidence supports and an
owner the LLP 0183 workstream structure provides — or, where it provides
none (§6), names choosing one as part of the ruling. The through-line:
most of what looked like many small frictions is a small number of deep
ones — evaluation-per-subscriber, server-round-trip-per-read, identity as
app-space plumbing, and a durable store that is secretly several files.

## Evidence base

Claims below cite two artifact classes: immutable receipts and tickets,
and local diagnosis traces (labeled as such where used):

- Receipts under `demos/zerobugs/evidence/` — especially
  `snapback-control-large.zb5.v3.json` (reads at 5.5M rows),
  `snapback-control-hot.zb5.v9/.v10.json` (write fan-out, stream
  liveness, the typed-refusal transition), and the preserved FAIL ladders.
- The stream-diagnosis traces
  (`demos/zerobugs/fixtures-local/hot-diag-baseline/diag-run1.jsonl` and
  `diag-run2.jsonl`, summarized in
  `issues/closed/20260807-hot-cycle-live-stream-stale-at-settle.md`):
  1,913 and 439 sequenced records covering connection transitions,
  per-frame deliveries, and authorization errors before and after the
  invalidation repair. These traces are local diagnostics, not immutable
  receipts; where a number below comes from a trace rather than a
  receipt, it is labeled as such.
- Diary 0061's dated entries and the control PLAN's workaround register
  (15 counted rows) and "Guide gaps encountered" section (11 dated
  entries).
- The 2026-08-08 ticket sweep (`issues/20260808-*`) and the two runtime
  repairs this program landed (version-scan sentinel indexes; invalidation
  revision supersession).

## 1. The live-query evaluation model

**Current architecture.** A live query is an opaque JavaScript handler.
When a mutation commits, subscriptions are matched against their
*captured* read dependencies — the realtime matcher
(`crates/snapback/src/live_matcher.rs`, LLP 0020 Phase 4) reuses captured row/predicate/
window-boundary read sets to skip provably disjoint changes, with a
conservative replace fallback where proof is unavailable. A subscription
that matches (or falls back) is then re-evaluated by re-running its
handler from scratch, per subscriber, and the result is delivered as a
fresh frame. On this opaque-handler path the matcher can only *skip*:
no sharing between subscribers, no incremental maintenance. (Analyzable
single-table `HostPlan` queries already ride a tightly scoped
`live_delta` fast path — LLP 0008 DK-3, same file — precedent that
rung 4 below extends an admitted-shapes lane the runtime already has
rather than building one; the lane never applies to the opaque handlers
this evidence measures.)

**What the evidence says.** Numbers from two receipts and two local
traces:

- Re-running the Zerobugs list engine once over the 5.5M-row store costs
  ~1.3 s (`zb5-large.v3`, `raw-list-ready-timing` — and that is the
  *bounded, read-model-backed* implementation, not a naive scan).
- With six 1,000-row streaming observers open, the 48 sampled mutation
  settle latencies in `zb5-hot.v10` span 111 ms–148 s, **median 72.8 s**
  (cited as ~74 s by the ticket and LLP 0190). Each cycle's sixteen
  mutations, dispatched open-loop at fixed 25 ms offsets (0–375 ms),
  owe *up to* ~96 full re-evaluations — a theoretical ceiling, not a
  plausible count: the receipt's own inventory partition
  (`eight-trigger-eight-nontrigger-inventory-partition`, PASS) names
  eight operations that write only tables the list query never reads,
  so the expected wake fraction is roughly half, and no artifact
  records actual match/skip/fallback decisions or evaluation counts —
  exactly what the OQ4 spike's counters add. Notably, non-trigger
  mutations settled slowly too, which independently motivates the
  settlement-isolation question below. Whatever the split, the queue
  drains at evaluation speed.
- Two delivery measurements from two instruments whose counts do not
  reconcile — stated here exactly as the artifacts record them, with
  the reconciliation left open. Both instruments dispatch the same
  arrival discipline: open-loop bursts of 16 mutations at fixed 25 ms
  offsets, nothing awaited (`open-loop-arrivals-use-fixed-nonadaptive-
  offsets` PASS in the receipt; `ARRIVAL_INTERVAL_MS = 25` in
  `diag-hot-stream.mts`). The *diagnosis instrument* (local traces, six
  persistent observers, 48 dispatches per run): pre-fix, 676 `update`
  frames plus 676 `authorization_boundary` records (both counts
  byte-verified in `diag-run1.jsonl`); post-fix, **12** update frames
  plus 12 `authorization_boundary` records for the same 48 dispatches
  (`diag-run2.jsonl`). The *acceptance
  receipt* (`zb5-hot.v10`, immutable; fresh six-observer set each
  cycle, 3 × 16 mutations): **521 deliveries** in its custody
  accounting, 23–33 per observer per cycle. The instruments differ in
  observer lifecycle and in what they count as a frame, and no artifact
  records evaluation counts — so neither "delivery is already
  coalesced" nor "each mutation costs a full evaluation per subscriber"
  can be read off these numbers. What is established: the pre-fix
  frames were overwhelmingly redundant re-resolutions of content the
  client already had, the supersession repair eliminates delivery of
  stale resolutions (the closed ticket's repair claim), and the
  521-vs-12 discrepancy is an open measurement question the OQ4 spike's
  predeclared counters must resolve before any Spec leans on either
  number.

Correctness held throughout: every observer converged to oracle-exact
rows. The ceiling is purely architectural — evaluation × subscribers ×
mutations, with no sharing and no increments.

**The revisit is a ladder, not a bet.** The options are ordered by cost,
and the cheap rungs may buy most of the win. (Both round-1 review
families revised the entering three-rung version: precision was a missing
rung, and cross-principal sharing was overstated as separable.)

1. **Coalescing, cancellation, and fair scheduling.** N invalidations
   pending against one subscription should produce one re-evaluation at
   drain time, not N. The hot burst should cost each observer roughly one
   ~1.3 s re-run — six serialized evaluations are an ~8 s floor before
   delivery and contention, so *single-digit seconds is the hypothesis
   the OQ4 spike tests, not an estimate*. Two contracts come with the
   rung, both D4-owned: conflation is a semantic change (clients may no
   longer observe intermediate states — a latest-value delivery contract,
   not an optimization), and fairness/starvation under sustained writes
   must be explicit. The supersession repair shows stale *resolutions*
   can be superseded; whether delivery already coalesces under load is
   exactly what the unreconciled frame counts above leave open —
   coalescing moves the latest-wins idea before evaluation either way.
2. **Affected-read precision.** The matcher already skips provably
   disjoint changes from captured row/predicate/window-boundary read
   sets, with a conservative replace fallback — so this rung is
   *extend and measure*, not build: widen the captured vocabulary to
   joins, ranges, windows, and authority partitions so the conservative
   fallback fires rarely, and record match/skip/fallback decisions so
   its coverage is measurable (today no artifact records them). The
   field's endpoint — read-set/index-range intersection that lets most
   mutations wake *no* subscriptions — is the same lever. The hot
   profile can already measure this rung: its inventory deliberately
   mixes relevant, disjoint, and principal-local writes (8 trigger /
   8 non-trigger in the receipt's partition check), so the spike should
   predeclare expected relevance per mutation × observer and compare it
   with the matcher counters. The general workload — many subscriptions
   over different data, where sharing collapses nothing — is where
   precision matters most.
3. **Authority-partitioned shared evaluation.** The six hot observers ran
   the same query text under different principals — but principal and
   policy are *ambient query inputs*, and the observers' result
   memberships differ. An opaque handler that partitions before counting
   cannot safely be evaluated under a super-principal and projected
   afterward. So the sound rung is same-authority-partition memoization
   first; cross-principal sharing becomes credible only after D2 declares
   an authority-independent base with separately evaluated
   protected/private overlays. The trust question — evaluating under
   whose authority? — is the same question LLP 0190 §4 poses for
   projected facts; the two designs should share an answer, not invent
   two.
4. **Incremental view maintenance (the admitted-shapes answer).** True deltas
   require declared query shapes; opaque handlers cannot be incrementally
   maintained, only re-run. This is the expensive rung, and the control's
   experience argues it should be scoped to *admitted* shapes (the D2
   graph profile) rather than attempted generically. Re-run plus
   coalescing, precision, and caching is a legitimate stable resting
   point, not merely a waypoint (external prior art, non-load-bearing:
   Convex reportedly stopped exactly there).
5. **Delta-fed local replicas.** A maintained fact plus an ordered delta
   stream is a local replica — the rung where this ladder converges with
   §2/D3 (see there).

**Settlement isolation is part of this revisit.** The 74 s medians time
`client.mutate()` settlement itself — the architectural question is not
only "evaluate subscriptions faster" but "why does subscriber work hold
up mutation settlement at all." The D4 contract must separate and
independently measure commit acknowledgement, mutation settlement, and
observer convergence, and bound the write-path latency and memory a slow
or disconnected subscriber can consume. The same contract owns the
earned lifecycle question the quarantine posture leaves open: what, if
anything, re-establishes liveness after a quarantine, given a quarantined
stream by design never self-recovers without an authority transition.

**Decision this evidence supports.** Commission the D2/D4 owner-Specs
with rungs 1–3 as required design content and rung 4 as the
admitted-shape question it already is; rung 5 is *referenced* D3 scope
reached through the shared D2–D3 interface, not D2/D4 required content.
Commission separably: rung 1 plus settlement isolation is
scheduling/lifecycle work that should not queue behind D2's heavier
graph-profile Spec (D2 owns declared dependencies, plan identity,
affected-query matching, and deltas; D3 owns retained/local
consumption) — noting that 0183 charters D4 as the headless
windowed-query controller, so the commissioning must either extend
D4's charter to server-side evaluation scheduling explicitly or name
the runtime owner. Measure each rung with the existing instrument (`diag-hot-stream.mts` iterates in minutes against
the persistent baseline) before committing to the next. Ticket:
`issues/20260808-live-query-reevaluation-cost-at-scale.md`.

**Dated note (2026-08-08):** the coalescing half of rung 1 was built the
same day via the ticket sweep, as ticket work ahead of the OQ4 ruling:
backlog-triggered fan-out coalescing with a backstop flusher and explicit
starvation bounds landed under LLP 0008 §"Dated decision — post-commit
fan-out coalescing (2026-08-08)", which records the latest-value delivery
semantics (subject to the D4-lineage owner-Spec absorbing or refining that
contract), behind `SNAPBACK_LIVE_COALESCE_DISABLED=1` as the strict
per-commit control arm. Synthetic reduced-scale evidence (30k rows, six
ordered 1,000-row windows, 16-mutation open-loop burst — the replace-lane
shape at reduced scale): 96 → 6 delivered frames, 15.6× wall, in
`crates/snapback/tests/live_coalesce_v0.rs`. This is a landing with a kill-switch, not the
OQ4 measurement spike and not the de facto D4 design: the spike's
predeclared axes (frame-kind accounting resolving the 521-vs-12
discrepancy, matcher and evaluation counters, commit-ack vs settlement vs
convergence timed separately, the 5.5M-row A/B arms) remain to be run, and
rungs 2–5, settlement isolation, and evaluation cancellation remain open
with the D2/D4 owner-Specs. The ticket stays open as the workstream
anchor.

**Dated note (2026-08-08, OQ4 spike results):** the commissioned spike ran
the same day — twelve A/B arms over the predeclared axes at 5.5M rows
(artifacts: branch `spike/oq4-coalescing-measurement`; full disposition:
`issues/closed/20260808-oq4-coalescing-measurement-spike.md`). The
single-digit-seconds hypothesis for rung 1 was **not confirmed** (burst
trigger p50 23.6 s coalescing-on vs 33.2 s off; N=1 per arm, shape
evidence): the frame-kind counters show ~90% of delivered evaluation
frames at this store shape ride the authorization lane, which the landed
coalescer excludes by design, so the synthetic 15.6× replace-lane result
does not transfer. The decomposition answers this section's
settlement-isolation question empirically: with zero observers the
48-mutation inventory settles at ~0.2 s; with observers, commits are
durable early but mutate responses wait up to ~10.7 s behind subscriber
evaluation — including refused, commit-free mutations — and sustained
4/s writes are throughput-bound at ≈0.85 settles/s with or without
coalescing. Matcher counters recorded 0 conservative fallbacks with skips
matching the trigger partition (rung 2 is not the binding constraint on
this inventory; the two predeclared-relevance disagreements were
predeclaration errors), and six same-partition observers cost the same as
six mixed (rung 3 memoization has ~6× measured headroom). The 521-vs-12
delivery discrepancy is resolved as a unit-and-lifecycle accounting
difference, not evidence of delivery coalescing. The D2/D4 owner-Specs
(commissioned, now unblocked) should rank settlement isolation first in
rung 1's remainder and either include the authorization lane in
coalescing's scope or justify its exclusion.

## 2. Local facts as a read path (retention is not just offline)

**Current architecture.** Every read is a server evaluation. The client
retains nothing it may answer from.

**What the evidence says.** The control's ~43-gap cluster (ZB2/ZB3/ZB4)
traces to one absence — no retention carrier for opaque queries — and
Stage 0.5's two biggest live findings both point at the same remedy from
different directions. The re-evaluation ceiling (§1) makes server-served
reads contend with write fan-out; the stream-quarantine posture (the
client's correct fail-closed behavior, proven twice in the diagnosis
trace) currently degrades to *nothing renderable* because there are no
retained facts to fall back to. Retention converts both: reads that
don't queue behind evaluation, and lapses that degrade to honest
`retained` rendering instead of spinners.

**Depth already exists.** LLP 0190 (drafted 2026-08-07) carries the
candidate mechanisms, trust consequences, and staged plan; its Revised
header now cites the 74 s number as motivating evidence. This section
therefore only records the architectural framing the receipts add: D3
should be evaluated not as "offline support" but as **the read-path
scaling strategy**, with §1's rungs 4–5 as its convergent twin. The two
programs meet at one design point — admitted shapes with maintainable
deltas — and should be sequenced to meet there deliberately.

**But the two consumers pull LLP 0190's OQ1 in different directions**,
and the round-1 reviews converged on naming this explicitly. The
quarantine-degradation consumer is served by exact-result retention
(0190's Candidate D) — cheap, honest, and a respectable stable resting
point (external prior art, non-load-bearing: Firestore's offline cache
has this shape) — but exact retention removes no
server evaluation and does nothing for the 74 s write path. The
scaling consumer requires the materially larger design: maintained facts
(Candidate A / D2 graph facts), server-maintained ordered deltas, and a
local evaluator — and a usable replica additionally needs an initial
consistent cut, cursor/version identity, gap detection and resnapshot,
tombstones, backpressure, authority-partition transitions, and
predecessor retirement. The likely honest ruling is a portfolio, which
0190 already permits: Candidate D now as the tactical resilience
carrier (only if it reuses the eventual identity/authority envelope),
Candidate A as the strategic end-state.

**Decision this evidence supports.** Rule LLP 0190's OQ1 as the
two-outcome split above, with §1's ladder in view; treat "retained fact +
delta stream = replica" as the shared end-state hypothesis both D2 and
D3 test — motivated by the hot result, not claimed as repaired by exact
retention.

## 3. App identity as a first-class schema concept

**Current architecture.** Snapback owns physical `_id`s and session
principals. Everything else identity-shaped — an app's own public ids,
serial/numeric identities, the principal-to-app-user mapping, idempotency
keys for effects — is application plumbing.

**What the evidence says.** This is the largest *cluster* in the recorded
friction, and its parts arrived independently:

- `W-IDENTITY`: binding server principals to the app's frozen user ids
  required an acceptance-only bootstrap with five hand-built guards,
  because handler auth exposes the principal but no verified claim about
  it (guide gap 2026-08-05; ticket
  `20260808-guide-gap-principal-to-app-identity-binding.md`).
- `W-MUTATION-IR`: both mutations the inventory classed as current-IR
  stayed on the JS tier for one reason — generated `Get` addresses
  physical `_id` while the app's contract addresses source ids, and
  `AuthUserId` is the principal, not its app-owned binding (guide gap
  2026-08-06).
- `W-SHORTID`: no numeric identity/default columns, so the app emulates a
  PostgreSQL sequence with a bounded scan that **refuses issue creation
  outright at the million-row store** (typed refusal
  `ZBUGS_SHORT_ID_BOUNDARY`, receipts v9/v10; ticket
  `20260808-numeric-identity-default-columns.md`).
- Settlement identity: two independent lanes needed the protocol's
  `clientMutationId` inside the handler for effect idempotency and could
  not have it; the workaround is composition-injected identity arguments
  on eight generated calls (flagged twice in "Guide gaps"; ticket
  `20260808-handler-settlement-identity-surface.md`).

**The revisit.** Treat "the application arrives with its own identity
scheme" as a schema-level fact rather than four unrelated gaps: declared
**source keys** (unique app-public ids the generated tier can address, so
current-IR verbs work on ported contracts), **identity columns**
(server-owned monotonic numerics with *sequence* semantics — gaps
allowed, rollback burns values; a gapless transactional counter would
serialize all writes to the table and recreate a scale cliff at exactly
the store size that exposed `W-SHORTID` — and normally a secondary
display/permalink identity, with client-generable ids remaining the safer
canonical key for local-first creation), a **verified principal-claim
surface** (what `session mint` verified, visible to a binding handler —
bound to immutable provider `(issuer, subject)` rather than email, which
is a mutable attribute — or a privileged provisioning channel; which
claims are exposed is a deliberate trust-boundary widening the design
must treat as a first-class alternative set), and a **read-only
settlement identity** on the handler context (server-bound and scoped to
app, instance, and operation — a raw client-chosen mutation id must not
become an unnamespaced global effect key). Individually each is modest;
together they remove three workaround-register rows and the largest
porting friction the diaries record.

The parts share a vocabulary but not a trust domain: schema identity,
authentication binding, and protocol/settlement identity have different
owners, invariants, and failure modes. The 0183 review round flagged
identity as an unowned cross-cutting contract needed by D2 authorization,
D3 partitions, and D5 guards — evidence it needs **one coordinating
document and one acceptance corpus**; whether that document also holds
implementation authority, or defines the namespace/provenance/conversion
vocabulary and distributes implementation to the schema, auth/D7, and
D5/effects owners as amendments, is the genuine open ruling (the round-1
families split exactly here — see OQ2).

**Decision this evidence supports.** Commission one coordinating identity
document (joint D3/D5/D7 dependency) covering the four surfaces above,
with the Zerobugs port as its single acceptance corpus; OQ2 rules how
much implementation authority it centralizes.

## 4. The durable-store envelope

**Current architecture.** The durable state of a running app is a SQLite
database file — plus, in practice, its WAL sidecar (which SIGTERM strands
at multi-GiB scale: `issues/20260807-server-sigterm-strands-large-sqlite-wal.md`),
plus a db-path-prefixed auth keyring without which a byte-identical copy
of the database **refuses to boot** (probed 2026-08-07; ticket
`20260808-sessions-store-copy-needs-auth-keyring-sibling.md`), plus
telemetry siblings. No interface names this set or copies it atomically.

**What the evidence says.** The zb5-hot ladder burned two of its four
receipted early attempts (the WAL-strand and auth-keyring discoveries,
v1–v4) finding the envelope's members one at a time, and
only because no lane had ever cloned a sessions store before. Every
operation that treats the db file as the store — backup, copy, migration,
and the instance-forking direction LLP 0158 has already made a product
bet — inherits the same trap silently.

**The revisit.** Define the envelope as a contract — but the contract is
an **operation-specific custody manifest**, not one "copy all members"
verb, because the operations have opposite dispositions for the same
member. Same-instance backup/restore must *carry* the auth-keyring
sibling (the probed boot refusal); a derived fork must *not* — LLP
0158's accepted custody ruling makes scrub-and-mint load-bearing, and
copying keyrings into a fork would regress that trust model. The known
form, which 0158's per-sidecar disposition table
(`copy`/`scrub`/`rotate`/`share`/`refuse`) already is locally: at least
`snapshot/backup` (consistent data cut plus exactly the authority
material needed to restore the *same* instance), `restore` (verified
input, activation barrier, predecessor fencing), `clone-for-test`
(explicit authority policy, never inferred from copied filenames),
`fork` (0158's scrub/rotate/mint semantics), and `export` (data without
operational secrets). The consistent cut should come from the SQLite
backup API or an equivalent primitive, not from relying on every
graceful shutdown producing a single-file checkpoint — the
shutdown-checkpoint repair stays worth landing as a bounded runtime fix,
but it is not the foundation of the contract. The boot diagnostic should
also name a missing sibling explicitly — the current
`SNAPBACK_AUTH_PROVIDER_UNAVAILABLE` cost a receipted attempt to decode.

**Decision this evidence supports.** Commission the envelope as a
state-capture/custody Spec built on LLP 0158's custody-manifest model,
with 0158 keeping the fork profile; whether it lives as a companion Spec
in the 0158 lineage or a standalone Spec with 0158 as consumer and
conformance witness is the placement ruling (OQ3 — the round-1 families
split there while agreeing on everything structural). Either way, do not
patch the two tickets independently.

## 5. Relational-surface completeness

**Current architecture.** Stored fields reject literal unions; route
groups reject nested route params and null/union literal arguments; the
relational surface composes bounded two-source shapes.

**What the evidence says.** These are the quiet multipliers behind the
workaround register: `W-ENUM` (every writer re-implements closed domains
for authorization-relevant fields), `W-QGROUP`/`W-MANUALSET` (the
22-relation graph shapes live in ~1,400 lines of hand-written typed
merge), and the §3 identity columns. Two causes stack there: nested
route arguments refuse (`ROUTES_ARGS_INVALID` blocked the generated
bundle), *and* the relational capability itself is bounded to two-source
shapes while the application composes up to 22 relations — fixing the
argument lowering alone removes a real compiler blockage but does not by
itself retire `W-MANUALSET`. None is individually architectural; jointly
they are the difference between "porting a relational app" and
"rewriting one against a different data model" — the exact authoring
delta LLP 0183's ZB6 gate measures. Tickets:
`20260808-stored-literal-union-enums.md`,
`20260808-route-group-argument-lowering.md`.

**Decision this evidence supports.** Split by kind rather than folding
whole: the schema-fidelity items (stored literal-union enums, defaults
and identity columns, alternate keys) land through the schema surface's
owner as early, independently testable improvements — naming that owner
explicitly at commissioning, since the control's register routes
`W-ENUM` to D5 while the graph reading routes it to D2; structured
route-argument lowering lands as a compiler-surface prerequisite; and
D2's owner-Spec keeps what is actually architectural — the finite graph
IR, authorization at every node, affected-query dependencies,
completeness vocabulary, and server/local evaluator agreement — with
the control's query corpus as the acceptance instrument. No separate
program.

## 6. Bulk data flows

**Current architecture.** All writes are bounded interactive mutations
(LLP 0108/0109 ceilings). The control moved 5,549,113 rows through 6,176
hand-batched ≤900-row calls behind an acceptance-only seam, with a
client-side resumable ledger, in ~66 minutes — and hit the 1 MiB result
ceiling when the seam echoed large batches
(`issues/20260807-result-contract-violation-names-no-bound.md` records
the diagnosis cost).

**What the evidence says.** The ceilings did their job — every bound the
program hit was a designed bound refusing an unbounded pattern. But the
workaround (`W-FIXTURE`) is now the *third* bespoke bulk loader in the
repo's demo lineage, each rediscovering the same shape: deterministic
batches, an exactly-once ledger, digest verification, resumability. That
is a protocol, not an app feature.

**The revisit.** A first-class resumable bulk-transfer protocol, in the
field's converged shape: an authenticated import session bound to app,
schema, source manifest, and limits; staged chunks with ordinal, digest,
and idempotency identity; small acknowledgements rather than echoed
rows; bounded validation with resumable progress; whole-manifest
verification with an atomic completion/activation sentinel;
abandoned-session cleanup; and optionally an initial-snapshot plus
change-watermark catch-up for online migration. "Exactly once" is the
externally observable outcome, not necessarily one internal
transaction. Its design inputs are all measured: batch-size vs the
1 MiB echo ceiling, per-batch cost flatness (the sentinel-index
repair's receipt), and ledger semantics proven over 6,176 batches ×
five runs. Import is what the evidence directly earns; export is a
sensible companion that needs its own consistency and secret-redaction
justification, and the seam against §4 must stay declared — §4 is the
*physical* envelope (byte-exact custody), this is the *logical* one
(portable data; `issues/20260730-auth-logical-export-import.md` already
sits on this side).

**Decision this evidence supports.** Commission the protocol as its own
Spec on the storage/import-export side — an owner the current 0183
D-table does not provide, so naming one is part of the ruling — with the
control's loader as reference implementation and D8 plus LLP 0160's
migration program as acceptance consumers: D8 qualifies targets against
the protocol rather than owning its semantics. Do not build a fourth
bespoke loader.

## Author rulings — 2026-08-08 (Charlie Cheever)

All five open questions were ruled on 2026-08-08, in each case on the
cross-family convergent recommendation:

1. **OQ1 — ruled yes.** D2 and D4 owner-Specs are commissioned with the
   five-rung ladder as required content (rungs 1–4; rung 5 referenced D3
   scope), commissioned separably; the D4-charter-extension question
   (server-side evaluation scheduling vs a named runtime owner) is
   resolved at commissioning. Drafting waits for spike data. Ticket:
   `issues/20260808-d2-d4-owner-specs-commission.md`.
2. **OQ2 — ruled distributed.** One coordinating identity-architecture
   Decision (namespaces, provenance, uniqueness, conversion rules) with
   implementation distributed to the schema, auth/D7, and D5/effects
   owners as amendments; one Zerobugs acceptance corpus; LLP 0129 keeps
   mutation-IR admission. Ticket:
   `issues/20260808-identity-architecture-decision.md`.
3. **OQ3 — ruled standalone.** A state-capture/custody Spec generalizing
   LLP 0158's custody manifest into operation-specific profiles; 0158
   remains the fork profile and a consumer/conformance witness; the
   shutdown-checkpoint repair proceeds as a bounded runtime fix. Ticket:
   `issues/20260808-state-capture-custody-spec.md`.
4. **OQ4 — ruled yes, immediately.** The coalescing measurement spike
   runs now against the persistent diagnosis baseline with the
   predeclared axes in OQ4 above; measurement only per LLP 0189. Ticket:
   `issues/20260808-oq4-coalescing-measurement-spike.md`.
5. **OQ5 — ruled: envelope-early tail.** Head as agreed (D3 continues;
   spike immediate and parallel; identity Decision + §5 schema
   quick-wins next; D2/D4 Specs after spike data); then the §4
   state-capture lane as a small independent lane early, §6 bulk
   demand-gated, and the §1+§2 strategic convergence waiting on its
   D2/D3 prerequisites.

These rulings turn §§1–6 into workstream scope per the Status note below.

## What this document deliberately does not claim

No comparative statement against Zero is made or implied — no Zero-arm
receipts exist (the 0183 review round's first MATERIAL concern), and
LLP 0183's ratified comparator protocol (its "§13" in corpus shorthand)
forbids unpre-registered comparison. Nothing here
weakens the ceilings, the fail-closed client postures, or the
server-authoritative trust model; every revisit above is either sharing
work the server already does (§1), moving admitted facts closer to the
reader under the existing authorization discipline (§2), or naming
contracts that already exist implicitly (§3, §4). The refusals the
control hit were, in every case, the platform working as designed — the
revisits are about making the designed thing bigger, not the refusals
softer.

## Open questions for Charlie

Both round-1 review families answered these as design partners; where
they converged, the convergent recommendation is stated; where they
split, the fault line is the ruling.

1. §1: commission D2/D4 owner-Specs with the ladder as required
   content? *Both families: yes, with the ladder as now revised (rungs
   1–4; rung 5 is referenced D3 scope via the shared interface), and
   commissioned separably — the scheduling/lifecycle contract (rung 1 +
   settlement isolation + latest-value delivery semantics) need not
   queue behind D2's graph-profile Spec, with the D4-charter-extension
   question in §1 resolved at commissioning. Cross-principal sharing
   (rung 3, second half) waits for D2's authority decomposition.*
2. §3: how much implementation authority does the coordinating identity
   document centralize? *The fault line: one owner-Spec holding all four
   surfaces (argued: the surfaces interlock — source keys feed D5 `Get`
   and D2 addressing, claims feed D2 auth and D7 provisioning) versus a
   short identity-architecture decision defining the
   namespace/provenance/conversion vocabulary with implementation
   distributed to schema, auth/D7, and D5/effects owners (argued: three
   trust domains should not share one implementation owner). Both agree
   on one coordinating document, one Zerobugs acceptance corpus, and
   LLP 0129 retaining sole admission authority over mutation-IR
   consequences.*
3. §4: companion Spec inside the LLP 0158 lineage, or standalone Spec
   generalizing 0158's custody manifest with 0158 as consumer and
   conformance witness? *Structure is agreed (operation-specific custody
   profiles; fork keeps scrub-and-mint; backup/restore gets its own
   acceptance rows); only the placement is the ruling.*
4. Spike the coalescing rung immediately against the persistent
   diagnosis baseline, ahead of any Spec? *Unanimous and emphatic yes —
   the best single decision available here. Guardrails: it is a
   measurement spike, not a landing (LLP 0189); predeclare the metric
   axes — arrival discipline (the existing open-loop fixed-offset
   bursts, plus a settle-gated and a sustained-write arm as new arms)
   crossed with an explicit frame-kind accounting per instrument, so
   the 521-vs-12 discrepancy this document declares open is resolved at
   the source rather than re-measured; plus matcher match/skip/fallback
   counters, evaluation queue/start/finish/cancel counters, frame
   bytes, and commit-ack vs settlement vs convergence timed separately
   — across zero/one/six observers in same and different authority
   partitions. Single-digit seconds is the hypothesis under test; a
   successful spike sizes rung 1, it does not become the de facto D4
   design.*
5. Priority order across §§1–6 for Stage 1 sequencing, given D3 is
   already ruled first. *The families' orders agree on the head: D3
   continues; the §1 spike runs immediately and in parallel; the
   identity document is next (widest unblocking effect) alongside the
   §5 schema quick wins; the D2/D4 owner-Specs are drafted after spike
   data exists. They diverge on the tail — whether the §1+§2 strategic
   convergence (maintained deltas + local replica) is sequenced as its
   own very-large item before the §4 envelope and §6 bulk protocol, or
   those two smaller independent lanes land first. §6 is demand-gated
   either way; §4's shutdown-checkpoint runtime fix is bounded and
   should not wait for its Spec.*

## Status

Review. The 2026-08-08 super-refine loop (design-partner lens, three
rounds, two families per round, all reviews verbatim under
`llp/reviews/0191-scale-architecture-revisits.{claude,codex}.md`) closed
at budget without formal convergence: on the final reviewed revision
(commit `9f30acdb1`) the Claude family was READY and the Codex family
NOT READY on one pre-existing evidence defect (the trigger-partition
claim), which the orchestrator verified and repaired in a labeled,
unreviewed post-loop revision. Both families judged §§2–6 and the five
open questions sound bases for commissioning. The escalation was taken
up same-day: all five open questions were ruled 2026-08-08 (see "Author
rulings"), turning the sections into commissioned workstream scope via
the four tickets named there. Research synthesis plus recorded rulings;
the commissioned documents carry the design authority.
