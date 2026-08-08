# LLP 0191: Architectural revisits the Zerobugs control earned

**Type:** Research
**Status:** Draft
**Systems:** Live queries, Local sync, Storage, Auth, Schema, Relational queries, Client SDK, Effects, Deployment, Performance
**Author:** Claude Fable 5 (analysis and synthesis; commissioned by Charlie Cheever, 2026-08-08)
**Date:** 2026-08-08
**Revised:**
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
  (`demos/zerobugs/fixtures-local/hot-diag-baseline/diag-run1/2.jsonl`,
  summarized in
  `issues/closed/20260807-hot-cycle-live-stream-stale-at-settle.md`):
  1,913 and ~1,100 sequenced records covering connection transitions,
  per-frame deliveries, and authorization errors before and after the
  invalidation repair.
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
- The pre-fix diagnosis trace recorded **676 delivered frames** for 48
  mutations across six observers; after the invalidation repair the same
  workload delivered **12**. Most frames were redundant re-resolutions of
  content the client already had — evaluation work and delivery work with
  no information in it.

Correctness held throughout: every observer converged to oracle-exact
rows. The ceiling is purely architectural — evaluation × subscribers ×
mutations, with no sharing and no increments.

**The revisit is a ladder, not a bet.** The options are ordered by cost,
and the cheap rungs may buy most of the win:

1. **Coalescing (scheduling only).** N invalidations pending against one
   subscription should produce one re-evaluation at drain time, not N.
   The hot profile's 16-mutation burst should cost each observer roughly
   one 1.3 s re-run, not a queue of them — that alone plausibly turns
   74 s into single-digit seconds. No query-shape change, no protocol
   change; the invalidation-obligation machinery (post-repair) already
   supersedes stale frames, so the delivery side is ready for it. The
   risk is fairness/starvation under sustained writes, which the D4
   stream-lifecycle contract must own explicitly.
2. **Shared evaluation (identity, not shape).** The six hot observers ran
   the *same query and arguments* under different principals. Evaluating
   once per (query, args, store-version) and fanning out per-principal
   projections requires an authorization-partitioning step — exactly the
   role/visibility partition discipline the control already implements in
   app space (`W-READMODEL`'s partition-before-count rule). The trust
   question — evaluating under whose authority? — is real and is the same
   question LLP 0190 §4 poses for projected facts; the two designs should
   share an answer, not invent two.
3. **Incremental view maintenance (the Zero-class answer).** True deltas
   require declared query shapes; opaque handlers cannot be incrementally
   maintained, only re-run. This is the expensive rung, and the control's
   experience argues it should be scoped to *admitted* shapes (the D2
   graph profile) rather than attempted generically. It is also exactly
   what retention (D3) wants, since a retained fact plus a delta stream
   is a local replica.

**Decision this evidence supports.** Commission the D2/D4 owner-Specs with
rungs 1 and 2 as required design content and rung 3 as the admitted-shape
question it already is. Measure each rung with the existing instrument
(`diag-hot-stream.mts` iterates in minutes against the persistent
baseline) before committing to the next. Ticket:
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
scaling strategy**, with §1's rung 3 as its convergent twin. The two
programs meet at one design point — admitted shapes with maintainable
deltas — and should be sequenced to meet there deliberately.

**Decision this evidence supports.** Rule LLP 0190's OQ1 (first candidate
branch) with §1's ladder in view; treat "retained fact + delta stream =
replica" as the shared end-state hypothesis both D2 and D3 test.

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
(server-owned monotonic numerics), a **verified principal-claim surface**
(what `session mint` verified, visible to a binding handler — or a
privileged provisioning channel), and a **read-only settlement identity**
on the handler context. Individually each is modest; together they remove
three workaround-register rows and the largest porting friction the
diaries record. The 0183 review round independently flagged identity as an
unowned cross-cutting contract needed by D2 authorization, D3 partitions,
and D5 guards — evidence this should be **one owner-Spec**, not slivers of
three.

**Decision this evidence supports.** Commission a dedicated identity
owner-Spec (joint D3/D5/D7 dependency, per the review's framing) covering
the four surfaces above, with the Zerobugs port as its acceptance corpus.

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

**The revisit.** Define the envelope as a contract: an enumerable,
versioned set of paths (or a single-file sealed format) with a supported
`snapback` verb that exports/copies/forks it atomically — checkpointing
the WAL, including the keyrings, and refusing to produce a partial copy.
LLP 0158's derived-deployment work is the natural owner since forking is
where the envelope is load-bearing; the shutdown-checkpoint repair is a
prerequisite piece of the same contract. The boot diagnostic should also
name a missing sibling explicitly — the current
`SNAPBACK_AUTH_PROVIDER_UNAVAILABLE` cost a receipted attempt to decode.

**Decision this evidence supports.** Fold an envelope contract into the
LLP 0158 lineage (amendment or companion Spec) rather than patching the
two tickets independently.

## 5. Relational-surface completeness

**Current architecture.** Stored fields reject literal unions; route
groups reject nested route params and null/union literal arguments; the
relational surface composes bounded two-source shapes.

**What the evidence says.** These are the quiet multipliers behind the
workaround register: `W-ENUM` (every writer re-implements closed domains
for authorization-relevant fields), `W-QGROUP`/`W-MANUALSET` (the
22-relation graph shapes live in ~1,400 lines of hand-written typed
merge because `ROUTES_ARGS_INVALID` blocked the generated bundle), and
the §3 identity columns. None is individually architectural; jointly
they are the difference between "porting a relational app" and
"rewriting one against a different data model" — the exact authoring
delta LLP 0183's ZB6 gate measures. Tickets:
`20260808-stored-literal-union-enums.md`,
`20260808-route-group-argument-lowering.md`.

**Decision this evidence supports.** These belong inside D2's owner-Spec
as required scope (the review round asked for exactly this), with the
control's query corpus as the acceptance instrument. No separate program.

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

**The revisit.** A first-class resumable import/export protocol —
authenticated, ledgered, digest-verified, streaming rather than
echo-bounded — as the D8 question the register already poses
("D8 fixture/import profile may standardize a resumable authenticated
bulk loader"). Its design inputs are all measured: batch-size vs the
1 MiB echo ceiling, per-batch cost flatness (the sentinel-index repair's
receipt), and ledger semantics proven over 6,176 batches × five runs.
Migration stories (LLP 0160's program) are the demand side.

**Decision this evidence supports.** Assign the protocol question to D8
with the control's loader as reference implementation; do not build a
fourth bespoke loader.

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

1. §1: commission D2/D4 owner-Specs with the coalescing → shared-eval →
   IVM ladder as required content? (Cheapest high-leverage decision here.)
2. §3: one dedicated identity owner-Spec, or distribute across D5/D7 as
   the workstream table currently implies?
3. §4: fold the store-envelope contract into the LLP 0158 lineage, or a
   standalone Spec?
4. Should the coalescing rung (§1.1) be spiked immediately against the
   persistent diagnosis baseline — a days-scale experiment with the
   instrument already built — ahead of any Spec, to size the win?
5. Priority order across §§1–6 for Stage 1 sequencing, given D3 is
   already ruled first.

## Status

Draft. Research synthesis only; commissions nothing by itself. Each
section names the owner the LLP 0183 structure provides; rulings on the
open questions turn sections into workstream scope.
