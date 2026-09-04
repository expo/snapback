# Snapback 2 fence: the resume trust anchor's remaining race, and the no-facts seed's single try

**Status:** Open
**Systems:** snapback2 client (`packages/snapback2/src/store/outbox.ts` lifecycle generation; `src/offline.ts` open(); `src/client-offline.ts` resume completion and the no-facts seed)
**Date:** 2026-09-04
**Related:** LLP 1012 revision (i) and lane F's §7 record; reviews `fence-r3-astra.md` B1, `fence-r3-muse.md` M2 (the lane's third and last review round)

## Findings

1. **A resume racing a same-principal re-open can restore obsolete trust (astra r3 B1).** The
   lifecycle generation advances on a partition change, seal, wipe, reset, and close, but a
   re-open of the *same* principal (login again without sign-out) does not advance it, and the
   resume path records trust after grant persistence without a second authority check. A
   resume whose grant persistence is paused across such a re-login completes and records the
   anchor. Narrow (the same principal, the same partition, no seal in between), and the anchor
   it records is still "this partition resumed successfully", so it is not a cross-principal
   trust violation; but the generation should advance on every open so the invariant is one
   sentence. Fix: advance the generation unconditionally in `open()` and re-check authority
   after grant persistence; test with a deferred carrier.
2. **The no-facts recovery tries one seed candidate with no fallback (Muse r3 M2).** The seed
   chooser picks by priority (mounted drain, recorded log, manifest `Cursor` query with known
   arguments, all-optional query) but awaits one choice; a stale held-watermark op removed by a
   program change refuses and the recovery stops instead of trying the next candidate. Fix:
   iterate the candidates until one answers or the list is exhausted, then `E_OFFLINE_RESUME`.

3. **The generation is consulted only when setting the anchor (grok r3 M1)** — after the store
   and the grant have already moved; check it before persisting the grant as well, so an
   obsolete resume moves nothing.
4. **The seed chooser can pick a `Cursor` query that is not a log (grok r3 M2)** and does not try
   another candidate — the same fix as item 2: prefer a query whose result the manifest marks as
   a delivery log, iterate candidates.

Filed at the lane's third review round (the limit); the fence landed with all four open.
