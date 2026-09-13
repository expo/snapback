# Copied Clique refused edit leaves edit mode while retaining its draft

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 4
**Confidence:** 4
**Systems:** Snapback2 authoring recipes, Clique message composer
**Date:** 2026-09-09
**Related:** LLP 1018.007.004

## Evidence

The final independent Grok source review at `c5fa99997` notes that the copied
app's shared submit helper clears `editId` immediately after `editMut.run`,
before checking for a rejected result. The corrected controlled draft remains
intact, but an owner-refused edit leaves edit mode. This ordering predates the
receipt/draft correction; no browser reproduction of this edit-only path is
claimed. The retained patch chain and applied-source hashes are in
`snapback2/packages/compiler/fixtures/quarry-clique/corrections/README.md`.

## Follow-up

Reproduce in a fresh copied app, keeping the benchmark lane read-only. Retain
the edited target and draft after terminal refusal, and clear edit mode only
when the existing edit intent is accepted. Cover queued/committed/refused
results and a user changing edit target while settlement is pending. Do not
turn this into a new composer, generic retry loop, or benchmark rescore.

## Disposition — 2026-09-11

**Priority:** P2. **State:** keep open; still source-only. Frozen benchmark/run
bytes were not modified or rescored, and no current copied-app browser fixture
exercised a refused edit. The HTTP-400 control establishes public terminal
state `rejected` while its durable row is retained/named, which the composer
must distinguish from accepted queued/committed results. Closure still needs
the exact fresh-copy UI matrix, including changed-edit-target race; source
inspection alone is not reproduction.

## Related browser evidence — 2026-09-12

Keep this ticket open. The new cold Astra/medium Clique app on published
`snapback2@0.0.24` is **not** the older copied artifact at `c5fa99997`, so
the following does not retroactively turn that exact fixture's source-only
finding into a browser reproduction or close its requested matrix.

A fresh Claude Opus5 grader independently reproduced a related editing
lifecycle defect in the new app: Edit tapped about300ms after sending uses
the optimistic `draft-<key>` ID in `messages.edit`. The server refuses it
with `NOT_FOUND`, the edit is lost, and in one of six fast trials its text
became a second message. Fast trials failed6/6; a paired2s pause passed4/4.
A later successful send also left the earlier error banner visible.

Evidence: [grader report d-01/d-04](../../benchmarks/runs/2026-09-11-clique-astra-snapback2-0024-linux/grading/grader-report.json),
[sanitized trace](../../benchmarks/runs/2026-09-11-clique-astra-snapback2-0024-linux/grading/trace.md#d-01),
and the exact source/screenshot archives in that run's README. The grade is
uncalibrated and the run has disclosed custody limitations; the concrete
wire/server/UI observations, not a claim of comparative performance, support
this follow-up. This is an app-level observation, not proof of a runtime
editing defect.

Extend the fresh-copy acceptance matrix to immediate editing of an
unreconciled message: never issue an edit against a display-only draft ID;
retain the edit target and attempted text on terminal refusal; and clear a
stale error only when its corresponding operation has been resolved or
explicitly dismissed. Do not patch or rescore the frozen benchmark artifact.
The separate shipped React-starter refusal repair remains closed; do not
redo it on the strength of this different app's failure.
