# Snapback 4 progressive writes: a failed recovery save can clear the surviving-capture fence

Status: Closed
Date: 2026-10-30
Scope: progressive web startup (LLP 3000.002.000 §7.2), opt-in `startup: "progressive"` only; the default path is unaffected
Source: Astra, Lane B verification pass (llp/reviews/3000.002.000-lane-b-r4.astra.md), High, recorded at landing of Lane B (commit on main; see the RFC §13 Lane B record)

Reopen with a surviving pre-commit browser capture W, an empty committed journal and device custody `none`. If recovery's journal save fails, W stays in localStorage; a query-triggered inspection then reads the empty journal successfully and sets the custody snapshot valid, so a dependent read can publish the pre-W answer before recovery retries. The opening check (`progressive-writes.ts`, `install`) protects only the first refresh.

Fix: keep opening-capture uncertainty latched until recovery confirms adoption or cancellation; an empty journal inspection alone cannot discharge it. Test: fail the recovery save once, trigger an inspection by a dependent query, assert it does not publish pre-W data.

Landing posture: Lane B landed opt-in after four blind two-family fix rounds; the verification pass on the
landed snapshot raised this item and the orchestrator ticketed it rather than run a fifth round (LLP 0232
optimistic landing; LLP 0189 fix-forward). Closing this ticket is a precondition of the Lane C default flip.

Also (Fable, Low): the same fence can be cleared by a peer tab's journal broadcast between `install` returning and `custody.start()`: a cross-tab `onPendingWrites` triggers `refresh()`, whose inspection sees no adopted intent yet and sets the snapshot valid. Fix together: keep the snapshot invalid while `OnlineCapture.unsettled(...)` holds until the custody's recovery promise has settled once.

Resolution: fixed in Lane E round 1. Every successful inspection checks surviving captures; an empty committed journal cannot clear their recovery obligation.
Proof: progressive-writes.test.mjs:656 — failed recovery save plus query inspection; peer broadcast between install and start. Negative control: snapback4/reports/lane-e1/negative-capture-v2.log.
