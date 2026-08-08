# guide: freshness warnings are saturated and no longer provide triage signal

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Guide, documentation provenance, drift gates
**Date:** 2026-08-08
**Related:** LLP 0061, LLP 0187, LLP 0189

## Summary

`node scripts/check-guide.mjs` currently passes with 62 freshness warnings —
effectively every authored guide page reports that one or more authorities
changed after its review anchor. A warning-only policy is appropriate for a
fast-moving `main`, but a warning on the whole corpus no longer identifies
which pages deserve attention. Materially stale current-truth prose in the
authoring loop passes alongside the warnings.

This is not a request to make every authority change block landings or to
require a quiet exact-HEAD review loop. That would conflict with LLP 0189's
content-bound, fast-main verification model. The problem is that the existing
signal has no bounded debt model, prioritization, or accountable disposition.

## Ask

Run a risk-ranked review of the currently warned pages, then redesign the
freshness report so it remains actionable under continuous authority churn.
Useful ingredients may include an explicit reviewed-authority/content digest,
age and changed-authority counts, a committed triage baseline, high-risk page
classes, and a “new untriaged debt” delta that does not require zero warnings.

The mechanism should distinguish:

- a page whose owning LLP changed editorially;
- a page whose implementation authority changed at its documented seam; and
- a page with current-version, auth, security, or destructive-operations facts
  that require prompt review.

## Acceptance

- Every current warning has a reviewed/dispositioned baseline without
  mechanically claiming freshness.
- The checker produces a short prioritized summary rather than 62 equivalent
  warnings, with detail available for audit.
- New or materially changed untriaged drift is visible and can be selected by
  the existing frozen-record drift machinery without requiring exact HEAD.
- High-risk current-truth pages have a stricter or more explicit review policy.
- The design preserves LLP 0189's affected-scope landing cadence.

