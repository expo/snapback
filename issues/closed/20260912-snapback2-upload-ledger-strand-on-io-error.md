# snapback2 upload ledger strands on staging-discard I/O error

**Status:** Resolved
**Priority:** P2
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/snapback2/src/asset_http.rs:151` (`UploadLedgerGuard::drop`)

## What was reported

`UploadLedgerGuard::drop` only sends `AssetUploadFailed` if
`finish_bytes().is_ok()`. If the staging-discard I/O itself errors, no
`Failed` event is emitted — the ledger stays `Receiving` with the byte
charge held. Stuck ledger rows / leaked quota over time.

## Suggested fix

- Always emit `Failed` on `!committed`, regardless of the discard result
  (log the discard error, don't let it suppress the ledger event).
- Add a regression test with a failing discard path asserting the ledger
  reaches `Failed`.

## Acceptance

- Failed/discarded uploads always settle the ledger; no stranded
  `Receiving` rows in the error-injection test.

## Resolution — 2026-09-12

UploadLedgerGuard now reports AssetUploadFailed regardless of finish_bytes failure and logs failed physical cleanup. The writer marks the ledger Failed but retains registered custody if cancellation/unlink fails, so physical bytes remain charged until disposal/sweep succeeds. The existing Unix failure-injection regression now executes the actual guard through the owner request channel: permission-denied unlink produces Failed, preserves the 100-byte charge and file, allows sibling GC/queued reads, and subsequently releases the charge after permissions recover. All eight writer asset tests pass; seven HTTP unit tests and the raw HTTP asset roundtrip also pass.
