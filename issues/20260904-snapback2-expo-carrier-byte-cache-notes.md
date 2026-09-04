# Snapback 2 Expo carrier: do not copy two web byte-cache shortcuts

**Status:** Open (blocked on the Expo arm)
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
