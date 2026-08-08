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
the framework/self/tooling split. Record an unavailable metric as unmeasured
with a reason; never reconstruct it. `../protocol.md` governs that rule, and
diary 0058 is its precedent.

### Correction-loop attribution

Give one line per loop with its shorthand class. Map framework to
`snapback-defect` (every lane records defects in its own platform under this
value), self to `agent-error`, and tooling/environment to `environment`;
contested loops are `ambiguous`. The definitions and evidence requirements in
`../protocol.md` govern.

### Proof results

For each lane, state which brief proofs passed, any fallbacks or DNFs, and the
offline-guarantee label required by fairness rule 2: platform contract or
app-built.

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
