# LLP 0198: Surpassing Convex on agent authoring — state of the world and the closing plan

**Type:** Plan
**Status:** Draft
**Systems:** Competitive evaluation, Developer experience, Documentation,
Templates, Error handling, Operations, Publishing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Related:** LLP 0186 (the efficiency program this synthesizes and
extends), LLP 0187 (discoverability), LLP 0189 (verification cadence and
claim gating — governs every claim below), LLP 0193 (errors-as-docs),
LLP 0194 (generated API reference), LLP 0195 (public documentation and
training surface), LLP 0196 (template portfolio), LLP 0197 (benchmark
publication standard), LLP 0130 (Convex parity standing decisions),
diaries 0057–0060 and 0065–0069, `benchmarks/` (harness and records)

## Summary

Five instrumented measurement runs (2026-08-05 → 2026-08-08) plus the
qualitative bakeoff corpus now give a complete picture of where Snapback
stands against Convex as a backend for coding agents. The short version:
**the defect war is won and the knowledge war is winnable; what remains
after that is orientation (training-data presence), operations
productization, and the discipline to claim a win only when the
instrument supports it.** Run 5 (diary 0069, npm 0.1.15) recorded zero
framework defects in any Snapback lane for the first time — the entire
skill-lane backend passed codegen and typecheck first-try — yet Convex
still finishes the same brief in roughly half the wall-clock and 45% of
the tokens, almost entirely because the model already knows Convex and
must still read to learn Snapback.

This Plan does three things no single existing document does:

1. **Captures the current state in one place** — the measured series, the
   correction-loop trajectory, the scored-rubric record, the qualitative
   likes/dislikes synthesis across eight diaries, and Convex's own
   strengths and weaknesses as the lanes found them.
2. **Defines "surpass"** as four explicit victory conditions with the
   evidence each requires under LLP 0189's claim-gating rules.
3. **Sequences the endgame** — the already-owned lanes (0193–0197), the
   two gaps no document owns yet (operations productization; a brief that
   measures the trust-boundary dimension the current corpus zeroes out),
   and the N≥3 measurement protocol that must precede any claim.

This Plan re-owns no mechanism from 0186/0187/0193–0197; where those
documents own a lane, this Plan cites and sequences it. Its original
contributions are the synthesis (Part I), the victory conditions, the
real-auth brief proposal, and the operations-dimension ask (Part II).

---

## Part I — State of the world (evidence base, dated 2026-08-08)

### I.1 The measured series

Same WhatsApp-shaped brief, same machine (M5 Max, shared with fleet
load), serial cold-context lanes, published surfaces only from run 2
onward, token counts from the orchestration harness. Primary tracked
pair: skill-equipped Snapback web lane vs Convex.

| Run | Date | Basis | Snapback skill lane | Convex | Wall ratio | Token ratio |
|---|---|---|---|---|---:|---:|
| 1 (diary 0058) | 08-05 | in-checkout, Codex | 26m03s (no skill yet) | 11m15s | 2.32x | unmeasured |
| 2 (diary 0065) | 08-06 | npm 0.1.10, bare | 36m33s / 330k tok | 12m27s / 101k | 2.94x | 3.26x |
| 3 (diary 0066) | 08-07 | npm 0.1.12 | 64m00s / 329k | 14m01s / 111k | 4.57x | 2.95x |
| 4 (diary 0068) | 08-07 | npm 0.1.13 | 26m22s / 226k | 16m36s / 113k | **1.59x** | **2.00x** |
| 5 (diary 0069) | 08-08 | npm 0.1.15, first harness-native | 19m00s / 201k | 10m18s / 90k | 1.84x | 2.24x |

Reading rules established by the series itself:

- **Absolute Snapback numbers improve monotonically** once the run-3
  regression (unpaved web carrier) was repaired: skill-lane wall
  64m → 26m → 19m; tokens 329k → 226k → 201k. Every Snapback lane in
  run 5 posted its best-ever wall and tokens.
- **The ratio is inside the noise.** Convex's run-5 lane was also its
  best ever (previous band 12.5–16.6m / 101–113k), so the ratio moved
  1.59x → 1.84x with N=1 per configuration against a demonstrated ±30%
  per-lane variance band. Diary 0069's verdict stands as this Plan's
  measurement posture: *ratio movement of this size is not a signal in
  either direction; claiming the trend either way requires the N≥3
  protocol.*
- Run 3 is the cautionary tale in both directions: a structural wall
  (web carrier) tripled the gap in one release, and one seven-fix layer
  reversed it completely in the next. The gap is release-sensitive in
  both directions; single-run claims are worthless.

Secondary lanes (run 5): bare-web 29m35s / 212k (2.87x / 2.36x) —
the 0.1.15 template defaults produced the largest single-release
improvement of the program by deleting whole classes of work (sessions
custody, offline registration, upload plumbing no longer hand-built);
native-simulator 25m14s / 250k (2.45x / 2.78x) with all proofs on the
simulator and zero failed `snapback` invocations.

### I.2 The defect trajectory: walls → papercuts → zero

Framework-attributed correction loops in the skill lane: run 2 **4**
(each costing a diagnosis-plus-workaround cycle — the CORS relay and
offline fallback were real engineering), run 3 **8** (the web-carrier
wall, replicated independently by both lanes), run 4 **3** (all
papercuts), run 5 **0 backend / 0 framework across all three Snapback
lanes**. The corresponding Convex figures were 2–3 per run, resolved
"from its own error messages in minutes" (diary 0065) — that loop-quality
asymmetry, not the loop count, was the felt-experience gap, and it is
what run 5 eliminated.

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
verify-config authoring contract lives only in `verify.mjs` source
(second consecutive run); simulator-proof recipe gaps; the
offline supervisor-origin env var still lacks a guide anchor. Every one
is knowledge-shaped, not defect-shaped — which is precisely why LLP
0193/0194/0196 exist.

Longer-standing open frictions not in the run-5 residue but carried in
the corpus: the doc-comment/artifact-identity edit-loop tax (0186 W4's
remaining item — a comment edit can still force a local-store rollover);
the `optional-user` auth default in sessions apps (the one place the
framework is default-open; diary 0057 escalated it); jobs'
`maxAttempts: 1` default interacting with first-attempt platform
contention.

### I.3 The scored-rubric record

Diary 0058 established the eight-dimension 0–100 rubric now frozen in
`benchmarks/schema/run-record.schema.json` (weights: functional
completeness 20%, realtime+typing 10%, offline 20%, images/assets 10%,
data model + type safety 10%, DX/docs/setup 15%, testability 5%,
operations/maturity 10%). Two scored runs exist:

| Dimension (weight) | Run 1: S / C | Run 2: S / C | Movement and cause |
|---|---|---|---|
| Functional completeness (20%) | 96 / 97 | ~96 / 97 | stable; Convex marginally simpler to prove end-to-end |
| Realtime + typing (10%) | 95 / 80 | 95 / 80 | structural: one ephemeral declaration vs durable table + scheduled expiry + nonce + keepalive |
| Offline behavior (20%) | 94 / 62 | 66 / 62 | the closure gate collapsed Snapback's best dimension in run 2; **repaved for npm consumers 08-07, first-try in all run-4/5 lanes — no scored run since** |
| Images/assets (10%) | 82 / 92 | ~82 / 92 | Convex's 3-step flow "worked immediately"; Snapback's stronger policy/atomicity model taxed by authority ceremony (since paved) |
| Data model + type safety (10%) | 94 / 91 | 94 / 91 | stable Snapback edge (closed result shapes, generated contracts) |
| DX, docs, setup (15%) | 55 / 95 | 72 / 95 | biggest Snapback gain from the W0 plumbing wave; run-5's zero-defect result is unpriced |
| Testability + diagnostics (5%) | 87 / 88 | 90 / 88 | operator CLI + codegen diagnostics praised throughout |
| Operations + maturity (10%) | 62 / 96 | 70 / 96 | **the largest stable structural deficit**: Convex cloud dev is productized; Snapback is local-first with rigor but no equivalent hosted story |
| **Weighted overall** | **84 / 86** | **81 / 86** | run-2 dip = offline forfeit outweighing DX gain |
| Mature-hypothetical (run 1) | **97 / 96** | — | "chat is a local-first replicated log plus ephemeral coordination and referenced media; most deductions today are implementation/packaging maturity" |

No scored rubric has been recorded since run 2. Given that runs 4–5
repaired exactly the two dimensions that produced run 2's deficit
(offline forfeited, DX at 72), the mature-hypothetical flip is plausibly
already the published-surface reality — but under LLP 0189 that is a
hypothesis, not a claim. **P0 below makes scoring the rubric part of
every harness run so the record can say so.**

### I.4 Qualitative synthesis: what agents say

Eight diaries (0057–0060, 0065–0069) agree on a single shape: **writing
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
  acceptance harness caught every real bug before the UI ever ran").

**The friction ledger** (nearly all closed; see I.2): docs-vs-package
drift (0057's top finding — three of its four biggest time sinks from
one gap; closed by the published-closure fence), the human-shaped dev
loop (closed), asset authority ceremony (paved), deployment pinning vs
edit loop (open), sharp defaults (open), closed-shape failures without
field names (closed), knowledge residue (open, owned by 0193/0194/0196).

**Convex's profile as the lanes found it.** Strengths: one command to a
live cloud deployment with zero code corrections; "reactivity is free";
storage is a two-liner; anonymous local mode "remains the standout";
compact TypeScript model; self-explanatory errors; and **zero
documentation consumed in any run** — the training-data moat. Weaknesses
the lanes hit: no offline contract (each lane hand-rolled a ~40–60-line
cache its own report disclaimed as "not a real sync story" — offline
writes would be lost); presence rebuilt expensively from durable
primitives; the three-step upload's orphan window and bearer-URL
snapshotting care; non-ASCII/emoji field names refused only at runtime
("a real sharp edge for chat"); local backend lifetime tied to the CLI
process ("undocumented-feeling"); circular-type inference on untyped
`ctx.runMutation` callers; Node actions unable to read bundled files;
N+1-ish reads at demo scale.

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

With defects at zero, the run-5 skill-lane delta (19m00s / 201k vs
10m18s / 90k) decomposes into four named terms:

1. **Orientation (the dominant term).** Convex lanes read nothing;
   Snapback lanes still read the guide and, at the edges, package
   source. Diary 0069: "the orientation gap is now the dominant term, as
   predicted; it shrinks with training-data presence, not engineering."
   Levers: LLP 0195 (public docs/training surface — "the only available
   lever on the training-data moat"), LLP 0196 (templates: the series
   proved scaffold beats guide beats package source), LLP 0194 (kill the
   package-source excursions), the published skill (already worth ~10m
   wall in run 5: 19m vs 29m35s bare).
2. **Knowledge residue.** The specific run-5 excursions of I.2 — each
   maps 1:1 onto 0193/0194/0196 work items already drafted.
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

- N=1 per configuration everywhere; demonstrated ±30% per-lane variance;
  same shared machine; one model family for runs 2–5 (Claude Fable 5;
  run 1 was Codex). No ratio claim without the N≥3 protocol
  (`benchmarks/README.md`, LLP 0186 OQ1/OQ2, LLP 0197 requirement 1).
- One brief family (messaging) has ever been run; it favors
  realtime-native platforms (0186 OQ4). CRUD and media briefs are
  authored but unrun.
- **The auth seam caveat, which cuts against Snapback:** every messaging
  arm on both sides used a client-supplied test-persona seam, not real
  authentication. The corpus therefore systematically measures the
  dimension Snapback is weakest on (setup ceremony) while zeroing the
  dimension it is strongest on (structural trust boundaries) — diary
  0057, the only real-auth run, is also the most pro-Snapback verdict.
  No current brief prices this. Part II fixes that.
- Convex is a moving target: its run-5 lane was its best ever, and its
  weaknesses list is dated 2026-08-08 against the versions the lanes
  used.

---

## Part II — The plan: parity, then past it

### II.1 What "surpass" means — four victory conditions

Each condition is a claim under LLP 0189: snapshot-bound to a scoped
qualification digest, never a gate requiring a complete proof at an
exact commit, and requalified after drift rather than asserted as a
standing fact.

- **V1 — Efficiency parity (measured).** Skill-web lane ≤1.2x Convex
  wall-clock on the messaging brief (LLP 0186 outcome 1), established by
  the N≥3 protocol, then held by the ratchet. Stretch: ≤1.0x — plausible
  only after the orientation term shrinks (P2/P3), and honestly labeled
  as contingent on training-data presence.
- **V2 — Rubric win (scored).** `weightedOverall` ≥ Convex on published
  surfaces across ≥2 brief families under the frozen 0058 weights, N≥3,
  with fairness notes attached. Given I.3, this is likely the first
  condition to fall; it is unclaimed until scored.
- **V3 — Preference (stated).** In a fresh-context choose-your-backend
  probe (agent given both platforms' public surfaces and a brief, asked
  to pick and justify before building), agents pick Snapback for briefs
  with offline/realtime/media/trust requirements and are at worst
  neutral on plain CRUD. This is the qualitative flip of run 1's "I
  would choose Convex this week," and it is only meaningful once P2
  gives agents a public surface to orient on.
- **V4 — Publishable.** V1/V2 evidence published under LLP 0197's
  standard (instrument, briefs, raw records, all runs reported).

### II.2 Strategy in one paragraph

Do not soften the declarative, typed, evidence-heavy core to imitate
Convex (0186's non-goal, upheld). Close the two remaining self-owned
gap terms (knowledge residue → P1; orientation → P2), make the
measurement price what Snapback actually delivers (equal proof bars and
a real-auth brief → P3), name an owner for the one structural deficit
(operations → P4), and claim nothing before the instrument supports it
(P0 first, publication last).

### II.3 Phases

**P0 — Variance before claims (immediate; owner: `benchmarks/` under
0186 W1).** Run the N≥3 repeat protocol on the exact run-5
configuration (0.1.15, messaging brief, four lanes) to establish the
per-lane variance band. Score the 0058 rubric as part of every harness
run from now on — the schema requires it and runs 3–5 skipped it, which
is why I.3's most important row is a hypothesis. Exit: standing
mean±band numbers replacing all N=1 ratios; first scored rubric since
run 2; ratchet tolerance derivable from data (answers 0186 OQ2).

**P1 — Knowledge-residue closure (days–weeks; owners: LLP 0193, 0194,
0196 as drafted; the run-5 round-3 tickets).** The errors-as-docs audit,
the generated API reference (its acceptance test is exactly I.5's
excursion list: `ctx.db` verbs, headless call shapes, verify-config
contract, constructor pairs — none should require `node_modules`), the
template portfolio (T1/T2 matching the committed briefs; web deps into
expo-chat — two runs running). Also the two sharp defaults from I.2
(auth `optional-user`; jobs `maxAttempts: 1`) — cheap, corpus-flagged,
author-visible. Exit: a measurement run in which no Snapback lane opens
package source and knowledge-attributed loops are 0, matching the
defect-attributed 0 already achieved.

**P2 — Orientation and the training-data lever (author-gated; owner:
LLP 0195).** The public documentation surface is the largest unstarted
item and the only lever on the dominant remaining term. This Plan adds
one sequencing note to 0195: publish *before* pressing V1's stretch
goal, because every run demonstrates the ceiling — an agent cannot pay
less than one full guide-orientation pass for a platform whose docs
exist nowhere it has ever seen. Exit: cold agent with no skill installed
reaches the paved path from the public web; orientation cost measured as
its own wall/token split (the harness already supports the split).

**P3 — Make the briefs price the moats (owner: this Plan; instrument
changes land under `benchmarks/` conventions).**

- Run the authored-but-never-run **equal-proof-bar messaging brief**:
  identical offline read and offline-write semantics required from every
  lane. Prediction on record: the Convex lane must build a real outbox
  (run-1 diary priced that as "a significant feature, not a fair
  incidental shim") and the efficiency ratio inverts. Either outcome is
  publication-grade signal.
- **Author and run a real-auth brief** (new work item): both lanes
  implement their platform's idiomatic production auth (Snapback
  sessions custody; Convex's auth integration), retiring the
  test-persona seam that zeroes Snapback's strongest dimension (I.6).
  Fairness rule: each platform's own recommended path, no imported
  ceremony.
- Run the CRUD and media briefs so wins don't overfit to chat, and so
  the Supabase/PocketBase/Postgres lanes can enter without being
  strawmen (0186 OQ4).

Exit: rubric + efficiency records across ≥3 brief families, each N≥3.

**P4 — The operations dimension (author decision required; no current
owner).** The 62–70 vs 96 deficit will cap V2 at every scoring until
addressed. Options, for an author sitting rather than this Plan to
decide: (a) productize the hosted lane (the LLP 0099 hosted-executor
direction) to genuine one-command parity; (b) sharpen the existing
local-first + Cloudflare deploy story and contest the dimension's
definition — scale-to-zero self-hosting *is* an operations story, argued
under 0197's fairness notes; (c) accept the dimension deficit and win
V2 on the other seven. This Plan's only assertion: the choice should be
explicit, because it is the last structural term in the gap.

**P5 — Publish (owner: LLP 0197).** When V1 or V2 holds under P0
discipline, publish under the 0197 standard. The fork-publication
lesson (2026-08-07: publication withdrawn same-day by wave drift) is the
cautionary precedent: publish snapshots with digests, not standing
claims.

### II.4 What must not change

Restated from 0186 with three more runs of evidence: the ephemeral
primitive, platform offline, typed assets, the closed result contract,
enforced determinism, server-derived identity, and the verify/evidence
culture are the product. Every one is now attached to a competitor cost
the lanes measured (I.4). The endgame is making the first fifteen
minutes as cheap as Convex's while keeping the semantics Convex would
have to rebuild — not meeting in the middle.

### II.5 Risks

- **Convex keeps improving** (best-ever run 5); the ratchet must track a
  moving control, which is another reason P0's bands come first.
- **Training-data timescale.** P2 seeds the next training cut at
  earliest; until then the orientation term has a floor. V1-stretch may
  be unreachable this year — say so in publications rather than gaming
  the brief.
- **Rubric overfit.** The 0058 weights price offline at 20%; a critic
  will note it favors Snapback. Answer under 0197: publish per-dimension
  scores, not just the weighted total, and publish the weights'
  provenance (frozen 2026-08-05, before any Snapback win existed).
- **Fleet drift vs claims.** Main moves continuously; every number here
  is a dated snapshot. LLP 0189 discipline is load-bearing for this
  entire Plan.

## Open questions

- **OQ1 — Operations posture.** Which P4 option — hosted productization,
  contest-the-definition, or accept-the-deficit? Author decision;
  everything else in this Plan proceeds regardless.
- **OQ2 — Real-auth brief fairness.** Does "each platform's idiomatic
  auth" survive review as fair when the platforms' auth models differ
  this much in shape? Proposed test: publish both lane transcripts and
  let the fairness notes carry the asymmetry.
- **OQ3 — Model diversity.** Runs 2–5 are one model family. Does the
  ranking hold on other families, and does V3's preference probe need a
  multi-family panel to mean anything? (Extends 0186 OQ1's
  pin-one-model-per-epoch question to the qualitative claims.)
- **OQ4 — Choose-your-backend probe design (V3).** A stated-preference
  probe is cheap but gameable by prompt framing; what framing makes it
  honest, and should it be run blind (platform names redacted, surfaces
  only)?
- **OQ5 — Proof-surface token accounting.** Should records split
  proof/verification tokens from build tokens so the deeper-proof
  asymmetry (I.5 term 3) is visible in the efficiency numbers instead of
  silently inflating them?
