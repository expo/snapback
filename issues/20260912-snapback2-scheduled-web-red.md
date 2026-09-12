# Snapback 2 scheduled check `web` is red

**Status:** Open
**Priority:** P2
**Date:** 2026-09-12
**Systems:** Snapback 2 scheduled checks (`snapback2/scripts/scheduled.mjs`), the React chat starter in real Chromium (`scripts/witness-web.mjs`)
**Scheduled check:** `web`
**Host:** M1MacBookPro14in2021Office
**First red:** `f129dd7b942a453db23251c8c6a11b94d5abcf1d` (2026-09-12)
**Last red:** `e4a85d7671eec82e44f4f8163b9fa4e73a73b01b` (2026-09-12)
**Last green before it:** `93be9f23614bcc2bdb35d41cefac35baa92f9d5f`

## Evidence and impact

<!-- scheduled failure -->
`cd snapback2 && node scripts/witness-web.mjs` exited 1 at `e4a85d767` on M1MacBookPro14in2021Office; the full output is in `/Users/ccheever/.snapback2-scheduled/logs/web.log` there.

    FAIL 256/257 live capacity and sustained no-poll delivery
    page.evaluate: TypeError: Failed to fetch
        at eval (eval at evaluate (:291:30), <anonymous>:4:28)
        at UtilityScript.evaluate (<anonymous>:293:16)
        at UtilityScript.<anonymous> (<anonymous>:1:44)
        at sharedSessions (/Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:474:33)
        at async main (/Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:1246:5)
        at async file:///Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:1267:1
    ok   a follower's sends are durable rows: queued at once, bubbles in order, the composer still enabled — {"rows":[{"intent":"inbox:1","state":"queued","ids":0,"inbox":1},{"intent":"inbox:2","state":"queued","ids":0,"inbox":2}],"bubbles":["1…
    ok   a reload shows the device's queued rows from durable state before any network request — {"mutationRequests":0,"rows":["inbox:1","inbox:2"],"bubbles":["1018.004 durable oneSending… · Awaiting confirmation","1018.004 durable twoSending… …
    ok   the writer admits durable rows in key order; each executes exactly once; the follower reads the ledger entries — {"admitted":[{"intent":"s2id-037a280221f0c3a30f1f86712d5575ce-0000000000003c01:417","inbox":1,"state":"committed","body":"…
    ok   a follower's dismissal is a durable command the writer consumes; both tabs' history agree — {"dismissed":"s2id-037a280221f0c3a30f1f86712d5575ce-0000000000003c01:417"}
    ok   writer readiness before going offline — {"status":{"ready":true,"reason":"ready","action":"none","remaining":0,"fence":"inside"},"post":{"ready":true,"reason":"ready","action":"none","remaining":0,"fence":"inside"},"entries":[{"op":"_d…
    ok   writer readiness after going offline — {"status":{"ready":true,"reason":"ready","action":"none","remaining":0,"fence":"inside"},"post":{"ready":true,"reason":"ready","action":"none","remaining":0,"fence":"inside"}}
    ok   both tabs durably enqueue through the one offline writer — {"origins":["writer","follower","writer"],"intents":["s2id-037a280221f0c3a30f1f86712d5575ce-0000000000003c01:627","s2id-037a280221f0c3a30f1f86712d5575ce-0000000000003c01:731","…
    ok   takeover observation — {"status":{"ready":true,"reason":"ready","action":"none","remaining":4,"fence":"inside","draining":true},"entries":[{"op":"_delivery.deliveries.ack","args":{"events":["106ea2e2c649fadb6cfaa9f49ae056dfb3f4c572d399…
    ok   closing the writer transfers its Web Lock and one cross-tab FIFO queue; the new writer admits the row left behind and commits — {"replayIntents":["s2id-037a280221f0c3a30f1f86712d5575ce-0000000000003c01:627","s2id-037a280221f0c3a30f1f86…
    ok   a wipe deletes the partition beneath an open follower connection; the follower's route ends and its wait takes over a fresh partition — {"before":20,"after":{"entries":0,"status":{"ready":true,"reason":"ready","action":"none","remainin…
    {"name":"witness-web","kind":"witness","verdict":"fail","steps":[{"name":"a real account signs in through the starter's form","verdict":"pass","detail":{"principal":"user:3Dhs64rU5aDiNJBokjYhyQ"}},{"name":"seed, drain, and open three chats …
<!-- /scheduled failure -->

Commits touching `snapback2/` since that green run, newest first (at most 20):

    3b7f51564 fix(snapback2): withhold unheld Insights totals until authority arrives
    4e22e8046 fix(snapback2): admit foreground writes during acquisition recovery
    9f93f3e1b feat(snapback2): batch durable acquisition and acknowledgement work
    a07a851b0 fix(snapback2): keep Metro alive across a successor compile

## Requested outcome and acceptance

- Fix the regression, or the check if it is stale, and close this ticket in the commit that makes
  `cd snapback2 && node scripts/witness-web.mjs && node scripts/witness-web.mjs --signup && node scripts/witness-web.mjs --offline-replay` pass. Each scheduled run
  refreshes **Last red** at most once a day or when the failure changes, and adds **Passed again**
  once the check passes.
