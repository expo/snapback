# Run record — social-messenger (Clique) seven-model exploratory sweep, 2026-08-11/12

**Status: CALIBRATION — exploratory evidence only, not claim-eligible.**
N=1 per cell; no scored phrase is supported by anything in this record
(LLP 0201 D5 + the 2026-08-11 exploratory-model-sweep amendment,
`d5294d528`). Purpose: model×Snapback fit survey across seven models in
their native harnesses, cap-family seed data for later promotions, and
OQ1 (capability-floor model) input at P3.

## Configuration

- **Scope:** reduced brief M1–M3 (suites + web choreography segments; no
  scale replay, no M7/M8), Snapback + Convex, one lane per cell, all
  lanes strictly serial on one reserved machine.
- **Pins (frozen at sweep start, never advanced):**
  `@expo/snapback-cli@0.1.20` (published + qualified that morning, epoch
  25), `convex@1.43.0`, instrument at repo commit `d5294d528` (unchanged
  through the close-out `2fa1af6f6`), aid condition = consumer-form
  SKILL.md extracted from the published 0.1.20 scaffold and embedded
  verbatim in every Snapback lane prompt (uniform across harnesses).
- **Machine:** office 14-inch M1 Max MacBook Pro (reserved, caffeinated,
  verified idle at start). Playwright chromium and choreography deps
  pre-provisioned so environment setup never counted against lane wall.
- **Harnesses (frozen):** Claude Code CLI 2.1.228 (claude-fable-5,
  claude-opus-5, claude-sonnet-5 — harness-default effort), codex-cli
  0.147.0 (gpt-5.6-sol at xhigh, gpt-5.6-terra at high), Kimi CLI 0.29.1
  (`openrouter/moonshotai/kimi-k3`, plain `-p` prompt mode), Grok CLI
  1.0.0 (`grok-4.5-build`, `--permission-mode bypassPermissions`).
- **Execution:** each model's Snapback and Convex lanes ran back-to-back
  (Snapback first). Lanes ran as detached processes; after control-plane
  pollers were repeatedly killed by machine-wide process sweeps, a
  detached on-rig sequencer drove all lane-to-lane handoffs
  (`~/clique-sweep/run-sweep-sequencer.sh`).
- An earlier lane-1 attempt against 0.1.19 was aborted mid-M2 by author
  direction (release 0.1.20 first) and is retained as
  `lanes-aborted/fable5-snapback-0119-aborted/`; it is not part of this
  record's data (its M1 observations independently replicate lane 1's).

## Lane table

Wall = launcher meta epochs (start→exit). Output tokens/turns/cost from
each harness's final JSON where surfaced; codex and kimi lanes did not
surface totals (see metering gap below). "Choreo" counts implemented
checks only; the frozen harness's required-but-unimplemented checks make
m2/m3 segment `green:true` structurally unreachable for every lane (see
instrument defects).

| Lane | Wall | Out tokens | Turns | Cost | Suites | Choreo implemented |
|---|---:|---:|---:|---:|---|---|
| fable5-snapback | 99 m | 241,963 | 254 | $92.41 | full, pass | m1 3/3, m2 4/4, m3 pass |
| fable5-convex | 65 m | 180,274 | 180 | $50.69 | full, pass | all pass |
| sol-snapback | 60 m | — | — | — | full, pass | m1 3/3 + others pass |
| sol-convex | 37 m | — | — | — | full, pass | all pass |
| opus5-snapback | 143 m | 243,616 | 243 | $67.84 | full, pass | all implemented pass |
| opus5-convex | 62 m | 203,760 | 195 | $29.21 | full, pass | all pass |
| sonnet5-snapback | 124 m | 394,975 | 563 | $97.04 | full, pass | all implemented pass |
| sonnet5-convex | 90 m | 281,413 | 357 | $39.59 | full, pass | all pass |
| terra-snapback | 24 m | — | — | — | **1-assertion stubs (non-conforming)** | m2 3/4, **m3 0/2** |
| terra-convex | 24 m | — | — | — | full, pass (7/7, 22/22, 7/7) | m1–m2 pass, **m3 0/2** |
| kimi-snapback | 230 m | — | — | — | full, pass | m1 green:true, all implemented pass |
| kimi-convex | 78 m | — | — | — | full, pass | all pass |
| grok-snapback | 44 m | 109,486 | 186 | $39.09 | full, pass | m1 3/3, **m2 0/4**, m3 2/2 |
| grok-convex | 30 m | 82,290 | 83 | $9.24 | full, pass | all pass (incl. m2 4/4) |

Snapback/Convex wall ratios: Fable 1.52×, sol 1.63×, Opus 2.31×,
Sonnet 1.38×, terra 1.0× (but non-conforming on Snapback), Kimi 2.9×,
Grok 1.47×. Model wall ordering is near-identical on both backends —
the backend tax multiplies a model's own pace rather than reordering
models.

## Findings

### 1. The password gap is universal, convergent, and now measurable

All seven Snapback lanes (plus the aborted 0.1.19 attempt) independently
discovered that the published closure has no client-facing password
mechanism (`defineAuth` admits `kind:'password'` but nothing witnesses
it) and **all converged blind on the same architecture**: a trusted
broker/gateway holding an adaptive-KDF hash that gates the
admin+impersonation capture-mailbox read and releases a one-use code
adopted through the ordinary `authExchange` into AuthCoordinator
custody. Fable's essay: composition is clean and the platform keeps
sessions/custody/revocation, "but every consumer app on this closure
pays the same tax," and the broker's privileged carriers are a sharp
edge. Convex core also lacks password credentials (its hand-rolled
variant — sessions table, token threaded through every function — was
judged worse), so this is an industry gap Snapback can win by shipping
first; auth catalog v4 (`b180492e9`) landed after this sweep's pin and
is the designated answer. This record is the pre-v4 baseline.

### 2. Snapback-only degradation appears below the frontier tier

- **terra (gpt-5.6-terra, high):** fully conforming on Convex
  (22/22 assertions covered+passing) but collapsed to one-assertion stub
  suites on Snapback within the same hour — corners cut instead of wall
  spent. Its m3 realtime choreography failed on both backends (model
  trait), but the conformance collapse is Snapback-only.
- **grok (grok-4.5-build):** kept full suite conformance everywhere, but
  its Snapback M2 implemented choreography failed 0/4 where its Convex
  M2 passed 4/4 — a milder, outcome-level Snapback-only degradation.
- **kimi (kimi-k3):** the opposite archetype — slowest lane of the sweep
  (2.9× its own Convex wall) but fully conforming with honest receipts;
  the only lane to read the harness source proactively and plan around
  its defect. The guide carried a never-seen-the-docs model to a correct
  build; it cost wall, not quality.
- Claude mid-tiers (Opus, Sonnet) showed only pace effects, no quality
  effects.

**OQ1 implication:** terra and grok *exhibit* the capability-floor
effect the leg exists to detect; Sonnet does not (it just runs slower
and chattier — 395k output tokens in 563 turns vs Fable's 242k/254).
A floor leg that never fails measures nothing; terra-class models are
the more informative floor choice.

### 3. What Snapback got right, cross-family

- **Refusals-as-docs held for every family**: Fable fixed "almost every
  backend mistake from the refusal text alone" (zero web searches in
  three milestones); sol credited the artifact-identity refusal for
  making a stale generated client obvious; codegen diagnostics named
  fields and fixes for Kimi and Grok too.
- **Realtime primitives matched the brief one-to-one**: declared live
  queries with server-side authority praised over Convex's ambient
  `useQuery` for auditability; ephemeral presence called "the best
  typing-indicator API I've used" (Fable) — Convex lanes hand-built
  typing as a table row + expiry + cleanup mutation every time.
- **Operability**: the dev supervisor's stdin JSON control channel,
  ready-files with PIDs, served build-bound guide, and admin console
  drew explicit praise ("best-operated local backend I've used in this
  class"); the skill's trap list preempted loops verbatim (inline-args
  churn, sessions-mode auth, upload custody) across families.
- Raw local latency favored Convex in sol's measurements (posts ~70 ms
  vs ~348 ms; likes ~58 ms vs 111–165 ms) — consistent with P2. DX and
  capability wins are Snapback's; raw reactive latency is not yet.

### 4. Guide/surface gaps observed (ticketed with this record)

1. Client TypeScript declarations omit runtime auth methods
   (`authExchange` et al. absent from `index.d.mts`) and no page
   documents how a booted client asks "am I signed in and as whom"
   (`coordinator.settledView()` was found by prototype enumeration) —
   both Fable runs and sol hit this.
2. The `CI=1` Metro watch-inert trap is documented, but the advisory
   only fires on the supervised path; two lanes lost real time hitting
   it unsupervised.
3. Recipe candidates: promote lane 1's per-page mounted-live-query fix
   into the paged-list recipe (cleaner than the recipe's own archive
   bookkeeping, validated against its deletion caveat); an
   optimistic-intent-overlay recipe for rapid-toggle races over live
   queries (sol found a real race); advertise the
   upload-then-mutate path for multi-asset composition.

### 5. Instrument defects (fix before the scored wave)

- **The frozen choreography ships required-but-unimplemented checks**
  (4 per segment in m2 and m3), so `green:true` is structurally
  unreachable regardless of the app — flagged by the P2 pilot, still
  open, now ticketed. Every lane recorded it honestly; lanes diverged
  in labels ("functionally green" vs "capability-failure" vs
  "instrument-level failure") — the grader phase needs one convention.
- Sonnet's run-log prose timestamps were invented (future-drifted vs
  the machine clock); launcher meta epochs remain authoritative and
  per-milestone attribution for that lane carries a caveat.
- Terra's brief-interpretation divergences: proceeded to M3 declaring
  "M3 does not require M2"; sol likewise. The milestone-DAG wording for
  reduced runs should be pinned at P3. Sol also surfaced a genuine
  assertion ambiguity: an author's post can enter Following via the
  viewer's own repost, so follow-projection assertions must distinguish
  direct from attributed entries.
- **Token metering**: only Claude and Grok harnesses surfaced totals;
  codex and kimi lanes have none (`issues/20260809-per-milestone-token-metering.md`
  remains the owner; cross-harness lane-total capture is now also in
  scope).

## Operational record

The 0.1.19→0.1.20 re-pin and lane-1 abort are in the run journal. The
grok pair false-started once (`Not signed in`: the rsynced session token
was rotated by the origin machine's grok instance overnight) and
completed on its one allowed relaunch with fresh auth. Control-plane
background pollers were killed repeatedly by machine-wide process
sweeps; the durable pattern is detached-on-rig execution (lanes,
sequencer) with the supervising session only journaling — recorded in
the supervision memory and recommended for the scored wave.

## Artifacts

Rig: `~/clique-sweep/` on the office M1 Max (lanes/, logs/ incl.
sequencer log and grok authfail logs, prompts/, instrument/). Control
plane: `/Users/ccheever/clique-runs/model-sweep/` (PLAN.md,
RUN-JOURNAL.md, prompt templates, full lane-artifact mirror excluding
node_modules and dev databases). Per-lane: final-report.md, essay.md,
diary.md, run-log.md, receipts-m*.jsonl.
