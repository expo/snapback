# Snapback 2 twin: supersession and reset follow-ups from the third review round

**Status:** Open
**Systems:** snapback2 client (`packages/snapback2/src/{offline,client,client-offline,client-outbox,sse}.ts`)
**Date:** 2026-09-04
**Related:** ticket 20260904-snapback2-twin-supersession-ready-followups (closed by lane T2 after three review rounds); LLP 1012 §7/§8 (the supersession and reset record); reviews `t2-r3-{muse,grok,astra}.md`

## Findings (third round; the lane's limit)

1. **A predecessor-generation delivery can still clobber a newer superseded marker** (Muse M1):
   the supersession marker is adopted on any generation mismatch without comparing to a marker
   already held; keep the newest generation's marker and ignore older ones.
2. **The reset epoch is the client's own request epoch** (Muse M2), sound only while the owner
   checks epoch before generation (it does, `writer_resume.rs`); record the dependency beside
   the check, or take the epoch from the owner's refusal.
3. **The settlement-tail retry proof is staged** (Muse M3): the test hand-commits the successor
   drain page before the byte-identical retry; prove the retry end-to-end against the fake
   owner without the hand commit.
4. **`abortResume()` drops `resumeFlight` before the aborted run exits** (grok r3 1): a new
   `performResume` can start while the old one is still unwinding; hold the slot until the
   aborted run settles.
5. **`program()` can persist then abort before memory adopts** (grok r3 2): the store holds G2
   while memory names G1 after an abort between the commit and the adoption; adopt in the
   same step or re-read on the next flight.
6. **`json()` does not fence an aborted signal before interpreting a late 4xx** (grok r3 3):
   mirror `stream()`'s check so an aborted request cannot seal the session.
7. **`drainNow()` has no signal** (grok r3 4): drains rely on the revision fence only; give the
   drain the flight's signal or a revision check at each await.

## Disposition — 2026-09-11

**Priority:** P2. **State:** keep open for items 1–5; items 6/7 are implemented.
Same-client hot-regroup controls exercised ordinary online/resume supersession
without refusal, but do not impose the remaining await-boundary races or replace
the staged tail proof.

Item 6 is resolved by `client.ts::refuseJson` checking cancellation before
ordinary late-refusal expiry/sealing. The delayed terminal/invalid-refusal
cases in `auth-restoration.test.ts` pin unchanged token, snapshot, status and
entries after the cancelled body completes. Item 7 is resolved by
`drainNow`'s tracked AbortController, its signal passed to `drainOutbox`,
and `withAbort` around JSON; the same file has the replay-fetch/body and
tail-fetch cancellation matrix. These are current-source and maintained-test
evidence at `15c134d056`, not claims that the hot-regroup control exercised them.

Remaining: deterministic marker ordering, abort-unwind, persist/adopt and
unstaged settlement-tail evidence; retain the epoch-order dependency.
