# Snapback 4 progressive writes: repeated inspection failures strand reads already waiting

Status: Closed
Date: 2026-10-30
Scope: progressive web startup (LLP 3000.002.000 §7.2), opt-in `startup: "progressive"` only; the default path is unaffected
Source: Astra, Lane B verification pass, Medium, recorded at landing of Lane B (commit on main; see the RFC §13 Lane B record)

If an inspection and its query-triggered retry both fail and storage is then restored without another notification, nothing retries once `dirty` is false. A one-shot already inside `QueryCustody.wait()` never calls `pending()` again and eventually returns `E_QUERY_RETRY`; observations can remain `loading`.

Fix: schedule a coalesced, backed-off retry while an active inspection remains invalid; test recovery of reads already waiting, not only a fresh query after restoration.

Landing posture: Lane B landed opt-in after four blind two-family fix rounds; the verification pass on the
landed snapshot raised this item and the orchestrator ticketed it rather than run a fifth round (LLP 0232
optimistic landing; LLP 0189 fix-forward). Closing this ticket is a precondition of the Lane C default flip.

Also (Grok, High): after a single cross-tab-style `onPendingWrites` notify, if `inspect()` throws once and nothing else calls `refresh()`, `snapshotValid` stays false forever: a `rooms` watch keeps its pre-write answer, a `messages` one-shot already in `queryCustody.wait` returns `E_QUERY_RETRY`, and a watch that published loading stays there; only a later manual `query()` recovers. Fix: in `finally`, if `active && !snapshotValid`, schedule a retry even when `!dirty`; in the timer callback, if `refreshing` is set, reschedule. Regression: fail one cross-tab notify with no second `refresh()`, hold an in-flight query and a disjoint watch, expect both to publish after storage works without a later manual query.

Resolution: fixed in Lane E round 1. Schedule a coalesced 100 ms retry while active custody stays invalid; an overlapping inspection reschedules the timer; close cancels it.
Proof: progressive-writes.test.mjs:677 — one notification, one/two failures, already-waiting one-shot, retaining disjoint watch and loading watch; no later manual query. Negative control: snapback4/reports/lane-e1/negative-retry-v5.log.
