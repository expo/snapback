# Clique grading: d-01 contradicts the brief's receipt departure clause

- **Opened:** 2026-09-26, from the [LLP 3000.008.002.000](../llp/3000.008.002.000-common-client-patterns.rfc.md) direction check (all three reviewers, F1).
- **Area:** the social-messenger grader instructions/rubric; calibration-21 record
  (`/Users/ccheever/clique-sb4-20260925-astra-cal21/lanes/astra-snapback4/grading/grader-report.json` d-01).
- **Severity:** Medium for measurement: a correct implementation was docked.

## What happened

The brief (`benchmarks/briefs/social-messenger.md` ~500–507) defines a group's
aggregate receipt over the recipient set = membership at send time, and says
"members who leave or are removed before reaching a state drop out of the
aggregate requirement". The grader quoted only the first clause and filed the
behaviour the second clause mandates (an unread member leaves → the aggregate
advances) as defect d-01; O2 was docked for it. The builder's `receipt()` and
its recipient proof implement the brief exactly. LLP 3000.008.002.000 revision
1 then adopted the grader's reading; revision 2 withdrew it.

## Fix

Quote the whole sentence wherever grading instructions paraphrase the
recipient set; add the departure case (and a later-joiner case) to the grader's
receipt probe expectations; annotate the calibration-21 record that d-01 is a
grading error.
