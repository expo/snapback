# Snapback 4: The partition log replays deleted row images

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-13
Review finding: S06
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [security review](../../llp/reviews/3000-security-review-20260913.md)

## Problem and reproduction

A delete (chat `unsend`, expiry sweep, or any `delete`) appends a `del` to the group log. The earlier `put` still holds the full row image, including `body`. `_log` is never redacted.

`GET /sync?from=0&stream=1` (any watermark, not only zero) merges that log for the caller's current groups and returns those puts. Snapshot (`from=0` without `stream=1`) is current state and omits deleted rows; the stream path does not.

A member who holds a live session can recover an unsent message after `unsend` by following the log from before the delete. Expelled members with `retain delivered-history` already have the device copy; this ticket is the **server** handing the body back on a later stream.

Expired rows have the same shape: sweep logs `del`, the put remains.

## Acceptance

- A stream must not return a put image for a row that is deleted, released, or expired at the moment of the request, **or** the log must redact `data` on delete and compaction must drop it.
- Catch-up from an old watermark still converges to the same replica as a snapshot (no resurrected bodies).
- Decide and document whether `retain delivered-history` is device-only or also a server-history promise.

## Implementation locations

- [crates/snapback4-core/src/partition.rs](../../snapback4/crates/snapback4-core/src/partition.rs) (`append`, `stream`, `read_log`)
- [crates/snapback4/src/serve.rs](../../snapback4/crates/snapback4/src/serve.rs) (`GET /sync`)
- [crates/snapback4-core/src/store.rs](../../snapback4/crates/snapback4-core/src/store.rs) (`_log`)

## Resolution — 2026-09-13

Catch-up resolves each historical put against the current row, read rule, and expiry. Deleted or expired rows produce deletion events; unreadable historical puts are suppressed. Updates serve only the current authorized image. Old watermarks cannot retrieve deleted, expired, or replaced content. Revocation preserves an already delivered device copy when the declared policy is delivered-history; it grants no server-history retrieval right. Regression tests cover convergence and that retention distinction. Historical bytes may remain in the private SQLite log; this is a serving guarantee, not secure erasure.

Delivery validation and independent review for the current-main port are in
the [remediation record](../../llp/reviews/3000-security-remediation-20260913.md).
