# Snapback 2 twin: supersession reset trigger, `outbox.ready()` semantics, remaining catch-alls

**Status:** Closed
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

## Resolution — 2026-09-04

- An online delivery that supersedes held generation/schema facts now schedules the old-facts
  resume immediately when transport is open and retains the trigger for the next `online()` or
  subscription reconnect after a retryable transport failure. The reset reloads `/api/program`
  and re-holds the triggering live delivery under the successor facts. Proved by `an online query
  under a new generation immediately resets and rebuilds fresh coverage without an explicit
  online()`.
- `client.outbox.ready(op?)` now distinguishes grant-only readiness from per-operation readiness;
  the op form also requires a recorded bound and capacity for `1 + maxNewIds`. `useMutation(op)`
  uses the op probe, `useOutbox()` remains grant-only, and grant/bound adoption notifies subscribers.
  Proved by `enqueue consumes a grant slice of 1 + maxNewIds and refuses E_OFFLINE_ID_BLOCK when
  the grant is spent`, `a store with an open partition never sends plain bytes: no grant or no bound
  refuses E_OFFLINE_ID_BLOCK with no request; a client with no store sends today's bytes`, and `a
  grant arriving without an outbox entry change flips useOutbox().ready`.
- The twin catches only `TypeError` (including `DeliveryEnvelopeDecodeError`) and `EvalError` from
  the tagger/hasher calls; `ClientStore` construction and overlay `put`/`remove` execute outside the
  catch. Proved by `a ReferenceError from tagArguments surfaces on query and mutation, never as
  hydrating or an empty trace`.
- The previous measurement method records 60,302 minified bytes and 19,737 Node-zlib gzip-9 bytes,
  10 gzip bytes below landing 6; `metrics/twin.jsonl` contains the T2 line.

Verification: `cargo build` passed; `scripts/test.sh` reached 96/96 package tests, 496/498 Rust tests,
160/160 evaluator cases, and 303/304 compiler checks. The two Rust failures were the documented
sandbox `E_OWNER_STOP_TIMEOUT` cases; compiler F9 was the documented sandbox dead-owner timing case.
`node tests/index.js` passed 200 with one pre-existing skip, `bun src/test.ts` exited 0, and
`./ref-check --verbose` passed. Root caps reported only its pre-existing Snapback 1 1,504-line
baseline overage; the largest T2 file is `client.ts` at 1,335 lines.
