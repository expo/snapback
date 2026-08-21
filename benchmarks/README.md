<!-- @ref LLP 0186#w1--competitive-benchmark-and-ratchet-owned-here — this
     directory is W1's instrument: the fixed brief corpus, lane prompt
     templates, protocol, and per-release run records the ratchet reads. -->

# Snapback competitive benchmark

This directory is the instrument mandated by **LLP 0186 W1**
(`llp/0186-agent-authoring-efficiency-program.plan.md`): a repeatable,
same-brief, same-harness comparison of what it costs a coding agent to build a
real application on Snapback versus its competitors, formalizing the
2026-08-05 paired bakeoffs
(`diaries/0058-relay-room-expo-backend-bakeoff.diary.md`,
`diaries/0059-tandem-expo-messaging-bakeoff.diary.md`) and the instrumented
0065/0066/0068 series.

An orchestrating agent can select a brief, instantiate the proven lane prompts,
run the comparison, and produce a durable record using this directory alone.

## What it measures, per lane per run

| Metric | Definition | Provenance |
|---|---|---|
| Wall-clock | Epoch-timestamped start/finish of the lane, split into orientation / authoring / verification / diagnosis where the transcript supports it | Diary 0058 recorded 26m03s (Snapback) vs 11m15s (Convex) from local epoch timestamps — the calibrated baseline pair. That clock excluded Snapback-only orientation reading, biasing it in Snapback's favor; the instrument makes orientation an explicit split instead of an exclusion. |
| Input + output tokens | Usage accounting from the orchestration harness, with the accounting channel named in the record (`tokens.source`) and orientation / authoring / verification / diagnosis counts in `tokens.phases` | Metering is no longer hypothetical: the 0065/0066/0068 runs metered per-lane tokens through the harness. **OPEN (LLP 0186 OQ1):** which channels are trustworthy, and whether cross-model token comparison is fair or the ratchet pins one model per epoch. |
| First green proof | `firstGreenProofAt`, the per-lane timestamp of the first passing acceptance proof; null if the lane never reaches green | Turns the first-fifteen-minutes target into a recorded milestone rather than treating lane completion as a proxy. |
| Tool uses | Per-lane tool invocations from the same orchestration-harness accounting | Recorded for diaries 0065/0066; where a harness count is not retained, as in the 0068 standing record, mark it unmeasured rather than reconstructing it. |
| Correction loops | Recorded count of correction loops, each carrying an attribution (`snapback-defect`, `agent-error`, `environment`, `ambiguous`) and an evidence pointer | Diaries 0065/0066/0068 recorded counts during the runs. The earlier ~11 / ~4-heavy figures remain qualitative reconstructions and are not substituted for measured counts. |
| Hand-authored LOC | Hand-authored source/test lines, generated artifacts excluded | Diary 0058: Snapback 1,202 lines / 14 files vs Convex 868 / 13. A ceremony proxy only — see fairness rules. |
| Rubric scores | Required for every lane (see `schema/run-record.schema.json`) | Messaging-family briefs retain diary 0058's frozen eight dimensions and weights. Every other brief uses its preregistered outcome rubric plus the invariant DX / diagnostics / operations platform score. |

Rubric scoring is part of the record format, not an optional analysis pass.
For messaging and messaging-equal-proof-bar, record all frozen 0058 dimensions
and `weightedOverall`. For every other brief, freeze the outcome dimensions
with the brief and record `outcomeRubric` plus `invariantPlatformScore` for
every lane. Cross-brief conclusions use preregistered noninferiority/dominance
counts; they never average dimensions a brief did not exercise.

## Lanes

The instrument has two axes. The backend axis is Snapback, Convex, Supabase,
PocketBase, and raw Postgres+Express — the LLP 0186 W1 lane set. Convex is the
proven control; the other three competitor lanes remain unproven.

The Snapback axis crosses authoring context (bare or skill-equipped) with
carrier (web or native simulator). The four proven prompt templates in
`lanes/` are bare Snapback web, skill-equipped Snapback web, skill-equipped
Snapback native simulator, and competitor web, carried verbatim from diary
0068's run apart from parameters. The primary tracked pair in that series is
skill-equipped Snapback web versus Convex.

**OPEN (LLP 0186 OQ4):** the messaging brief advantages realtime-native
platforms; the CRUD and media briefs exist so the Supabase, PocketBase, and
Postgres lanes can be representative rather than strawmen, but which brief mix
keeps them so is not settled.

## Brief corpus

- `briefs/messaging.md` — the standing WhatsApp-shaped baseline and its proven
  lane-prompt block.
- `briefs/messaging-equal-proof-bar.md` — the same app with identical offline
  read and offline-write semantics required from every lane; not yet run.
- `briefs/crud.md` — a field-service CRUD shape, scaffolded 2026-08-06 and not
  yet run.
- `briefs/media.md` — a trip-photo-journal media shape, scaffolded 2026-08-06
  and not yet run.
- `briefs/messaging-trust-boundary.md` — the same app with real auth and
  vendor-neutral trust-boundary outcomes (negative proofs mandatory;
  LLP 0198 P3); authored 2026-08-08, not yet run.
- `briefs/messaging-day2-evolution.md` — three scripted change requests
  against a frozen, acceptance-equivalent post-messaging artifact
  (LLP 0198 P3); authored 2026-08-08, not yet run.
- `probe-pick-and-build.md` — the LLP 0198 L5 revealed-preference probe
  (choice under commitment, per-cell verdicts); authored 2026-08-08, not
  yet run.

## Fairness rules

1. **Auth parity is labeled, never assumed.** Both bakeoff arms used a visibly
   labeled test-persona seam, not production authentication (diary 0058:
   "neither app pretends that tapping 'Ada' is production authentication";
   diary 0059: "the line-count result must not be read as a security
   comparison"). Every run record states the auth posture of each lane; lanes
   with unequal auth work are compared with that labeled, not silently.
2. **Guarantees are scored, not line counts.** Raw lines are "a rough ceremony
   signal" (0058) and "a crude measure" (0059): the Snapback arms expressed
   more image policy and runtime admission; the Convex arms hand-built typing
   cleanup and an app-owned offline cache with offline sends disabled. The
   rubric scores what is guaranteed (offline/durability contracts, atomicity,
   presence semantics), so the ratchet never rewards omitting guarantees to
   look cheap.
3. **Orientation cost is measured, not excluded.** The 0058 clock excluded
   shared Snapback-heavy orientation; the instrument records it as a
   wall-clock split instead.
4. **Failures caused by the lane's own authoring mistakes are attributed as
   such**, per the attribution rule in `protocol.md`, which remains
   draft-labeled until LLP 0186 OQ2's calibration phase confirms or revises it.
5. **Context is cold.** Every lane uses a fresh agent with no memory of other
   lanes or prior runs of the brief.
6. **Isolation fences are strict.** Every lane has a private workdir, no lane
   reads another's directory, and Snapback builds use published surfaces only
   — npm packages, the served guide, and CLI help — never the source checkout.
7. **Execution is serial and controlled.** Run lanes serially on the same
   machine, harness, and model, with no human steering after prompt delivery.
8. **Usage comes from the harness.** Meter tokens and tool uses through the
   orchestration harness's usage accounting and name its channel in the record;
   which channels are trustworthy remains **OPEN (LLP 0186 OQ1)**.
9. **Repetition floors constrain claims.** One run is existence evidence;
   ratchet claims require N>=3 per configuration, regression attribution
   requires N>=8, and the calibrated answer remains **OPEN (LLP 0186 OQ2)**
   under `protocol.md`.

## Run procedure

1. Pick a brief from `briefs/` and use its `Lane-prompt block` verbatim as
   `{{BRIEF}}`.
   The `lane-setup.mjs` flow below is currently scoped only to
   `social-messenger.md` / Clique. Other brief families keep their own frozen
   setup procedure and must not use this Clique-specific generator until they
   gain a manifest and registered lane kind.
2. Preflight the environment: confirm that npm `latest` resolves to the
   published closure the run claims to measure; survey occupied ports and
   write the `{{PORT_EXCLUSIONS}}` sentence. Provision one read-only instrument
   snapshot carrying `instrument.manifest.json` and every tree it hashes. For
   skill-equipped and native lanes, extract `{{SKILL_PAYLOAD}}` from the
   published consumer scaffold using the recipe below.
3. Create one fresh workdir per lane. Before starting its agent, run
   `tools/lane-setup.mjs setup` with an explicit matching kind:
   `snapback-web-clique`, `snapback-native-simulator`, or `competitor-web`.
   Skill-equipped Snapback kinds also receive the complete extracted body
   through `--skill-body snapback-authoring=/path/to/SKILL.md`; the body is
   hashed and charged to the same 16 KiB ceiling as the generated packet. Bare
   and competitor lanes use `--no-skills`. Setup refuses a missing, mismatched,
   or escaped manifest artifact and never reads a live checkout as fallback. It writes
   `AGENTS.md`, `BENCHMARK-ORIENTATION.md`, `lane-report.json`, and the
   lane-local `instrument` symlink used by every orientation link. Do not put
   workdirs under `/private/tmp` because Metro's watcher is blind there, and
   do not set `CI=1`, which silently disables watching.
4. Instantiate the lane template matching that kind from `lanes/`. When the
   expanded prompt is too long for a harness field, write it to a lane-private
   file and deliver the proven one-line instruction documented in
   `lanes/skill.md`.
5. Run the lanes serially and cold. Collect start/end epochs,
   `firstGreenProofAt`, per-lane token and tool-use counts from the orchestration
   harness, the first-product-edit snapshot, the four wall-clock and token phase
   splits, and each lane's final report. Join the snapshot into
   `lane-report.json` without charging its orientation tokens to M1 authoring.
   At M1 preflight, run `tools/lane-setup.mjs preflight` over the harness JSONL,
   the explicit first-edit marker, and `lane-report.json`; the command
   deterministically retains any registered out-of-allowlist skill warning in
   that report. P0 runs must provide all phase values; ordinary records may
   mark a phase unavailable with a reason.
6. Attribute correction loops under `protocol.md`, then independently check
   each claimed proof result against the selected brief's acceptance bar and
   score every lane with the required messaging or non-messaging rubric.
7. Write the comparison record under `records/` following `records/schema.md`,
   append its series row, and file one repository ticket per
   framework-attributed loop. That fix-measure loop closed the walls found by
   the 0065 and 0066 runs.
8. Before making a ratchet claim, repeat the same configuration in fresh
   workdirs until N>=3. Re-instantiating the templates is the current repeat
   mechanism; making repeats one command remains open harness work under
   **LLP 0186 OQ2**.

## Skill payload and registry lag

To build `{{SKILL_PAYLOAD}}`, use a throwaway directory, install
`@expo/snapback-cli@latest`, run
`snapback new probe --template expo-chat`, and take
`probe/.claude/skills/snapback-authoring/SKILL.md`; do not use this repository's
`skills/` copy, because the scaffold-emitted consumer form is what an external
agent actually receives. Then check the version the lane install resolved in
its lockfile or with `npm ls` against the release the run claims to measure:
registry propagation can lag, and a lane must never receive credit or blame for
a closure it did not run.

## Ratchet: measurement-only until calibrated

The standing published-consumer baseline is npm 0.1.13: skill-equipped
Snapback web is **1.59x wall / 2.00x tokens** versus Convex (the primary pair),
bare Snapback web is **2.50x / 2.25x**, and skill-equipped native is
**2.27x / 2.33x**. The evidence and full 0058/0065/0066/0068 series are in
`records/2026-08-07-messaging-0113.md`.

Per LLP 0186 W1, the ratchet remains measurement-only until a calibration
phase resolves OQ1/OQ2: model/epoch pinning, repetition count, variance,
tolerance, cadence, and run cost. Until then a breach is a report, not a block.

## Publication gate

W0 exited 2026-08-06: the qualified 0.1.9 closure reached npm `latest` with a
green cold install from the public registry
(`issues/closed/20260803-first-npm-latest-promotion.md`). Baseline Snapback
lanes since then measure published packages, not the source checkout used by
the earlier diaries. Diary 0068's npm 0.1.13 standing baseline reduced
framework-attributed Snapback loops to papercuts — one to three per lane — and
established that the publication gate's product condition is met: these are
comparative numbers one could publish with their fairness notes attached.

Numbers from a record are publishable **only together with that record's
fairness notes**. What fuller disclosure a credible publication requires
remains **OPEN (LLP 0186 OQ5)**; this instrument does not decide it.

## Directory layout

- `briefs/` — four fixed briefs: messaging, its equal-proof-bar variant, CRUD,
  and media.
- `lanes/` — four proven parameterized prompt templates.
- `records/` — the record format, standing run records, and the series table.
- `schema/` — the optional per-lane JSON run-record schema.
- `instrument.manifest.json` — the frozen social-messenger artifact/version
  manifest; its file and tree digests are verified before a lane packet exists.
- `tools/` — the LLP 0197 checked record loader/publisher and publication-safe
  action-trace sanitizer, plus the lane setup/orientation/preflight generator.
  Its fixtures are synthetic and are never benchmark results; see
  `tools/README.md`.
- `protocol.md` — run rules, metering, repetition floors, attribution, and
  publication posture.
