# DECISION: Accepted-vs-Review disposition for LLP 0075

**Status:** Open (author decision)
**Severity:** P2
**Systems:** Competitive evaluation
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0075 §Author adjudication + Revised header, llp/reviews/0075-convex-checkpoint-protocol.{fable,codex}.md, issues/20260723-llp0075-checkpoint-program.md
**Marker:** llp-0075, competitive-checkpoint, decision, status

LLP 0075 carries **Status: Accepted** by direct author decision, while its own
body records that whether Accepted stands over the two Codex NOT-READY verdicts
"is an open author decision." A preregistration authority whose governance
status is self-declared undecided is a status-discipline defect — downstream
consumers (LLP 0063's delegation, the JSON's `authority` field) cite an Accepted
Spec that admits it may be in Review.

**Resolved when** the author records one disposition in a dated Revised entry and
removes the open framing:

- Accepted stands on author authority over the recorded dissent (Fable READY
  across rounds 2-4; Codex NOT READY on incomplete-preregistration grounds that
  the fail-closed `unpinned-blocks-timed-runs` gates already prevent from
  affecting a run), **or**
- the Spec reverts to Review pending disposition of the round-2/3 findings.
