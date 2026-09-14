# Snapback 2 scheduled check `web` is red

**Status:** Open
**Priority:** P2
**Date:** 2026-09-13
**Systems:** Snapback 2 scheduled checks (`snapback2/scripts/scheduled.mjs`), the React chat starter in real Chromium (`scripts/witness-web.mjs`)
**Scheduled check:** `web`
**Host:** M1MacBookPro14in2021Office
**First red:** `3e01ba3e3329f0117d8d4220e756c445676b2311` (2026-09-13)
**Last red:** `ec15bba44ba81cda9ae1c7bbc10569a1c1caba94` (2026-09-14)
**Last green before it:** `93be9f23614bcc2bdb35d41cefac35baa92f9d5f`

## Evidence and impact

<!-- scheduled failure -->
`cd snapback2 && node scripts/witness-web.mjs` exited 1 at `ec15bba44` on M1MacBookPro14in2021Office; the full output is in `/Users/ccheever/.snapback2-scheduled/logs/web.log` there.

    FAIL 256/257 live capacity and sustained no-poll delivery
    page.evaluate: TypeError: Failed to fetch
        at eval (eval at evaluate (:291:30), <anonymous>:4:28)
        at UtilityScript.evaluate (<anonymous>:293:16)
        at UtilityScript.<anonymous> (<anonymous>:1:44)
        at sharedSessions (/Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:581:33)
        at async main (/Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:1419:5)
        at async file:///Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:1440:1
    ok   a follower's sends are durable rows: queued at once, bubbles in order, the composer still enabled — {"rows":[{"intent":"inbox:1","state":"queued","ids":0,"inbox":1},{"intent":"inbox:2","state":"queued","ids":0,"inbox":2}],"bubbles":["1…
    ok   a reload shows the device's queued rows from durable state before any network request — {"mutationRequests":0,"rows":["inbox:1","inbox:2"],"bubbles":["1018.004 durable oneSending… · Awaiting confirmation","1018.004 durable twoSending… …
    ok   the writer admits durable rows in key order; each executes exactly once; the follower reads the ledger entries — {"admitted":[{"intent":"s2id-91d3c87ca9b2b664eb71c1415b9a2cd1-0000000000003c01:417","inbox":1,"state":"committed","body":"…
    ok   a follower's dismissal is a durable command the writer consumes; both tabs' history agree — {"dismissed":"s2id-91d3c87ca9b2b664eb71c1415b9a2cd1-0000000000003c01:417"}
    ok   writer readiness before going offline — {"status":{"ready":true,"reason":"ready","action":"none","remaining":0,"fence":"inside"},"post":{"ready":true,"reason":"ready","action":"none","remaining":0,"fence":"inside"},"entries":[{"op":"_d…
    ok   writer readiness after going offline — {"status":{"ready":true,"reason":"ready","action":"none","remaining":0,"fence":"inside"},"post":{"ready":true,"reason":"ready","action":"none","remaining":0,"fence":"inside"}}
    ok   both tabs durably enqueue through the one offline writer — {"origins":["writer","follower","writer"],"intents":["s2id-91d3c87ca9b2b664eb71c1415b9a2cd1-0000000000003c01:627","s2id-91d3c87ca9b2b664eb71c1415b9a2cd1-0000000000003c01:731","…
    ok   takeover observation — {"status":{"ready":true,"reason":"ready","action":"none","remaining":4,"fence":"inside","draining":true},"entries":[{"op":"_delivery.deliveries.ack","args":{"events":["1d7d0b4b7a3a5592c00206dcb59fae7a8e743d3a4a28…
    ok   closing the writer transfers its Web Lock and one cross-tab FIFO queue; the new writer admits the row left behind and commits — {"replayIntents":["s2id-91d3c87ca9b2b664eb71c1415b9a2cd1-0000000000003c01:627","s2id-91d3c87ca9b2b664eb71c1…
    FAIL two offline tabs share one durable queue and transfer writer ownership
    AssertionError [ERR_ASSERTION]: the deletion completed beneath the third tab's connection: its fresh partition holds no ledger
    
    1 !== 0
    
        at sharedSessions (file:///Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:885:10)
        at async main (file:///Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:1419:5)
        at async file:///Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:1440:1
    {"name":"witness-web","kind":"witness","verdict":"fail","steps":[{"name":"a real account signs in through the starter's form","verdict":"pass","detail":{"principal":"user:AS9yagP3DytP5lIF5yHAGw"}},{"name":"seed, drain, and open three chats …
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
