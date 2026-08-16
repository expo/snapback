# LiveQueryHandle.dispose() is typed `void` but returns the awaitable cleanup task the guide tells you to await

**Status:** Closed
**Impact:** 4
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Client Kit, Types, Guide, Live Queries
**Date:** 2026-08-11
**Resolved:** 2026-08-15
**Governing:** LLP 0034, LLP 0012
**Found while:** Reviewing the LLP 0034 §11 `watchQuery` draft amendment
**Related:** `llp/reviews/0034-s11-watchquery-amendment.claude.md` (concern B3)

## Problem

Three sources disagree about what `LiveQueryHandle.dispose()` gives back.

- **Implementation** returns a promise:
  `packages/snapback-client/index.mjs:13066` — `return disposalTask;`
  (and `:13000` returns `disposalTask ?? Promise.resolve()` on re-entry).
- **Declaration** says it returns nothing:
  `packages/snapback-client/index.d.mts:590` — `dispose(): void;`
- **Guide** instructs callers to await it (`guide/clients/headless.md`):
  "`dispose()` performs local teardown synchronously and returns an awaitable
  cleanup task. UI unmount code may safely ignore it; acceptance and operations
  code **should await it when typed server cleanup failures matter**."

A TypeScript consumer following the guide cannot get what the guide promises.
`await handle.dispose()` on a `void`-typed expression is legal but yields
nothing, so the "typed server cleanup failures" the guide points acceptance and
operations code at are unreachable through the published surface.

## Why this is a real defect and not a cosmetic type gap

The typed-failure route is the *only* documented way for acceptance and
operations code to observe server-side retirement failures — genuine
ownership, session, and network errors that `dispose()` deliberately preserves
(`index.mjs:13058-13064`: the rejection handler is observation-only precisely
so explicit callers still receive the original task).

The same file already declares the correct shape on sibling surfaces:

- `index.d.mts:671-672` — `dispose(): void; settled(): Promise<void>;`
- `index.d.mts:842-843` — same pair
- `index.d.mts:1709` — `{ dispose(): void; settled(): Promise<void> }`

`LiveQueryHandle` is the one live-query surface missing the awaitable half, so
this reads as an omission rather than a deliberate asymmetry.

## Second, related gap

`handle.settled` is assigned at `index.mjs:13068` but is **not declared** on
`LiveQueryHandle` in `index.d.mts:569-592` at all.

It also does not cover disposal: `settled()` awaits `freshSubscribeTail`,
`pauseReleasePromise`, and `cleanupTail`, but `dispose()` parks its unsubscribe
in `disposalTask`, and `cleanupTail` is appended only by
`bestEffortUnsubscribeLive` (`index.mjs:11582`). So `settled()` does not await
the work `dispose()` starts.

That matters beyond typing: any future or existing caller reasoning
"dispose, then await settled()" believes it has awaited server-side retirement
when it has not. Decide and then document which of the two is the retirement
await, rather than leaving both partially true.

## Desired outcome

Publish the actual contract. Declare `dispose()`'s return so the guide's
instruction is followable in TypeScript, declare `settled()` on
`LiveQueryHandle` if it is public, and make the guide state precisely which
call awaits server-side retirement.

## Acceptance

- `LiveQueryHandle`'s declared `dispose()` return type matches what the
  implementation returns, and `await handle.dispose()` surfaces the typed
  ownership/session/network failure in a strict TypeScript consumer.
- `settled()` is either declared on `LiveQueryHandle` or made private, with the
  choice reflected in the guide.
- The guide names exactly one call as the server-side-retirement await and is
  accurate about what the other one covers.
- UI unmount code that ignores the return value keeps working unchanged, and no
  new unhandled rejection is introduced (the observation-only handler at
  `index.mjs:13062` stays).
- A typed test in the client package pins the awaited-failure route so the
  declaration cannot silently regress to `void`.

## Non-goals

- Adding `watchQuery()` or any new observation surface. That is LLP 0034 §11,
  which is a separate Draft amendment pending author ratification; this ticket
  is independently true whether or not §11 is ever ratified.
- Changing disposal *behavior*, retry, or the shared-connection retirement
  question recorded in LLP 0034 §10.11.

## Resolution

Resolved 2026-08-15. `packages/snapback-client/index.d.mts` now publishes
`LiveQueryHandle.dispose()` as the server-retirement `Promise<void>` and
declares `settled()` as the separate bounded drain for the fresh-subscribe,
pause-release, and best-effort cleanup tails. Its documentation states that
`settled()` does not await disposal.

`packages/snapback-client/exact-reference-types.fixture.ts` pins the returned
promise, the awaited diagnostic-error route, and the rejection of a synchronous
`void` interpretation. `guide/clients/headless.md` names the returned
`dispose()` task as the sole server-side-retirement await and gives `settled()`
the same precise boundary. `packages/snapback-client/index.mjs` was unchanged;
the existing observation-only rejection handler continues to make ignored UI
unmount cleanup safe while explicit callers retain the original failure route.
