# Snapback 4 progressive writes: a late journal response can overwrite newer store or generation state

Status: Closed
Date: 2026-10-30
Scope: progressive web startup (LLP 3000.002.000 §7.2), opt-in `startup: "progressive"` only; the default path is unaffected
Source: Astra, Lane B verification pass, High, recorded at landing of Lane B (commit on main; see the RFC §13 Lane B record)

Hold a journal mutation response from store A; let the attached device's sync adopt store B under the same credential revision; release A's response. The private transport's guard passes it to `onlineEvidence`, which treats A as another replacement, resets the current partition and invokes store retirement. A delayed generation-1 response can likewise reset an adopted generation-2 view. The ordinary query transport checks the captured incarnation; this transport does not.

Fix: pin store identity and incarnation at dispatch and fence obsolete authority and receipt-cut updates, while still delivering the invocation's known terminal outcome. Test as described.

Landing posture: Lane B landed opt-in after four blind two-family fix rounds; the verification pass on the
landed snapshot raised this item and the orchestrator ticketed it rather than run a fifth round (LLP 0232
optimistic landing; LLP 0189 fix-forward). Closing this ticket is a precondition of the Lane C default flip.

Resolution: fixed in Lane E round 1. Pin dispatch incarnation and store, recheck after authority I/O, suppress obsolete authority and receipt-cut updates while delivering the known terminal outcome.
Proof: progressive-writes.test.mjs:612 — held A/generation-1 receipt, sync adopts B/generation-2, receipt still sent, adopted state/local read survive. Negative control: snapback4/reports/lane-e1/negative-late.log.
