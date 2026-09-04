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
