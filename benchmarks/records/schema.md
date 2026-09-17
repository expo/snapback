# Comparison-set run records

## Purpose and naming

A comparison-set run record is the durable artifact an orchestrating agent
writes after one run. Keep one Markdown record per comparison set at
`benchmarks/records/YYYY-MM-DD-<brief>-<release>.md`, where `release` is the
published Snapback closure version measured, such as `0113` for 0.1.13.

Optional per-lane machine records may accompany the Markdown record as JSON
files validating against `../schema/run-record.schema.json`. Name them
`YYYYMMDD-<brief>-<lane>-rNN.json`, where `rNN` is the repetition index.

## Record sections

### Basis

Record the date; brief file; confirmation that every lane received the brief
verbatim; Snapback closure version and dist-tag; recorded competitor package
versions; harness name and model, held constant across lanes; and machine.
Confirm cold context, serial execution, the published-surfaces-only fence for
Snapback lanes, and the token-accounting channel required by LLP 0186 OQ1
(OPEN). Include the port exclusions used.

### Lane table

Give one row per lane with wall time; total tokens and, when the accounting
channel splits them, input/output tokens; tool uses; and correction loops with
the framework/self/tooling split. Record the orientation, authoring,
verification, and diagnosis splits for both wall time and tokens. Record an
unavailable metric as unmeasured with a reason; never reconstruct it. P0 runs
must supply every phase split under `../protocol.md`; ordinary records may use
unavailable phase values. Diary 0058 is the no-reconstruction precedent.

For social-messenger lanes, retain the lane setup's `orientation` block: the
explicit lane kind, verified instrument manifest/pin/version identity, selected
skills, and the byte/hash/dedup record for every generated or skill-body
steering carrier. Its retained `preflightWarnings` array is the deterministic
result of the event preflight, not setup-time intent. The sibling harness-native
`firstProductEdit` snapshot uses
`{at, orientationBytes, orientationTokens, selectedSkills}` and is the
orientation/authoring boundary: cumulative orientation tokens are never added
again to M1 authoring. `orientationTokens` always emits all five counters
(`input`, `output`, `cacheRead`, `cacheWrite`, `reasoning`), with explicit nulls
when unavailable.

Instrument `social-messenger@0.3.4-m8` also retains
`suiteStatusLinkage` plus the optional additive per-milestone D0.6 blocks:
`semanticActions`, `failureToRecoveryEpisodes`, `restartReseed`,
`browserAssertionWait`, `hostLoad`, and `apiInterruptions`. Every block points
to a sha256-bound sidecar and carries the aggregate needed by the efficiency
scorecard. The record validator checks those aggregates against the closed
taxonomy and contamination flags; the extension remains version `2` for old
record compatibility. It stamps typing observation boundary v2; retained
`0.3.3-m8` records remain boundary v1 and are never aggregated with it.

For every lane, record `firstGreenProofAt` as the timestamp of its first
passing acceptance proof. Use null when the lane never produced green proof;
do not substitute the finish time.

### Correction-loop attribution

Give one line per loop with its shorthand class. Map framework to
`snapback-defect` (every lane records defects in its own platform under this
value), self to `agent-error`, and tooling/environment to `environment`;
contested loops are `ambiguous`. The definitions and evidence requirements in
`../protocol.md` govern. Every `snapback-defect` line also carries the
`defect` or `knowledge-gap` sub-attribution; other classes do not.

### Proof results

For each lane, state which brief proofs passed, any fallbacks or DNFs, and the
offline-guarantee label required by fairness rule 2: platform contract or
app-built.

### Rubric scoring

Rubric scoring is required for every lane record going forward. Messaging and
messaging-equal-proof-bar records use the frozen diary 0058 `rubric`: all eight
dimensions and `weightedOverall`, with the existing weights unchanged. Every
other brief uses both scoring layers frozen at brief preregistration:

- `outcomeRubric`: the brief-specific outcome dimension names and 0–100 scores,
  plus `weightedOverall`;
- `invariantPlatformScore`: 0–100 scores for `dx`, `diagnostics`, and
  `operations`.

`team-workspace` is the Workroom exception because its brief declares both
layers, including DX and diagnostics. It records one `workroomScore`
instead of `outcomeRubric` and `invariantPlatformScore`:

- `source` is `benchmarks/briefs/team-workspace.md#scoring`;
- `builder` retains evidence pointers, B1–B10 as explicit 0–100/null values,
  and the separate 0–100/null `holisticBeforeTotal` captured before computed
  totals are shown;
- `outcome` records the exact grader identity, status, evidence pointers,
  O1–O5 as explicit 0–100/null values, and the 100-point `combinedTotal` using
  this record's builder dimensions.

The built app's model and effort remain `harness.model` and `harness.effort` on
that same lane record; `outcome.grader` identifies the independent grader.

The brief's declared weights are used as point contributions: O1–O5 are
13/8/10/8/6 and B1–B10 are 6/6/8/5/5/4/5/6/6/4. A grader's combined total is
null if any O or B dimension is null. There are no intermediate layer totals
and no cross-record average. An unavailable outcome is valid only with all O
dimensions and its combined total null, plus an evidence pointer explaining
the unavailability. Astra, Grok, and Muse builds therefore use three separate
lane records, each with its own builder experience and independently graded
outcome. Their model/effort matrix is preregistered outside this schema. This
records the current Draft instrument without treating calibration as settled.

Publish every dimension. Across briefs, aggregate with preregistered
noninferiority/dominance counts, never by averaging dimensions a brief did not
exercise.

### Ratios

Give each lane's wall and token ratios against the competitor control. Name
the primary tracked pair; for the messaging series established by diary 0068,
that is the skill-equipped Snapback lane against Convex.

### Fairness notes

This section is mandatory. Numbers from a record may not be quoted or
published without its fairness notes, under the `../README.md` publication
gate. The disclosure standard remains OPEN in LLP 0186 OQ5.

### Series table

Append the run to the standing series using the 0058/0065/0066/0068 table
shape established by diary 0068. Preserve basis changes and unmeasured values
rather than normalizing them away.

## Repetition floors

A single record is evidence of existence, never magnitude. A ratchet claim
needs at least three runs per configuration. Treating a delta as a real
regression, including blaming a commit or release, needs at least eight. The
calibrated repetition count, tolerance, and cadence remain OPEN under LLP 0186
OQ2; `../protocol.md` is the governing text.

## Measurement-only calibration

The ratchet reading these records is measurement-only until LLP 0186 OQ1
(token-metering mechanics) and OQ2 (ratchet tolerance and cadence) resolve. A
regression found here is a report to file and investigate, never a release
block.
