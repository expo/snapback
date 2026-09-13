# Received partial review — ticket repairs

Reviewer: Codex gpt-5.6-sol, xhigh, client lane; 2026-09-13.
Inspected: `3d2007794b3ac050da3f23dc2d9cb4473a53c385` against `42437496ddcd09071e22b080ae362ff2649af49e`.
Status: **Partial**. A provider safety filter stopped the worker before its planned reproduction and broader meter audit. The reviewer then returned only already-established static findings. This record is a lead transcription of the received report, not a clean-review claim.

One major, high-confidence finding: a legacy join without `expiresAt` could borrow the current membership's deadline after a later rejoin. An original grant expiring at 10, a group event at 15, a delayed scope and a rejoin expiring at 100 caused the historical span to admit the event at 15. Historical legacy transitions must fail closed when their own expiry cannot be recovered; a current deadline is defensible only for the no-transition current interval.

No device-meter defect was established in the inspected portion. Device query and prediction use the shared Rust interpreter with default ceilings and shared heap/output/index accounting. The reviewer also traced full-ledger interval reconstruction, half-open join/scope spans and the single SQL relation used for group polling. It did not complete the broader meter/coverage audit and ran no tests.

Lead disposition: `b478905e8` makes the historical fallback independent of current membership. The added regression failed against the old fallback (exit 101, exact value assertion) and passed with the fix. Raw before-fix output is retained under `.llp/ship-runs/sb4-36-20260913/reviews/legacy-before.log` in the lead checkout.
