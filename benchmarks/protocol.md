# Benchmark run protocol

Governing plan: LLP 0186 W1
(`llp/0186-agent-authoring-efficiency-program.plan.md`). This protocol
operationalizes the bakeoff practice of diaries 0058/0059 into rules a
repeatable instrument can hold every lane to. Sections marked **DRAFT**
or **OPEN** are not ratified; the first instrumented run ratifies the
attribution rule, and the OPEN items belong to LLP 0186's open
questions, not to this file.

## Run rules

1. **Cold context.** Each lane starts a fresh agent session with no
   memory of other lanes or prior runs of the same brief. Lanes of one
   comparison set must not inspect, reuse, or derive from each other's
   implementations (the independence rule both diaries operated under —
   0058: "I did not inspect, modify, or derive this build from that
   arm").
2. **No human steering.** After the brief is delivered, no human
   messages until the lane finishes or aborts. Clarifications are not
   answered; the brief must stand alone.
3. **Same brief, verbatim.** Every lane of a comparison set receives the
   identical brief file from `briefs/`, byte-for-byte. Brief edits
   create a new brief version and restart calibration for that brief.
4. **Same harness, same model, same effort** across all lanes of a
   comparison set, recorded in the run record (`harness.*`).
5. **One record per lane run**, validating against
   `schema/run-record.schema.json`, plus a free-form run diary. The
   diary is the qualitative instrument; the record is the quantitative
   one; neither substitutes for the other.

## Timing

The clock starts when the brief is delivered to the cold session and
stops at the last passing acceptance evidence. Orientation (docs/guide
reading) is **inside** the clock and recorded as a phase split —
diary 0058 excluded shared Snapback-heavy orientation and flagged that
as a bias in Snapback's favor; the instrument does not repeat that.
Phase splits (orientation / authoring / verification / diagnosis) are
recovered from the transcript where possible and recorded as null where
not.

## Token metering

Input and output tokens are recorded per lane with the accounting
channel named in `tokens.source`. Where no trustworthy per-lane meter
exists, record nulls with an explanation rather than reconstructing
counts (diary 0058: reconstructing from visible prose "would be
fictional").

**OPEN (LLP 0186 OQ1):** which harness exposes trustworthy per-lane
usage (Claude Code session accounting, Codex surface, or a wrapping
proxy), and whether cross-model token comparison is ever fair or the
ratchet pins one model per benchmark epoch. Until resolved, token
figures are recorded but make no cross-model claims.

## Repetitions and variance

Agent runs are nondeterministic. **No variance claim — and no ratchet
breach report treating a delta as real — is made from fewer than 8
repetitions per lane** of the configuration in question. This floor
carries the operational lesson LLP 0186 OQ2 cites ("measure N≥8 before
blaming a commit", the Minisforum telemetry lane).

**OPEN (LLP 0186 OQ2):** the actual calibration answer — how many
repetitions make the ratchet stable enough to gate a release without
being too expensive to run, the tolerance, and the cadence — is what the
calibration phase exists to determine. Single runs during calibration
are still recorded (a single run is evidence of existence — "this
defect occurred" — never of magnitude).

## Environment pinning

- **Snapback lane: published packages only.** Since the 0.1.9 promotion
  (2026-08-06, `issues/closed/20260803-first-npm-latest-promotion.md`),
  the Snapback lane installs `@expo/snapback-*` from npm `latest` like
  an external agent would — not the source checkout the 0058/0059 runs
  used. Exact versions land in `harness.environment`. A run against a
  source checkout is a diagnostic run, labeled as such, and never a
  baseline.
- Competitor lanes pin their package versions the same way (diary 0058
  ran Convex 1.43.0; the record keeps that precision).
- OS, Node/Bun, and Expo SDK versions are recorded. Lanes of one
  comparison set run on the same machine class.
- Backend accounts/deployments are fresh per run where the platform
  allows; reused state is recorded.

## Correction-loop attribution rule (DRAFT)

To be ratified at the first instrumented run (LLP 0186, Measurable
outcome 3: the prior ~11 / ~4-heavy figures are reconstructions from
qualitative diary text, not recorded counts; the first instrumented run
defines the rule and records the binding baseline).

**A correction loop** is counted each time the agent treats a step as
complete (or a tool reports success), contrary evidence arrives, and the
agent must revise work it had already produced. Ordinary first-pass
authoring, however long, is not a loop; a compile error fixed before any
done-claim is not a loop; three attempts against the same defect are one
loop with three iterations noted in the summary.

**Attribution, decided per loop with an evidence pointer:**

- `snapback-defect` — the platform under test caused the loop: a
  product defect, a doc/behavior mismatch, a type/runtime disagreement,
  or an error message that misdescribed its cause. (Named for the
  Snapback ratchet; every lane records its own platform's defects under
  this value.) Baseline examples from the diaries: the managed dev-loop
  multi-JSON abort, the optional-arg type/runtime disagreement, the
  anonymous-caller upload 403.
- `agent-error` — the agent's own authoring mistake against accurate
  documentation and accurate diagnostics. Baseline examples: diary
  0058's module-scope `PlatformColor` web export failure ("That was my
  mistake") and the `StartedLiveQueryHandle` misuse ("The type
  declarations were accurate").
- `environment` — harness, OS, network, or third-party tooling
  unrelated to the platform under test. Baseline example: 0058's
  browser-control runtime failing its own setup ("It is not counted as
  a Snapback defect").
- `ambiguous` — attribution genuinely contested after examining the
  evidence. Counts toward no lane's ratchet figure, but is reported;
  a run with many `ambiguous` loops is a signal the rule needs
  refinement, and the calibration phase should revise the draft.

Tie-break: if accurate documentation existed but was undiscoverable at
the point of need (the shipped-but-undiscovered class of LLP 0186's
evidence section), the loop is `snapback-defect` — discoverability is
part of the product under test — with the guide/retrieval-eval pointer
as evidence.

## Publication

Per the README's publication gate (LLP 0186 W1): no public comparative
numbers until the Snapback lane, from published packages, is not losing
on self-inflicted plumbing. **OPEN (LLP 0186 OQ5):** the disclosure
standard for published results. Draft position: publish the harness and
model identifiers, brief files, this protocol, fairness rules, raw run
records, and raw diaries alongside any headline number — but what makes
that credible rather than vendor-benchmark noise is OQ5's to resolve.
