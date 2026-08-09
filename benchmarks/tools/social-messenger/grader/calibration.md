# Grader calibration plan

**Provenance:** LLP 0201 D3.4 and P2; P1 deliverable. **Status:**
0.1.0-p1 DRAFT — the calibration artifacts themselves are P2 products
(they are built from the pilot artifact, which does not exist until
the pilot runs); this plan and the manifest format freeze with the
instrument.

Before the first scored wave, **each grader family** (both scored
families, and any family later used for an abort-fallback regrade)
grades the calibration artifacts below. A family that has not passed
calibration is ineligible to grade; an ineligible family regrades only
after recalibration.

## The three planted-defect artifacts

All three are **built from the P2 pilot artifact** — the N=1 tier-1
pilot lane's completed build (LLP 0201 P2). Stated explicitly: they do
not exist at P1; the pilot's output is the base, and the planted
variants are derived from it by minimal, manifest-recorded edits. This
keeps calibration difficulty representative of what graders will
actually see.

1. **Known-good.** The pilot artifact with any pilot-found defects
   repaired to the best adjudicated state; **zero planted defects**.
   Its planted-defect manifest is an empty list. Used for the
   precision half of the gate.
2. **Known-bad.** The pilot artifact with a set of planted MATERIAL
   defects across milestones (functional breaks, wrong data, broken
   flows) — each one recorded in the manifest with its detection
   threshold. Used for the recall half.
3. **Subtly authorization-broken.** The pilot artifact with planted
   **authorization** defects only — trust-boundary holes that UI
   absence hides (e.g. an API path that serves another user's DMs, an
   expired-window edit accepted server-side, a view-once asset still
   fetchable). Behaviorally clean in the happy path; only probing
   finds it. Missing a planted authorization defect fails calibration
   outright.

## Planted-defect manifest format

Each artifact carries a manifest conforming to
`planted-defects.template.json` (alongside this file). One entry per
planted defect: stable id, the milestone and assertion IDs it
violates, category (`functional` | `data` | `authorization` |
`performance`), the planted edit (file/behavior description), the
**expected minimum severity bucket** a calibrated grader must assign
(MATERIAL = blocker or major), and the detection threshold — what a
grader report must contain for the defect to count as detected
(matching assertion failure, matching probe failure, or a defect
entry whose summary identifies the behavior). The manifest is
withheld from the grader during calibration and published with the
calibration records.

## Pass/fail rule

Verbatim from LLP 0201 D3.4:

> Calibration is pass/fail on recall **and precision**: a family must
> detect every planted MATERIAL defect (missing a planted
> authorization defect fails outright), and any MATERIAL finding
> against the known-good artifact fails calibration unless the author
> adjudicates it a planting error; an ineligible family regrades only
> after recalibration.

Operationally:

- **Recall:** every manifest entry with expected severity MATERIAL
  must be detected per its detection threshold, on the known-bad and
  authorization-broken artifacts. Any missed authorization entry =
  fail outright, regardless of everything else.
- **Precision:** any MATERIAL (blocker/major) finding the family
  files against the known-good artifact = fail — **unless the author
  adjudicates it a planting error** (i.e. the "known-good" artifact
  actually contained a real defect; the adjudication is recorded, the
  artifact is repaired, and its manifest and the calibration record
  are amended). The author (Charlie) is the adjudicator.
- Minor/cosmetic findings against known-good do not fail calibration;
  they are recorded as noise data.

## Duplicate blind grading of a sampled pilot artifact

One pilot artifact is sampled and graded **blind by both scored
families** (neither sees the other's report or knows a duplicate
grade exists). Sample custody follows LLP 0201: the sample choice is
committed before grading starts. This produces the disagreement data
the noise trigger reads.

## Grader-noise trigger

On the duplicate sample, the following count as disagreement
(LLP 0201 D3.4):

- **Severity-bucket disagreement beyond one bucket** on shared
  findings (e.g. one family says blocker, the other says minor), and
- **any unmatched MATERIAL finding** — a blocker/major one family
  filed that the other's report does not match at all.

Tripping the trigger escalates to a **grader panel for that wave**:
the wave's grades are reviewed by a panel rather than accepted from a
single grader, and the calibration record notes the trip. The trigger
is operational from the first duplicate grading onward.

## Records

Every calibration grading produces a normal grader report
(`grader-report.schema.json`) plus a calibration verdict record
(family, artifact, recall table entry-by-entry, precision findings,
adjudications, pass/fail). Calibration records are published as
clearly-labeled calibration evidence with the thresholds they gate
(LLP 0201 P2's publication posture) and are never claim-eligible.
