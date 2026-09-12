# Clique: Astra medium on published Snapback 2, Linux

Status: **builder running**, started2026-09-11 at21:36:51 UTC on
expo-build-1000. PID2598100, Codex thread
`01a09266-ee00-7701-bd60-d118acbb9fc0`, foreground harness session52200.
All three0.0.24 packages were registry-visible with exact staged hashes and
both native registry-only consumer suites passed19/19 before launch.
No independent benchmark grade exists yet. Builder-reported checkpoints
below remain provisional. This document records one run, not a new benchmark
protocol.

The package is the qualified source snapshot
`5f115db401a41954f10dc3737e5b03872470a4eb`, published from the20:54 release
landing. Concurrent acquisition work `b585f410d` and later web-witness work
on main landed after that snapshot was frozen and are **not** in0.0.24.
This run must not be presented as measuring those later changes.

## Fixed inputs

| Input | Selection |
| --- | --- |
| Host | `expo-build-1000`, observed hostname `expose-builder-pixel`, Ubuntu24.04.4 x86_64 |
| Remote run root | `/home/ccheever/clique-ri-20260911` |
| Package | Public npm `snapback2@0.0.24`, exact pin; no repository imports |
| Builder | `gpt-6-astra`, medium effort, one continuous session |
| Independent grader | Fresh `claude-opus-5` session, blind to builder narrative and transcript |
| M7 | Fresh `gpt-6-astra`, medium effort |
| Absolute-rubric scorer | Fresh `gpt-6-astra`, xhigh effort |
| Instrument | Frozen170 files at `f40559f37722c79178be664a11f8a6485f1508fd` |
| Instrument manifest SHA-256 | `c79c488faba273248cc182bb2ece2e3bca87713774df70da15b4c70ecbd4b9de` |
| Assigned ports | 53100–53119 |

The builder receives only the frozen instrument, generic harness inputs, and
the installed package's README, guide and generated types. No prior app,
diary, findings, scores or transcripts were copied into its lane. It must not
read a Snapback source checkout. Publication source and runtime qualification
are recorded separately in the
[release record](../2026-09-11-snapback2-release-0024-linux/README.md).

Final preflight PID2591039 ran21:34:49–21:34:51 UTC, exit0: load1.11,
242.18GiB available memory,452.39GiB disk, assigned ports clear, Codex0.154.0
authenticated with ChatGPT and real Chromium151.0.7922.34 DOM launch passed.
The process-start epoch is1789162611; the builder's first authored run-log
line records1789162624. Preserve both clocks rather than silently replacing
one with the other.

One pre-actor wrapper defect was repaired: `codex login status` exits0 and
writes its24-byte ChatGPT status line to stderr, while the generic preflight
read only stdout. The fix captures both streams, still refuses a nonzero
exit, and requires the exact `Logged in using ChatGPT` line. The original
script, failed zero-byte preflight output and direct stream evidence remain
under remote `preflight/`. No credential, model, frozen instrument, threshold
or authentication setting changed. This follows the documented status
command contract; its observed stream placement is local evidence, not an
assertion about every CLI version. See the
[official CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli#codex-login).

The immutable [preparation and launch archive](./preparation-and-launch.tar.gz)
has SHA-256 `5ce81cb9cf9c343a26de1799bb637294c1e1f5839f7953ddf8e7008dfeb5c8ba`.
It includes generic runner sources, prompts, the170-file manifest, both auth
parser versions and stream evidence, final preflight and actor-start metadata.
Final prompt SHA-256:
`9ea73ca9c85aa006c56798f38f492dcd1e395566e1abe41ec8944f1e04443488`;
patched preflight:
`d73562dc994169e26ac3a348335624ed9a2fad5ea8a89d53b664ffa025f61c1f`.

## Execution and evidence limits

Sequence: M1→M2→M3→M4→M5→M6→M8, independent grading, fresh M7, then scoring.
The prior separate messaging-day2-evolution add-on is excluded. M7 uses a new
backend seeded to the populated pre-replay starter state, not the100k replay
database. The frozen instrument's milestone limits and failure rules remain
unchanged; no mid-run human coaching or threshold repair is permitted.

This is a disclosed N=1 calibration/diagnostic run, not evidence of comparative
magnitude or variance. The choreography's preparation retained two initial
unmodified M7 self-test timeouts, three diagnostic-copy passes and one final
unmodified10-assertion pass. No instrument threshold was changed and no
platform defect is inferred from that intermittent fixture observation alone.

Linux cannot provide Apple simulator proof. Web output and iOS Hermes bundle
exports are separate artifacts and must not substitute for native simulation.
No holdout set was committed for this run. Raw root and descendant Codex
rollouts are retained and hashed, but the lightweight runner has no authentic
milestone-boundary controller: usage is `raw-retained-not-joined`, and cap or
boundary adjudication is
`unavailable-old-lightweight-runner-no-authentic-boundary-controller`.

All actor phases remain foreground under the existing harness with recorded
PID, start, end, exit and interruption metadata. A later phase may reuse only
attributed listeners; unrelated fleet processes are not stopped.

## Progress snapshot — 2026-09-11 at23:55 UTC

The builder reports functional M1–M6 green; M8 remains under test. The
independent grader, fresh M7 session and final scorer have not started.
M3 uses a documented group-fixture adapter, and the copied UI kit contains
eight accessibility-value compatibility patches. The frozen instrument
remains unchanged. These deviations require grading, not automatic acceptance.

The original M6 scale replay completed **167,244 actions**, with its
[clock](./m6-scale-clock.jsonl) recording start1789167936, end1789170317,
`pass:true`, and37,133ms of excluded probes. That is2,381s raw elapsed,
not a controlled comparative performance result. The
[final verification](./m6-scale-verification.json) reports exact manifest
and named-content agreement, including1,008 users,50,228 posts and100,015
messages. It uses operator-paged state; this is not independent grader
verification of every client API or authorization assertion. The JSON also
retains non-scored timing probes without turning them into a blanket scale
claim. Subsequent media/deep-history checks are still in the remote evidence.

M8 has a separate scale source/store on port53103. Its
[first attempt](./m8-scale-attempt1-clock.jsonl) failed after8,144 actions
with a membership-cap rejection. The builder traced this to the fixture's
1,000-conversation hub exceeding its app's100-conversation cap and is revising
bounded digest/search handling. Its original clock retains that failure and
the retry start; this local copy additionally preserves the first refusal.
The retry is ongoing. M8's autonomous digest/restart proof reports passing,
but does not replace the failed scale evidence. No supervisor coaching or
app edits have been supplied.

Exact hashes of these completed observations:

- M6 clock: `cf6801d7d485599688362fb755f1aaba0a0c2dffef088538ef5241c32817836b`
- M6 verification: `99e246da934631acf936cc00f82d6c120ddff43492af5aca480a2eb3ca8169ba`
- M8 first refusal: `8b0fe29eaf44ed799dce154c99125c3b6c2bca41a59054138227c5ffe2627202`

### Completed scale and later regressions — 2026-09-12 at01:28 UTC

The [complete M8 clock](./m8-scale-completed.clock.jsonl) retains both
attempts: the first failed after8,144 actions; the second resumed and
completed159,100 more, ending1789173075. The total is167,244 actions, not
a clean first-attempt replay. Initial start to final end was3,671s,
including the recovery gap. The [final verification](./m8-scale-verification-final.json)
reports exact manifest and named-content agreement. As with M6, this is
builder-produced operator-state evidence, not independent grading. Later
source was applied after this invariant snapshot for supplementary probes.

The literal midpoint timing rule is red for
[M6 search](./m6-envelope-summary.json) and
[M8 Trending](./m8-envelope-summary.json), missing their interpolation lines
by0.194367ms and0.514951ms respectively. Both final/initial ratio checks
passed. Preserve those exact verdicts; submillisecond differences on a shared
host do not establish meaningful or asymptotic performance regressions.

Supplementary actual Expo-web measurements at their recorded revisions:

- [Hub search](./m8-hub-search.json):1,000 conversations,40 distinct results
  across two pages,1,157 query requests,11.462s. An initial timeout preceded
  this passing retry and remains in the remote evidence and supervisor copy.
- [Cold synchronization](./m8-cold-sync-final.json):100 conversations and a
  fresh IndexedDB,54.894s to the reported caught-up gate. Maximum sampled
  JavaScript heap over the whole probe was705,741,792 bytes; that sample
  occurred **after** the sync timer, during settlement. Retained heap after
  forced GC was169,431,472 bytes. This is not native-device evidence.

Later receipt/reaction batching, delivery-sequence, retained-history,
readiness and browser connectivity fixes changed the app. Do not present
those earlier costs as measurements of the eventual final source without
requalification. Final M3 regression suite/choreography reports passing;
final M5/M8 verification and the builder handoff are still pending. An
intermittent reconnect timeout has both passing retries and earlier failures.
No supervisor app edits or coaching have been supplied.

The optional native `snapback2 test --json` returned **blocked**: certify
passed57 operations, while other categories lacked native journeys/seed.
It is distinct from the required external acceptance suites. Its internal
`dev --foreground --port0` invocation exposed neither a port option nor an
owner PID to the builder. The builder disclosed this lane-port/PID audit gap;
cleanup is tool-documented, not independently witnessed. Preserve this
limitation rather than claiming complete test or process custody.

## Concurrent-run custody incident

At21:50 UTC, fetching main revealed another supervisor's
[separate0.0.25 run](../2026-09-11-snapback2-0025-clique-linux/README.md).
That supervisor reports briefly changing this preparation's version file
to0.0.25 and truncating `preflight/pre-builder.json` through a refused
preflight before discovering this already-running actor. It restored the
version file and launched its own actor at21:47:42 in a separate directory
on ports53200–53219. We did not stop or modify either actor.

Our read-only check confirmed the0.0.24 app dependency and installed package,
the original rendered-prompt hash, the patched runner hash and the instrument
manifest hash. The live pre-builder JSON is now empty. The **actual original
preflight is retained** in the immutable preparation archive above, with
SHA-256 `9d88cb704e3e0285bf222a8a8f7ba7475e17fba4ec8df003e30cc8e353a6ff4a`;
it is not a reconstructed receipt. Leave the truncated file as incident
evidence rather than silently replacing it. Subsequent phases must continue
to use the exact0.0.24 pin and original generic wrappers.

The concurrent actor adds shared-host load from21:47:42 onward. This reinforces
the diagnostic-only posture: wall times are not controlled comparative
performance measurements. At discovery our builder reported M1 green and
M2 in progress; its own defect attributions still require independent grading.

### Cross-lane browser traffic discovered at23:57 UTC

Concurrent main commit `a07a851b0b195ede1572fccb1bdae57566e0a038`
records that an inherited `EXPO_PUBLIC_SNAPBACK_URL` sent the0.0.25 actor's
initial M1 browser traffic to this run's backend on53100. A read-only check
of that actor's public run log confirmed its event at epoch1789163616
(21:53:36 UTC): initial signup/profile requests targeted53100, the actor
discarded its invalid suite attempt, pinned53200 and stopped web PID2745801.
We did not read that actor's implementation or feed its findings to our builder.

**This is a potential state-contamination incident, not merely shared CPU
load.** The accepted writes and their effects on this run have not been
established. Our M1 green predates the other actor's start; M2 was still
running during this interval. Do not describe the whole continuous run as
cleanly isolated, attribute every correction to Snapback, or use its times
as controlled measurements. Retain the artifact and diagnostic evidence;
do not silently restart the builder or erase the affected interval.

The later M6/M8 scale servers use fresh stores on53102/53103, distinct from
the implicated53100 destination, but share host load. Before each fresh
grader/M7/scorer launch, explicitly unset `EXPO_PUBLIC_SNAPBACK_URL` and
`VITE_SNAPBACK_URL` in that process environment, as the updated repository
protocol requires. This will be a recorded launch-environment correction,
not an edit to the running builder or frozen instrument, and cannot repair
the earlier isolation claim retroactively.
