# Snapback 2 installing a row schedule collects the whole table into RAM

**Status:** Resolved
**Priority:** P2
**Date:** 2026-09-11
**Systems:** `snapback2/crates/snapback2-core/src/store_timers.rs` (schedule install), `engine/index.rs` (`fetch_table_connection`)
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1016 D5; successor `ROW_BATCH` (128) already used elsewhere

## Symptom

Installing a new row schedule walks **every** source row via `fetch_table_connection` (unbounded `SELECT data FROM rows WHERE table_name=?`) and calls `maintain` per row. Successor of a large table + new `schedule expireMessage on messages at .expiresAt` is a full-table RAM collect. The same helper is used for aggregate id clearing. Scans/pages used everywhere else are `LIMIT`-bounded.

`job_commits` has a related N+1 (`commits_since(seq-1, 1)` per seq, cap 500) and a 10_000-commit trim that makes `trace <job>` fail with `"job commit disappeared"`. Fold that into this ticket if it is still cheap; otherwise split.

## Proposed

Batch like `successor.rs` `ROW_BATCH` (128) instead of collecting the table. Page `rows` by `row_id` (`WHERE table_name=? AND row_id > ? ORDER BY row_id LIMIT 128`).

For `job_commits` (if included): one `WHERE job=? AND seq>? ORDER BY seq LIMIT ?`. Treat a trimmed gap as an empty page with `hasMore: false` and a retained-window field, not `E_INPUT`.

## Acceptance

- Adding a row schedule to a table of 10_000 messages does not load 10_000 `Value`s at once (peak working set is one batch).
- Existing timer install / fire tests stay green.
- Optional: `trace <job>` on a job whose early chunks aged out of `_commits` does not throw `"job commit disappeared"`.

## Resolution (2026-09-12)

Schedule installation reuses successor row paging: SELECT ordered by row_id with LIMIT 128 and an advancing key. It retains at most one batch of raw row JSON and decodes one Value at a time before updating timer metadata. It no longer collects every table row into Values.

Validation: the integrated core timers suite passed 19 tests, including installation over 10,000 existing rows and the existing install/fire/target-change/removal cases. The optional job_commits item was outside this bounded fix.
