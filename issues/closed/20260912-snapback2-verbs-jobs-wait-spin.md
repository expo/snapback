# snapback2 verbs_jobs wait() spins without backoff

**Status:** Resolved
**Priority:** P2
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/snapback2/src/verbs_jobs.rs:260` (`wait`), `:251` (seq advance)

## What was reported

`wait()` loops with no sleep while `hasMoreCommits` is set, and only
advances on a numeric seq (`:251`). A large backlog hammers the owner in a
tight loop; a malformed/non-advancing page polls forever.

## Suggested fix

- Sleep/backoff between polls, a seq-progress guard (bail after N pages
  with no advance), and a page cap.
- Add a regression test with a non-advancing `hasMoreCommits` page
  asserting bounded polls.

## Acceptance

- Backlog drains without hot-looping; malformed pages terminate boundedly
  with an error, not a forever poll.

## Resolution (2026-09-12)

Backlog polling waits 20ms between pages. Every returned sequence must advance strictly, and an empty `hasMoreCommits` page is a protocol error; malformed pages stop on their first occurrence. Validation: `job_commit_pages_require_strict_progress` passed in the integrated native owner suite (263 tests).
