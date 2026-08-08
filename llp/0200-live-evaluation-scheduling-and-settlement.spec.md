# LLP 0200: Live evaluation scheduling and settlement isolation (the server-side D4 Spec)

**Type:** Spec
**Status:** Draft
**Systems:** Live queries, Performance, Auth, Storage, Client SDK
**Author:** Claude Fable 5 (commissioned by the LLP 0191 author rulings, Charlie Cheever, 2026-08-08)
**Date:** 2026-08-08
**Revised:** 2026-08-08
**Related:** LLP 0191 (evidence and ladder), LLP 0008 (live protocol; dated
coalescing decision this Spec absorbs), LLP 0183 (D4 charter this Spec
extends), LLP 0012/0043 (ordering and sessions contracts), LLP 0058
(auth-mode deployment state), LLP 0020 (live matcher),
`issues/closed/20260808-oq4-coalescing-measurement-spike.md` (measured
basis), `issues/20260808-live-query-reevaluation-cost-at-scale.md`
(workstream anchor), `issues/20260808-d2-d4-owner-specs-commission.md`

## 0. Charter

LLP 0183 charters D4 as the *headless windowed-query controller* — a
client-side artifact. The commissioning ticket requires this Spec to either
extend that charter to server-side evaluation scheduling or name the runtime
owner. **This Spec extends the D4 charter**: D4 owns the window/stream
lifecycle end to end, and the server-side evaluation scheduler is the
server half of that lifecycle. The client-side controller remains LLP 0183
scope; this document specifies only the server: when evaluations run, what
the write path promises, what delivery may elide, and how streams recover.

## 1. Measured basis (what this Spec must fix)

From the OQ4 spike and its post-spike diagnostic (all N=1, shape evidence;
full numbers in the closed spike ticket):

- **B-1 Write-turn coupling.** Commit plus full fan-out is one exclusive
  write turn (`dispatch_live_data_fanout` inside the commit path's
  `&mut self`). At 5.5M rows with six auth-scoped observers, a frame costs
  ~5–6 s of serial ~0.9 s evaluations; the next mutation's *commit* waits.
  Zero observers settle the same inventory at ~0.2 s; six observers push
  settles to 18–43 s p50, refused commit-free mutations included, and
  sustained writes are throughput-bound at ≈0.85 settles/s.
- **B-2 Starved coalescer.** Rung-1 coalescing (LLP 0008 dated decision)
  defers a commit only if it arrives while a pending frame exists — but
  B-1 serializes commits behind fan-out, so almost none do (4/24 deferrals
  at full scale vs 15.6× on the synthetic fixture).
- **B-3 Auth-lane dominance.** On a sessions store every subscription is
  auth-scoped and every replace-lane re-evaluation is delivered as an
  `authorization_invalidation` envelope via the authorization-resolution
  path — ~90% of delivered frames — and the coalescer excludes that lane
  wholesale ("permission resyncs, authorization events, and refresh
  signals always run inline").
- **B-4 Quarantine churn.** Roughly half the delivered auth frames in a
  burst arm arrived without a usable resolution ticket and quarantined the
  client boundary until a later frame restored it (119/231 callbacks).

## 2. Contracts

### 2.1 Settlement is decoupled from subscriber work

Three separately named, separately measured milestones per mutation:

1. **Commit-ack** — the commit is durable (WAL write completed).
2. **Settlement** — the mutate response (result or refusal) is written to
   the caller.
3. **Convergence** — a given subscription has delivered a frame at
   version ≥ the mutation's committed version.

Contract: **settlement never awaits fan-out or subscriber evaluation.**
Settlement follows commit-ack by handler-result serialization only.
Refusals settle without acquiring anything owned by delivery. Convergence
is per-subscription and unbounded by the write path (bounded instead by
§2.5's scheduler fairness). Nothing in the protocol has ever promised
"settled implies observers notified"; any internal caller relying on that
ordering must be found and named during implementation (OQ-2).

Read-your-writes is unchanged: it rides version cursors (`current_as_of`,
snapshot versions), not settlement timing — a client that requires its own
write in a subsequent read already states the version it requires.

### 2.2 Fan-out leaves the write turn

Fan-out (matching, evaluation, delivery) runs on an evaluation scheduler
outside the commit turn. The write turn ends at commit-ack plus enqueue of
the frame's change list. Consequences this Spec requires:

- Commits admit while evaluations run. (This is also what un-starves the
  rung-1 coalescer: backlogged commits now genuinely arrive during
  evaluation and merge — B-2 resolves without new coalescing machinery.)
- The pending-frame structure is the **bounded** hand-off: merged change
  lists with the LLP 0008 starvation bounds (max frames, max changes, max
  hold) carried over unchanged. Overflow degrades to a refresh-signal
  frame (full replace), never to unbounded memory.
- Evaluation reads run against a read view at the frame's version (the
  read-during-write lane exists; LLP 0035 measured it). Evaluation must
  not block subsequent commits.

### 2.3 Latest-value delivery (absorbed from LLP 0008, now load-bearing)

Per subscription, delivery is latest-value: intermediate states may be
elided whenever more than one frame is pending. This was landed as an
optimization contract; this Spec makes it the *default semantic* of live
delivery. Clients requiring every intermediate state are out of scope for
live queries (that need is the D3/event-log lane).

### 2.4 The authorization lane splits in two

B-3 shows "authorization lane" currently conflates two different things:

- **Data-driven resolution refresh**: a data commit re-evaluates an
  auth-scoped subscription and re-delivers its resolution snapshot. This
  is ordinary fan-out wearing an auth envelope. Contract: it participates
  in coalescing, cancellation, and scheduling exactly like plain replace
  delivery. It must also carry a usable resolution ticket so delivery does
  not quarantine the boundary it feeds (B-4).
- **Authority transitions**: grant, revocation, session invalidation,
  lease change. Contract: never coalesced, never cancelled, never delayed
  behind data evaluation — the existing inline guarantee narrows to
  exactly this class. Revocation latency is a security invariant and gets
  its own measured bound (OQ-4 sets the number).

### 2.5 Cancellation and fair scheduling

- A queued evaluation for a subscription is cancelled when a newer frame
  supersedes it (latest-value makes this sound).
- In-flight cancellation is best-effort at handler-turn boundaries; the
  scheduler must not require VM preemption.
- Scheduling is fair across subscriptions (no observer starves another
  indefinitely); a slow or disconnected subscriber costs the write path
  nothing and costs other subscribers only its scheduler share. Per-
  subscription pending memory is bounded; exceeding it degrades that
  subscription to resync-on-reconnect.

### 2.6 Quarantine-recovery lifecycle

A quarantined stream re-establishes liveness by: (a) the next successful
resolution delivery for that subscription (which §2.4 makes the norm for
data-driven refreshes), (b) an authority transition that re-admits it, or
(c) client resubscribe. Quarantine entry and exit are observable events
(§3). The B-4 churn pattern — quarantine as a routine per-frame state —
must not survive this Spec: quarantine is for authority uncertainty, not
for ordinary data delivery.

## 3. Observability

The spike's counter families become permanent surfaces at implementation
time: matcher decisions (match/skip/fallback by lane), evaluation
lifecycle (queue/start/finish/cancel, duration, frame bytes, kind),
coalescer stats (`LiveCoalesceStats`, already landed), settlement
decomposition (commit-ack/settlement timestamps), and quarantine
entry/exit. Landing them on the serialized inspect surface rotates
drift-gated schemas — that cost is accepted here once, in this Spec's
first landing, rather than dribbled.

## 4. Acceptance instruments and predeclared hypotheses

Instrument: the preserved spike harness (`spike/oq4-coalescing-measurement`
branch — twelve-arm A/B matrix, minutes per arm against the persistent
baseline) for per-phase A/Bs, and the zb5-hot gate for requalification per
LLP 0189. Predeclared post-landing hypotheses (shape targets, N≥3 per
`benchmarks/protocol.md` before any published claim):

- H-1 (after Phase 1): burst commit-ack p50 < 250 ms and settlement p50
  < 1 s at six observers; refused mutations settle < 250 ms; zero-observer
  settle unchanged.
- H-2 (after Phase 1): coalescer deferral engages on a majority of
  backlogged burst commits (vs 4/24), and sustained-write settle
  throughput approaches write-path capacity (vs 0.85/s).
- H-3 (after Phase 2): six-observer burst convergence p50 under the
  ~8 s evaluation floor via coalesced auth-lane frames; zero quarantine
  callbacks on ordinary data delivery.
- H-4 (after Phase 3): superseded-evaluation cancellations observed under
  sustained load; no starvation-bound violations.

## 5. Implementation phases

1. **Settlement isolation** (§2.1 + §2.2): respond at commit-ack +
   handler result; move fan-out onto the scheduler with the bounded
   pending-frame hand-off. The largest measured lever (~0.2 s vs 18–43 s)
   and the coalescer enabler. A/B via the spike harness before/after.
2. **Auth-lane split** (§2.4 + the B-4 resolution-ticket fix): data-driven
   resolution refresh joins coalescing/cancellation; authority transitions
   keep the inline guarantee; quarantine stops firing on ordinary data.
3. **Cancellation and fairness** (§2.5) with the sustained-write arm as
   its instrument.
4. **Observability + quarantine lifecycle** (§3, §2.6) with the inspect-
   schema rotation.

Each phase lands separately, A/B'd, fix-forward per LLP 0189. Rung 2
(matcher widening), rungs 4–5 (IVM, replicas), and cross-principal sharing
are D2/D3 scope and are not blocked by, nor blocking, these phases.

## 6. Open questions

- **OQ-1 (hosted profiles).** On the Cloudflare DO target the single-
  threaded owner *is* the write turn. Does fan-out-off-the-turn map to
  `waitUntil`-style deferral with the same contracts, or does the DO
  profile document a narrower guarantee? (LLP 0014's designed read
  ceiling already accepts per-app serialization; the settlement contract
  §2.1 must still hold.)
- **OQ-2 (hidden ordering dependents).** Audit for internal callers that
  assume fan-out completed before settlement (effects, `runAfter`
  scheduling per LLP 0070, acceptance suites asserting delivery before
  mutate-return). Each found dependent either moves to convergence-based
  waiting or gets a named carve-out here.
- **OQ-3 (evaluation read view).** Does off-turn evaluation read the
  frame-version snapshot via the existing read lane, or does SQLite WAL
  snapshot isolation need explicit pinning for long evaluations spanning
  multiple commits?
- **OQ-4 (revocation bound).** The numeric latency bound for authority
  transitions once data-driven refreshes coalesce (§2.4). Proposed:
  revocation-driven resync dispatches inline, before any pending data
  frame, with a measured p95 target set at Phase-2 time.
- **OQ-5 (client contract surface).** Does any published client behavior
  (LLP 0093 protocol docs, guide pages) describe settlement as implying
  delivery? If so those surfaces revise with Phase 1, same commit.

## 7. Non-goals

Incremental view maintenance, delta-fed replicas, matcher vocabulary
widening, cross-principal shared evaluation, multi-process realtime, and
any change to the one-authority-per-app storage contract (LLP 0007/0128).
