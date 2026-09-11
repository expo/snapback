# Clique Linux run preparation

Run root: `/home/ccheever/clique-ri-20260911` on `ccheever@100.65.137.99`
(`expo-build-1000`; observed hostname `expose-builder-pixel`).

## Frozen and run-specific material

- `instrument/`: 170-file byte-identical copy of the frozen instrument from
  BLACK's `/Users/ccheever/clique-ri-20260910/instrument`, instrument commit
  `f40559f37722c79178be664a11f8a6485f1508fd`.
- `lib/json-schema.mjs`: the required sibling helper from that packet.
- `prompts/*.template.md` and `scripts/`: generic prior-run orchestration only,
  patched for Linux, Astra-only ports 53100–53119, foreground process custody,
  PID/start/end metadata, and raw Codex root/descendant rollout retention.
- No prior lane, app, diary, finding, report, result, score, or run log was copied.

`SNAPBACK2_VERSION` intentionally contains `PENDING_ROOT_CONFIRMATION`.
`render.py` and `preflight.py` fail closed until root records a newly published
semantic version. Version 0.0.23 is explicitly refused because it is Darwin-only.

The frozen `instrument/ENVIRONMENT.md` still describes the prior Mac. The
run-specific prompt wrappers override only host/tool/port facts and leave the
instrument bytes untouched. Native Apple simulator evidence is unavailable on
this Linux host and must remain `unavailable`/`not-run`; a web run or iOS bundle
export is never a substitute.

## Evidence posture

This is the prior lightweight runner, not the frozen R2 controller. Each Codex
phase retains the newly created root rollout and every reachable descendant
rollout under `native/codex/<phase>/`, with a SHA-256 manifest. Those raw files
are compatible with the frozen `codex-rollout-jsonl.v4` adapter. They are not an
authentic milestone-boundary join: token totals remain `raw-retained-not-joined`,
and cap/boundary adjudication remains
`unavailable-old-lightweight-runner-no-authentic-boundary-controller`. No cap,
holdout, or native-simulator claim may be synthesized.

The grader is a fresh `claude-opus-5` session and must not read the builder's
diary, final report, transcript, or run log. No holdout set was committed for
this run; the wrapper requires the honest `none-uncommitted`/empty result.

## Sequence after root confirms publication

After `SNAPBACK2_VERSION` is updated, each command stays foreground. Run them
in this order; do not launch watchers.

1. Continuous M1→M2→M3→M4→M5→M6→M8 builder:

   `ssh -t ccheever@100.65.137.99 'export PATH=/home/ccheever/.cargo/bin:/home/ccheever/.bun/bin:/home/ccheever/.local/bin:$PATH; set -euo pipefail; cd /home/ccheever/clique-ri-20260911; ./scripts/preflight.py --phase builder | tee preflight/pre-builder.json; ./scripts/render.py; exec ./scripts/launch.py astra snapback2'`

2. Independent grader, injecting only the first configured Anthropic key into
   the remote process (the key is never copied to disk or printed):

   `awk '/^sk-ant-/ {print; exit}' /Users/ccheever/Dropbox/APIKeys/anthropic.txt | ssh -T ccheever@100.65.137.99 'export PATH=/home/ccheever/.cargo/bin:/home/ccheever/.bun/bin:/home/ccheever/.local/bin:$PATH; set -euo pipefail; IFS= read -r grader_key; cd /home/ccheever/clique-ri-20260911; ./scripts/preflight.py --phase grade | tee preflight/pre-grader.json; export ANTHROPIC_API_KEY="$grader_key"; unset grader_key; exec ./scripts/grade.py astra snapback2'`

3. Fresh M7 over a new backend seeded to the pre-replay populated starter state:

   `ssh -t ccheever@100.65.137.99 'export PATH=/home/ccheever/.cargo/bin:/home/ccheever/.bun/bin:/home/ccheever/.local/bin:$PATH; set -euo pipefail; cd /home/ccheever/clique-ri-20260911; ./scripts/preflight.py --phase m7 | tee preflight/pre-m7.json; ./scripts/render_m7.py; exec ./scripts/launch_m7.py astra snapback2'`

4. Absolute-rubric Astra score, read-only and after M7:

   `ssh -t ccheever@100.65.137.99 'export PATH=/home/ccheever/.cargo/bin:/home/ccheever/.bun/bin:/home/ccheever/.local/bin:$PATH; set -euo pipefail; cd /home/ccheever/clique-ri-20260911; ./scripts/preflight.py --phase score | tee preflight/pre-score.json; exec ./scripts/score.py astra'`

Each preflight rechecks host load/resources, ports, exact npm umbrella and
`snapback2-linux-x64` publication, frozen packet hashes, Codex authentication,
and a real Playwright 1.62.1 headless DOM launch. The builder phase requires the
entire range clear. Later phases retain exact listener evidence but do not fail
or kill by port/name; the phase actor must attribute any listener it reuses or
stop only a PID it recorded.

## Known frozen-harness preflight result

The real Playwright/Chromium DOM probe is green. The frozen choreography
`npm test`, in a representative copied sibling layout, failed its first two
unmodified Linux attempts at the internal M7 calibration assertion
`m7-a05-offline-vote-reconciles`: both timed out after 5 seconds waiting for
Alice's retained switched poll selection. Three later runs using a separate
diagnostic copy passed, including one with a diagnostic-only 1-second M7
timeout. One final unmodified, no-retry attempt also passed all 10 assertions.
The evidence supports a nondeterministic UI synchronization race, not
a deterministic fixture error, clock discontinuity, or demonstrated
Linux/Chromium/Snapback defect. Root disposition is to proceed unchanged as a
disclosed N=1 calibration/diagnostic run. Preserve every raw observed assertion;
do not weaken the threshold or attribute an application/platform defect without
independent corroboration. The run-specific layout supplies the previously
implicit fixture, metering, `CONTRACT.md`, and `lanes/lib/json-schema.mjs`
paths; no frozen instrument file was edited.
