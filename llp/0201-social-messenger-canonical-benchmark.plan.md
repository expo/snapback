# LLP 0201: Social-messenger canonical benchmark

**Type:** Plan
**Status:** Accepted
**Systems:** Competitive evaluation, Benchmarks, Publishing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-21 (o — D0.6 instrument registration: per LLP 0295
D0.6, the D2 record schema commissions per-milestone-boundary usage,
semantic-action, episode, restart/reseed, browser-wait, host-load, and
orientation fields, harness-native and without cross-harness normalization;
adopted-by-default pending author revision; see the dated amendment);
2026-08-21 (n — M3 typing-observation boundary versioned;
the 0.1.21 Simplified red is recorded as a v1 measurement artifact, and the
v2 choreography amendment plus rerun are routed through the P3 ruling queue);
2026-08-12 (m — factual pin: scoring DAG M3 requires M1 only;
reduced-run protocol still sequences M1→M2→M3); 2026-08-11 (l — additive milestone M8: insights/aggregation,
scheduled digest, celebrity fan-out envelope extension, multi-device and
durable-offline obligations; author direction, recorded in the dated
amendments); 2026-08-10 (k — P2 F2 choreography hardening: M6 native
evidence is separately recorded from web authoring green, while required web
checks remain fail-closed); 2026-08-09 (j — author clarification for future benchmark
runs: the Following feed always includes the viewer's own posts and reposts
without a persisted self-follow edge; the completed P2 pilot is not
retroactively changed); 2026-08-08 (i — Review → Accepted, applied on the
author's in-session ruling. Final review verdicts bind revision
(g) — round 6 dual NOT READY with all MATERIAL concerns convergent
and fixed in revision (h), which is **unreviewed**; its spot-review
folds into the P3 freeze gate. Full history: Revision history
section at the end of this document.)
**Related:** LLP 0197 (benchmark publication standard — governs every
publication from this instrument), LLP 0198 (surpass-Convex plan — this
Plan adds a brief family to its instrument and rows to its rung matrix),
LLP 0189 (claim gating), LLP 0186 (efficiency program), LLP 0193
(errors-as-docs — the diagnostics rubric dimension reads its standard),
`benchmarks/` (harness, protocol, records),
`benchmarks/briefs/social-messenger.md` (the authoritative app spec),
diaries 0058–0069 (the calibrated messaging series this extends),
`guide/capabilities.md` (the coverage map the app was designed against),
LLP 0295 (published-matrix improvement program — its D0.6 measurement
fields are registered in the 2026-08-21 dated amendment), LLP 0281
(benchmark instrument observability closure — the coordinated version
bump these fields ride),
`issues/20260809-per-milestone-token-metering.md` (D0.6 implementation
ticket), `issues/20260820-matrix-lane-skill-routing-context-budget.md`
(orientation carrier),
`issues/shelved/20260821-clique-instrument-observability-version-bump.md`

## Summary

The existing messaging brief is deliberately small — a 10–65 minute
lane that made five instrumented runs affordable. It cannot price real
authentication (it pins a test-persona seam), push notifications,
schema evolution, media lifecycle, search, offline *writes*, or a
third-party API surface. This Plan defines the **canonical full-app
benchmark**: one super-specified social-messenger application
— named Clique: WhatsApp-shaped group messaging plus a follow-graph
social feed — built as
an Expo app on each competing backend, structured as **eight ordered
milestones with per-milestone acceptance, budgets, and metrics**, so
variance localizes, partial credit exists, and per-capability
comparison falls out of the record.

The instrument keeps the established quantitative core (wall clock,
tokens, tool calls, correction loops under the protocol's attribution
rule) and adds what the small brief lacks: an **independent quality
gate** (a grader agent from a different model family, executing a
frozen checklist plus rotated holdout probes), a
**performance-at-scale gate** (a backend-neutral action-log replay to
a published scale envelope, judged by hardware-independent degradation
rules), a **preregistered
16-dimension anchored rubric** split between builder-scored experience
and grader-scored outcome, a **non-formulaic holistic score**, and a
**narrative layer** (per-milestone diary entries plus a 1–2 page
closing essay written before the agent sees any numbers).

The existing messaging brief stays frozen for longitudinal integrity;
`social-messenger` is a new brief family with its own rubric (LLP 0198
P0.0(e)), its own rung-matrix rows preregistered at brief freeze, and
no claim inheritance from the messaging configuration.

## D1 — The app, and why this app

The authoritative spec is `benchmarks/briefs/social-messenger.md`; the
app's product name is **Clique** (the brief family and measurement
identity remain `social-messenger`). The design intent: **the brief decides everything two reasonable agents
would build differently, so the only decisions left to the lane are
backend-shaped** — schema, auth wiring, sync strategy, media pipeline,
API surface. Screens, fields, behavior windows, group semantics, the
receipt state machine, media constraints, and conflict policy
(last-write-wins) are all pinned in the brief.

Milestones (reduced run = M1–M3; full run = M1–M8; numbering is
identity, not execution order — the continuous session runs M1–M6
then M8, with M7 fresh-session after grading):

- **M1 — Accounts and profiles.** Real email+password auth (no email
  sending; verification out of scope), sessions surviving restart,
  pinned profile fields, avatar upload, profile editing.
- **M2 — Posts and the follow graph.** Text/image/video posts, likes,
  reposts (no quote posts), flat reply threads, follow/unfollow with
  live counts, and two reverse-chronological feeds — Following
  (default, always including the viewer's own posts and reposts as an
  implicit self-follow) and Global. The implicit self-follow is feed
  membership only, not a stored edge or a contribution to follow counts.
  The Following feed is a genuine
  fan-out/read-model decision (fan-out-on-write vs read-time
  filtering) that the brief pins only by observable behavior, leaving
  the architecture backend-shaped. Identity is entirely in-system —
  no device address book, no phone-number identity (that flow needs
  SMS and measures OS permission plumbing, not the backend).
- **M3 — Messaging core.** Deduped DMs, group chats as entities,
  admin add/remove without invitation flow, typing indicators,
  sent/delivered/read receipts, WhatsApp-style quoted replies, seeded
  fixture personas. This milestone is structurally similar to the
  frozen messaging brief; **no longitudinal comparison is claimed** —
  the configurations differ (real auth instead of the persona seam;
  media, reactions, and offline arrive in later milestones).
- **M4 — Media messages, reactions, edit/delete.** Photo/video
  messages end-to-end, emoji reactions, edit within 15 minutes,
  delete-for-everyone within 1 hour (tombstoned).
- **M5 — Ephemeral, chat config, search.** Disappearing messages
  (off/24h/7d, server-enforced), view-once photos (second view denied
  server-side), per-chat name/color/background customization, people
  search, in-chat and global message search (results for synced
  messages must be available offline).
- **M6 — Offline writes, push, custom-client API.** Cold-start
  offline history (separately recorded native-simulator proof here), offline compose with
  queue-and-flush and correct receipt transitions, push notification
  emission at the provider seam (logged payload; real APNs/FCM out of
  scope — that would measure Apple, not the backend), and a
  documented third-party API: token auth, list conversations,
  paginated history, send, receive (stream or documented polling),
  proven by a headless demo script the grader can run.
- **M7 — Day-2 evolution.** In a **fresh agent session** (same aid
  condition — skill, kit, docs posture — as the lane it continues),
  add group polls (a new message type with live tallies and
  offline-queued votes) **plus a backfilled field**: conversations
  gain a message count shown in chat settings, backfilled for all
  existing chats and maintained forward — polls alone can be built in
  a new table without touching existing data, so the backfill is what
  forces a real migration. **M7 runs against the pre-replay starter
  state** (author ruling, 2026-08-08): a fresh backend instance
  seeded with the starter log, not the scale replay's ~100k-message
  database — cost containment and clean snapshot verification
  outweigh the migration-at-scale signal, which remains available as
  a future leg. No data loss, verified against a **pre-M7 snapshot
  exported through the M6 custom-client API** over the brief's
  pinned message field manifest (backend-neutral by construction,
  and cheap at starter-state size). M7 runs on its own recorded
  clock, writes its own diary entry and essay under the same
  sequencing rules, and its session scores rubric dimension B8
  (recorded null by the M1–M6 builder).
- **M8 — Insights, digest, and multi-device offline** (2026-08-11
  amendment; authored in the continuous session immediately after
  M6, requires M6; M7 unchanged). Three coverage holes the first
  seven milestones left open, deliberately closed as one additive
  milestone so prior records stay comparable (they record M8
  `not-run`): **aggregation read-models** (an Insights screen with
  six lifetime totals and a 7-day activity breakdown, plus a
  24-hour Trending feed tab — the app's first group-by/ranking
  surfaces, with degradation rules at the envelope so client-side
  corpus paging fails structurally); **genuinely scheduled work**
  (a per-user daily digest emitted through the M6 push seam on a
  config-driven schedule with no client connected — the first
  obligation lazy read-triggered enforcement cannot satisfy, so
  the cron row can no longer go unexercised); **fan-out under
  load** (the scale envelope gains a celebrity followed by 900 of
  the 1,000 users with write-path and read-path degradation rules,
  so the M2 fan-out decision's cost becomes measurable); and
  **offline depth** (same-account multi-device convergence
  including cross-device read state, dual-offline compose
  converging under the unchanged last-write-wins ruling, and
  queued writes surviving app restart as a separately recorded
  native artifact). The brief pins the full spec and 8-item
  checklist.

M7 prices the edit-loop story LLP 0198 flags as plausibly Convex's
second advantage — but as an **integrated, artifact-coupled
measurement**: across repetitions its cost varies jointly with the
quality of that repetition's M1–M6 output. Isolated day-2 *claims*
remain the province of LLP 0198 P3's paired-start day-2 brief (frozen
acceptance-equivalent starting artifacts); this instrument
complements, and does not replace, that brief. Likewise this
instrument's trust probes complement rather than subsume 0198 P3's
trust-boundary brief; if the two programs' budgets collide, the
overlap is a scoping decision recorded in the rung matrix, not silent
double-spend.

Coverage rationale: against `guide/capabilities.md`, the app exercises
schema/functions/codegen, live queries, ephemeral state, assets,
expiry enforcement (disappearing messages — schedulable or lazily
enforced, a backend-shaped choice; view-once is
deny-after-first-view access revocation),
text search, offline reads *and writes*, real sessions and
scoped auth, actions and the notification seam, migrations and record
history, the client protocol/headless arm, and acceptance testing.
The 2026-08-11 M8 amendment adds the previously-uncovered rows:
aggregation/reporting read-models, scheduled server-side execution
(the digest closes the loophole by which the cron row could go
entirely unexercised), high fan-out, and durable-offline/multi-device
behavior.
Deliberately out of scope: vector search, the Swift client, Cloudflare
deploy (lanes run local, like the series), and `operating.*` features
(priced by the operations rubric dimension, not app features).

Session shape: one continuous session through M1–M6 and M8 (context
accumulation is part of the product experience), per-milestone
timestamps and token phases stamped by the harness; M7 runs fresh by
design. A 1–3M-token session will compact; the harness's compaction
policy is pinned per family in the record and **compaction events are
logged**, so within-family variance attributable to context loss can
be inspected rather than guessed at.

## D2 — Quantitative instrument

Unchanged core, per `benchmarks/protocol.md`: wall clock, token counts
(input/output/cache) from the orchestration harness, raw tool
invocations, and correction loops under the protocol's attribution rule
(`snapback-defect` with `defect`/`knowledge-gap` sub-attribution,
`agent-error`, `environment`, `ambiguous`). Additions:

- **Per-milestone phases.** `wallClock.phases` and `tokens.phases`
  (LLP 0198 P0.0(a)) gain a per-milestone dimension; the
  first-green-proof timestamp (P0.0(b)) generalizes to a
  first-green timestamp per milestone. Record schema extension is a
  P1 deliverable.
- **Separate recorded clocks.** The protocol's "last passing
  acceptance evidence" boundary is restated for the milestone
  structure: a milestone's **authoring clock** stops when the
  harness records both a passing run of the milestone's acceptance
  suite **and** a passing run of that milestone's choreography
  segment — required two-client web behavior gates green too, so a
  realtime-heavy milestone cannot go green from its suite alone. M6's
  simulator proof is a separately recorded native/O4 artifact: its absence
  leaves native proof absent but does not block the web authoring-green clock.
  The suite pass
  is honored only if its **coverage manifest** validates: at P1 every
  checklist item is split into atomic assertions with stable IDs,
  each assigned one executor class, and the manifest maps every
  suite-required assertion (not merely every numbered item) to a
  test. The grader later spot-verifies the mapping is honest; a
  dishonest mapping **adjudicates** the milestone to
  `capability-failure` — scoring-only and non-retroactive
  (execution-time statuses, dependencies, termination history, and
  other milestones' clocks stand as run; the lane's published
  authoring wall recharges that milestone to its cap; O1 scores its
  checklist not-passed). The green receipt is a neutral harness
  artifact, not a builder assertion. The lane's authoring wall ends
  at M8 green or final cap (M8 closes the continuous session per the
  2026-08-11 amendment); a `capability-failure` milestone
  contributes its full wall cap **and its actual tokens, flagged
  capped-wall**; when tokens were the exhausted axis it charges the
  token cap plus actual wall, flagged capped-tokens; an `aborted`
  milestone charges exactly like a capability failure (full wall
  cap plus actual tokens, flagged `aborted`) — the abort never
  improves the capped axis.
  When M8 never runs, the lane's authoring wall ends at the last
  runnable milestone's terminal status. Grader
  execution, scale replay and probes, and the M7 session each run on
  **separately recorded clocks** never included in the authoring
  statistic. Published efficiency claims read the authoring clocks
  only; every clock is a distinct record field.
- **Dollar cost** per lane *and per grader session*, computed from
  tokens at the pinned models' published prices; recorded, not a
  claim statistic (it matters once the model matrix compares across
  tiers).
- **Budget caps, the proceed rule, and dependency statuses.** Each
  milestone carries a wall/token cap set by a preregistered formula:
  cap = 2× the slowest tier-1 pilot lane's figure for that milestone
  (the multiplier absorbs the observed ±30% per-lane spread on top
  of an N=1 pilot calibration; that formula is the **wall** cap
  rule). **Cap keys:** the wall cap is keyed by milestone and shared
  by every lane in every family of a wave; the token cap is keyed by
  **(cap family, milestone)** — token accounting is not
  cross-family interchangeable, and there is no per-backend token
  cap. **Cap families enumerate the model matrix exactly:** the
  primary Claude frontier model; the GPT frontier model; the
  mid-tier model (its own cap family — sharing a vendor with the
  primary does not share its caps); Kimi and Grok are each their own
  **cap-advisory** family: wall caps recorded for reference, token
  caps recorded as inapplicable (no mini-pilot, no transfer), never
  enforced — their N=1 cells are not claim-eligible, so enforcement
  would only manufacture noise — with the P2 safety limits applying
  as hard stops. Primary token cap(m) = 2× the largest tier-1 pilot lane
  token figure for m. The GPT and mid-tier families' token cap(m)
  derives from each family's one-lane Convex mini-pilot (GPT scope:
  M1–M3, matching its scored P4 configuration, extended before any
  full-app GPT lane, exploratory included; mid-tier scheduled at P3
  after OQ1's model choice, scope M1–M3, matching its leg) via a preregistered **cross-backend transfer rule**:
  cap(m) = 2× max over tier-1 backends B of [that family's Convex
  figure(m) × primary pilot figure B(m) / primary pilot figure
  Convex(m)] — pilot *figure* ratios, the 2× applied after
  transfer, and transfer-derived token caps clamp at 2× the safety
  limit. Pilot figures read **green** pilot milestones; a pilot
  lane with no green figure for m contributes the safety limit as
  its figure, and the ordinary 2× formula then applies (one rule
  everywhere — P2 uses the same wording — keeping the cap formula
  monotone in pilot outcomes). A single Convex lane has no
  "slowest," and Convex is
  predictably the cheapest lane; the transfer is what prevents
  structurally under-calibrated caps from manufacturing spurious
  failures. Unused budget does not roll over. A lane that exhausts a
  cap records that milestone as a **capability failure** (all runs
  reported, LLP 0197 rule 1; failed attempts reported as capability
  failures per the rung matrix's L2 language) and proceeds — without
  the proceed rule, partial credit collapses and one stuck milestone
  eats the lane. Milestones whose **prerequisites failed** record
  `blocked-by-M{n}`, never counted as an additional independent
  capability failure; the prerequisite DAG is pinned in the brief
  (M6 requires M2–M5, so its checklist's likes/media/view-once/search
  dependencies are honest; scoring DAG: M3 requires M1 only, not M2;
  reduced-run protocol still sequences M1 then M2 then M3, and
  skipping M2 is non-conforming; M7's regression item is conditional on
  previously-green milestones — prior failures are preserved, never
  repaired under M7's budget). A milestone abandoned mid-attempt
  (agent or environment abort before cap exhaustion) records
  **`aborted`** — treated as a capability failure for
  proceed/completeness purposes, distinct in the record. Two
  consecutive capability failures/aborts (blocks don't count) end
  the lane; milestones after a termination record `not-run`, and the
  record carries an orthogonal **termination reason**. Completeness scoring keeps every full-run milestone in the
  denominator regardless of status.
- **Performance at scale** (full-app runs, after M6): a distinct axis
  — everything else measures the *authoring* experience; this
  measures the artifact the lane produced. The brief publishes a
  visible **scale envelope** (~1k users, 50k posts, 100k messages, a
  10k-message chat, 500 follows — visible by design: whether the
  agent designs for scale is part of what is measured) as a
  backend-neutral **action log** each lane replays through its app's
  own write path under the brief's frozen **replay contract** (replay
  order authoritative with settle-before-next, a frozen action schema
  covering every log verb, log timestamps documentary, push seam
  disabled, replay separately clocked with its own wall cap whose
  exhaustion scores O5 — not lane completion; the replay pauses at
  each checkpoint, probe wall time excluded from the replay cap; end
  state verified against the log's invariant manifest, not just spot
  counts). The grader then runs rotated performance probes at the
  log's checkpoint sizes, and **O5 maps deterministically from the
  frozen invariants** — invariant-manifest conformance (a
  nonconforming end state caps O5 at its failure band: the envelope
  was never validly reached), degradation-rule passes, ceiling
  compliance, replay-cap margin — never from perceived speed; the
  exact decision table publishes with the ceilings at P3. **O5 is a scale-safety gate, not a comparative
  speed statistic**: backends run in different deployment postures
  (local binary vs hosted dev deployment), so cross-backend latency
  ordering is not a claim this instrument supports. What O5 scores is
  viability at the envelope under hardware-independent **degradation
  rules** (growth curves across checkpoints, no superlinear deep
  paging, feed latency must not scale with follow count, no
  timeout/OOM), with each lane's deployment posture a pinned record
  field and absolute ceilings calibrated at the pilot. Comparative
  performance claims are a deferred leg requiring a matched
  deployment posture — realistically, once a hosted service exists.

## D3 — Independent quality gate

Scoring splits by who can honestly observe what: **the builder scores
experience; a separate grader scores outcome.**

1. The acceptance checklist is frozen with the brief, per milestone,
   phrased as observable behaviors ("with two clients open, typing in
   one shows the indicator in the other within 2 s, and it expires").

   The M3 typing check's **observation boundary is versioned**:

   - **v1 — clock before synthetic typing.** The clock starts before the
     roughly 45-character `pressSequentially(..., { delay: 25 })` action, and
     the observer wait starts only after that action completes. Clique 0.1.21
     and earlier sweeps used v1, so their reported `visibleMs` includes at
     least 1.1 s of synthetic typing plus browser input/render overhead.
   - **v2 — clock at the measured transition.** Observation is armed and the
     clock starts at the final keystroke, or immediately before the publish
     call that creates that final typing-state transition, and remains armed
     until the other client applies the state. This is the boundary required
     by [LLP 0013's observation-honesty rule](./0013-ephemeral-realtime-state.rfc.md#first-delivery-latency-budget).

   A v1 run and a v2 run are **not comparable like-for-like**. Publications
   and receipts must name the boundary version, compare only within a version,
   and present a correction rerun separately from the historical v1 record.
   In particular, the only red boundary in the 0.1.21 sweep — Simplified M3
   typing at 2,045–2,126 ms against the 2,000 ms ceiling — is a **v1
   measurement artifact**, not observed product delivery latency. The
   instrumented local pipeline measured every segment at no more than 1 ms
   and caller-publish-start → overlay-apply at no more than 1.68 ms; see the
   [closed source ticket](../issues/closed/20260815-ephemeral-typing-first-visibility-misses-2s.md#resolution)
   and its landing commit `3ec6b1782`.
2. The builder ships a scripted acceptance suite plus the M6
   custom-client demo script.
3. The **grader** is a fresh-session agent from the *other* scored
   model family (D5), with a frozen prompt and pinned model, published
   with the instrument. It receives the checklist, the built app
   **including source code** (needed to run the suite and to verify
   code-level obligations like password hashing), and run
   instructions — **not** the builder's diary, self-scores, or
   transcript. It runs the builder's suite, independently executes the
   checklist via the custom-client API and browser automation on the
   web build, and files a severity-bucketed defect list. Native
   (simulator) proofs are not grader-driven: a lane-native harness executes
   the frozen simulator choreography and produces mechanically checkable
   artifacts (recordings plus structured receipts), recorded separately from
   web authoring green; the grader scores O4 from those artifacts, never from
   builder assertions. A sanitized grader evidence/action trace is
   the published artifact (raw transcripts follow LLP 0197's
   redaction posture and 0198's raw-transcripts-never-publish rule);
   grader judgment is identified as the human-judgment layer over the
   deterministic receipts, per 0197 rule 8. For capability-floor and
   exploratory lanes the grader comes from whichever scored family is
   not the builder's; if the builder is from neither scored family
   (Kimi/Grok), the grading family is chosen once per wave and
   recorded.
4. **Grader failure and noise.** A grader-side failure (its own
   environment or tooling) is not a lane defect: the grader re-runs
   once, and a second failure records `grader-abort` — the lane is
   then regraded by the other scored family; if that also aborts,
   O-dimensions record null and the lane is excluded from claim
   statistics while still being reported. Before the first scored
   wave each grader family grades **calibration artifacts** — a
   known-good, a known-bad, and a subtly authorization-broken build
   with planted defects — and a sampled pilot artifact is graded
   blind by **both** families. Calibration is pass/fail on recall
   **and precision**: a family must detect every planted MATERIAL
   defect (missing a planted authorization defect fails outright),
   and any MATERIAL finding against the known-good artifact fails
   calibration unless the author adjudicates it a planting error; an ineligible
   family regrades only after recalibration. A lane regraded by the
   builder's own family (the abort fallback) is labeled
   `same-family-graded` in the record and any publication. The operational grader-noise
   trigger on the duplicate sample counts both severity-bucket
   disagreement beyond one bucket on shared findings **and any
   unmatched MATERIAL finding** as disagreement; tripping it
   escalates to a grader panel for that wave.
5. **Holdout probes.** The grader additionally runs probes the builder
   never saw — trust-boundary shaped (can user A fetch user B's DMs
   through the API; does a removed member still receive messages; is
   a view-once photo's second view denied server-side; does an
   expired edit window actually reject the edit; do server-side
   denials survive the offline cache), and performance shaped (the
   exact queries measured against the brief's published scale
   envelope and degradation rules, per D2). Resolution of the
   conflict with LLP 0197's publish-the-instrument rule: **probes are
   published after each scored wave and rotated for the next** —
   every published claim is retroactively fully inspectable, but no
   builder sees its own wave's **scored** probes. Custody: the wave's
   probe-set file is **committed as a sha256 hash before the wave's
   first lane starts** (the hash lives in the wave record), so the
   set provably was not selected after seeing results. Each rotation
   covers every published probe category with at least one instance.
   **Anchor probes are non-scored** (author ruling, 2026-08-08): each
   category keeps one unchanged anchor across waves as a published,
   quasi-public **continuity diagnostic** — it prices difficulty
   drift but never bears on O3/O5, which read only the wave's secret
   rotated probes. This dissolves the anchor/holdout contradiction:
   publish-everything holds, and the holdout claim is scoped to
   scored probes. The probe set, commitment mechanism, and rotation
   log live under `benchmarks/` (P1 deliverable).

## D4 — Qualitative instrument

- **Rubric.** Sixteen preregistered dimensions, frozen with the brief
  per LLP 0198 P0.0(e): five grader-scored outcome dimensions
  (functional completeness, correctness under grading, trust
  boundaries, observed offline behavior, performance at the scale
  envelope — 45 points of weight) and eleven
  builder-scored experience dimensions (schema/data-model, auth,
  realtime, offline/sync authoring, media/storage, search,
  push/actions, day-2 evolution, DX/docs/setup, diagnostics and error
  quality, operations/maturity — 55 points). Every dimension carries
  a paragraph description **and anchored examples of what ~30, ~60,
  and ~90 look like** — anchors reduce cross-model score variance
  more than descriptions alone. Full text in the brief.
  **Runs score only the dimensions they exercise** (author ruling,
  2026-08-08 — nulls block totals): the brief's reduced-run
  applicability table freezes which dimensions record null on M1–M3
  (O3, O4, O5, B4, B6, B7, B8), and the same rule generalizes to
  full runs — an *attempted*
  (`green`/`capability-failure`/`aborted`) milestone's B-dimensions
  are scored from the attempt; *never-attempted*
  (`blocked`/`not-run`) dimensions record null; **any run with a
  null dimension publishes per-dimension scores and efficiency
  statistics only, no overall weighted total**, per 0198 P0.0(e)'s
  bar on averaging unexercised dimensions. The brief pins each
  dimension's **observing milestones**; P1 freezes the full
  dimension-by-milestone applicability manifest the record schema
  reads. A **complete lane**, by enumeration: M6 green, the replay
  attempted, M7 attempted, and every other milestone attempted —
  that is *execution* completeness; a weighted total and L4
  eligibility additionally require a **usable grading record**
  (D3.4's dual-abort outcome — O-dimensions null — overrides
  applicability). The published completion rate counts execution
  completeness; total-eligibility is reported beside it. L4
  statistics read complete lanes only (all lanes still reported, so
  no survivor bias is hidden: the completion rate itself is a
  published, claim-relevant figure). The holistic score is recorded and
  published for every run but is narrative evidence, never a claim
  statistic.
- **Holistic score.** A single 0–100 from the builder that is
  explicitly *not* derived from the dimensions — its overall sense of
  the experience — recorded **before** the builder computes or sees
  the weighted total, and required to cite two or three concrete
  moments from the run.
- **Narrative layer.** A run diary with a timestamped entry at each
  milestone boundary, and a **1–2 page closing essay** — purely
  qualitative, comparative against the alternatives the model knows —
  written before the agent sees any metrics. Sequencing is mandatory:
  essay, then rubric, then holistic, then numbers. Diaries follow the
  repo's `diaries/` convention and feed LLP 0198's qualitative
  synthesis.

## D5 — Lanes: backends and models

**Backend tiers** (standing set; a scored wave = tier 1):

- **Tier 1, every scored run:** Snapback, Convex (calibrated
  baseline), Supabase (the Postgres/RLS/PostgREST worldview and the
  most common unprompted agent choice).
- **Tier 2, periodic:** Firebase (the historical mobile-offline
  incumbent), InstantDB (local-first-native), Zero/Replicache
  (sync-engine-native — client-driven sync vs server-authoritative,
  the strongest architectural contrast on the offline milestones).
- **Tier 3, on demand:** a roll-your-own baseline (Hono/Express +
  Postgres + Drizzle — what does any framework buy), PocketBase,
  Amplify.

**Model matrix:**

- **Scored:** one frontier model per family × two families — Claude
  (Fable 5) and OpenAI (GPT-5.6/Codex) — × tier-1 backends × N≥3.
  This is LLP 0198's P0b cross-family posture applied to the new
  family; claims are family-scoped per LLP 0197. Named risk the
  second family partially insures: Snapback's guide and skill were
  developed almost entirely with Claude and Codex agents in the loop
  and may be unconsciously tuned to them.
- **Capability-floor leg:** one mid-tier model (Sonnet 5 or
  Haiku 4.5) × tier-1 × N≥3 on the reduced run (M1–M3). Frontier
  models hide friction as tokens; mid-tier models convert ergonomics
  into outcome differences, and either direction of the result is
  informative (the guide rescues weaker models, or weaker models lean
  harder on training priors and the gap widens). Underwrites the
  "ship with a cheaper model" claim frontier runs cannot.
- **Exploratory:** Kimi K3 and Grok at N=1 on the reduced brief,
  over Snapback and Convex — the families that never touched
  Snapback's docs development, hence the cleanest generalization
  test — promoted to scored status only on a surprising result.
- **Inclusion rule (no a-priori "dumb tier"):** a model qualifies for
  scored runs only if it completes the reduced run on Convex (the
  familiarity-maximal baseline) within budget; below that floor,
  every lane fails and nothing is measured.
- **Effort pinned, not varied:** one recorded effort level per model
  (the series' setting for Fable; xhigh for Codex); effort variation
  is a possible later probe, not an axis.

Cross-family grading falls out free: each lane's grader is the other
scored family (grading for floor/exploratory lanes per D3.3).

The matrix's operative content is maintained as **one configuration
table** frozen at P3 alongside the rung-matrix rows: every cell
(brief scope × backend × family × aid condition) with its
preregistered N, claim eligibility (scored vs exploratory vs
calibration), lane-order counterbalancing schedule (LLP 0197 rule 2's
balanced rotation across repetitions), cache/state posture, and
stopping rules. Only cells that meet their preregistered N support
claims; a cell run below its N (e.g., a second-family full-app N=1
under OQ3) publishes as exploratory, never as the scored phrase.

## D6 — UI kit

Provided, but **purely presentational**: MessageBubble, ChatListRow,
Composer, FeedCard, Avatar, ProfileForm, ReactionPicker, poll
compose/display (M7's polls are in the frozen brief, so the frozen
kit covers them — M7 sessions should not pixel-push), and the
like — plus, from the 2026-08-11 M8 amendment, the insights stat
tiles, the naive 7-day bar list, and the trending row (M8 is in the
brief, so the frozen kit covers it and M8 sessions do not
pixel-push) — dumb props in (plain arrays and values), callbacks out, zero
data dependencies, built against bare React Native primitives, plus
fixed design tokens and a screen list with wireframe descriptions in
the brief. Lanes do all data wiring. Rationale: a full app shell with
a predefined data-interface layer smuggles in a worldview (hooks-shaped
interfaces favor reactive backends; fetch-shaped favor Supabase), while
no kit at all lets pixel-pushing dominate wall clock. Prop shapes stay
deliberately naive (a `messages` array, an `onSend` callback — no
cursor or subscription assumptions), and every component carries
stable test IDs/accessibility labels so grader automation doesn't
vary by lane. The kit is authored under a neutral-third-party hat,
**reviewed against each tier-1 backend's idioms before freezing**
(the per-backend neutrality-review notes are retained and published
with the kit version), versioned and frozen with the brief, and
disclosed as a symmetric aid under LLP 0197 rule 10 (starter/aid
disclosure).

## D7 — Phases

- **P1 — Prerequisites** (each a concrete deliverable, so none becomes
  an ambient blocker): the brief at freeze-candidate quality; the
  16-dimension rubric with anchors; the UI kit built and
  neutrality-reviewed; the fixture pack (personas with known
  passwords, image set, one small video, and the deterministic
  action-log generator with its committed starter and scale logs)
  under `benchmarks/fixtures/social-messenger/`; the grader prompt,
  harness, and initial probe set (trust-boundary and performance)
  with the sha256 probe-commitment mechanism; the **grader-report
  schema** (severity-bucketed defect list, probe results, O-dimension
  scores as schema-valid machine records, per LLP 0197 rules 4
  and 12); the **grader calibration artifacts** (known-good,
  known-bad, subtly authorization-broken builds with planted
  defects); the two-client choreography script, extended to produce
  structured receipts and recordings on the simulator (D3.3); the
  run-record schema extension for per-milestone phases, the separate
  clocks, the full milestone status set (`green` /
  `capability-failure` / `aborted` / `blocked-by-M{n}` / `not-run`
  plus termination reason and adjudication flags), compaction
  events, performance-probe results, the assertion-ID coverage
  manifest, and the dimension applicability manifest.
- **P2 — Pilot:** N=1 per tier-1 lane, **not claim-eligible**, run
  on the primary family (Claude) and covering the **full scope** —
  M1–M7 plus the scale replay — since their caps and ceilings all
  calibrate from it; the GPT family runs a one-lane Convex mini-pilot
  for its per-family token caps. Pilot lanes run under predeclared
  **safety limits** (4 h wall / 2M tokens per milestone; the replay
  under the same wall limit); a pilot lane with no green figure
  for a milestone contributes the safety limit as its figure (the
  ordinary 2× formula then applies — the same rule as D2), and P3
  may rerun that pilot milestone after gap-fixes. **Material P3 changes** to
  platform, brief, kit, or harness require rerunning the affected
  pilot milestones before their caps/ceilings freeze — no thresholds
  frozen from obsolete conditions. Other purposes: find Snapback
  gaps (real auth is expected to need building; push seam and
  migrations may too), run the grader calibration and duplicate
  blind grading of a sampled pilot artifact (D3.4), and shake down
  choreography and kit. LLP 0198 explicitly permits a single-run
  pilot preceding a preregistered series. Because the pilot supplies
  the scored thresholds, its records are **published as
  clearly-labeled calibration evidence** when those thresholds
  publish — excluded from claims, not hidden.
- **P3 — Gap-fix and freeze:** fix what the pilot found (the
  treadmill working as intended), decide whether environment-caused
  aborts get a narrow rerun rule, run the mid-tier Convex
  mini-pilot (after OQ1's model choice), then freeze the brief,
  rubric,
  kit version, budgets and ceilings, and probe-rotation log;
  preregister the rung-matrix rows and the D5 configuration table
  (configuration, N, thresholds, aggregation, counterbalancing
  schedule) per LLP 0198's matrix discipline.
- **P4 — Scored wave, reduced run:** tier-1 × two families × N≥3 on
  M1–M3, graded, published per LLP 0197 under the reduced-run
  scoring profile (per-dimension only, no overall total).
- **P5 — Full-app wave and capability-floor leg:** M1–M7 at N≥3 on
  the primary family (second family as budget allows), plus the
  mid-tier M1–M3 leg. Named publication artifact: the
  **per-milestone median view** — which milestone the gap comes from
  is the point of the milestone design, so the checked publisher
  (0197 rule 12) grows support for it now rather than ad hoc.
- **P6 — Exploratory legs:** tier-2 backends and Kimi/Grok at N=1;
  promotion decisions recorded.

### P3 ruling queue

- [ ] **P3-Q1 — Adopt M3 typing observation boundary v2 and rerun
  Simplified M3.** On the sweep kit's recorded host, amend the frozen M3
  choreography so observation is armed and the clock starts **at the final
  keystroke, or immediately before the publish call that creates the final
  typing-state transition**. Do not start the clock before the roughly
  45-character `pressSequentially(..., { delay: 25 })` action and begin
  waiting for the observer only after that action completes. Stamp the
  choreography and resulting receipt as boundary v2; preserve all 0.1.21 and
  earlier receipts as v1; do not compare v1 and v2 like-for-like. Then rerun
  the 0.1.21 Simplified-lane M3 typing boundary and retain the corrected v2
  receipt. The sweep kit is out of this repository at
  `~/clique-0121-20260814` on LA Durand, so this in-repo landing queues but
  does not perform the amendment or rerun. Treat the boundary change as a
  material choreography correction and rerun the affected milestone before
  P3 freezes the instrument.

Rough cost, so scope stays conscious: the small brief runs 200–330k
tokens per Snapback lane; this app is plausibly 5–10× **per builder
lane** — and builder lanes are roughly half the program. All-in, P4
(18 reduced lanes + graders) plus P5 (full-app lanes, M7 fresh
sessions, the mid-tier leg, graders throughout) plus calibration
grading is order **20–60M tokens**. The pilot-first posture and the
reduced-run default exist because of this number, and P2 re-estimates
it from measured pilot figures before P4 commits.

## Open questions

- **OQ1 — Mid-tier model choice.** Sonnet 5 vs Haiku 4.5 for the
  capability-floor leg; decide at P3 from pilot-era pricing and the
  inclusion rule.
- **OQ2 — Kit placement.** Whether the UI kit lives under
  `benchmarks/tools/` or as a separately published package; decide
  when building it (P1). Publication of the instrument (0197 rule 3)
  is the binding constraint either way.
- **OQ3 — Second-family full-app runs.** P5 runs the full app N≥3 on
  one family; whether the second family gets N≥3 or N=1 on M1–M7 is
  a budget call at P5 time.

Resolved during authoring (2026-08-08, author rulings): a follow graph
and Following/Global feeds are in v1 (was OQ1); the app is named
Clique; identity is entirely in-system (no device address book or
phone-number identity); voice notes stay out of scope (the media
pipeline is already priced by photo/video; recording measures the
client); M7's day-2 task is group polls.

Resolved after the P2 pilot (2026-08-09, author clarification): the
Following feed always includes the viewer's own original posts and reposts,
without a persisted self-follow edge or any change to follower/following
counts. This changes the freeze-candidate brief and acceptance manifest for
future benchmark runs; it does not require a retrofit or rerun of the
completed P2 Clique pilot.

Resolved by the round-1 review revision (2026-08-08, revision b — see
the Revised header and `llp/reviews/0201-*`): reduced runs publish
per-dimension scores only (no overall total, no L4 evidence); O5 is a
scale-safety gate, with comparative performance deferred to a
matched-posture leg; message search is normalized word-prefix, not
substring (substring conflicts with every tier-1 backend's indexed
text search, including Snapback's own term/prefix contract, and would
force either full scans or a parallel client-side implementation);
M7 is an integrated measurement complementing — not replacing —
LLP 0198 P3's paired-start day-2 brief.

Resolved by the round-2 super-refine revision (2026-08-08, revision
d — author rulings on the three escalated items): M7 runs against the
pre-replay starter state; null dimensions block a run's overall
total (L4 reads complete lanes, completion rate published); anchor
probes are non-scored continuity diagnostics, with the holdout claim
scoped to the wave's secret rotated probes.

## Revision history

**Revised:** 2026-08-21 (n — versioned the M3 typing observation boundary as
v1 clock-before-synthetic-typing versus v2 clock-at-final-keystroke/publish;
marked cross-version runs non-comparable like-for-like; annotated the 0.1.21
Simplified M3 red with the instrumented 1.68 ms delivery evidence; queued the
out-of-repo v2 choreography amendment and Simplified rerun at P3-Q1.)

**Revised:** 2026-08-12 (m — factual pin only: scoring DAG M3 requires M1
only; reduced-run protocol still executes M1 then M2 then M3.)

**Revised:** 2026-08-09 (j — author clarification after the P2 pilot:
Following includes the viewer's own posts and reposts as feed-only implicit
self-follow semantics; the authoritative brief and assertion manifest carry
the executable contract for future runs, while the completed pilot remains
unchanged historical calibration evidence.)

**Revised:** 2026-08-08 (h — post-loop closure revision;
**UNREVIEWED** — final verdicts bind revision (g): dual NOT READY,
round 6. Applies the round-6 convergent fixes: the safety-limit
stand-in rule unified in the Codex-prescribed direction (stand-in as
figure, ordinary 2× applies, transfer clamped at 2× safety limit —
P2 aligned with D2, monotone); exact pre-probe verification of the
named O5 fixtures with mismatch scoring O5 = 0; Kimi/Grok
enumerated as separate advisory cap families with token caps
recorded inapplicable and safety limits as hard stops; GPT
mini-pilot extension keyed to any full-app GPT lane; mid-tier
mini-pilot scope pinned M1–M3; execution-completion rate clause.)
**Revised:** 2026-08-08 (g — round-5 revision under the author's
1–2-round extension. Round-5 verdicts bind revision (f): Claude READY
(all-MINOR residue), Codex NOT READY (4 MATERIAL IN-DELTA). (g)
applies all four — cap families enumerated over the full model
matrix with Kimi/Grok cap-advisory; grader-abort nulls override
applicability and weighted totals/L4 require a usable grading
record; the hidden actual-state sample covers every action-schema
class; aborted charging mirrored in the brief — plus both families'
minors (pilot-figure domain, O3-only parenthetical, wall-axis
rationale, transitive blocking, never-built probe rule, table
preamble, mid-tier mini-pilot scheduling, status enumeration
hygiene). Round 6 is the final authorized round.)
**Revised:** 2026-08-08 (f — post-loop closure revision applying the
round-4 convergent smallest-sufficient fixes; **this revision is
UNREVIEWED** — round-4 verdicts bind to revision (e): dual NOT READY,
pre-existing clean in both families. Fixes: per-dimension
applicability replacing the blanket O-rule; token-cap keying settled
family-shared with max-over-backends pilot-figure transfer, 2× after
transfer; O5 75-band as explicit complement with first-match
precedence; replay base pinned to a fresh instance; `aborted`
charges like capability-failure; sample custody, adjudicator,
blocked-set recording, and wall-end wording pinned.)
**Revised:** 2026-08-08 (e — super-refine round-3 delta revision,
dual NOT READY on (d) with pre-existing text clean in both families
(delta-convergence): green now requires suite plus choreography
segment with assertion-level executor mapping; status machine closed
(`aborted`, non-retroactive adjudication); cap keys defined with the
GPT cross-backend transfer rule; DAG M6←M2–M5 and M7 regression
conditional on previously-green; replay base state, settle-receipt
accounting, and deterministic sampled manifest verifier; O5 exact
function with manifest gating; dimension applicability manifest and
complete-lane definition; calibration precision; residual sync.
Reviews: round-3 sections of `llp/reviews/0201-*.{claude,gpt-5}.md`.)
**Revised:** 2026-08-08 (d — super-refine round-2 revision, dual
NOT READY on (c): green gated on a coverage-manifest-validated suite
with per-item executor tags; statuses gain `not-run` + termination
reason and M6's prerequisites become M3–M5; starter seed segmented
per milestone, scale-adapter ruling scoped to the scale replay, and a
frozen action schema with settle-before-next; M7 pinned to the
pre-replay starter state with an API-export snapshot over a pinned
message field manifest (author ruling); full-run totals blocked by
null dimensions (author ruling); anchors demoted to non-scored
diagnostics (author ruling); O5 mapped deterministically from frozen
invariants; unfollow carved out of content revocation; fixture
credential exception; calibration detection thresholds; pilot
protocol pinned. Reviews: round-2 sections of
`llp/reviews/0201-social-messenger-canonical-benchmark.{claude,gpt-5}.md`.)
**Revised:** 2026-08-08 (c — Draft → Review at llp-super-refine loop
start, the one authorized transition; reviewers instructed to refine,
with rethink-scale feedback surfaced as author-decision items)
**Revised:** 2026-08-08 (b — round-1 llp-review revision, both families
NOT READY on (a): reduced-run scoring profile; milestone dependency
statuses and preregistered cap formula; separate recorded clocks; the
scale-replay contract; O5 rescoped to scale-safety; revocation and
idempotency scoping; holdout custody; grader calibration and abort
protocol; M7's relationship to LLP 0198 P3; 0197 citation repairs.
Reviews:
`llp/reviews/0201-social-messenger-canonical-benchmark.{claude,gpt-5}.md`.)
**Revised:** 2026-08-08 (a — initial draft)

## Dated amendments

**2026-08-10 — F1 replay-posture ruling (author).** The pilot's F1
finding (a hosted lane cannot complete the scale envelope's
registration phase inside any reasonable cap: GoTrue's fixed
30-signups/5min/IP meter consumed ~2.62 h for 1,000 users) is ruled:
**registration carve-out**. The replay clock starts after identity
seeding, which may use whatever fastest path the lane's posture
allows; registration wall time is recorded separately as posture
data, never on the replay clock or against the replay cap.
Rationale: registration throughput measures a provider's abuse
throttle, not the data-plane behavior the envelope exists to test.
The brief's replay contract absorbs this at P3 freeze; the pilot
record's Supabase figures are reinterpreted accordingly (its
post-registration 18.56/s sustained rate becomes the comparable
figure).

**2026-08-10 — F2 choreography hardening.** M6 simulator evidence is
re-scoped from an external prerequisite of web authoring green to a separately
recorded native/O4 artifact. P1 froze `simctl` process mechanics but not the
cross-lane app-side event protocol needed for a generic driver to identify
offline completion, restart a lane-specific backend, or bind UI observations
to server state. A wrapper without that protocol would create ceremonial
evidence. Lane-native drivers still follow the frozen artifact contract;
missing evidence cannot support native/O4 claims. Required web choreography
continues to fail closed: every implemented check must pass and no required
check may remain unimplemented.

**2026-08-11 — M8 additive milestone (author direction).** The
instrument gains **M8 — Insights, digest, and multi-device offline**,
pinned in the brief: aggregation read-models (Insights totals, 7-day
buckets, 24 h Trending), a config-scheduled per-user digest through
the push seam (no connected client — the first obligation that
forces real scheduled execution), a celebrity fan-out extension to
the scale envelope (900 followers, write- and read-path degradation
rules, new named O5 fixtures), and multi-device/durable-offline
obligations (cross-device read state, dual-offline convergence under
unchanged LWW, queued writes surviving restart as a native
artifact). Design constraints honored: **additive only** — M1–M7
text is untouched except where the milestone set is enumerated, so
prior records (including the P2 pilot) stay comparable, recording M8
`not-run` with its dimensions null; conflict policy stays pinned
LWW (M8 deepens offline without opening merge semantics); every M8
feature is expressible by each tier-1 backend. Consequences:

- **Caps (P2b):** M8 postdates the pilot, so its wall/token caps
  calibrate from a **P2b M8 pilot extension** — one M8 session per
  tier-1 pilot artifact, primary family, continuing the pilot lane
  under its aid condition and the P2 safety limits — before P3
  freezes M8 caps; the safety limits stand in until then. The GPT
  mini-pilot is unaffected (its scope is M1–M3).
- **Scale replay:** regenerating the scale log for the celebrity is
  a **material change** under P2's rule — the pilot replay reruns
  against the regenerated log before O5 ceilings freeze at P3. The
  registration carve-out (F1) is unaffected.
- **Scoring:** no new rubric dimensions. Observing-milestone sets
  extend on full runs only (B1, B3, B4, B7 read M8; O1/O2 include
  it as in-scope; O4 reads its native evidence; O5 reads the
  extended rules); reduced-run nulls are unchanged, so reduced runs
  still publish per-dimension scores exactly as before. A complete
  lane now includes M8 attempted.
- **Deliverables** (this amendment's landing): brief M8 section and
  envelope/applicability updates; assertion + applicability +
  run-record manifest updates; kit insights/trending components
  with wireframes, contract test IDs, and neutrality notes; fixture
  digest configs and the celebrity generator extension with
  regenerated invariant manifests; the M8 web choreography segment.
  Grader-side probe instances for the new categories join the next
  probe rotation (they are wave artifacts, not brief artifacts).

**2026-08-11 — Exploratory model sweep (author direction).** Before
the P3 freeze, D5's exploratory leg runs once as a **seven-model
research sweep**: Fable 5 (the series' effort setting), Opus 5
(default effort), Sonnet 5 (default), GPT-5.6 sol (xhigh),
GPT-5.6 terra (high), Grok (harness default), and Kimi K3 (harness
default) — each in its **native harness** (Claude Code, Codex CLI,
Grok CLI, Kimi CLI), with harness name and version recorded per lane
alongside the model and pinned effort. Scope: the reduced brief
(M1–M3, suites plus web choreography segments; no scale replay, no
M7/M8), over Snapback and Convex only, N=1 per cell. Posture:
Snapback lanes consume the **published npm package at a pinned
version** (what an external agent gets), not a checkout build; the
aid condition is uniform across harnesses — the consumer-form
authoring skill embedded in the lane prompt, per the P2 pilot's
mechanism. Execution: all lanes **serial on one reserved fleet
machine**, each model's Snapback and Convex lanes back-to-back so
the within-model backend comparison shares conditions; the full pin
manifest (npm version, instrument commit, brief blobs, harness
versions) freezes at sweep start and never advances mid-sweep.
Publication: **calibration-labeled** under P2's rule — per-dimension
observations only, never the scored phrase; token totals are the
primary cross-model metric, wall clock reported with timestamps and
the provider-weather caveat. Role: the sweep's Convex lanes seed
cap-family mini-pilot data for any later promotion of a new model to
scored status (the inclusion rule's floor check), and its results
inform OQ1's mid-tier choice at P3. The scored matrix is unchanged:
scored waves remain Fable 5 + GPT-5.6/Codex at N≥3, and no sweep
cell qualifies for claims at N=1.

**2026-08-21 — D0.6 instrument registration (Adopted per LLP 0295
default proposal; author may revise).** LLP 0295 §D0.6 requires that,
before the next measured run, every **milestone boundary** in the D2
record schema carries the following fields. This amendment registers
them as commissioned schema work; it changes no completed record and no
scoring rule. Implementation ticket:
`issues/20260809-per-milestone-token-metering.md` (this resolves that
ticket's open P3-freeze decision in favor of the **harness-native
path**: per-phase usage read from each harness's own accounting fields,
with a protocol-approved boundary-snapshot estimator permitted only
where a pinned harness exposes no per-phase fields, and the estimator's
use recorded as a field). The fields must be schema-compatible with the
coordinated version bump in
`issues/shelved/20260821-clique-instrument-observability-version-bump.md`.

Registered per-milestone fields:

1. **Usage, harness-native:** fresh input, cache read, cache write,
   output, and reasoning tokens, using each harness's native vocabulary
   and recorded per (harness, model) — **no cross-harness
   normalization**; cross-family token comparison stays out of scope
   exactly as the cap-family rules already provide.
2. **Semantic actions**, using the **closed D0.6 taxonomy registered in
   LLP 0186's 2026-08-21 amendment** (which reconciles and refines W5's
   prose list in place — one list, not two): `guide-lookup`,
   `source-inspection` (with `binary-excavation` as a flagged subclass),
   `edit`, `generate`, `process` (start/restart/attach/shutdown),
   `reseed`, `suite`, `choreography`, `retry`. Every recorded action
   carries a `progress`/`correction` disposition tag; `correction` means
   the action belongs to a field-3 failure-to-recovery episode.
3. **Failure-to-recovery episodes** with attribution and outcome,
   per LLP 0186's failure-to-recovery trace amendment.
4. **Server/process restart and reseed counts.**
5. **Browser assertion attempts and wall time spent waiting** on
   assertion settlement — choreography and suite assertion waits both
   recorded, per D0.6's wording.
6. **Host load and API interruption windows** (the 0.1.24 matrix's
   contamination classes), as declared cell-eligibility facts.
7. **Orientation bytes and the selected skill set before the first
   product edit** (`issues/20260820-matrix-lane-skill-routing-context-budget.md`
   is the carrier ticket), reported separately from authoring tokens.
8. **Estimator provenance:** whether any phase-usage figure came from the
   boundary-snapshot estimator rather than harness-native fields, recorded
   per (milestone, field).

**Schema compatibility:** all eight are **optional additive fields at the
existing extension version**, delivered through the coordinated version
bump; the shipped `tokenCounts` object (`additionalProperties: false`, no
`reasoning` member) is extended there, and completed records are never
rewritten. **Null policy for field 1:** fresh input and output tokens are
required per (harness, model); cache read, cache write, and reasoning may
be explicit nulls where the pinned harness does not expose them, and a
scorecard measure whose numerator reads a null subfield is inapplicable
for that cell (the output-token target reads the required output field).

**Eligibility rule (registered, per LLP 0295):** a run lacking
per-phase usage may still debug product behavior, but its cells are
ineligible for LLP 0295's efficiency scorecard (whose thresholds are
registered in LLP 0186's 2026-08-21 amendment). Cell eligibility reuses
the **same contamination flags the 0.1.24 record already carries** —
host-load contamination and API interruption windows — rather than a new
numeric threshold invented here; a flagged cell is scorecard-ineligible
while retaining its product findings.
