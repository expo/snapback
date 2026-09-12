# Clique: Astra medium on published Snapback 2, Linux

Status: **builder and independent grading complete; fresh M7 running**. The builder ran
2026-09-11 at21:36:51 through2026-09-12 at01:37:35 UTC on expo-build-1000,
exit0,14,444s harness wall. PID2598100, Codex thread
`01a09266-ee00-7701-bd60-d118acbb9fc0`, foreground harness session52200.
All three0.0.24 packages were registry-visible with exact staged hashes and
both native registry-only consumer suites passed19/19 before launch.
The independent grade below qualifies the builder-reported checkpoints;
M7 and the absolute-rubric experience score are still pending. This document
records one run, not a new benchmark protocol.

## Builder handoff and grading

The builder reports M1–M6 and M8 suites and implemented web choreography
green. The last M8 boundary was1789176963; its authored run clock is
1789162624–1789177036 (14,412s), distinct from the harness clock above.
These are builder results, not independent acceptance of every assertion.
The strict scale timing failures, unavailable native simulator proof and
custody incidents below remain in force.

The [public handoff archive](./astra-snapback2-builder-public-handoff.tgz)
retains the actual final report, essay, diary, run log, base-schema run
record, coverage, final suites/choreography, correction ledger and selected
receipts. SHA-256:
`0877f3c55a20876bf5fdc0bdf8873cfa81d04976cdfaa6a1cee31ead250237cf`.
The [source snapshot](./astra-snapback2-pre-m7-source.tgz), taken before
M7, retains app/backend/scripts/configuration, vendored UI and lockfile,
without stores, credentials, dependencies or private transcripts. SHA-256:
`5ffa555a3907f8dcb6623ce59d492c6c8273a71901fe08bdc9558bd20c85c91f`.
Raw native rollout retention found the root and selected one tree entry;
the builder CLI stream contains no collaboration item. The manifest is
public, but the raw transcript stays private on the run host. This does
not supply joined milestone token accounting or cap adjudication.

The builder's final exported cold-sync probe reports55.869s for100
conversations, maximum sampled heap636,609,816 bytes over the whole probe,
and179,462,420 bytes retained after explicit post-settlement GC. Earlier
measurements below remain separate rather than being replaced. This is a
local web diagnostic with concurrent regression traffic, not a native or
network-realistic performance claim.

Some early failed standalone choreography files were overwritten by the
frozen writer before the builder added archival. Structured miss logs,
first-green copies and later retry archives survive. Do not claim every
standalone failure artifact was preserved. Rich custom-client history is
one item per page; normal app history is50 per page. The final report also
discloses non-virtualized history, fifty-row receipt/reaction display slices,
expensive hub-search merging, and one-minute digest dispatch cadence after
the08:00 UTC period boundary.

Fresh Claude Opus5 grading started1789177099 (01:38:19 UTC), PID2235048,
foreground harness session18355. Preflight verified0.0.24, real Chromium,
all assigned ports clear,239.64GiB available memory and381.63GiB free disk;
load was8.07/9.28/6.62. The launch explicitly cleared both public backend
URL variables and inherited harness note/port overrides. No builder
narrative or supervisor findings were supplied to the grader.

### Completed independent grade — 2026-09-12 at02:57:40 UTC

The grader exited0 after4,761s. Its [report](./grading/grader-report.json)
passes the frozen schema under AJV2020, and its [sanitized trace](./grading/trace.md)
records the independent probes, all three M4 choreography attempts,
deviations and process shutdown. The [grading archive](./astra-snapback2-grading-public.tgz)
adds receipts, screenshots, prompts and phase metadata; SHA-256:
`0def75f1ee04fd716b49c8b0904c57be8f150dfc0042a4d5ebc1bdfbfca65f6b`.
Raw grader transcripts and working probe data remain private on the host.

**101 assertions pass;18 are not-run**, comprising9 native-simulator
assertions and9 M7 assertions (this grade precedes M7). No coverage mapping
was judged dishonest. The frozen report schema permits only M1–M7 assertion
keys, so its JSON contains85 passes/16 not-run; M8's16 passes/2 not-run are
fully retained in the trace and report notes, and counted in O1. The frozen
schema was not changed to make this fit. The reviewer accepted the documented
UI compatibility patch and independently checked the thinner suite mappings.

Passing the checklist did not establish a bug-free app. The grader found
one **major app defect**: editing about300ms after sending can address the
optimistic `draft-…` ID, lose the edit and sometimes create a duplicate
message. It reproduced in6/6 fast attempts; a paired slow case passed4/4
with a2s pause. Three minor findings concern a1-of-3 video-delivery flake,
raw backend error strings in the UI and an error banner surviving a later
successful action. One cosmetic finding is an outsider's receipt-mark call
returning committed as a verified no-op; it was not an existence oracle.
These are findings about this built artifact, not automatic attribution of
every app bug to the Snapback runtime.

| Independent outcome dimension | Grade | Meaning and limitation |
| --- | ---: | --- |
| O1 checklist | 72 | Pre-M7 snapshot;18 checks unavailable/not attempted |
| O2 defects | 58 | Includes the major rapid-edit defect |
| O3 holdouts | null | No committed holdout set; improvised probes cannot replace it |
| O4 native offline proof | 30 | Missing Apple simulator evidence, **not** a demonstration that native offline is broken |
| O5 scale band | 30 | Literal midpoint rule misses by0.19/0.51ms; no demonstrated meaningful slowdown follows from that alone |

No weighted outcome total or efficiency score is valid: O3 is null, the
grader is uncalibrated, and the run has the custody limitations below. The
later Astra experience score is a separate, unweighted rubric. Preserve the
grade's actual findings and the distinction between unavailable evidence and
observed defects.

### Fresh M7 — started2026-09-12 at03:02:42 UTC

Fresh `gpt-6-astra`/medium, PID2738331, foreground harness session36841.
Preflight verified the same0.0.24 package/browser, clear assigned ports,
load0.88/1.08/1.36,241.46GiB available memory and364.73GiB free disk. Both
public backend URL overrides were cleared again. The original generic
renderer/launcher are unchanged, with one wave and one backend confirmed.

The actor archived the inherited store, started a fresh backend (PID2743065,
port53100), seeded all three starter segments, and exported per-persona
pre-M7 snapshots **before changing source**. It records that an existing
message-count structure includes tombstones; M7 must implement the required
visible-message count semantics and polls while preserving the starter data.
No supervisor coaching or grader findings were supplied to this fresh actor.
All179 files in the retained source snapshot matched the live app before
M7 launched. Earlier local extraction/audit accidentally saw empty directories
while transfers were still completing; the actual populated179-file source
and42-file handoff were subsequently extracted, counted and audited. The
only assignment-like credential candidates were the documented `your-password`
placeholder and HTML `current-password` autocomplete value. The archives
themselves and their hashes are unchanged.

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

At2026-09-12 01:57 UTC, an archive-to-live hash audit found that the sealed
archive's `SNAPBACK2_VERSION` itself contains `0.0.25\n`: it captured that
brief concurrent edit. The archive is therefore **not a wholly coherent
pre-launch directory snapshot**, despite retaining the actual original
preflight and prompt. Do not rewrite it or describe that version-file entry
as0.0.24. Its original preflight still says0.0.24 and hashes to9d88cb704e3e…;
the original rendered builder prompt still hashes to9ea73ca9c85a… and matches
the live prompt. All eight generic Python scripts, all four templates and
the original rendered prompt match the archive byte-for-byte. The live
version file, app dependency and installed package were rechecked as0.0.24;
the independent grader's fresh preflight also verified0.0.24. This limits
the archive's custody claim, not evidence that the actor switched packages.

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
