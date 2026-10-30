# Snapback 4 progressive writes: receipt coverage of a local answer is judged by the sync cursor, not the evaluation watermark (probable two-owner E_QUERY_RETRY flake)

Status: Closed
Date: 2026-10-30
Scope: progressive web startup (LLP 3000.002.000 §7.2); progressive becomes the web default under the author's 2026-10-30 ruling, so this is default-path exposure once Lane D lands
Source: Fable (claude -p), Lane B verification pass (llp/reviews/3000.002.000-lane-b-r4.fable.md), High, recorded after the Lane B landing (68b3e2f829)

A local candidate carries no `seq`, so `journalCovered` (local.ts) falls back to the client's `seq`, which `syncRound` assigns only after a complete round, while Rule 2 in `local-query.ts` already certified the same answer with the device's transaction watermark via `receiptCurrent`. During every sync round the two checks disagree: a one-shot `query(total)` after a journal receipt at cut 22, with the device at 23 mid-round, passes Rule 2, then fails `journalCovered(seq = 21)` and becomes `{loading, custodyWaiting}`; `settledQuery` retries four times within ~175 ms and the caller gets `E_QUERY_RETRY` with empty pending lists and status ready/acquired — the exact signature of the lane's unexplained two-owner browser flake.

Fix: record the evaluation watermark on the local result (`outcome.watermark`) and make `journalCovered` use `result.seq ?? result.evaluationWatermark ?? seq`. Confirm by holding `/sync` mid-round in the two-owner witness and issuing the dependent one-shot.

Landing posture: Lane B landed after four blind fix rounds; the author ruled "land it and make it the default and then keep
working on ironing out all bugs in it", so this ticket is bug-ironing work (Lane E), not a landing veto.

Resolution: fixed in Lane E round 1. Carry the device transaction watermark on local candidates; journal coverage uses response seq, then evaluation watermark, then the sync cursor.
Proof: web-start.test.mjs:719,779 — held-sync two-owner witness; dependent roster read, plus original total audit. Negative control: snapback4/reports/lane-e1/watermark-negative-v2.log.
