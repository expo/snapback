# Clique: Astra medium on published Snapback 2, Linux

Status: **builder running**, started2026-09-11 at21:36:51 UTC on
expo-build-1000. PID2598100, Codex thread
`01a09266-ee00-7701-bd60-d118acbb9fc0`, foreground harness session52200.
All three0.0.24 packages were registry-visible with exact staged hashes and
both native registry-only consumer suites passed19/19 before launch.
No benchmark outcome or milestone-green claim is made yet. This document
records one run, not a new benchmark protocol.

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
