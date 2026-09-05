# P1 Snapback 2: cold offline drains with a custom cursor repeat page one

**Status:** Closed
**Priority:** P1
**Systems:** offline program restoration and DrainSubscription
**Date:** 2026-09-05
**Source:** Codex local-data review; reproduced/inspected at `23e89b4a17fecb713b7ca61681cf6f4f969c8536` (product tree equal to locally tracked origin/main `11e2e60984e756128aa0091b4c6c36ff82094ecb`).
**Related:** LLP 1012 §6 and §8; issues/20260904-snapback2-expo-carrier-byte-cache-notes.md item 5 (related warm-start metadata race)

## Problem

Cold program restoration restores the schema and IR but not cursor
descriptors. With the network unavailable, `cursorArg()` defaults to `c`,
even when the held program declares another argument. The drain advances the
extra c argument while the real cursor stays null, and repeats its first page.

Sites in `snapback2/packages/snapback2/src/offline.ts`:
`cursorArg` at line 388 and `loadProgram` at line 765.
The unbounded progress loop is in `src/drain.ts`.

## Real-owner reproduction

1. Add to the checked chat fixture:

   ```q
   query page(nextPage: cursor ?):
     return profiles[] after nextPage first 1 by byId
   ```

   Save as `snapback/review.q`.
2. Create a persona Alice client with a file range store.
3. Subscribe to `api.review.page`, `{nextPage: null}`, with
   `{drain: true}`; wait for `caughtUp: true`, then close the client.
4. Recreate it against the same store with `startOffline: true`.
5. Mount the same drain. Close it from the callback after four events to
   bound the reproduction.

Observed:

```text
warm: profile-alice (capped), profile-bob (complete, caughtUp=true)
cold: profile-alice, profile-alice, profile-alice, profile-alice
      all capped, caughtUp=false
```

This is a cold-restart failure despite persisted program custody. The older
byte-cache-notes item concerns a bearer drain mounted before initial metadata;
waiting for a network manifest cannot fix the cold offline case.

## Resolution and acceptance

Restore cursor names from the held program or saved watermark before offline
draining. Detect repeated cursors and refuse without an infinite loop.

Verify a cursor not named c drains to the same rows and terminal state after
offline restart on all carriers. Keep the persisted server watermark intact.

## Review qualification

The package was rebuilt before verification. Existing selected client/carrier
suites passed 251/251 and Rust offline/replay/retention tests passed 37/37.
The new review reproductions expose gaps in that coverage. This ticket is
self-contained; temporary review artifacts are not required to implement it.

## Resolution — 2026-09-05

The runtime derives cursor descriptors lazily from held program IR after
reopen. Both page traversal and the live tail detect repeated cursors and
refuse instead of looping. Offline traversal leaves the server watermark
unchanged. Drains still wait for startup when online, while covered local
reads can proceed independently.

Real-owner regression coverage drains a non-c cursor on file, IndexedDB,
and SQLite carriers, reopens offline, and verifies rows, completion, and
preservation of the actual persisted watermark.

The complete package run passed 364 tests with one existing skipped
process-control placeholder; no package tests failed. The implementation,
regressions, and guide/LLP updates ship together with this ticket closure.
