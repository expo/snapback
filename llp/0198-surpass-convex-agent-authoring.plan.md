# LLP 0198: Surpassing Convex on agent authoring — state of the world and the closing plan

**Type:** Plan
**Status:** Accepted
**Systems:** Competitive evaluation, Developer experience, Documentation,
Templates, Error handling, Operations, Publishing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-12 (post-acceptance owner-map amendment: routes the later
Clique ordinary-TypeScript residuals to Draft LLPs 0245–0249 and preserves P4
as the existing operations decision owner; no claim rung or threshold changes).
2026-08-08 (e — **Accepted by author ruling** (Charlie
Cheever, 2026-08-08), applied at revision (d) with the loop's terminal
state on the record: revision (d) is the unreviewed post-loop residue
repair; the Claude-family READY binds to revision (c). The run journal
`llp/reviews/0198-surpass-convex-agent-authoring.run.md` holds the
verdict history and the disclosed growth-budget deviation.)
**Revised:** 2026-08-08 (d — **UNREVIEWED post-loop residue repair**,
applied at round-budget exhaustion under the delta rule's
label-unreviewed terminal. Round 3: Claude READY on (c) with 0
MATERIAL; GPT NOT READY with 5 MATERIALs, all IN-DELTA in (c)'s own
text, 0 PRE-EXISTING — pre-existing text was clean in both families in
rounds 2 and 3. (d) applies the GPT round-3 set (L2 ordering-claim
evidence bar + 4b gates; qualification digest widened to all semantic
inputs; per-configuration family-scope lift; per-cell probe verdicts
and neutral definition; day-2 acceptance-equivalent paired starts) and
both families' minors. No reviewer has seen (d); acceptance is the
author's call with that on the record.)
**Revised:** 2026-08-08 (c — round-2 delta revision; both families
NOT READY on (b) with **zero PRE-EXISTING MATERIAL concerns** — every
MATERIAL was in the (b) delta itself: run-5 loop accounting restated to
the 0115 record's annotations, 0194 ownership re-corrected to r5
(verify-config initial-scope, `ctx` the sole exclusion), labeling
widened template→aid-assisted per 0197 4a, pick-and-build probe given a
P3 owner with preregistered N/decision rule, two-layer scoring defined
at P0.0(e), requalification bound to a 0189 qualification digest with
material-competitor-release aging and N≥3-confirmed band triggers,
P0b preregistered at N≥3, retry ask routed to LLP 0070 per 0171
Finding D, publication-safe projection replacing raw transcripts.)
**Revised:** 2026-08-08 (b — round-1 super-refine revision, both
families NOT READY on (a): P0 restaged against the N≥8 variance floor;
victory conditions → claim ladder with 0197-4a labeling and
requalification semantics; run-5 zero-defect claim precise; P1
record-measurable and ownership-corrected (0194 exclusions, 0171
Finding D); trust-boundary/day-2 briefs; cross-family leg P0b. Reviews:
`llp/reviews/0198-surpass-convex-agent-authoring.{claude,gpt-5}.md`.)
**Revised:** 2026-08-08 (a — Draft → Review at llp-super-refine loop
start, the one authorized transition; design-partner mode requested by
the author, GPT-family reviewer weighted toward generative input)
**Related:** LLP 0186 (the efficiency program this synthesizes and
extends), LLP 0187 (discoverability), LLP 0189 (verification cadence and
claim gating — governs every claim below), LLP 0193 (errors-as-docs),
LLP 0194 (generated API reference), LLP 0195 (public documentation and
training surface), LLP 0196 (template portfolio), LLP 0197 (benchmark
publication standard), LLP 0130 (Convex parity standing decisions), LLP 0236,
LLP 0237, LLP 0238, LLP 0241, LLP 0242, LLP 0245, LLP 0246, LLP 0247,
LLP 0248, LLP 0249,
diaries 0057–0060, 0065–0066, and 0068–0069, `benchmarks/` (harness
and records)

## Summary

Five instrumented measurement runs (2026-08-05 → 2026-08-08) plus the
qualitative bakeoff corpus now give a complete picture of where Snapback
stands against Convex as a backend for coding agents. The short version:
**the defect war is won and the knowledge war is winnable; what remains
after that is orientation (prior model familiarity), operations
productization, and the discipline to claim a win only when the
instrument supports it.** Run 5 (diary 0069, npm 0.1.15) recorded zero
defect-shaped framework loops in any Snapback lane for the first time —
the skill lane's entire backend passed codegen and typecheck first-try,
and the framework-attributed loops that remained in the web lanes were
knowledge-shaped (the template web-deps gap hit both), not defects. Yet
Convex
still finishes the same brief in roughly half the wall-clock and 45% of
the tokens, almost entirely because the model already knows Convex and
must still read to learn Snapback.

This Plan does three things no single existing document does: it
**captures the current state in one place** (the measured series, the
loop trajectory, the scored-rubric record, the qualitative synthesis,
and Convex's own profile as the lanes found it); it **defines "surpass"
as an explicit claim ladder** — which conjunction of evidence supports
which public phrase, under LLP 0189 claim gating and LLP 0197's
publication standard; and it **sequences the endgame** across the owned
lanes (0193–0197) and the gaps no document owns yet. It re-owns no
mechanism from 0186/0187/0193–0197; its original contributions are the
synthesis (Part I), the claim ladder and requalification semantics, the
trust-boundary and day-2 brief proposals, the cross-family replication
leg, and the operations-dimension ask (Part II).

---

## Part I — State of the world (evidence base, dated 2026-08-08)

### I.1 The measured series

Same WhatsApp-shaped brief, same machine (M5 Max, shared with fleet
load), serial cold-context lanes, published surfaces only from run 2
onward, token counts from the orchestration harness. Primary tracked
pair: skill-equipped Snapback web lane vs Convex. Bases differ across
rows (as LLP 0197 requires stating): runs 1–2 predate the authoring
skill — run 1 was in-checkout under Codex, run 2 was the bare
published-consumer lane under Claude Fable 5; runs 3–5 are the
skill-equipped lane under Claude Fable 5.

| Run | Date | Basis | Snapback lane (see basis) | Convex | Wall ratio | Token ratio |
|---|---|---|---|---|---:|---:|
| 1 (diary 0058) | 08-05 | in-checkout, Codex, no skill | 26m03s | 11m15s | 2.32x | unmeasured |
| 2 (diary 0065) | 08-06 | npm 0.1.10, bare (no skill existed) | 36m33s / 330k tok | 12m27s / 101k | 2.94x | 3.26x |
| 3 (diary 0066) | 08-07 | npm 0.1.12, skill | 64m00s / 329k | 14m01s / 111k | 4.57x | 2.95x |
| 4 (diary 0068) | 08-07 | npm 0.1.13, skill | 26m22s / 226k | 16m36s / 113k | **1.59x** | **2.00x** |
| 5 (diary 0069) | 08-08 | npm 0.1.15, skill, first harness-native | 19m00s / 201k | 10m18s / 90k | 1.84x | 2.24x |

Reading rules established by the series itself:

- **Absolute Snapback numbers improve monotonically** once the run-3
  regression (unpaved web carrier) was repaired: skill-lane wall
  64m → 26m → 19m; tokens 329k → 226k → 201k. Every Snapback lane in
  run 5 posted its best-ever wall and tokens.
- **The ratio is inside the noise.** Convex's run-5 lane was also its
  best ever (previous band 12.5–16.6m / 101–113k), so the ratio moved
  1.59x → 1.84x with N=1 per configuration against an observed ±30%
  per-lane spread. Diary 0069's verdict stands as this Plan's
  measurement posture: *ratio movement of this size is not a signal in
  either direction; claiming the trend either way requires repetition*
  (see P0 for the staged N≥3 / N≥8 design the protocol requires).
- Run 3 is the cautionary tale in both directions: a structural wall
  (web carrier) tripled the gap in one release, and one seven-fix layer
  reversed it completely in the next. The gap is release-sensitive in
  both directions; single-run claims are worthless.

Secondary lanes (run 5): bare-web 29m35s / 212k (2.87x / 2.36x) —
the 0.1.15 template defaults produced the program's largest
knowledge-placement single-release improvement (LLP 0196's qualifier:
the 0.1.13 defect-fix layer produced larger raw steps) by deleting
whole classes of work (sessions custody, offline registration, upload
plumbing no longer hand-built);
native-simulator 25m14s / 250k (2.45x / 2.78x) with all proofs on the
simulator and zero failed `snapback` invocations.

### I.2 The defect trajectory: walls → papercuts → zero defects

Framework-attributed correction loops in the primary tracked lane (bare
in run 2 — no skill existed yet; skill-equipped thereafter): run 2 **4**
(each a diagnosis-plus-workaround cycle — the CORS relay and offline
fallback were real engineering), run 3 **8** (the web-carrier wall),
run 4 **3** (all papercuts), run 5 **0 defect-shaped** (the
knowledge-shaped residue is broken out below). Precisely,
per the 0115 record's annotations (skill "7 (0 backend)", native
"8 (0 framework)", bare "6 (~2)"): **no defect-shaped framework loop in
any run-5 Snapback lane**, with knowledge-shaped framework-attributed
residue in *both* web lanes — the expo-chat web-deps gap was both web
lanes' longest single loop (diary 0069, residue 1). Convex's
framework-attributed figures were 2, 3, 1, 0 (runs 2–5), resolved "from
its own error messages in minutes" (diary 0065) — that loop-quality
asymmetry, not the count, was the felt experience gap, and run 5
eliminated its defect-shaped half.

Diaries 0065/0066 established the working proxy: token cost tracks loop
count almost linearly, making the correction-loop ledger the cheapest
honest instrument when metering is unavailable.

What the fix waves actually closed, in order (all previously documented;
listed here as the closed-ledger half of the state):

- run-1 era: managed dev-loop JSON envelope defect ("the biggest
  Snapback detour"), result-contract violations hashing the field path,
  React upload hook typing, HMR reference invalidation, nested-repo root
  resolution (0186 W0/W4 evidence, all closed 08-05);
- run-2 era: published-closure coherence (`snapback new` + `dev` +
  codegen first-try from npm), the offline-retention closure gate that
  had forfeited Snapback's best-scoring dimension (`single_table_v1`
  refused by the published runtime — reopened and paved by 08-07);
- run-3 era: the web carrier (bootstrap CORS, react-native-web deep
  import, web `blob:` URI refusal in the picker adapter), sessions-bearer
  mutation misrouting to the offline queue, the `AUTH_STREAM_RESET` boot
  flake, arg-filtered live-query retention classification;
- run-4 era: the template ships the skill; supervised offline
  receipt-fallback works first-try on both carriers; image e2e first-try
  in every lane.

**Open residue after run 5** (all ticketed 2026-08-08, round 3; the
complete list is diary 0069's): the expo-chat template lacks web
platform deps (both web lanes' longest single loop, two runs running);
the `ctx.db` verb set is undocumented (the native lane extracted
`query/withIndex/eq/collect/take/delete` from runtime binary strings);
headless call-shape ambiguity (`{ args: {...} }` nesting); the
verify-config authoring contract was findable only by reading
`verify.mjs` source (second consecutive run; 0194 r5 has since placed
its published `verify.d.mts` declaration in initial scope — the
remaining residue is discoverability); simulator-proof recipe gaps; the
offline supervisor-origin env var still lacks a guide anchor. Every one
is knowledge-shaped, not defect-shaped — which is precisely why LLP
0193/0194/0196 exist.

Longer-standing open frictions not in the run-5 residue but carried in
the corpus: the doc-comment/artifact-identity edit-loop tax (0186 W4's
remaining item — a comment edit can still force a local-store rollover);
the `optional-user` auth default in sessions apps (the one place the
framework is default-open; diary 0057 escalated it; 0186 W3 already
sequences the diagnostic); and first-attempt platform-contention
failures interacting with jobs' `maxAttempts: 1` — where LLP 0171
Finding D has already ruled that the default stays and the remedy is
effect-safe retry/observability, not a blanket default increase.

### I.3 The scored-rubric record

Diary 0058 established the eight-dimension 0–100 rubric now frozen in
`benchmarks/schema/run-record.schema.json` (weights: functional
completeness 20%, realtime+typing 10%, offline 20%, images/assets 10%,
data model + type safety 10%, DX/docs/setup 15%, testability 5%,
operations/maturity 10%). Two scored runs exist:

| Dimension (weight) | Run 1: S / C | Run 2: S / C | Movement and cause |
|---|---|---|---|
| Functional completeness (20%) | 96 / 97 | 95 / 97 | stable; run 2: "Convex first-run-passed everything" |
| Realtime + typing (10%) | 95 / 80 | 95 / 80 | structural: one ephemeral declaration vs durable table + scheduled expiry + nonce + keepalive |
| Offline behavior (20%) | 94 / 62 | 66 / 62 | the closure gate collapsed Snapback's best dimension in run 2; **repaved for npm consumers 08-07, first-try in all run-4/5 lanes — no scored run since** |
| Images/assets (10%) | 82 / 92 | 78 / 93 | Convex's 3-step flow "worked immediately"; Snapback's stronger policy/atomicity model taxed by authority ceremony and the run-2 CORS relay (since paved) |
| Data model + type safety (10%) | 94 / 91 | 94 / 90 | stable Snapback edge (closed result shapes, generated contracts; Convex's emoji-key refusal dinged in run 2) |
| DX, docs, setup (15%) | 55 / 95 | 72 / 95 | biggest Snapback gain from the W0 plumbing wave; run-5's zero-defect result is unpriced |
| Testability + diagnostics (5%) | 87 / 88 | 90 / 88 | operator CLI + codegen diagnostics praised throughout |
| Operations + maturity (10%) | 62 / 96 | 70 / 96 | **the largest stable structural deficit**: Convex cloud dev is productized; Snapback is local-first with rigor but no equivalent hosted story |
| **Weighted overall** | **84 / 86** | **81 / 86** | run-2 dip = offline forfeit outweighing DX gain |

Run 1's mature-hypothetical scoring flips the winner (Snapback 97,
Convex 96): "chat is fundamentally a local-first replicated log plus
ephemeral coordination and referenced media," and "most of the
deductions today are implementation/packaging maturity" (diary 0058,
two adjacent passages).

No scored rubric has been recorded since run 2. Given that runs 4–5
repaired exactly the two dimensions that produced run 2's deficit
(offline forfeited, DX at 72), the mature-hypothetical flip is plausibly
already the published-surface reality — but under LLP 0189 that is a
hypothesis, not a claim. **P0 below makes rubric scoring a required part
of the record format so the record can say so.**

### I.4 Qualitative synthesis: what agents say

The bakeoff-corpus diaries (0057, both 0058 files —
`0058-relay-room-expo-backend-bakeoff` is the scored run cited as
"run 1" throughout; `0058-messaging-snapback` is its Snapback-arm
sibling — 0059, 0060, 0065-rematch, 0066, 0068, 0069) agree on a
single shape: **writing
the app on Snapback is cheap; everything around it was where the time
went — and "everything around it" has been shrinking release over
release.** Diary 0057's decomposition of a ~25-minute build: 5 minutes
writing the app, 3 minutes codegen iteration, the rest environment.

**Consistently praised (the moats — "what must not change" in 0186, held
with more evidence now):**

- **Codegen and diagnostics** — the most-praised surface in every diary:
  deterministic, fails closed, writes nothing on error, stable codes,
  messages naming function/argument/file/line.
- **Ephemeral presence/typing** — "the best part was typing state" (0059):
  one TTL collection vs Convex rebuilding presence from durable
  primitives (table, two indexes, public mutation, internal expiry
  mutation, scheduled job per refresh, nonce guard, 2s client keepalive).
- **Platform offline** — retained live queries + outbox with honest
  freshness/retention facts; the two-boot cold-start proof "much
  stronger than merely observing that a React component still has memory
  after airplane mode."
- **Typed assets as a model** — declared media policy, GPS stripping,
  renditions, and atomic typed attach (no orphan window).
- **The trust boundary** — diary 0057, the only run with a real
  server-resolved identity: "the strongest I have used for this spec";
  the classic identity-spoofing bug "not merely avoidable here, it is
  close to unexpressible."
- **Enforced determinism, transactional jobs, the guide's architecture**
  ("genuinely agent-first... I found what I needed by navigating, not
  grepping"), and the verify/done-oracle machinery ("the headless
  acceptance harness caught every real bug before the UI ever ran" —
  the 0058-messaging diary).

**The friction ledger** (nearly all closed; see I.2): docs-vs-package
drift (0057's top finding — three of its four biggest time sinks from
one gap; closed by the published-closure fence), the human-shaped dev
loop (closed), asset authority ceremony (paved), deployment pinning vs
edit loop (open), sharp defaults (open, with 0171 Finding D bounding the
jobs half), closed-shape failures without field names (closed),
knowledge residue (open, owned by 0193/0194/0196).

**Convex's profile as the lanes found it.** Strengths: one command to a
live cloud deployment with zero code corrections; "reactivity is free";
storage is a two-liner; anonymous local mode "remains the standout";
compact TypeScript model; self-explanatory errors; and **zero
documentation consumed in any instrumented run (2–5)** — prior model
familiarity. Weaknesses the lanes hit: no offline contract (each lane
hand-rolled a ~40–60-line cache its own report disclaimed as "not a
real sync story" — offline writes would be lost); presence rebuilt
expensively from durable primitives; the three-step upload's orphan
window and bearer-URL snapshotting care; non-ASCII/emoji field names
refused only at runtime ("a real sharp edge for chat"); local backend
lifetime tied to the CLI process ("undocumented-feeling");
circular-type inference on untyped `ctx.runMutation` callers; Node
actions unable to read bundled files; N+1-ish reads at demo scale.

**The verdict pattern, verbatim where it matters:** run 1 — "If I had to
ship this prototype this week, I would choose Convex... If offline
relaunch plus queued writes is a product requirement rather than a demo
checkbox, I would keep investing in Snapback." Diary 0057 (the
trust-boundary spec) — "Would I choose this backend for this app again?
For this app — yes, and it would not be close... none of \[the things
that fought me\] is a design mistake." Diary 0059 — "Convex is
materially faster to get from schema to a conventional live React app.
Snapback is materially clearer for truly ephemeral state and much more
prescriptive for media handling and evidence."

### I.5 The remaining gap, decomposed

With defect-shaped loops at zero, the run-5 skill-lane delta (19m00s /
201k vs 10m18s / 90k) decomposes into four named terms:

1. **Orientation (the dominant term).** Convex lanes read nothing;
   Snapback lanes still read the guide and, at the edges, package
   source. Diary 0069: "the orientation gap is now the dominant term,
   as predicted." Levers, in verified order: LLP 0196 (the series
   proved scaffold beats guide beats package source — scaffold defaults
   produced run 5's largest gain); the published skill (run 5's skill
   lane ran ~10m faster than bare — though per diary 0068 the scaffold
   now ships the skill, so the residual delta measures pre-scaffold
   routing and is a single-run figure inside the observed spread);
   LLP 0194 (kill the package-source excursions); LLP 0195 (the public
   surface — the pre-install orientation and discoverability fix; its
   training-data effect is, per 0195's own text, a plausible but
   **unverified hypothesis**, so this Plan treats training-data
   presence as upside, never a scheduled lever).
2. **Knowledge residue.** The specific run-5 excursions of I.2 — each
   maps onto 0193/0194/0196 work items, with the ownership caveat P1
   records (0194 still *excludes* the `ctx` surface until its
   declaration file lands; verify-config joined 0194's initial scope
   at r5).
3. **Deeper proof surface (not a cost to remove — a cost to price).**
   Snapback lanes register real verify profiles and prove platform
   retention with honest facts; Convex lanes pass a shallower bar with
   disclaimed caches. The scoring rubric, not the wall-clock ratchet, is
   where this asymmetry gets credited; the equal-proof-bar brief
   (`benchmarks/briefs/messaging-equal-proof-bar.md`, authored, never
   run) exists to make every lane meet identical offline semantics — the
   configuration where Convex must hand-build what Snapback ships.
4. **Operations productization.** The one dimension where the deficit is
   structural and stable (62–70 vs 96) and **no accepted document owns
   closing it**. Convex's productized cloud dev is a real product
   advantage, not a measurement artifact. Part II names the ask.

### I.6 Measurement caveats (carried into every claim)

- N=1 per configuration everywhere; an observed ±30% per-lane spread
  (itself an N=1-era estimate — `benchmarks/protocol.md` makes no
  variance claim below N≥8); same shared machine; one model family for
  runs 2–5 (Claude Fable 5; run 1 was Codex). No ratio claim without
  the staged repetition design in P0.
- One brief family (messaging) has ever been run; it favors
  realtime-native platforms (0186 OQ4). CRUD and media briefs are
  authored but unrun — and because LLP 0196 T1/T2 build templates
  against those same brief shapes, runs of them are *aid-assisted*
  scenarios under LLP 0197 rule 4a, never general-claim evidence.
- **The auth-seam caveat, which cuts against Snapback:** every messaging
  arm on both sides used a client-supplied test-persona seam, not real
  authentication. The corpus therefore systematically measures the
  dimension Snapback is weakest on (setup ceremony) while zeroing the
  dimension it is strongest on (structural trust boundaries) — diary
  0057, the only real-auth run, is also the most pro-Snapback verdict.
- **The greenfield caveat, which cuts for Snapback:** every run builds
  from empty, zeroing the dimension where Snapback's known open
  frictions live — the artifact-identity rollover, deployment pinning
  vs the edit loop, 0057's "story for evolving a sessions app without
  dropping its database." Convex's edit-loop story is plausibly its
  second advantage after familiarity. No current brief prices either
  direction; P3 adds both.
- Convex is a moving target: its run-5 lane was its best ever, and its
  weaknesses list is dated 2026-08-08 against the versions the lanes
  used.

---

## Program board — 2026-08-12 ordinary-TS authoring wave

The five LLPs this plan routed through LLP 0236 (0245–0249) landed their
first implementation wave: 0245 rollouts 1–2 + apply CAS, 0246 rollouts 1–2
(erasure custody fix + frozen TS profile), 0247 rollouts 1–5, 0248 rollouts
1–3 with the `bounded_batch_reads_v1` experimental introduction (LLP 0134
same-commit act; record
`tests/acceptance/maturity/bounded-batch-reads-2026-08-12.introduction.json`),
and 0249 rollouts 1–2 as calibration-only spike evidence. All five remain
Accepted; the deferred remainder is tracked under `issues/` (0245 R4 on LLP
0146, 0246 R3–6 on LLP 0237, 0247/0248 measurement reruns, 0249 design
tickets).

## Program board — 2026-08-15 media-collection introduction (LLP 0239 R3)

The LLP 0236-derived media program (LLP 0239, Accepted) landed its R3
rollout: the generated bounded `assetCollection` relation with stable
non-reused item identity, atomic mutation-host operations, the author-ruled
closed D4 sharing grammar, and GC/quota/invalidation/consistent-cut custody.
`assets.media-collection.v1` enters experimental (LLP 0134 same-commit act;
record
`tests/acceptance/maturity/media-collection-2026-08-15.introduction.json`).
The remaining R4 media command, collection client hook, and guide Paths 2/4
stay tracked in `issues/20260815-finish-media-happy-path.md`.

2026-08-16 addendum — R4 landed: `defineMediaCommand` (closed
`MediaCommandBindingV1`, command-only mutation ingress, atomic staging
through the R3 collection writer, multi-source `CommandTask` with
ambiguity/retry/residue semantics, and the author-ruled explicit
`mapping.operation` + direct-recipient principal mapping).
`assets.media-command.v1` enters experimental (LLP 0134 same-commit act;
record `tests/acceptance/maturity/media-command-2026-08-16.introduction.json`).
Remaining: the collection client hook, guide Paths 2/4, and Expo acceptance
(Scope C of the same ticket).

## Part II — The plan: parity, then past it

### II.1 What "surpass" means — a claim ladder

Each rung is a claim under LLP 0189 — snapshot-bound, requalified after
drift — publishable only per LLP 0197 (all runs reported, instrument
published, rule-4a scenario labeling). Every rung is scoped to the
**pinned model family**; family scope lifts **per configuration**, only
when that rung's own configuration (brief × aid condition) has a
cross-family series at the preregistered N≥3 — P0b's messaging-pair leg
lifts the messaging-configuration rungs only, never L2/L3/L4's other
configurations by transfer. Rungs are labeled
**aid-assisted** wherever any vendor-authored aid — template, example,
recipe, or skill content — materially built the lane's start (0197
rule 4a's full scope, not templates alone), with symmetric predeclared
competitor aid selection.

- **L1 — Aid-assisted efficiency parity.** Skill-web ≤1.2x Convex
  wall **and** ≤1.2x within-family tokens (both required — parity
  bought by doubling inference spend is not parity), messaging brief,
  N≥3 medians, all runs reported.
- **L2 — Equal-proof-bar superiority.** On the equal-proof-bar brief,
  Snapback wins wall or tokens with the other metric inside the L1
  bound, under 0197 rule 4b's success gates (identical budgets and
  stopping rules; failed attempts reported as capability failures) —
  and because a win here is an *ordering* claim, it requires either
  N≥8 on this configuration or a preregistered variance-transfer rule
  from the P0.2 band, stated in the rung matrix. This rung prices the
  moat honestly; a loss publishes as instrument-honesty evidence, not
  as L2.
- **L3 — General authoring efficiency.** L1's bounds on a held-out
  brief variant no vendor-authored aid was designed against (0197
  rule 4a).
- **L4 — Scored superiority.** Rubric wins under the two-layer scoring
  defined in P0.0(e), N≥3, published surfaces, fairness notes.
- **L5 — Revealed preference.** The pick-and-build probe P3 owns
  (preregistered N and decision rule stated there) favors Snapback on
  offline/realtime/media/trust briefs and is at worst neutral on plain
  CRUD — "neutral" = neither platform meets the favors-condition —
  with verdicts **per family, per brief family, per redaction
  condition**, never pooled across cells; the rung needs the
  favors/neutral pattern to hold in every family cell measured.

**The unqualified phrase "surpasses Convex for agent authoring" requires
L3 + L4, with L5 across ≥2 model families as confirmation.** Lower rungs
publish individually under their own labels; no rung is ever stated as a
higher rung's phrase. (Replaces revision (a)'s "V1 or V2" trigger, which
let one narrow win imply the global claim.) The ladder's operative
content is maintained as one **rung matrix** committed under
`benchmarks/` — configuration, aid label, preregistered N and
threshold, aggregation rule, snapshot tuple, invalidation events — and
P5 publishes only from the matrix.

**Requalification:** every published rung names its snapshot tuple
{closure version, competitor version, model build, harness commit,
brief hash} and binds to a claim-scoped qualification digest per LLP
0189 covering every semantic input of the claim — the run records and
verify receipts it reads from *and* the rung matrix, protocol, brief
texts, lane prompts, and scoring definitions that give it meaning, at
their qualification commit — so semantic drift cannot escape the
invalidation boundary. A standing **control-lane cadence** — one
Convex re-run per epoch (monthly or on a competitor minor release) —
watches control drift. Triggers: a material competitor release in the
measured area ages the claim to historical on its own, band breach or
not; a control-lane band exceedance triggers an N≥3 confirmatory series
first (single runs never fire requalification; N≥3 only confirms the
exceedance is worth a requalification cycle — attributing the delta to
a cause still needs the protocol's N≥8); a
Snapback promotion or model-epoch change requalifies on the next cycle.
A lapsed claim reads "held at snapshot X," never current. "Convex keeps
improving" becomes a mechanism, not a risk note.

### II.2 Strategy in one paragraph

Do not soften the declarative, typed, evidence-heavy core to imitate
Convex (0186's non-goal, upheld). Close the two remaining self-owned
gap terms (knowledge residue → P1; orientation → P2), make the
measurement price what Snapback actually delivers — in both directions
(equal proof bars, trust-boundary brief, day-2 brief → P3), name an
owner for the one structural deficit (operations → P4), and claim
nothing before the instrument supports it (P0 first, publication last).

#### 2026-08-12 ordinary-TypeScript successor owner map

The later multi-model Clique sweep found a residual layer below the original
orientation term. The accepted LLP 0237–0243 set remains the primary delivery
program; these Draft follow-ons own only boundaries that the set explicitly
deferred or that later runs exposed:

| Owner | Residual | Relationship to this Plan |
| --- | --- | --- |
| LLP 0245 | infer, show, and freeze explicit declarations | attacks authored transcription after schema-reference compression without making inference authoritative |
| LLP 0246 | `.ts`/`.mts` custody in the bounded handler graph | closes the TypeScript module/IDE path that LLP 0237 deliberately deferred |
| LLP 0247 | auth-gate recovery, optional-`undefined` normalization, presence withdrawal, and refusal access | removes repeated ordinary React/TypeScript traps under LLP 0238's lifecycle vocabulary |
| LLP 0248 | same-snapshot bounded batch id/unique-index reads | makes the imperative fallback avoid handler-side N+1 host calls without widening LLP 0242's projection algebra |
| LLP 0249 | explicit package-capable trusted actions | forces the Node/package escape-hatch decision without weakening the portable deterministic profile |

None changes a claim rung. P0/P3 must measure them from a published external
package, and P4 remains the sole owner of the broader shareable-deployment and
operations posture rather than acquiring a duplicate plan.

### II.3 Phases

**P0 — Instrument before claims (immediate; owner: `benchmarks/` under
0186 W1).** Staged, so the evidence bar rises without pricing the plan
out of execution:

- *P0.0 — schema/protocol amendments landed before the repeats*:
  (a) `tokens.phases` mirroring `wallClock.phases` — this makes the
  **orientation and verification token shares** record facts (I.5
  terms 1 and 3; term 2 is proxied by (c), term 4 is P4's leg — the
  full four-term decomposition is not claimed as a schema fact), and
  phase attribution is *required* on P0 runs even where the protocol
  otherwise permits "unavailable"; resolves OQ5; (b) a
  first-green-proof timestamp per lane (II.4's "first fifteen minutes"
  gets a number); (c) sub-attribution on `snapback-defect`-attributed
  loops — `defect` vs `knowledge-gap` — as a sub-field of the existing
  enum value, preserving series continuity and the protocol's
  discoverability tie-break, so P1's exit reads from records; (d)
  rubric scoring required by the record format (`records/schema.md` +
  README procedure — the JSON schema alone is optional today); (e) the
  **two-layer scoring definition L4 reads from**: the frozen 0058
  rubric continues for messaging (longitudinal integrity); every other
  brief family gets a preregistered outcome rubric frozen with the
  brief, plus the invariant platform dimensions (DX, diagnostics,
  operations); cross-brief aggregation by noninferiority/dominance
  counts, never by averaging unexercised dimensions; schema extended
  accordingly.
- *P0.1 — N≥3 confirmatory series* on the run-5 configuration:
  ratchet-eligible medians + ranges per 0197 rule 1 and
  `benchmarks/protocol.md`. **No variance band is claimed at N≥3** —
  the protocol's floor for variance claims is N≥8.
- *P0.2 — N≥8 variance study on the primary pair only* (skill-web vs
  Convex), blocked design: alternating lane order (ABBA), runs paired
  within time blocks, fleet load recorded. Produces the band and the
  ratchet tolerance (answers 0186 OQ2).
- *P0b — cross-family replication leg* (promoted from revision (a)'s
  OQ3: the dominant term — prior familiarity — is a property of the
  model family, so every rung is exposed to being a one-family
  artifact): re-run the primary pair under a GPT-family harness at a
  **preregistered N≥3 per condition** — a single-run pilot may precede
  it, but no rung's family scope is lifted, and L5's family panel is
  not satisfied, below the preregistered N≥3 (0197 rule 1). Two
  conditions: **native ecosystem discovery** (skill found via
  `AGENTS.md`/`.agents/skills` conventions, not prompt-pasted —
  distribution quality, not payload quality) and pinned-payload for
  comparability. Token accounting is **never pooled across families**
  (tokenizer and hidden-reasoning accounting differ); report
  within-family ratios and wall only. Matrix expansion waits on a
  family interaction appearing.

Exit: standing medians+ranges (N≥3) for all four lanes; a variance band
and ratchet tolerance from the N≥8 primary-pair study; records carrying
token-phase splits, first-proof timestamps, sub-attributed loops, and
rubric scores; a directional answer to "is the ranking family-stable?"

**P1 — Knowledge-residue closure (days–weeks; owners: LLP 0193, 0194,
0196 as drafted; the run-5 round-3 tickets).** The errors-as-docs audit;
the generated API reference — **plus a declaration-source work item this
Plan adds**: 0194 (r5) carries verify-config in its *initial scope* (its
`verify.d.mts` declaration source is already published), so the
remaining named exclusion is the `ctx` handler surface; the work item is
0194 OQ2's `ctx` declaration file plus retrieval probes for every
diary-0069 package-source excursion (verify-config's residue is
discoverability, which the initial scope covers); the template
portfolio (T1/T2; web deps into expo-chat — two runs running). Sharp
defaults, scoped to their governing rulings: the auth-omission
diagnostic (0186 W3, already sequenced); for jobs retry, **not** a
default flip — LLP 0171 Finding D keeps `maxAttempts: 1` and assigns
retry policy to LLP 0070's owner with the effect-safe shape it
specifies (finite cap, jitter/backoff, generation pin, a proved
no-effect stage); this Plan sequences that ask to 0070 and re-owns
nothing. Exit, read from records via P0.0(c): a run with zero
`knowledge-gap`-attributed Snapback loops and no package-source
consultation.

**P2 — Orientation (author-gated; owner: LLP 0195).** The public
surface is the largest unstarted item and the primary lever on the
dominant term — as **pre-install orientation and discoverability**,
which 0195's own decision case rests on; the training-data effect is
upside on 0195's stated unverified hypothesis, not a scheduled return.
Two additions from this loop: (a) skill distribution is itself an
acceptance surface — cold discovery through `.agents/skills`,
`.claude/skills`, and scaffold `AGENTS.md`, tested per ecosystem, never
simulated by prompt-pasting; (b) P2's measurement is the orientation
*decomposition* the P0.0 token split enables — prior-only / public-web
/ native-skill / template conditions on the same pinned model isolate
where the next orientation dollar goes. Exit: a cold agent with no
pre-installed skill reaches the paved path from the public web;
orientation reported from record fields, by condition.

**P3 — Make the briefs price the product in both directions (owner:
this Plan; instrument changes land under `benchmarks/` conventions).**

- Run the authored-but-never-run **equal-proof-bar messaging brief**.
  Prediction on record: the Convex lane must build a real outbox (run-1
  diary priced that as "a significant feature, not a fair incidental
  shim") and the efficiency ratio inverts. Either outcome is
  publication-grade signal — a win claims L2; a loss publishes as
  instrument-honesty evidence.
- **Author and run a trust-boundary brief** (replacing revision (a)'s
  "real-auth brief," whose "idiomatic production auth" framing would
  have mixed trust-boundary quality with identity-provider choice and
  account ceremony). Pattern: the equal-proof-bar shape — vendor-neutral
  *outcome* requirements with negative proofs: (a) identity is
  server-derived — no client-supplied sender reaches storage; (b) a
  valid principal-X token cannot read a conversation X is not in,
  proven by a two-principal negative test (0057's shape, the corpus's
  only real-auth precedent); (c) unauthenticated requests to protected
  operations are refused; (d) revocation takes effect on the live
  connection. Each lane meets the outcomes via its platform's
  recommended path; principals and credentials are preprovisioned and
  the measured window is clock-bounded per `protocol.md`, so provider
  ceremony stays outside the construct; both lanes publish per 0197's
  publication-safe projection (raw transcripts never publish).
  Identity-provider *onboarding* ceremony is OQ2's residual.
- **Author and run a day-2 evolution brief**: starting from frozen
  post-messaging-run artifacts with a cold-context agent, three
  scripted change requests — add a field and migrate live data; add a
  feature touching schema + client; a pure refactor. The starting
  artifacts are paired configuration inputs: each platform's artifact
  must have passed the same messaging acceptance bar
  (acceptance-equivalent starts), its hash is part of the
  configuration cell, and re-freezing is a new configuration — so
  repeats measure evolution cost, not one lucky or poor prior
  implementation. Prices I.6's greenfield caveat (the artifact-identity
  tax, deployment pinning vs the edit loop) — Snapback's hidden
  weakness, symmetric to the auth seam hiding its hidden strength.
- **Run the pick-and-build preference probe** (L5's instrument, owned
  here): the agent picks a backend from redacted surface artifacts,
  then must build the brief with its pick; the record captures the
  pick, post-build preference (regret or switch), and whether the
  justification cites properties the measured record supports.
  Preregistered: N≥5 fresh contexts **per cell** (model family × brief
  family × redaction condition); "favors Snapback" = strict majority
  of picks with no majority post-build regret, judged per cell and
  never pooled; the publication label carries the redaction condition
  (OQ4's residual).
- Run the CRUD and media briefs — labeled aid-assisted where T1/T2 or
  any vendor-authored aid applies, held-out variants frozen before
  measurement for any general claim, symmetric predeclared competitor
  aid selection (0197 rule 4a). **Preregister the plain-CRUD control as
  expected to favor
  Convex, and publish it either way** — a credible loss is stronger
  instrument evidence than another fairness disclaimer.

Exit: efficiency + scoring records across ≥3 brief families at N≥3,
including one brief adversarial to Snapback and one pricing each
direction's hidden dimension.

**P4 — The operations dimension (author decision required; no current
owner).** The 62–70 vs 96 deficit drags L4 at every scoring until
addressed (≈2.6 weighted points on a 10%-weighted dimension — option
(c) can outscore it elsewhere, which is exactly why it is a live
option). **Before the sitting, gather evidence**: a small
deploy-and-operate brief leg, once per platform — reach a shareable URL
that survives the authoring session, read logs after an induced error,
restart, rotate a secret, clean up — recording time, logins, manual
interventions. That converts a judged score into a cost table. Author
options: (a) productize the hosted lane (LLP 0099 direction) to
one-command parity; (b) argue scale-to-zero self-hosting as a
different-but-equal operations model — as a **new, preregistered,
separately-published scorecard for future claims only**; the frozen
0058 rubric and already-scored records are never redefined post hoc;
(c) accept the deficit and compete on the other seven. This Plan's only
assertion: the choice should be explicit — it is the last structural
term in the gap.

**P5 — Publish (owner: LLP 0197).** When a rung of II.1 holds under P0
discipline, publish it under the 0197 standard **naming the exact rung
and scope** — never a higher rung's phrase. The fork-publication lesson
(2026-08-07: publication withdrawn same-day by wave drift) is the
cautionary precedent: publish snapshots with digests, run the
control-lane cadence, and let requalification lapse a claim to
historical rather than defending it.

### II.4 What must not change

Restated from 0186 with three more runs of evidence: the ephemeral
primitive, platform offline, typed assets, the closed result contract,
enforced determinism, server-derived identity, and the verify/evidence
culture are the product. Every one is now attached to a competitor cost
the lanes measured (I.4). The endgame is making the first fifteen
minutes as cheap as Convex's — now a measured quantity via P0.0(b) —
while keeping the semantics Convex would have to rebuild; not meeting
in the middle.

### II.5 Risks

- **Convex keeps improving** (best-ever run 5). Mitigated by mechanism:
  II.1's control-lane cadence and requalification tuple.
- **Familiarity timescale.** Even if 0195's training-data hypothesis
  pays off, it pays at training-cut cadence; until then the orientation
  term has a floor set by retrieval and injection quality. L3 may be
  unreachable this year — say so rather than gaming the brief.
- **Rubric overfit.** The 0058 weights price offline at 20%. Answer
  under 0197: per-dimension scores always published, weights'
  provenance stated (frozen 2026-08-05, before any Snapback win
  existed), two-layer scoring keeps unexercised dimensions out of
  cross-brief aggregation.
- **One-family artifact risk.** The series is Fable-5-shaped until P0b
  runs; every rung is scoped to the pinned family until then.
- **Fleet drift vs claims.** Every number here is a dated snapshot;
  LLP 0189 discipline is load-bearing for this entire Plan.

## Open questions

- **OQ1 — Operations posture.** RULED 2026-08-08 (author): run the P4
  deploy-and-operate evidence leg first, then choose among the three
  options on the measured cost table. The posture choice itself remains
  open pending that evidence.
- **OQ2 — Identity-provider onboarding.** The trust-boundary brief
  prices security outcomes vendor-neutrally; does *onboarding* ceremony
  (provider setup, credentials, account flows) deserve its own priced
  brief, or is it provider-dominated noise?
- **OQ3 — Family-matrix expansion rule.** What family-interaction
  signal justifies expanding beyond P0b's two families, given each
  family-lane is a full serial run cost?
- **OQ4 — Pick-and-build probe mechanics.** How much surface redaction
  survives contact with reality (both platforms are identifiable from
  their artifacts), and should the named-platform condition publish
  alongside the redacted one (the GPT-family review's brand-prior
  point)?
- **OQ5 — resolved by P0.0(a):** token-phase splits mirror the
  wall-clock phases; kept as a disposition record.
