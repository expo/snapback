# LLP 0191: Architectural revisits the Zerobugs control earned

**Type:** Research
**Status:** Review
**Systems:** Live queries, Local sync, Storage, Auth, Schema, Relational queries, Client SDK, Effects, Deployment, Performance
**Author:** Claude Fable 5 (analysis and synthesis; commissioned by Charlie Cheever, 2026-08-08)
**Date:** 2026-08-08
**Revised:** 2026-08-08 (round-1 super-refine revision, design-partner
lens: frame-count evidence repaired against the v10 receipt and the diag
traces' true metrics; ladder revised to five rungs; settlement isolation
added; §§3–6 decisions restructured on the trust-domain and ownership
boundaries the two review families converged on; open questions carry
the cross-family recommendations and remaining fault lines)
**Related:** LLP 0008, LLP 0043, LLP 0053, LLP 0057, LLP 0107, LLP 0108, LLP 0130, LLP 0146, LLP 0155, LLP 0157, LLP 0158, LLP 0166, LLP 0182, LLP 0183, LLP 0189, LLP 0190

## Summary

The Zerobugs control (LLP 0183 Stage 0.5) is the first application big
enough — 5.5M rows, six concurrent live windows, sixteen mutators, a real
browser — to show where Snapback's architecture bends. This document takes
the evidence that program produced (immutable receipts, the diary's
attempt ladders, the stream-diagnosis traces, and eleven recorded guide
gaps) and explores six candidate architectural revisits in enough depth to
commission design work. It proposes no single design and changes no
contract; each section ends in the decision the evidence supports and the
owner the LLP 0183 workstream structure already provides. The through-line:
most of what looked like many small frictions is a small number of deep
ones — evaluation-per-subscriber, server-round-trip-per-read, identity as
app-space plumbing, and a durable store that is secretly several files.

## Evidence base

All claims below cite artifacts that exist and cannot be rewritten:

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
When a mutation commits, every subscription whose declared reads intersect
the touched tables is re-evaluated by re-running its handler from scratch,
per subscriber, and the result is delivered as a fresh frame.

**What the evidence says.** Three numbers from one receipt and one trace:

- Re-running the Zerobugs list engine once over the 5.5M-row store costs
  ~1.3 s (`zb5-large.v3`, `raw-list-ready-timing` — and that is the
  *bounded, read-model-backed* implementation, not a naive scan).
- With six 1,000-row streaming observers open, the 48 sampled mutation
  settle latencies in `zb5-hot.v10` span 111 ms–148 s, **median ~74 s**.
  Sixteen mutations dispatched over 400 ms owe up to ~96 full
  re-evaluations; the queue drains at evaluation speed.
- Two delivery metrics, from two distinct workloads, that must not be
  conflated. The *diagnosis harness* (local traces) dispatches its 48
  mutations as a burst: pre-fix it delivered **676 update frames** plus
  676 authorization boundaries; post-fix the same burst delivered **12**
  — two per observer, because the supersession repair collapses a burst
  to its latest resolution. The *acceptance receipt* (`zb5-hot.v10`,
  immutable) paces the same 48 mutations across three cycles awaiting
  each settle, and records **521 deliveries** (23–33 per observer per
  cycle) — ~1.8 frames per mutation per observer, because a paced
  workload gives supersession nothing to collapse. Read together:
  post-repair, the delivery machinery already expresses "latest wins"
  when work queues up, but each mutation still costs a full evaluation
  per subscriber — the pre-fix frames were redundant re-resolutions of
  content the client already had, and the paced workload still pays the
  evaluation bill even with clean delivery.

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
   must be explicit. The supersession repair shows the delivery side can
   express "latest wins"; coalescing moves the same idea before
   evaluation.
2. **Affected-read precision.** Today's trigger is "declared reads
   intersect the touched *tables*." The field's first-order lever is
   finer-grained matching — read-set/index-range intersection — which
   makes most mutations wake *no* subscriptions. Snapback already has
   captured-dependency matching with conservative fallbacks; D2 should
   extend that vocabulary to joins, ranges, windows, and authority
   partitions rather than start from table-level invalidation. The hot
   profile cannot show this win (all 16 mutations genuinely touch the
   list); the general workload — many subscriptions over different data,
   where sharing collapses nothing — is where precision is the lever.
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
4. **Incremental view maintenance (the Zero-class answer).** True deltas
   require declared query shapes; opaque handlers cannot be incrementally
   maintained, only re-run. This is the expensive rung, and the control's
   experience argues it should be scoped to *admitted* shapes (the D2
   graph profile) rather than attempted generically. Re-run plus
   coalescing, precision, and caching is a legitimate stable resting
   point (Convex deliberately stopped there), not merely a waypoint.
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
admitted-shape question it already is — but commission them *separably*:
rung 1 plus settlement isolation is D4-side scheduling/lifecycle work and
should not queue behind D2's heavier graph-profile Spec (D2 owns
declared dependencies, plan identity, affected-query matching, and
deltas; D3 owns retained/local consumption). Measure each rung with the
existing instrument (`diag-hot-stream.mts` iterates in minutes against
the persistent baseline) before committing to the next. Ticket:
`issues/20260808-live-query-reevaluation-cost-at-scale.md`.

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
point (Firestore ships exactly this) — but exact retention removes no
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

**What the evidence says.** The zb5-hot ladder burned two full receipted
attempts (v1–v4) discovering the envelope's members one at a time, and
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
Spec under the storage/import-export owner, with the control's loader as
reference implementation and D8 plus LLP 0160's migration program as
acceptance consumers — D8 qualifies targets against the protocol rather
than owning its semantics. Do not build a fourth bespoke loader.

## What this document deliberately does not claim

No comparative statement against Zero is made or implied — no Zero-arm
receipts exist (the 0183 review round's first MATERIAL concern), and the
ratified §13 protocol forbids unpre-registered comparison. Nothing here
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

1. §1: commission D2/D4 owner-Specs with the five-rung ladder as
   required content? *Both families: yes, with the ladder as now
   revised, and commissioned separably — the D4 scheduling/lifecycle
   contract (rung 1 + settlement isolation + latest-value delivery
   semantics) need not queue behind D2's graph-profile Spec.
   Cross-principal sharing (rung 3, second half) waits for D2's
   authority decomposition.*
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
   measurement spike, not a landing (LLP 0189); predeclare the metrics —
   settle-latency distribution, delivered-frame counts with the metric
   defined per workload (burst vs paced, repairing this document's own
   round-1 evidence defect at the source), evaluation queue/start/
   finish/cancel counters, frame kinds and bytes, commit-ack vs
   settlement vs convergence timed separately — and run burst *and*
   sustained writes with zero/one/six observers across same and
   different authority partitions. Single-digit seconds is the
   hypothesis under test; a successful spike sizes rung 1, it does not
   become the de facto D4 design.*
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

Review (super-refine loop opened 2026-08-08, design-partner lens; round-1
revision applied — both families' reviews are preserved verbatim under
`llp/reviews/0191-scale-architecture-revisits.{claude,codex}.md`).
Research synthesis only; commissions nothing by itself. Each
section names the owner the LLP 0183 structure provides; rulings on the
open questions turn sections into workstream scope.
