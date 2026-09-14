# Clique on Snapback 4 — relaxed-Quarry rerun, full brief, three builder models

**Status: Astra calibration lane on `snapback4@0.2.12` / `snapback4-expo@0.2.4`, the pin that carries LLP 3000.007 §18: the catch-up landing for the 0.2.9 calibration's findings (search across the viewer's groups as a merge of matching lanes, retained history under a horizon through the client, literal defaults additive with `check` reading the dev store, `processDevice({ dir })` with a compiled README, four more `check --fix` rewrites and Trending on the feeds card), landed as main `a5ef8da61` after three blind-review fix rounds and published 2026-09-14 16:54–16:57 UTC. It measures whether the three categories the 0.2.9 lane lost (setup_and_docs 78, data_modeling 88, queries_and_live 74) moved. The packet was prepared for `0.2.11`; another session published that number first (bounded HTTP reader reuse), so this run pins 0.2.12 and keeps the directory name. It runs the Astra builder only, on ports 49360–49379 (scripts/render.py, verify.py and run_phase.py edited for that range only), because the 0.2.10 three-model cell (`/Users/ccheever/clique-sb4-20260913-relaxed-3models/`, ports 49340–49359) still runs on this machine. Same frozen instrument, scripts and templates as the 0.2.9 calibration packet. N=1, same-family and cross-run: a gap of a few points is inside the noise.**
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
