# Clique on Snapback 4 — relaxed-Quarry rerun, full brief, three builder models

**Execution update — 2026-09-14, Astra orchestrator handoff.** The prepared-status paragraph below is historical. This cell launched at 11:15:05 UTC on the frozen `snapback4@0.2.10` / `snapback4-expo@0.2.3` pair in `PACKAGE_PINS.json`; builders and later phases run serially under `~/projects/snapback-lanebriefs/clique-cell.sh` (chain PID 58444, `cell.log`). Astra is in M6 at this update. The actual ports are 49340–49359, as the deviation section records. No instrument, prompt, package pin or lane source is changed by this documentation update. Worker actions (§9.2) have already been commissioned and built; the full-cell finding will inform the author's remaining §9.1 SQL-read choice.

**Status: prepared, pins pending.** Nothing has been launched.
`SNAPBACK4_VERSION` holds `PENDING_PUBLISHED_FIXED_PIN` and
`SNAPBACK4_EXPO_VERSION` holds `PENDING_PUBLISHED_EXPO_PIN` until the fixed
packages are published; the pins will be `snapback4@0.2.10` or later and
`snapback4-expo@0.2.2` or later. Creation time is in `CREATED_AT`.

## Purpose

This packet is the rerun that LLP 3000.007 §10.3 asks for
(`llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md` in the Snapback
repository at `/Users/ccheever/projects/snapback`): a fresh docs-only cell per
builder family on a published pin carrying that RFC's §5 (the relaxed
language), §6 (explicit residency), §7 (the online-only mode) and §8 (the
seams), on the unchanged frozen instrument; the loop bar (LLP 3000 §3) as the
gate; the 0.2.6 record as the anchor. The pin is the publish after LLP
3000.007 §12 step C. The rerun decides LLP 3000.007 §9: if reporting and
integrations still cost loops, §9.1 and §9.2 get their Moves lines; if not,
they stay specified and unbuilt.

The anchor is the 0.2.6 three-model run. Its repository record is
`benchmarks/runs/2026-09-13-snapback4-clique-0004/`; its frozen packet is
`/Users/ccheever/clique-sb4-20260913-full-3models/` (published
`snapback4@0.2.6` + `snapback4-expo@0.2.1`). This packet was populated from
that packet's inputs only: its `lanes/`, `scores/`, `logs/`,
`observed-milestones/`, `snapshots/`, rendered per-lane prompts,
`PACKAGE_PINS.json` and `REGISTRY_RECEIPTS.json` were not copied.

This packet runs the unchanged full social-messenger instrument continuously
through M1 → M2 → M3 → M4 → M5 → M6 → M8, runs the September 5 same-family
holistic scoring rubric, independently grades the resulting artifact against
all 119 assertions in a fresh Claude Opus 5 session, then runs M7 in a fresh
session of the same model and effort as that lane's builder. Builders receive
no steering after launch and must not read any Snapback source checkout or
prior benchmark.

## Frozen inputs and lanes

- `instrument/` is a byte-for-byte, read-only copy of the anchor packet's
  `instrument/` (itself the copy of
  `/Users/ccheever/clique-sb4-20260912-full/instrument`), commit
  `409954115f151a72dd95e897c5f00f36877f11e0`: 177 files, 16,243,769 bytes,
  verified file-by-file against the unchanged `INSTRUMENT.sha256`, with no
  writable entry. It includes the exact brief, protocol, assertion schemas,
  fixture logs/media, UI kit, choreography, grader, metering, and
  observability tools. `lib/json-schema.mjs`, which the instrument's
  validators import by relative path, is copied beside it unchanged.
- The builder, grader, holistic and M7 templates are copied unchanged from the
  anchor packet and match the unchanged `PROMPT_TEMPLATES.sha256`.
  `score.previous.template.md` is byte-identical to the September 5 holistic
  scoring prompt; `holistic.template.md` retains its 13-category rubric while
  adapting its three-backend input list to this run's one Snapback4 lane per
  model family. `scripts/render.py` supplies only lane/model/environment facts
  and a version-neutral published Snapback4 orientation paragraph.
- `scripts/`, `GRADER_ASSERTIONS_101.txt`, `INSTRUMENT_COMMIT` and
  `MODEL_AVAILABILITY.md` are byte-identical to the anchor packet's.
- Cold lanes are `lanes/astra-snapback4`, `lanes/grok-snapback4`, and
  `lanes/muse-snapback4`. Each initially contains only a link to this packet's
  frozen instrument.
- Every lane uses ports 49300–49319. Builder processes run serially on the
  Black M5 Max, so the same range and occupied-port note reach every lane.

| Lane | Harness | Builder model | Effort |
| --- | --- | --- | --- |
| astra | Codex CLI | `gpt-6-astra` | medium |
| grok | Grok CLI | `grok-4.6` | xhigh |
| muse | Muse Code | `muse-spark-1.3` | xhigh |

`scripts/run_phase.py` keeps its child in the foreground and waits for it. It
writes the child PID, complete command and start time before waiting, streams
stdout/stderr to retained logs, and writes exit code, end time, and monotonic
wall time afterward. It does not create a detached process. Builder and
holistic-score phases hold separate serial locks so their model sessions cannot
overlap within a phase.

## Pin and packet check

After the fixed packages have been published, from this directory:

```sh
cd /Users/ccheever/clique-sb4-20260913-relaxed-3models
printf '%s\n' '<published-semver>' > SNAPBACK4_VERSION
printf '%s\n' '<published-expo-semver>' > SNAPBACK4_EXPO_VERSION
python3 scripts/render.py
python3 scripts/verify.py
```

The published pair must be `snapback4@0.2.10` or later and
`snapback4-expo@0.2.2` or later, and the `snapback4` pin must be the publish
that carries LLP 3000.007 §5–§8; an earlier pin would measure the anchor's
language again. Confirm both exact pins exist on npm before launch without
installing them into a lane: `npm view snapback4@<published-semver> version`
and `npm view snapback4-expo@<published-expo-semver> version`.
`scripts/render.py` writes the frozen pair to `PACKAGE_PINS.json`; every
lifecycle start record also repeats both pins. While either pin is pending,
`scripts/verify.py` refuses with `package pins are pending`;
`scripts/verify.py --allow-pending` checks everything else.

The anchor packet also recorded registry integrity for `snapback4`,
`snapback4-darwin-arm64` and `snapback4-expo` against the exact qualified
tarballs in a `REGISTRY_RECEIPTS.json` (per package: name, version, the
registry `dist` block, the local tarball path, its SHA-256, and whether the
registry integrity matched it). Write the same receipt for the new pins before
launch. No packet script reads it; it is a record, not a gate.

## Exact execution order

Run each command only after the preceding one exits. These are foreground
commands; no watcher or detached launcher is required.

```sh
cd /Users/ccheever/clique-sb4-20260913-relaxed-3models

python3 scripts/run_phase.py builder astra
python3 scripts/run_phase.py builder grok
python3 scripts/run_phase.py builder muse

python3 scripts/run_phase.py score astra
python3 scripts/run_phase.py score grok
python3 scripts/run_phase.py score muse
python3 scripts/aggregate_scores.py

python3 scripts/run_phase.py grade astra
python3 scripts/run_phase.py grade grok
python3 scripts/run_phase.py grade muse
python3 scripts/summarize_grades.py

python3 scripts/run_phase.py m7 astra
python3 scripts/run_phase.py m7 grok
python3 scripts/run_phase.py m7 muse
```

Anchor wall times, from the anchor packet's retained lifecycle records:
continuous builders 9,614 s (Astra), 12,499 s (Grok) and 17,658 s (Muse);
same-family holistic scores 145 s, 295 s and 42 s. The anchor had not
recorded grade or M7 wall times when this packet was created; the earlier
anchors' fresh M7 sessions took 1,386 s (Snapback 4 0.1.0, Astra) and 19 min,
31 min and 5 h 58 min (Snapback 2 0.0.4, Astra, Grok and Muse).

The holistic scorers use each builder's own model family at xhigh and read only
that family's builder narrative, matching the earlier rubric while avoiding the
independent `grading/` evidence. The three grades are fresh `claude-opus-5`
sessions using the frozen grader prompt plus a wrapper that requires every
frozen assertion. That is the exact grader model recorded by the September 5
full run; its then-current Claude CLI version was not recorded, while this
packet uses Claude Code 2.1.270, a comparison limitation.

The frozen assertion manifest has 119 unique IDs: 101 across M1–M7 and 18 in
M8. Its frozen report schema permits only the M1–M7 IDs. Each grader therefore
writes the schema-valid 101 to `grader-report.json` and the same independent
session's 18 M8 results to `m8-assertion-results.json`.
`scripts/summarize_grades.py` requires that exact partition and reports the
complete 119, the directly comparable prior 101, and M8's 18 separately. The
September 5 and September 12 structured `assertionResults` omitted M8 entirely;
their notes could describe M8 observations, but did not supply a comparable
18-ID result set. That is the prior measurement-coverage gap.

M7 runs only after all grades have passed the 119-ID summary check and every
lane has been holistically scored because M7 mutates the artifact. Each M7
command starts a new CLI process and never resumes the continuous builder
session.

## Anchors

The primary anchor is the 0.2.6 three-model run: repository record
`benchmarks/runs/2026-09-13-snapback4-clique-0004/`, frozen packet
`/Users/ccheever/clique-sb4-20260913-full-3models/`, published
`snapback4@0.2.6` + `snapback4-expo@0.2.1`, on this same instrument commit,
these same templates and scripts, and the same models, efforts and harness
versions. The LLP 3000.007 §9 comparison reads that record. Its retained
lifecycle records give the continuous builder outcomes: Astra medium
9,614.013 s (exit 0), Grok 4.6 xhigh 12,499.350 s (exit 0), Muse Spark 1.3
xhigh 17,657.686 s (exit 130: the runner forwarded a SIGINT; the lane's
`final-report.md` was already written). When this packet was created, the
record's holistic, independent-grade and M7 cells were still pending; the
frozen packet's `scores/` and `logs/` hold what has completed since.

Earlier anchors, N=1 each and calibration only (retained in the 0.2.6
record's `prior-results.json`); the grade column covers only the prior 101
M1–M7 IDs:

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

The executable versions and harmless model probes are recorded in
`MODEL_AVAILABILITY.md`, copied unchanged from the anchor packet. They were
re-checked at this packet's creation and are identical: Codex CLI 0.154.0,
Grok 1.0.30, Muse Code 1.2.1, Claude Code 2.1.270, Node 24.18.0, Bun 1.3.12,
macOS 26.6.2 (25G83) on the Apple M5 Max. CLI version drift from the earlier
runs is disclosed there.

## Carried-over labels to rule on before launch

- `scripts/render.py` labels each lane `<wave>-clique-snapback4-full-20260913`
  and each grade wave `full-3models-<wave>`, the same IDs the anchor run used.
  They are labels, not paths; no packet script keys on them. They are left
  unchanged so the scripts stay byte-identical to the anchor's; change them
  and re-render only on the author's ruling.
- `MODEL_AVAILABILITY.md` cites the anchor's probe directory,
  `/Users/ccheever/clique-sb4-20260913-model-probes/`. A fresh probe directory
  is only needed if a CLI version changes before launch.

## Deviation from the anchor packet

`scripts/run_phase.py`'s port-occupancy check counts listening sockets only (the anchor's bind-probe also refused ports that an unrelated process held as the local end of an outbound connection, since 49300–49319 lies inside macOS's ephemeral range). The port range is 49340–49359 (`scripts/render.py`, `verify.py`, `run_phase.py` edited for the range only), because the anchor packet's M7 phases and the 0.2.9 Astra calibration packet hold 49300–49339 on this machine. No other script differs from the anchor.

## Observed execution deviation — 2026-09-14, Grok signing

The Grok builder reports re-signing its lane-installed `snapback4-darwin-arm64@0.2.10` executable with an Apple Development identity and using Python/Popen in a new session after macOS `_dyld_start` stalls. This changes the binary's byte identity; the package version stays 0.2.10. At the orchestrator's read-only observation, the published control is 7,728,288 bytes / SHA-256 `af4e26be10419df9428bf6be0c7513de07d227e33f77cdb464c4d93dc2a0767d`, and Grok's re-signed binary is 7,701,616 bytes / `929be28d4907839a25b88d9ec456b2a1a18c44921e8e223f86e6982c64cb8ed2`. All 17 Mach-O section payloads and the payload between load commands and embedded signature hash identically. The evidence supports the observed signing/load-command deviation; it does not establish signing as the cause or cure of the stall. The host also exhibited dyld-start stalls in unrelated executables.

Evidence: `lanes/grok-snapback4/run-log.md` (received workaround and M1 green), with the external orchestrator receipt at `/Users/ccheever/projects/snapback-lanebriefs/grok-signature-observation-20260914.json`. No instrument, pin file, prompt, or runner was changed by the orchestrator. This note records an already observed builder action; it does not steer the active builder or certify the final cell.

## Observed execution deviations — 2026-09-14, completed Grok builder

Grok's builder ended at 16:47:32 UTC with actual exit 0 and runner wall 11,928.612 s. Its final report marks only M1 and M2 green; M3–M6 and M8 are aborted after non-green choreography, and no milestone reached the allowed four-hour cap. Preserve this early-stop deviation and incomplete coverage. The report's 11,750 s wall disagrees with both the runner and its own start/end difference (11,890 s). The process exit is not a seven-milestone success. Muse began immediately afterward; the orchestrator did not resume or steer Grok's completed builder.

The bounded public-argument access audit found two packaged implementation read requests (CLI wrapper and `dist/web.js`) and eleven declaration access requests among 731 public tool calls. These qualify the docs-only protocol even though the builder's essay says it did not open a source tree. The audit does not establish delivery of every requested file, indirect access, or complete compliance. It traces the development-signing requests and the packet-provided JSON-schema helper copy. Two copied choreography files change only the helper import from `../../lib` to `../lib`; the helper is byte-identical to `benchmarks/tools/lib/json-schema.mjs` at frozen commit 409954115f151a72dd95e897c5f00f36877f11e0. The packet's frozen instrument remains distinct from these adapted lane copies.

Post-builder capture retains the same package versions and re-signed native binary SHA documented above. More precisely, its 14 file-backed Mach-O section hashes match the control, alongside matching descriptors for three zero-fill sections; the full payload between load commands and signature also matches. Its 453-second scale replay uses a separate, earlier schema with substantive differences from the final app, and verifies named cardinalities rather than the complete invariant manifest. It does not qualify the final app's exact source.

Evidence outside the frozen packet: `/Users/ccheever/projects/snapback-lanebriefs/GROK-0210-ACCESS-AUDIT.md` and `.json`, plus `cell-custody-0.2.10/grok/{builder,builder-supplement,builder-instrument-adaptation}/`. The audit observed no remaining PIDs in the selected recorded sets at approximately 16:56–16:59 UTC; exact end-time teardown and all descendants are not established. No orchestrator cleanup preceded those observations.

## Observed execution deviations — 2026-09-14, Muse completion and phase driver

Muse supplied its final report and a complete public terminal answer, then twice
restated completion in response to idle-server callbacks. At 22:21:31 UTC the
orchestrator sent SIGINT to the verified Muse CLI PID 65229 alone. Its actual
builder end record is retained unchanged: exit 130, wall 20,039.027 seconds.
The report's end epoch is 22:10:23, leaving 668 seconds before the runner end;
its calendar labels and several milestone epochs disagree with retained receipts.
Use lifecycle and receipt times, preserving the report's original values.

The final `receipts-all5.jsonl` sweep reports seven green segments. Its M5 expiry
pass is a false positive: the exact probe message remained stored with a 24-hour
expiry when independently inspected read-only, despite the probe passing after
46.459 seconds. The app used production windows and a 45-second wait; the frozen
instrument provides shortened grading windows. The precise hydration/snapshot
race is an inference. Original receipts remain unchanged. Muse ran only the
50-action replay sample and exported Hermes bundles without a native simulator
proof. Three diagnoses in its final report are not a complete correction ledger.

The original serial shell PID 58444 was paused while Astra's scorer continued,
then stopped after that scorer finished. Remaining phases are scheduled serially
by the orchestrator, preserving all scores before any grade and all grades before
M7. `cell.log` therefore will not receive an automatic `cell-done` line.

For Muse's later phases, the external helper
`/Users/ccheever/projects/snapback-lanebriefs/muse-post-interruption-phase.py`
qualifies the exact builder, final report, interruption receipt, raw log and pin
hashes, then changes only the builder-completion predicate in memory. The frozen
runner, original exit 130, phase starts/ends, prompts, models, port checks and
other completion gates are preserved. Seven retained guard checks pass. This
follows the anchor's completed-Muse-tail exception; it does not authorize treating
an arbitrary nonzero builder as complete or deleting prior phase records.

The Muse public-argument audit found 44 packaged implementation read/search
requests and 12 declaration events. Targets for 299 native file/search requests
and internal access by two subagents remain unverified. All 35 copied UI files
and 67 metering files match their frozen originals. Two copied choreography
imports use an 18-line AJV helper; all 340 retained receipt rows and setup validate
under the unchanged original support validator. These are bounded format and
custody observations, not semantic or docs-only compliance proof.

External evidence: `muse-tail-interruption-20260914.json`,
`cell-driver-takeover-20260914.json`, `muse-builder-exception-qualification.json`,
`muse-post-interruption-tests.log`, `MUSE-0210-ACCESS-AUDIT.md`, and
`cell-custody-0.2.10/muse/` under the lanebriefs directory. The expiry and awaited
navigation-admission controls are also retained in the repository's
`benchmarks/runs/2026-09-14-snapback4-clique-0.2.10/muse/qualifications/`.


## Completed execution — 2026-09-15 UTC

All twelve phases have actual end records. The cell spans 2026-09-14 11:15:05
through 2026-09-15 02:43:55 UTC (55,730 elapsed seconds). Eleven phases exited
zero; the continuous Muse builder's interrupted completion tail remains exit
130. The original shell's log has no manufactured completion marker. Its
qualified external continuation helper records its own actual start/end for
each Muse score/grade/M7 phase without changing the frozen runner on disk.

Received holistic scores: Astra 82, Grok 63, Muse 82. Independent grades over
119 IDs: 99/2/18, 71/30/18, 98/3/18 (pass/fail/not-run). All three grades
completed without continuation. The unchanged summarizer ran after all three
validated outputs and before any M7. The nine M7 not-run verdicts in each grade
are not rewritten by later builder work; this frozen sequence has no independent
post-M7 grade. Native-proof classifications and O3/O4/O5 methods differ across
the compared reports, and the scorer/grade audit qualifications remain separate
from received numbers. These are uncalibrated N=1 family/pin observations.

Fresh M7 sessions: Astra 2,870.258 s, Grok 1,667.198 s, Muse 895.247 s, all
actual exit 0 and received green. They do not demonstrate equivalent forced
count migrations. Astra backfilled a message contribution feeding a maintained
sum; Grok added a maintain in a fresh in-memory backend; Muse left its inherited
maintain unchanged and added a capped read-time count, without count backfill.
Astra's maintained-ID adoption refusal has a separate public-pin reproduction
and P2 ticket; it is not a new SQL necessity claim. Prior failures, snapshot
versions, source changes after suites, and inaccurate/retrospective narrative
clocks remain in the record. All actual pre exports occurred after session
start and before observed app edits, preserving the frozen brief/prompt timing
mismatch. Sparse original message media/reactions and bounded exporters limit
preservation claims; actual post inputs and comparator omissions are retained.

The original docs-only premise is qualified by the source-access audits;
additional M7 discovery requests are inventoried separately from continuous
builders. Installed declaration discovery and implementation access have
different scopes, and unavailable native-tool arguments remain unknown. No
complete negative claim is inferred from end-state source hashes. Inherited
choreography helper adaptations and Grok's development re-signing remain.
The shared host, runtime-managed servers, Node-version retries and M7 passive
observer add unisolated work. The external observer hashes selected source
and retains safe stable JSON every two seconds; it makes no app requests or
packet writes, can miss intermediate versions, and is not a semantic grader.

All 177 frozen instrument files, prompt templates and the 0.2.10/0.2.3 pin file
match their manifests in the completed-file observation. Rendered prompts have
separate final hashes. Selected late PID/listener observations are not complete
end-time process inventories. Raw model streams, stores and credential-bearing
script bodies remain outside the selected repository archive.

The completed record, full deviation inventory, received artifacts, bounded
audits and file-custody checks live at
`benchmarks/runs/2026-09-14-snapback4-clique-0.2.10/` in the Snapback repository.
The dated LLP 3000.007 §10.3 finding gives a qualified recommendation on remaining
reporting-authoring cost; it does not claim a full docs-only loop-bar gate pass,
change a Moves line, commission SQL implementation, or reopen the four §14
rulings the author accepted on September 14.
