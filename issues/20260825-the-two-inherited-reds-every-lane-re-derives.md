# The two inherited reds every lane re-derives, with the evidence, so they stop

Status: open
Date: 2026-08-25
Systems: snapback-server, snapback-engine
Related: llp/0232-optimistic-landing.decision.md,
  llp/0189-verification-cadence.decision.md,
  issues/20260825-lane-completion-checklist.md

## Why this exists

Lanes in this programme are required to attribute every non-green suite as introduced or inherited,
and to do it by *running* the suite on a fresh `origin/main` rather than inferring. That rule is
correct and is staying.

But the same two reds keep coming back, and each lane pays a full build-and-run cycle to reach the
same answer. At least **three** lanes have independently attributed the server digest mismatch and at
least **three** have independently attributed the engine failures. That is six wasted verification
cycles on two known facts.

This ticket records the evidence so a lane can cite it and move on. It is not a licence to skip
attribution for *new* reds — only these two.

## Red 1 — server frozen-digest mismatch

```
frozen : sha256:8686ea0fb93c7d18
actual : sha256:2652be777fb62392
```

Also present: `SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` has no reviewed HTTP classification.

Independently reproduced on fresh `origin/main` checkouts by three lanes. One of them additionally
pinned the drift: at base `84587bc4a` the committed bundle was `db416…`; at `origin/main`
`72b766977` the assertion is still `8686…` but the bundle is now `2652…`. So the frozen record
describes an older base, not current `main`.

Typical shape: `snapback-server` **597–600 passed, 1 failed** at the asserted artifact hash.

Under LLP 0232 this is scheduled fix-forward work, not a landing veto.

## Red 2 — engine `/proc/self/fd` SQLite image capture

**Exactly 22 failures**, all at the same `/proc/self/fd/*` SQLite-open error, several in
`crates/snapback-engine/src/local/admission_fence_tests.rs`. Typical shape: **570 passed / 22 failed**
(counts shift with the crate's test population — 568 and 590 have also been reported as the pass
figure; the 22 and the failure names are the stable part).

Reproduced identically on `origin/main` `72b766977` by multiple lanes, including one that compared
failure *names* rather than only counts and found them identical.

## How to use this

- If your run matches one of these signatures, cite this ticket, state the numbers you measured, and
  proceed. Do not spend a cycle re-attributing.
- If the **count or the failure names differ**, that is not this red — attribute it properly. The
  engine figure in particular is 22 failures, not "some failures"; a 23rd is a finding.
- Neither red excuses a *new* non-green suite, and neither is a reason to regenerate a frozen record
  to make a test green. Regenerating a frozen record is a deliberate act with its own justification.

## What still needs doing

Both are open reds on `main` and neither is fixed by this ticket. Red 1 in particular has a real
follow-up: the `SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` classification is a small, well-scoped piece of
work that no lane owns because it is nobody's row.
