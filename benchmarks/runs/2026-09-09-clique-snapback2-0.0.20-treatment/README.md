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
| Astra, gpt-6-astra medium | M1–M6 and M8 green; seven Hermes exports; supplemental native M6/M8 proofs failed | 167,157 / 167,157 settled; all 225 invariants and 10% / 50% / final checkpoints passed; cold browser sync and group send/render exceeded 30 s | 3.68 h (13,231 s) |
| Grok 4.6 xhigh | M1–M2 green; M3 suite green but choreography non-green; M4–M6/M8 suite-only and blocked by M3 | not run | 2.80 h |
| Muse Spark 1.3 xhigh | M1/M4 receipt-backed green; M2/M3 reported green with preserved-receipt gaps; M5 capability-failure at its four-hour wall; M6/M8 blocked | not run | 8.98 h, including disclosed same-family closeout |

Astra's first scale verifier run failed because its verifier omitted the
starter-author identity map. The same unchanged database passed after that
agent error was corrected; the failed receipt remains in the raw lane. Its
backend degradation checks passed, while device-side cold synchronization did
not: the cold-sync repeat exceeded 30 seconds in its first warm-up, with
zero of 20 measured samples completed and no p95. Grok ended candidly after
repeated M3 browser failures rather than upgrading suite-only evidence to
green milestones.

Muse's original continuous builder remained inside M5 until the preregistered
four-hour milestone wall at epoch `1788992935`. The orchestrator stopped only
that GUI service and its two child processes, then launched one fresh
same-family xhigh closeout over the preserved lane. The closeout attempted no
repair, recorded M5 as a capability failure, applied the brief's dependency
DAG to block M6 and M8, cleaned the lane-owned backend PID, and wrote the
required narrative and terminal report. Its disclosure and raw epochs are in
the retained final report.

## Independent grading

Fresh Claude Opus 5 sessions graded each pre-M7 lane against all 119 in-scope
M1–M8 assertions. The frozen JSON schema can serialize only the 101 M1–M7
keys; the traces retain the eighteen M8 results. Each session wrote a
schema-valid report and exited before M7 could
mutate the artifact. No holdout probe set was committed for this wave, so O3
is null and this remains uncalibrated grading.

| Lane | 101-key M1–M7 serialization subtotal: pass / fail / not-run | coverage | blocker / major / minor / cosmetic | O1 / O2 / O3 / O4 / O5 |
| --- | --- | --- | --- | --- |
| astra-snapback2 | 83 / 9 / 9 | honest | 0 / 3 / 4 / 2 | 66 / 45 / – / 55 / band 30 |
| grok-snapback2 | 68 / 9 / 24 | dishonest | 0 / 6 / 5 / 1 | 38 / 38 / – / – / – |
| muse-snapback2 | 80 / 5 / 16 | honest | 1 / 3 / 4 / 2 | 28 corrected (62 original) / 34 / – / – / – |

Full 119-assertion O1 scope accounting (observed results, before milestone
completeness-credit rules):

| Lane | M8 pass / fail / not-run | Full M1–M8 pass / fail / not-run | Trace |
| --- | --- | --- | --- |
| Astra | 16 / 2 / 0 | **99 / 11 / 9** | [M8 results](grading-astra-snapback2.trace.md#4-m8-assertion-results-recorded-here-because-the-report-schema-cannot-key-them) |
| Grok | 9 / 2 / 7 | **77 / 11 / 31** | [Full totals](grading-grok-snapback2.trace.md#12-totals-and-dimension-outcomes) |
| Muse | 0 / 0 / 18 | **80 / 5 / 34** | [M8 disposition](grading-muse-snapback2.trace.md#m8--insights-digest-and-multi-device-offline) |

The [frozen O1 rule](../../schema/social-messenger/applicability.json) keeps
every in-scope milestone in the denominator and gives non-green milestones
no checklist completeness credit, even when individual assertions pass.
The fresh Claude [O1 adjudication addendum](grading-muse-snapback2-o1-adjudication.md)
corrects Muse's original **62 to 28**: only M1 (13/13) and M4 (12/12) were
green, so 25/119 assertions receive completeness credit. The other 55
independently passing assertions remain true observations. The original Muse
grader JSON and trace remain unchanged; their O1 justification is superseded
only by this addendum. O2–O5, defects, coverage, assertion results, and holistic
scores are unchanged. The addendum is a rubric adjudication, not a new test run.

The clearest cross-lane repeated finding was web send/visibility latency.
Astra's [timing probes](grading-astra-snapback2.trace.md#316-web-client-write-latency--probe-send-breakdownmjs-lat-probemjs-defect-d-02)
isolated delay in the browser path to the server. Grok's
[six-message recheck](grading-grok-snapback2.trace.md#64-live-delivery--the-m3-failure-independently-reproduced)
verified all six commits only afterwards; commit-versus-visibility timing
remains unresolved. Neither establishes already-server-committed delivery latency.
Grok additionally reproduced the signup-to-first-offline-write grant boundary
three times. Astra established a full-envelope cold-browser synchronization
failure despite a green backend replay. Its feed APIs paged correctly while
the React feed surfaces stopped at twenty rows. Grok's remaining majors were
mostly application defects: null expiry on the product send path, a
never-called digest counter procedure, periodic digest over-emission, and an
untruncated push preview.

Muse's grader found one blocker: media mutations returned early for a duplicate
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
| grok-snapback2 | capability-failure | All 6/6 suite-required assertions passed (11/11 coverage), as did snapshot comparison and live tallies, but the offline vote did not reliably reconcile. |
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

- Muse Spark 1.3 xhigh is the same documented substitution as the
  [September 5 control](../2026-09-05-clique-full-3x3/README.md): requested
  Muse 3.1/ultra was unavailable (model IDs refused; ultra effort gated closed).
- The treatment lanes used ports 50100–50119 (Astra), 50400–50419 (Grok), and
  50700–50719 (Muse) because stale listeners from another program occupied the
  original 491xx range. The change was recorded before execution and changes no
  assertion.
- The remote SSH context could not read Muse or Claude credentials from the
  logged-in keychain. Scoped `gui/501` LaunchAgents started those exact sessions;
  no credential was copied. Failed SSH-auth launches did no lane work and are
  retained separately in the raw logs.
- Load above 90 is a **raw-host-only orchestrator observation**, with Spotlight
  indexing, an unrelated simulator session, and Chrome processes visible; no
  committed receipt substantiates that value. Copied grading evidence
  independently records load as high as **78** ([Muse trace](grading-muse-snapback2.trace.md),
  M3 typing attempts). Timing evidence retains its own load context and the
  instrument's repeated/best-of-three attempts.
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
- Muse's scorer exited zero without writing the expected `FINAL.md`. The
  orchestrator reconstructed it by mechanically concatenating only the root
  model command's ordered `run.output.delta` chunks, then ran the unchanged
  aggregator. No prose was authored or altered. The aggregate JSON's
  `muse/FINAL.md` source names that reconstructed scorer artifact. Its generic
  “Clique full run” Markdown heading describes this treatment's narrative
  aggregation; the Convex and Supabase narratives are the frozen controls.

## Corrections to verbatim sources

- Astra's 13,231-second wall is **3.68 h** (the prior synthesis said 3.65 h).
- [Muse's final report](final-muse-snapback2.md) miscalculates start-to-M4 as
  27,606 s / about 7.7 h. Its own endpoints give
  `1788978535 - 1788960929 = 17606` s, **4.89 h**. Total lane wall remains
  32,344 s, **8.98 h**.
- [Muse's M7 report](m7-muse-snapback2.md) places approximate choreography
  green at `1789000600`, 96 seconds after terminal end `1789000504`.
  The raw receipt `lanes/muse-snapback2/m7/choreo-m7.receipts.jsonl` records
  the green segment at **2026-09-10T00:33:11.772Z**, epoch `1789000391.772`
  (about `1789000392`), before terminal end. This receipt correction was
  supplied by the orchestrator for this fix; the raw receipt remains outside git.
- [Muse's verbatim essay](essay-muse-snapback2.md) incorrectly says it was
  written after M8. It was written by the M5 closeout; M8 was blocked and
  unbuilt. The essay, final, and M7 source prose above remain unchanged.

## Retained evidence

This directory contains the three builder narratives and final reports, every
grader report and trace actually received, every M7 final report, available
machine run records, the scorer prompt, the final score JSON/summary, and the
fresh Claude O1 adjudication addendum. Raw
lanes and logs remain outside git on the benchmark host at
`/Users/ccheever/clique-full-20260909-snapback2-0020/`.

| Lane | Builder evidence | Independent grading | Fresh M7 |
| --- | --- | --- | --- |
| Astra | [diary](diary-astra-snapback2.md), [essay](essay-astra-snapback2.md), [final](final-astra-snapback2.md), [machine record](record-astra-snapback2.json) | [JSON](grading-astra-snapback2.json), [trace](grading-astra-snapback2.trace.md) | [report](m7-astra-snapback2.md) |
| Grok | [diary](diary-grok-snapback2.md), [essay](essay-grok-snapback2.md), [final](final-grok-snapback2.md) | [JSON](grading-grok-snapback2.json), [trace](grading-grok-snapback2.trace.md) | [report](m7-grok-snapback2.md) |
| Muse | [diary](diary-muse-snapback2.md), [essay](essay-muse-snapback2.md), [final](final-muse-snapback2.md) | [original JSON](grading-muse-snapback2.json), [original trace](grading-muse-snapback2.trace.md), [O1 correction](grading-muse-snapback2-o1-adjudication.md) | [report](m7-muse-snapback2.md) |

Holistic evidence: [scorer prompt](holistic-score-prompt.md),
[unchanged aggregate JSON](holistic-scores.json),
[unchanged aggregate Markdown](holistic-scores.md).

**Navigation normalization and source hashes.** Only the 54 unresolved relative
Markdown links in Astra's reader-facing final/M7 reports were converted to
explicit code-form raw-lane locators. `lanes/...` locators are relative to the
raw host root above, not links to files in this publication; Astra's M7
locators start under `lanes/astra-snapback2/m7/`. Byte-exact originals remain
as [final source](final-astra-snapback2.source.txt) and
[M7 source](m7-astra-snapback2.source.txt), with SHA-256:

- final: `d899a9ab5f6467230e8c96fefc23765724d9c00e782a719ab69b4db140e76042`
- M7: `5ce379a27213d061e9d9969fbeba31b172eee362d168d0fd4255530b651a4c61`

All other copied artifacts retain their original bytes. The addendum's inline
paths such as `grading/trace.md` are raw Muse lane locators; the table above
links its copied inputs. The generic scorer prompt's substitution tokens and
the traces' credential redactions are preserved evidence, not pending work.
