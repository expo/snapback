# Snapback 2 Expo carrier: do not copy two web byte-cache shortcuts

**Status:** Closed — implemented and qualified in `819dfb063` (2026-09-11)
**Priority:** P2
**Systems:** snapback2 client (`packages/snapback2/src/store/byte-cache.ts`, `range-store.ts`, the Expo carrier when it exists)
**Date:** 2026-09-04
**Related:** LLP 1012 §9 and §10; reviews `o4w-r2-muse.md` M1, M4, M6

## What the web carrier does today, and why the Expo carrier must not

1. The view-once session allowance stores whole blobs in memory keyed by asset id (up to
   eight), ignoring width and `maxAssetBytes`. On a phone: bound session bytes by
   `maxAssetBytes` (or hold one blob, the clip on screen) and key by `(assetId, width)`.
2. Byte reads (`readBytes`) run without holding the store's queue while a swap (including a
   file unlink) can land mid-read; fails closed on seal, but serialize byte I/O on the same
   queue before an sqlite carrier copies it. The IndexedDB abort path is still
   fire-and-forget.
3. LRU touches are stamped in memory and persisted with the next swap; a clean close before
   a swap loses the order (never bytes). The Expo carrier should persist or coalesce on close.
4. (grok round 2, M4) `useAssetUrl` is a mint-time check: two mounted players of the same
   unviewed clip both hold carrier URLs, and `markViewed` from one does not darken the
   other until unmount or identity change. Do not copy "any sibling marks viewed → all go
   dark" into Expo without a live revocation keyed on `viewed`.
5. (grok round 2, M5) A bearer client with no principal resolves `ready` before metadata,
   so a drain of an `after`-cursor log mounted before the first authenticated query files
   under `c`. Recipe ops are named `c`; a custom cursor name on a bearer drain needs the
   manifest awaited, not `ready`.

## Reconciliation — 2026-09-11

The Expo arm now exists, so this is no longer blocked. Current-source triage:

- Item 1 remains: `SESSION_VIEW_LIMIT` is still 8 whole session blobs without a
  session-byte ceiling.
- Item 2 is partly landed: SQLite reads and transactions share `driverQueue`, and
  native materialization/removal has its own file queue. The IndexedDB abort note and
  a cross-queue completion proof remain.
- Item 3 remains: `getBytes` catches a coalesced `touchBytes`, and close has no final
  touch flush.
- Item 4 landed for native files through per-asset revision revalidation; the web hook
  still subscribes only to partition custody, so it is not globally resolved.
- Item 5 was not exercised in this bounded pass and remains unproven.

Next acceptance: bound session-held bytes and width identity; add close/touch and
read-vs-swap cases for both carriers; prove sibling revocation on each UI arm; and run
the bearer pre-manifest custom-cursor case.

## Resolution — 2026-09-11

Commit `819dfb063` closes all five items. View-once session blobs now use exact
`(assetId,width)` admission keys and the single `maxAssetBytes` device ceiling,
with one oversize on-screen blob permitted. Reads and revoking swaps share the
store queue on file, SQLite, and IndexedDB; the IndexedDB abort is awaited.
Coalesced LRU touches flush on close, and close preserves a primary flush error
plus a carrier-close error when both fail.

Both React arms observe view-once admission revisions, so a sibling loses its
source immediately. The bearer drain waits for the manifest when no restored
program can name a custom cursor. Deterministic coverage is in
`offline-bytes.test.ts`, `offline-view-once.test.ts`,
`native-custody.test.ts`, and `offline-resume-tail.test.ts`; the combined focused
run passed 205/205 after the teardown control was made to await client close,
and the two UI files then passed 44/44 together.
