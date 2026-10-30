# Snapback 4 progressive writes: an opening inspection failure treats unknown journal custody as empty

Status: Closed
Date: 2026-10-30
Scope: progressive web startup (LLP 3000.002.000 §7.2), opt-in `startup: "progressive"` only; the default path is unaffected
Source: Astra, Lane B verification pass, High, recorded at landing of Lane B (commit on main; see the RFC §13 Lane B record)

A previous document committed unsent W to the online journal. On reopen, reading that journal throws while the device probe reports `none`. `decide()` records only an admission refusal and `install()` returns with the snapshot valid and no pending entries, so dependent reads publish pre-W server data and pending surfaces omit W. Refusing new mutations does not resolve existing custody.

Fix: preserve unknown journal custody on opening failures and fence potentially dependent reads until a successful inspection, or return a typed refusal when recovery is unavailable. Test as described.

Landing posture: Lane B landed opt-in after four blind two-family fix rounds; the verification pass on the
landed snapshot raised this item and the orchestrator ticketed it rather than run a fifth round (LLP 0232
optimistic landing; LLP 0189 fix-forward). Closing this ticket is a precondition of the Lane C default flip.

Resolution: fixed in Lane E round 1. Keep failed opening inspection uncertain and return its typed E_ADMISSION for potentially dependent reads; preserve the durable journal for repair/reopen.
Proof: progressive-writes.test.mjs:601 — prior unsent W, failing journal read, probe none; query/watch refused, table-free read usable, original bytes intact. Negative control: snapback4/reports/lane-e1/negative-opening.log.
