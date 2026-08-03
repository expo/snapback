# "Cold process" names two different proof classes across the corpus

**Status:** Resolved (2026-08-03)
**Impact:** 3
**Urgency:** 2
**Ease:** 3
**Confidence:** 5
**Systems:** Documentation, Acceptance testing, JS client, Contract arm
**Date:** 2026-08-01
**Governing:** LLP 0012, LLP 0043, LLP 0053, LLP 0129

## Problem

Round 6 of the LLP 0129 super-refine found that the repository uses
"cold process" / "cold boot" for two materially different proof classes, which
collides with LLP 0012's claim-honesty rule and LLP 0129 constraint 2.

LLP 0129 v0.6/v0.7 corrected its own usage: the JS-arm Phase 0 acceptance is a
**fresh client instance in the same Node process** (`closeClient(clientA)` then
`openClient()`, with only the server stopped), not a client-process restart,
and the Plan now claims no cold-boot beat at any reach.

Two residues remain outside that Plan's ownership:

1. **Retained artifacts still carry the old vocabulary.** The acceptance
   suite's check *labels* at
   `demos/public-dashboard/tests/acceptance/offline-local-first.mjs` still read
   "cold relaunch," and those strings flow into
   `demos/public-dashboard/offline-acceptance-report.json`. A receipt-only
   reader sees the withdrawn word.
2. **LLP 0043 and LLP 0053 claim a "cold process" Contract-arm proof.** The
   cited card-game acceptance
   (`demos/card-game/tests/acceptance/authority-scope.mjs`) constructs new
   wrappers in the same process over explicitly shared memory-store state — the
   same shape LLP 0129 just stopped calling a cold boot.

## Resolution witness

- Rename the same-process check labels in the JS-arm suite and regenerate the
  retained report so no artifact carries the withdrawn word.
- For LLP 0043/0053: either amend the wording to "fresh wrappers over retained
  state in one process," or land a genuinely process-isolated Contract-arm
  witness before retaining the "cold-process" claim. This is an amendment to
  those documents and belongs to their owners — LLP 0129 constraint 7 forbids
  the Plan from making it.

## Note

A hard-terminated client subprocess against the durable file store would prove
the process-restart element on one carrier cheaply, without waiting for the
browser harness in
`issues/20260801-js-arm-integrated-authenticated-restart-witness.md`.

---

**2026-08-01 (fix-wave docs sweep) — residue 1 done, residue 2 routed.**
Residue 1 is cleared: the same-process check labels in
`demos/public-dashboard/tests/acceptance/offline-local-first.mjs` now read
"fresh client instance (same process) …" instead of "cold relaunch", and the
retained `offline-acceptance-report.json` was updated in the same change, so
no artifact carries the withdrawn word.

Residue 2 is deliberately **not** actioned here: the "cold process"
Contract-arm claim in LLP 0043 and LLP 0053 is an amendment to those
documents, and per LLP 0129 constraint 7 it belongs to their owners — either
reword to "fresh wrappers over retained state in one process" or land a
genuinely process-isolated witness. This ticket stays open for that
adjudication.

---

## Resolution (2026-08-03) — residue 2 amended in the doc owners

Took the cheap doc-owner fix: dated terminology notes landed in both
documents, distinguishing the two proof classes without changing any
normative claim.

- `llp/0043-offline-replay-retention.rfc.md` — end-of-file dated section
  "Terminology note (2026-08-03)" (the doc's dated-amendment style) plus
  a Revised-header entry. It pins "cold process" in that document to the
  fresh-wrappers-over-retained-state-in-one-process class and names the
  witnesses: `demos/card-game/tests/acceptance/authority-scope.mjs`
  (Contract arm, new wrappers over shared memory-store state) and
  `demos/public-dashboard/tests/acceptance/offline-local-first.mjs`
  (JS arm, fresh client instance same process).
- `llp/0053-authorization-invalidation.rfc.md` — mirrored as a
  2026-08-03 §Changelog entry (that doc's amendment collection point)
  plus a Revised-header entry, pinning its "cold-process retained boot"
  citation to the same class.

Both notes state plainly that no current suite proves a genuinely
process-isolated restart; that witness remains owned by
`issues/20260801-js-arm-integrated-authenticated-restart-witness.md`.
Residue 1 (artifact labels/report) was already cleared 2026-08-01, per
the entry above. Nothing else in this ticket remains open.
