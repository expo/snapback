# Clique Snapback 2 treatment — published 0.0.20

**Date:** 2026-09-09

**Treatment:** three fresh Snapback 2 lanes against the public
`snapback2@0.0.20` package

**Controls:** the unchanged same-family Convex 1.45.0 and Supabase 2.112.4
lanes from the [2026-09-05 full 3x3 run](../2026-09-05-clique-full-3x3/README.md)

**Instrument:** `f40559f37722c79178be664a11f8a6485f1508fd`

**Host:** M5 Max black, Node 24.18.0

## Why this is a treatment rerun

The 2026-09-05 run put Snapback 2 0.0.4 at 64 / 57 / 78 for Astra, Grok,
and Muse, a mean of 66 against Convex's 81. The elegance program addressed
thirty accepted rulings about templates, diagnostics, Quarry composition,
the client surface, screen composition, and shipped bytes, then audited the
integrated authoring docs before publication. The docs audit was deliberately
completed before this cold run because setup, discovery, and composition are
part of the measured product.

The release commit is `4fd5a28ec`; the publication and loop-record commit is
`6ffce9c07`. Both `snapback2@0.0.20` and
`snapback2-darwin-arm64@0.0.20` were published and their registry integrities
were checked before the lanes started. Each treatment lane installed the
public package and could read its packaged README and `dist/guide`; no builder
could inspect a Snapback source checkout or a previous Snapback lane.

This rerun changes only the three Snapback lanes. Each scorer reads its own
fresh Snapback narrative beside its exact frozen Convex and Supabase narratives.
The resulting control scores may move slightly because each scorer is a fresh
session. This is N=1 per builder family and is calibration evidence, not a
claim-eligible causal magnitude.

## Builder results

| Builder | Continuous milestones | Scale replay | Wall |
| --- | --- | --- | ---: |
| Astra, gpt-6-astra medium | M1–M6 and M8 green; seven Hermes exports; supplemental native M6/M8 proofs failed | 167,157 / 167,157 settled; all 225 invariants and 10% / 50% / final checkpoints passed; cold browser sync and group send/render exceeded 30 s | 3.65 h |
| Grok 4.6 xhigh | M1–M2 green; M3 suite green but choreography non-green; M4–M6/M8 suite-only and blocked by M3 | not run | 2.80 h |
| Muse Spark 1.3 xhigh | M1/M4 receipt-backed green; M2/M3 reported green with preserved-receipt gaps; M5 capability-failure at its four-hour wall; M6/M8 blocked | not run | 8.98 h, including disclosed same-family closeout |

Astra's first scale verifier run failed because its verifier omitted the
starter-author identity map. The same unchanged database passed after that
agent error was corrected; the failed receipt remains in the raw lane. Its
backend degradation checks passed, while device-side cold synchronization did
not. Grok ended candidly after repeated M3 browser failures rather than
upgrading suite-only evidence to green milestones.

Muse's original continuous builder remained inside M5 until the preregistered
four-hour milestone wall at epoch `1788992935`. The orchestrator stopped only
that GUI service and its two child processes, then launched one fresh
same-family xhigh closeout over the preserved lane. The closeout attempted no
repair, recorded M5 as a capability failure, applied the brief's dependency
DAG to block M6 and M8, cleaned the lane-owned backend PID, and wrote the
required narrative and terminal report. Its disclosure and raw epochs are in
the retained final report.

## Independent grading

Fresh Claude Opus 5 sessions graded each pre-M7 lane against the frozen 101
atomic assertions, wrote a schema-valid report, and exited before M7 could
mutate the artifact. No holdout probe set was committed for this wave, so O3
is null and this remains uncalibrated grading.

| Lane | pass / fail / not-run | coverage | blocker / major / minor / cosmetic | O1 / O2 / O3 / O4 / O5 |
| --- | --- | --- | --- | --- |
| astra-snapback2 | 83 / 9 / 9 | honest | 0 / 3 / 4 / 2 | 66 / 45 / – / 55 / – |
| grok-snapback2 | 68 / 9 / 24 | dishonest | 0 / 6 / 5 / 1 | 38 / 38 / – / – / – |
| muse-snapback2 | 80 / 5 / 16 | honest | 1 / 3 / 4 / 2 | 62 / 34 / – / – / – |

The clearest cross-lane repeated finding was web send/live-delivery latency.
Grok additionally reproduced the signup-to-first-offline-write grant boundary
three times. Astra established a full-envelope cold-browser synchronization
failure despite a green backend replay. Its feed APIs paged correctly while
the React feed surfaces stopped at twenty rows. Grok's remaining majors were
mostly application defects: null expiry on the product send path, a
never-called digest counter procedure, periodic digest over-emission, and an
untruncated push preview.

Muse's report schema keys the same 101 M1–M7 assertions as the other graders;
its O1 denominator additionally counts all eighteen M8 assertions as not run.
The grader found one blocker: media mutations returned early for a duplicate
client key after upload, leaking held assets until the owner-wide forty-object
pool was full and all personas' media sends were refused for twenty-four
hours. Its three majors were application defects: the M6 suite's wrong replay
import meant it had never started, duplicate compose test IDs made the reply
screen undrivable, and the web composer could neither preview nor submit a
video post. Independent replay made only M1 and M4 green under the frozen bar;
M2, M3, M5, and M6 were non-green, while M7 and M8 were not part of the
pre-evolution build.

## M7 day-two evolution

Each M7 session was fresh, used the same family and effort as its builder, and
started only after independent grading completed and exited.

| Lane | M7 result | Evidence |
| --- | --- | --- |
| astra-snapback2 | capability-failure | Polls, live/offline voting, migration, count backfill, and snapshot preservation passed. Required regression a09 re-exposed the inherited M2 feed-pagination and M3 pending-reply failures. |
| grok-snapback2 | capability-failure | Feature suite 8/8 and snapshot comparison passed; live tallies passed, but the offline vote did not reliably reconcile. |
| muse-snapback2 | green | Feature suite 6/6 and frozen live/offline vote choreography passed. A clean successor installed a visible-only maintained count; all 48 pre-existing message views survived unchanged. The inherited M6 import failure remained red. |

All three M7 lanes preserved pre-existing persona-visible data. They also
recorded real product-shaping constraints: adding poll fields to retained
message rows exceeded the thread closure bound, and Grok's membership-scoped
message backfill exceeded the certified job-step budget. Muse inherited an
existing raw message-count maintain, added a composite visible-only group, and
installed the additive successor without a migration refusal or a Snapback-
attributed correction loop.

## Holistic scores

Each builder family scored its own three lane narratives in a fresh read-only
xhigh session. Overall scores are holistic, not category averages.

| Scorer family | Snapback 2 0.0.20 | frozen Convex | frozen Supabase | Snapback 2 0.0.4 baseline |
| --- | ---: | ---: | ---: | ---: |
| Astra | 80 | 82 | 76 | 64 |
| Grok | 67 | 80 | 49 | 57 |
| Muse | 48 | 82 | 72 | 78 |
| **mean** | **65** | **81** | **66** | **66** |

Astra and Grok scored the treatment 16 and 10 points above their respective
0.0.4 observations; Muse scored it 30 points below. The resulting Snapback
mean is one point below the old 66 and remains sixteen behind Convex. Category
means preserve the original shape: Snapback leads Convex in authorization
(87 to 74) and offline sync (63 to 46), but trails in setup/docs (71 to 77),
queries/live (67 to 87), client integration (66 to 81), and scale/limits
(44 to 80). This N=1-per-family treatment establishes neither a causal
magnitude for an individual ruling nor a regression in the package itself;
it does establish that the integrated surface did not reliably compose into a
complete product across all three cold builders.

## Deviations and environment

- The treatment lanes used ports 50100–50119 (Astra), 50400–50419 (Grok), and
  50700–50719 (Muse) because stale listeners from another program occupied the
  original 491xx range. The change was recorded before execution and changes no
  assertion.
- The remote SSH context could not read Muse or Claude credentials from the
  logged-in keychain. Scoped `gui/501` LaunchAgents started those exact sessions;
  no credential was copied. Failed SSH-auth launches did no lane work and are
  retained separately in the raw logs.
- Host load intermittently exceeded 15 and briefly exceeded 90, with Spotlight
  metadata indexing, an unrelated simulator session, and Chrome processes
  visible during the sustained intervals. Timing evidence retains the load
  context; repeated or best-of-three evidence is used where the instrument
  supplies it.
- Muse changed its lane-local copy of `choreography.mjs` while diagnosing M5
  (282 inserted and 12 deleted lines by attempt six; final diff 324 insertions
  and 12 deletions, lane hash
  `f752eebb7340ff5eab35fb9a8c6f896bfbd1da51f0fe62ed9b73b7fe5f5771e1`).
  The root instrument at
  commit `f40559f37722c79178be664a11f8a6485f1508fd` remained unchanged, and the
  diff's segment hunks are confined to M5 plus shared helpers. M1–M4 retain
  their frozen-harness standing; no later Muse M5 receipt is accepted as a
  canonical green result, even if the modified copy passes.
- Muse's verbatim score note repeats the lane final's “351-line harness
  mutation” characterization. The direct root-versus-lane diff above is the
  authoritative integrity measurement: 324 insertions and 12 deletions.
- Supplemental iOS simulator proof is not substituted for the required Hermes
  export, and a suite pass is never substituted for choreography.

## Retained evidence

This directory contains the three builder narratives and final reports, every
grader report and trace actually received, every M7 final report, available
machine run records, the scorer prompt, and the final score JSON/summary. Raw
lanes and logs remain outside git on the benchmark host at
`/Users/ccheever/clique-full-20260909-snapback2-0020/`.
