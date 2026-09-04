# Snapback 2 twin: supersession reset trigger, `outbox.ready()` semantics, remaining catch-alls

**Status:** Open
**Systems:** snapback2 client (`packages/snapback2/src/offline.ts` commitMany/resumeRequest, `client-offline.ts`, `client-outbox.ts` ready(), `twin.ts` context(), `react.tsx` useOutbox)
**Date:** 2026-09-04
**Related:** LLP 1012 §7, §8, §15 (revision (h)); reviews `o2b-r3-muse.md` M2–M5, `o2b-r3-grok.md` items 2–4

## Findings

1. **Supersession's reset is not self-triggered.** A delivery under another generation or schema
   marks `superseded` and serves the live answer; only a resume's 409 runs the reset path. An app
   that queries online but never resumes (no mounts, no reconnect, grant still valid) stays
   superseded: online live-but-unheld, offline `hydrating`. Every online query after a rotation
   should at least schedule the reset. When generation and auth epoch both differ, supersession
   wins over the epoch refusal (recorded in the spec); the resume still carries the old facts and
   validators, safe only because the server checks epoch, then generation/schema, before the log.
2. **`outbox.ready()` promises a grant, not a write.** It does not read the write bounds or the
   grant's remaining capacity; both refuse `E_OFFLINE_ID_BLOCK` at enqueue. The composer gates on
   it and surfaces a refusal's rewrite, which is the backstop. Either include bound-known (and
   capacity for the op) in `ready()`, or document it as grant-only. `useOutbox` re-reads `ready`
   only on an entries push; a grant arriving without an outbox change can leave it stale — push on
   grant changes too.
3. **Two catch-alls remain in the twin.** `evaluate`/`predict`'s `context()` failures are bare
   catches (a `ReferenceError` in `tagArguments` becomes `hydrating`/empty trace), and the hydrate
   catch's `TypeError` arm swallows any `TypeError`-shaped bug in overlay put/remove. Narrow them
   the way the hydrate catch was narrowed.
4. **Size.** The twin is 19,747 bytes gzip after fix round 2 (+30 over the 19,717 NOT-DOING cites
   as "19.7 KB"); the next lane that touches the twin offsets it or re-baselines explicitly. Do not
   let small growth become the new normal.
