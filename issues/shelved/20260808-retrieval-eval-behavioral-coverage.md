# guide: retrieval eval lacks a current behavioral coverage record

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Guide, retrieval evaluation, agent authoring
**Date:** 2026-08-08
**Related:** LLP 0061, LLP 0184, LLP 0186, LLP 0187


## Triage (2026-08-26 leftover sweep)

Still open. Extra transcripts exist (`guide/eval-runs/2026-08-10`, `2026-08-21`) but there is still no case/digest/model registry or cadence. Static checker + disclaimer remain in `guide/retrieval-eval.md`.

## Summary

The retrieval corpus now defines 21 strong, failure-oriented seed intents. The
deterministic checker passes, but it proves only that an expected page exists
and at least one route term occurs in the capability index or page. The guide
correctly disclaims that it does not prove a cold agent finds the page within
the tool budget or avoids the named anti-pattern.

`guide/eval-runs/` contains eight retained transcript files across four dates,
while the numbered corpus has grown to 21 cases. There is no machine-readable
registry mapping case number, guide revision/content digest, model family,
tool budget, verdict, and transcript. Consequently a reviewer cannot tell
which current cases have ever received the behavioral protocol or whether the
required rerun after discovery-wiring changes happened.

This does not mean there has been no behavioral evidence: the retained runs and
LLP 0184's external cold-agent control-plane sessions are valuable. The gap is
coverage and freshness custody for the current corpus.

## Ask

Add a small behavioral-run registry and a bounded cadence. Reuse the LLP 0186
W1 instrumentation and published-build/external fixtures where applicable.
Do not run all 21 cases on every commit; select a risk-based subset after
discovery-wiring changes and run the complete corpus periodically or at named
program exits. Make uncovered and stale cases visible.

## Acceptance

- Every retained transcript is registered against case(s), guide/content
  identity, agent/model family, tool budget, date, and verdict.
- The registry reports uncovered cases and cases whose relevant routing content
  changed after their last behavioral run.
- A documented sampler prioritizes new cases, prior failures, security
  boundaries, and changed routes without depending on exact HEAD.
- A scheduled or milestone full-corpus run has a named owner and retained
  summary.
- The static checker remains the fast gate but no longer reads as the only
  current evidence for discovery quality.


## Status (2026-08-08 docs-review execution)

Not addressed by this execution — the behavioral registry and sampler need
model/budget decisions the docs lanes could not make. Note that the same
landing materially changed the corpus the eval targets (new
declarative-plans and migrations pages, four new capability rows, new
aliases, ~40 pages restamped), which strengthens the case for a behavioral
run soon: the lexical static check still passes, but no current transcript
shows an agent retrieving the new pages.
