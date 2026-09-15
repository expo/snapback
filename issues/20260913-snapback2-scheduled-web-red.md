# Snapback 2 scheduled check `web` is red

**Status:** Open
**Priority:** P2
**Date:** 2026-09-13
**Systems:** Snapback 2 scheduled checks (`snapback2/scripts/scheduled.mjs`), the React chat starter in real Chromium (`scripts/witness-web.mjs`)
**Scheduled check:** `web`
**Host:** M1MacBookPro14in2021Office
**First red:** `3e01ba3e3329f0117d8d4220e756c445676b2311` (2026-09-13)
**Last red:** `1a4a50da811c5c4a7544ae11c94ccda4f9f5fefd` (2026-09-15)
**Last green before it:** `93be9f23614bcc2bdb35d41cefac35baa92f9d5f`

## Evidence and impact

<!-- scheduled failure -->
`cd snapback2 && node scripts/witness-web.mjs` exited 1 at `1a4a50da8` on M1MacBookPro14in2021Office; the full output is in `/Users/ccheever/.snapback2-scheduled/logs/web.log` there.

    FAIL witness
    Error: partial history to coherent composite remounted the pinned bubble
        at main (file:///Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:1357:42)
        at async file:///Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:1440:1
    {"name":"witness-web","kind":"witness","verdict":"fail","steps":[{"name":"a real account signs in through the starter's form","verdict":"pass","detail":{"principal":"user:36TvWOJZKnNjhIPnc_ynBg"}},{"name":"seed, drain, and open three chats …
<!-- /scheduled failure -->

Commits touching `snapback2/` since that green run, newest first (at most 20):

    6abe83b63 Park Snapback 1-3 tickets and keep Snapback 4 as the working set
    39eb55a26 Record 7.49-second native owner prototype and remaining acquisition gap
    475c6893f Record native acquisition restart and measured eight-second target miss
    5cfd2ae8c Record full acquisition redesign prototype and measured target miss
    ca3ec9435 Record bulk-index and final-image acquisition feasibility results
    d59351c4b Reject marginal acquisition redesign after scoped CPU attribution
    52c2db465 Start queued IndexedDB commits and record acquisition feasibility limits
    e77b8ab05 Preserve persisted replay fingerprint encoding during acquisition tuning
    fc6dd8c68 Retain current content profile and rule out repeated snapshot rebuilds
    6c5253a16 Record complete acquisition comparison and numeric omission coverage
    4e545d525 Remove repeated omission sorting and journal copy traversal
    70f7c2e29 Retain query packing repetition and keep the current request size
    1169aa930 Record full acquisition improvement from shared acknowledgement settlement
    5060a5474 Coalesce time-limited acknowledgement replies within their original offer
    e59bf9008 Merge remote-tracking branch 'origin/main' into llp-ship/acquisition-20260912/integration
    35f353b83 Record retained-image write reduction and native lookup evidence
    57b859698 Use canonical row addresses for native primary point reads
    3a0b3a881 Avoid rewriting unchanged retained image reference counts
    806f2e35e Merge commit 'eb5b464893bce21a6c1e96db0e2b6bbad3ff2b53' into llp-ship/1023-20260912/darwin
    b3b6bdf8e Record qualified 0.0.31 publication and close query follow-up

## Requested outcome and acceptance

- Fix the regression, or the check if it is stale, and close this ticket in the commit that makes
  `cd snapback2 && node scripts/witness-web.mjs && node scripts/witness-web.mjs --signup && node scripts/witness-web.mjs --offline-replay` pass. Each scheduled run
  refreshes **Last red** at most once a day or when the failure changes, and adds **Passed again**
  once the check passes.
