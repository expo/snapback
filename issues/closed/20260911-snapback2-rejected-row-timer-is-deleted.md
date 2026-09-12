# Snapback 2 a rejected row-timer firing deletes the timer

**Status:** Resolved
**Priority:** P3
**Date:** 2026-09-11
**Systems:** `snapback2/crates/snapback2-core/src/engine/timers.rs`
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1016 D5; Clique disappearing-message schedules

## Symptom

After the target savepoint is released or rolled back, **every** row-timer firing deletes `_timers`. Period timers re-arm. Tests pin this: a ceiling rejection “settles” and `due_timers` is empty. Crash-before-commit retries exactly once.

So a `schedule expireMessage on messages at .expiresAt` whose target is `Rejected` (constraint, rule, bound) will not run again unless the deadline column is rewritten. The message remains past due. Jobs park and can resume; row timers do not.

Clock jumps: `now` is the owner’s clock; period catch-up records `skipped` and fires once for the latest period (no double-fire). Exclusive WAL writer prevents two owners firing the same row.

This may be the intended product rule (“one attempt per deadline value”). If it is, say so in the guide next to `schedule … at`. If expiry must be at-least-once, it is a bug.

## Proposed

Decide and pin:

**A. One attempt per deadline value (current).** Guide: a rejected expiry does not retry; rewrite `.expiresAt` (or the row) to re-arm. Keep the tests.

**B. At-least-once expiry.** On target `Rejected`, re-arm the same `_timers` row (or park it like a job) instead of deleting it. Cap retries so a permanently-illegal target cannot spin. Crash-before-commit stays one due row.

Recommend **B** for disappearing messages (the brief’s M5): a bound/rule miss should not strand the body. Keep **A** for one-shot notifications if those exist.

## Acceptance

- Documented choice in `guide` next to row schedules.
- If B: a `schedule` target that rejects `E_BOUND` once still fires again after the next due instant (or immediately with backoff), and a test covers it.
- If A: the existing “ceiling rejection settles” test stays, and the guide names the rewrite.

## Resolution (2026-09-12)

Choice A is now explicit next to row schedule syntax in the guide and in LLP 1016 D5: one attempt per deadline value. Rejection settles a row timer. Changing its deadline re-arms it; rewriting the same value or an unrelated field does not. Period timers still re-arm.

Validation: the existing ceiling-rejection-settles regression remains in the integrated core timers suite, which passed 19 tests. No retry policy was added.
