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
