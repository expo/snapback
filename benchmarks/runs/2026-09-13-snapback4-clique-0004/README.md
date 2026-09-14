# Clique on Snapback 4 — full brief, three builder models

**Status: running.** Astra medium completed its continuous build at
`2026-09-13T21:10:50Z` in 9,614.013 seconds of driver wall time. Grok 4.6 xhigh
finished at `2026-09-14T00:40:23Z` after 12,499.350 seconds with incomplete
milestone coverage. Muse delivered its builder report, then its runtime kept
submitting empty follow-up turns for background terminals. The orchestrator
interrupted that loop at `2026-09-14T05:34:59Z`; the actual exit code is **130**
and driver wall time is 17,657.686 seconds, including the continuation tail.
[Holistic scores](./holistic/README.md) are complete: Astra 84, Grok 70, Muse 80
(mean 78). Astra's received independent grade is 100 pass / 10 fail / 9 not-run
across 119 assertions. Grok's received grade is 70 pass / 18 fail / 31 not-run.
Muse's received grade is 94 pass / 16 fail / 8 not-run / 1 not-applicable.
[All three baseline grades](./grades/summary.md) are complete and structurally
validated. Astra's fresh M7 is active; Grok and Muse M7 remain pending.
All three lanes are frozen to published `snapback4@0.2.6` and
`snapback4-expo@0.2.1`. `REGISTRY_RECEIPTS.json` confirms that registry integrity
matches the exact qualified tarballs, including the platform binary.

The [36 ticket dispositions](./ticket-dispositions.md) are complete: 28 include
implemented fixes, seven were already resolved or obsolete, and one documents
existing policy. The repairs landed at `342c53d306d7484cd64e820ee27a151e02eb4b0b`.
The publisher reran the full suite in 30 seconds: 236 Rust, 9 fixture and
89 client passes, zero failures and one declared ignored test. Its installed
consumer checks passed. `release-qualification.json` retains the package,
binary and raw-log digests. Astra reports all seven continuous milestones green; its received independent grade and methodological limits are recorded below.

## Frozen run

| Item | Prepared value |
| --- | --- |
| Packet | `/Users/ccheever/clique-sb4-20260913-full-3models/` |
| Instrument | 177-file read-only snapshot at `409954115f151a72dd95e897c5f00f36877f11e0` |
| Brief | unchanged full social messenger brief; nothing struck |
| Builder sequence | one continuous cold session: M1 → M2 → M3 → M4 → M5 → M6 → M8 |
| Later phases | same-family holistic score; fresh Claude Opus 5 independent grade; fresh M7 builder-family session |
| Execution | serial, foreground, on the Black M5 Max; ports 49300–49319 |
| Requested product access | published packages, package README, generated API, CLI guide and diagnostics only; source-inspection deviations are recorded below |
| Evidence level | N=1 per model; calibration evidence, not a magnitude claim |

| Lane | Harness | Builder | Effort | Holistic scorer |
| --- | --- | --- | --- | --- |
| astra | Codex CLI | `gpt-6-astra` | medium | Astra, xhigh |
| grok | Grok CLI | `grok-4.6` | xhigh | Grok 4.6, xhigh |
| muse | Muse Code | `muse-spark-1.3` | xhigh | Muse Spark 1.3, xhigh |

The independent grader is a fresh `claude-opus-5` session for each artifact.
That matches the September 5 grader model. Its prior CLI version was not
recorded; this packet uses Claude Code 2.1.270, which limits comparison of
grader behavior across runs.

The [public-tool source-access audit](./source-access-audit.json) found five
Grok calls targeting installed package implementation, and no such call among
Astra's 393 inspected command starts. The final [Muse audit](./muse/qualifications/muse-finished-builder-source-access-audit.json)
records 23 implementation-targeting commands (21 exited zero, two exited one).
The earlier [active-run observation](./muse-source-access-observation.json) is
retained as a historical prefix. These accesses exceed the requested
documentation and generated-API discovery path. The audit inspects public
command/path arguments, not private reasoning or every possible indirect read;
no repository-checkout path appeared in the inspected arguments. These access
qualifications accompany the results without changing assertion grades.

## Results

[Astra's continuous build](./astra/README.md) is complete: M1–M6 and M8 are builder-green, and all
167,157 scale actions settled with local invariants and entity totals passing.
Its replay clock was 3,481.181 seconds after 87.819 seconds of recorded probe
exclusions (raw scale wall: 3,569 seconds). Registration honored the published
30-attempts-per-minute auth limit. The first 50% browser startup timed out;
after an application counter correction, the same-store replay resumed on the
original clock. Full-corpus cold startup later passed in 21.446 seconds.

Two strict performance predicates failed (Insights and Trending midpoint
curves). The implementation changed after the 10% checkpoint, so these are
diagnostic measurements, not a qualified uniform-code curve.

[Grok's continuous build](./grok/README.md) finished with M1/M2 web checks green,
M3 choreography failing (one of five required checks passed; one of six
implemented checks overall), and M4–M6/M8 partial API suites without choreography.
It produced no successful iOS Hermes export and stopped its scale replay
before verifying invariants. Its report cites insufficient remaining session
wall, although the prompt provides four hours per milestone and a separate
scale clock. This early stop is retained as an execution limitation, not an
exhausted benchmark allowance.

Muse reports its acceptance suites green after corrections, but did not run
the frozen choreography. Its four reduced replay attempts changed the generated
input: the first had 3,113 action failures; the second settled all actions but
verification failed to complete; the third passed 87/88 local verifier checks;
the fourth reports 36,804/36,804 actions and 88/88 checks. These are a reduced
corpus and local verifier, not the frozen 167,157-action scale qualification.
The [provisional corpus audit](./muse-provisional-scale-corpus-audit.json) and
[running-build observations](./muse-progress-observations.json) are retained as
historical observations. The [final Muse archive](./muse/README.md) now retains
source, corpus, native, and teardown qualifications, including the available
frozen log that the builder did not select and the copied choreography it did
not execute. A [clock observation](./muse-runlog-clock-observation.json)
records handwritten epochs ahead of observer wall time. Receipt clocks,
builder-written times, and driver time including the runtime continuation loop
remain separate. All three baseline grades are complete; fresh M7 sessions
remain in progress.

The separate [Grok client attribution audit](./grok-client-attribution-audit.md)
identifies mutation return values as a documented client limitation. Static
inspection points to the app's Expo/Babel version mismatch as the cause of its
Hermes failure; the proposed toolchain correction has not been runtime-tested.

The [pending-shape audit](./m6-pending-shape-audit.md) separates the builder's
attribution from the documented raw-row metadata boundary. The
[replica startup audit](./replica-startup-audit.md) confirms the old quadratic
JavaScript implementation is gone and explains why whole-browser startup
timing does not identify a new device-apply defect. The observed server exits
are tracked in the [existing dev-server follow-up](../../../issues/20260913-snapback4-dev-exits-without-diagnostic-during-schema-change.md);
that ticket retains the builder evidence with attribution still unresolved.

| Lane | M1 | M2 | M3 | M4 | M5 | M6 | M8 | Continuous wall | Holistic score | Independent 119 | Comparable 101 subtotal | Fresh M7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Astra medium | builder green | builder green | builder green | builder green | builder green | builder green | builder green | 9,614.013 s | 84 | 100 pass / 10 fail / 9 not-run | 84 pass / 8 fail / 9 not-run | active |
| Grok 4.6 xhigh | web green | web green | capability failure | blocked; partial API suite | blocked; partial API suite | blocked; scale incomplete | blocked; partial API suite | 12,499.350 s | 70 | 70 pass / 18 fail / 31 not-run | 60 pass / 17 fail / 24 not-run | pending |
| Muse Spark 1.3 xhigh | suite claim; no choreography | suite claim; no choreography | suite claim; no choreography | suite claim; no choreography | suite claim; no choreography | suite claim; no choreography | suite claim; no choreography | 17,657.686 s; includes interrupted runtime continuation | 80 | 94 pass / 16 fail / 8 not-run / 1 not-applicable | 79 pass / 13 fail / 8 not-run / 1 not-applicable | pending |

Astra's grade passed the frozen schema and exact 101+18 assertion partition.
Its 18 M8 results are 16 pass / 2 fail; all nine not-run results are pre-evolution
M7 assertions. The grader found one checklist functional failure: follower
counts stay stale on the followed user's client. The other nine failures
represent absent native simulator proofs. On the prior 101 assertions, its 84
passes match the previous Snapback4 run. The [exact assertion comparison](./astra-grade-comparison.md)
records one pass→fail (live follower counts), one fail→pass (quoted-reply
navigation), seven not-run→fail classifications for the same absent native
proofs, and nine unchanged not-run M7 assertions.

The grader reports O1=74, O2=76, O3=null, O4=35, O5 band=30. Its O4 justification
explicitly uses grader-run choreography. The frozen schema calls for retained
choreography receipts, while the prompt also calls for web re-execution and
best-of-three timing checks. This methodology qualification remains attached
to the received results; O4 is not presented as a score from original builder
receipts. The [completed grade archive and audit](./astra/grading/README.md)
found no explicit excluded narrative or other-lane read in public tool
arguments, and original source and evidence hashes remained unchanged. It also
records one nonexistent receipt filename in the received report; the named
assertion passes in the actual retained receipts. The grader remains
uncalibrated N=1.

The [client attribution audit](./astra-grade-client-attribution.md) traces the
stale follower count to 0.2.6 discarding server changed-table invalidations when
the device receives no matching row. Later main commit `047862694` repairs this
class and adds a regression; this benchmark does not measure that fix. The
grader also observed delayed offline indication despite 1 ms local search.
That separate [link-detection follow-up](../../../issues/20260913-snapback4-offline-link-detection-can-lag-during-held-poll.md)
retains the three samples and the inferred long-poll mechanism.

Grok's independent grader exited zero after 2,793.393 seconds. Its structurally
validated results are 60 pass / 17 fail / 24 not-run on the comparable 101 IDs,
plus 10 pass / 1 fail / 7 not-run for M8. It reports O1=10 and O2=25, with O3,
O4 and O5 null. O1 applies a separate coverage adjudication: the grader found
assertions such as `assert(true)` and `assert(own || true)` and marked six
milestones' suite mappings dishonest. The raw 70/119 passing observations and
that scoring penalty remain distinct. The [exact Grok comparison](./grok-grade-comparison.md) records 60 current
passes versus 68 on the prior Snapback2 run, with changed methods and instrument
limits retained. The [completed Grok grade audit](./grok/grading/README.md)
confirms the coverage findings, original source custody, and package pins. It
records two citation defects without changing received grades. Grok's grader
used the original choreography receipts and separate web/API probes; it did
not rerun the choreography harness.

The [Grok client attribution audit](./grok-grade-client-attribution.md) separates
application defects from one concrete [pending-sync transport mismatch](../../../issues/20260914-snapback4-sync-pending-query-exceeds-request-line-limit.md):
256 ordinary pending IDs produce a 9,011-byte request line, exceeding the
host's 8,192-byte limit. The app's repeated receipt writes amplify the trigger.
The retained failed URL is truncated, so its exact size and the parser response
remain unproven; the supported-state mismatch follows from pinned code.

The received Grok report says scale replay was never attempted. The continuous
builder archive instead retains a short real attempt that stopped without
completing the frozen replay or verifying invariants. Its lack of a qualifying
scale receipt is established; the received wording and O5=null remain
unchanged and carry this qualification.

Muse's grader exited zero after 2,312.379 seconds. It reports 79 pass / 13 fail /
8 not-run / 1 not-applicable on the comparable 101 IDs, plus 15 pass / 3 fail
for M8. Its O1=30 applies coverage adjudication to M2, M3, M6 and M8, leaving
34/119 credited separately from 94 raw passes. O2=40, O3/O4=null, and O5 band=0
because the reduced replay does not meet the frozen corpus invariants. Its
[exact Muse comparison](./muse-grade-comparison.md) records 79 current passes
versus 75 on the prior Snapback2 run, plus one conditional M7 classification
change from not-run to not-applicable. The [completed Muse grade audit](./muse/grading/README.md)
verifies coverage adjudication, citations, source custody, and package pins.
It records the use of fresh browser checks when the frozen harness failed at
sign-in, and the corrected typing measurement used in the final grade.
All verdicts remain as received.

The [Muse attribution audit](./muse-grade-client-attribution.md) found no new
product defect in its five reviewed clusters. Private digest metadata was
exposed because the app explicitly declared those tables `public` and
`sync public`. Its five-way login failure matches the documented two Argon2
slots; the app discards structured retryability and the harness does not retry.
The TTL unit conversion, recent-pool Trending, and unreconciled digest counts
are application logic defects. These qualifications do not change the grade.

Astra's fresh M7 started at `2026-09-14T07:58:39Z` with the same Astra medium
model and a single 14,400-second cap. The baseline grades above precede this
schema-evolution work; M7 evidence and outcome will be retained separately.

The [holistic scorers](./holistic/summary.md) use their own builders' narratives, so their diagnoses are
not independent technical findings. Astra charged pending metadata loss that
the [pending-shape audit](./m6-pending-shape-audit.md) identifies as a documented
raw-row boundary. Grok charged Hermes failure that the
[client attribution audit](./grok-client-attribution-audit.md) traces statically
to its Expo/Babel mismatch. Received scores remain verbatim.

The Astra M4 builder reproduced a new [video prediction defect](../../../issues/closed/20260913-snapback4-video-id-only-prediction-refuses.md): passing the documented asset `{ id }` fails locally when the mutation reads `.duration`. Passing the complete upload response let it continue. This is received builder evidence; the auditor did not independently reproduce it, and the published pins remain unchanged.

A separate main-branch change, `7b2b8fc65`, has since closed that ticket by persisting authenticated upload facts for device prediction and degrading safely when they are unavailable. That resolution is outside the frozen 0.2.6 benchmark; the results here do not qualify it.

Muse later supplied a [second compact-video trace](./muse-m4-compact-video-provisional-attribution.md) with the same local `E_FIELD`, authoritative upload duration, and absence of a mutation HTTP request. This corroborates the existing issue; it is not an independent auditor reproduction or grade.

The frozen assertion manifest contains 119 unique IDs: 101 for M1–M7 and 18
for M8. The frozen report schema accepts the 101-ID set, so each independent
grader will write those results to `grader-report.json` and the same session's
18 M8 results to `m8-assertion-results.json`. The summary must retain the full
119 result and the comparable 101 subtotal separately. Earlier structured
grades omitted all 18 M8 IDs; their narrative comments are not a comparable
M8 assertion result.

The holistic score and complete independent grade occur before M7 because M7
changes the artifact. Each M7 run starts a fresh process using its lane's
builder model and effort.

The [Muse score-provenance preflight](./muse-score-output-provenance-preflight.md)
found that recursive JSON-string extraction could accept the prompt's example
if the final answer were malformed. The frozen aggregator remains unchanged.
Before aggregation, an external capture helper validates the unique public
terminal answer and its complete score, then retains that answer verbatim as
`scores/muse/FINAL.md` with a provenance receipt. Validation failure stops this
path; no score is inferred or repaired.

## Prior N=1 anchors

The grade column below is limited to the prior 101 M1–M7 IDs. These are
calibration anchors only. [The prior-results dataset](./prior-results.json)
retains the exact scores, timings, methods and 32 hashed sources. The [instrument audit](./instrument-comparison.md)
confirms byte-identical September 12/current packets, while September 5 differs
in 47 shared files and adds seven current files. The brief, assertion manifest,
grader contract and scale log are unchanged, but fixture membership, UI and
choreography, evidence rules and host scheduling differ.

| Prior lane | Published product | Grade pass / fail / not-run (101) | Holistic score | M8 structured coverage | Fresh M7 |
| --- | --- | --- | ---: | --- | --- |
| Snapback 4, Astra medium | `snapback4@0.1.0` | 84 / 1 / 16 | not run | 0 / 18 reported | capability-failure, 1,386 s |
| Snapback 2, Astra medium | `snapback2@0.0.4` | 81 / 11 / 9 | 64 | 0 / 18 reported | green, 19 min |
| Snapback 2, Grok 4.6 xhigh | `snapback2@0.0.4` | 68 / 9 / 24 | 57 | 0 / 18 reported | green, 31 min |
| Snapback 2, Muse Spark 1.3 xhigh | `snapback2@0.0.4` | 75 / 17 / 9 | 78 | 0 / 18 reported | artifact green, 5 h 58 min 26 s; exceeded the 4 h safety cap |

The prior Snapback 4 builder completed every continuous milestone in 7,002
seconds. Its M7 preserved a pre-existing M1 regression and therefore closed as
a capability failure. The Muse/Snapback 2 M7 row reflects the retained-artifact
audit completed on 2026-09-13: the artifact passed, but its 21,506-second run
was not an on-budget completion.

## Execution order

Both exact npm pins are published and frozen. Packet verification passed for
all 177 instrument files and three cold lanes before launch. These foreground
commands run serially:

```sh
cd /Users/ccheever/clique-sb4-20260913-full-3models
python3 scripts/run_phase.py builder astra
python3 scripts/run_phase.py builder grok
python3 scripts/run_phase.py builder muse
python3 scripts/run_phase.py score astra
python3 scripts/run_phase.py score grok
python3 observed-milestones/helpers/muse_post_interruption_phase.py score
python3 observed-milestones/helpers/capture-muse-score-final.py .
python3 scripts/aggregate_scores.py
python3 scripts/run_phase.py grade astra
python3 scripts/run_phase.py grade grok
python3 observed-milestones/helpers/muse_post_interruption_phase.py grade
python3 scripts/summarize_grades.py
python3 scripts/run_phase.py m7 astra
python3 scripts/run_phase.py m7 grok
python3 observed-milestones/helpers/muse_post_interruption_phase.py m7
```

Muse's post-builder phases use the external helper shown above. It qualifies
only this exact builder's exit-130 record, completed public terminal answers,
automatic empty-turn continuation, interruption receipt, and fixed package
pins by hash. Its generated runner differs from the frozen runner by one
builder-completion predicate; downstream exit checks, prompts, models, commands,
and lifecycle output remain unchanged. The original runner and actual builder
exit record are retained unchanged. This is an orchestration exception, not a
successful builder-process exit or a benchmark pass.

The packet's foreground runner records command, PID, start, exit, end, wall
time, stdout, and stderr for every phase. Those retained lifecycle records,
lane reports, holistic outputs, 101-ID grade files, 18-ID M8 supplements, grade
summary, and fresh-M7 reports will replace the pending cells after execution.
