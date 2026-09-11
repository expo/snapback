# Snapback 2 scheduled check `web` is red

**Status:** Open
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback 2 scheduled checks (`snapback2/scripts/scheduled.mjs`), the React chat starter in real Chromium (`scripts/witness-web.mjs`)
**Scheduled check:** `web`
**Host:** M1MacBookPro14in2021Office
**First red:** `f2dc1bdee72d0ca3da5c990eb6c07366ceda7b4f` (2026-09-11)
**Last red:** `1d2b6d8d3fbef3f66288a9de097e6725349ba5a7` (2026-09-11)
**Passed again:** `93be9f23614bcc2bdb35d41cefac35baa92f9d5f` (2026-09-11)
**Last green before it:** none recorded on this host

## Evidence and impact

<!-- scheduled failure -->
`cd snapback2 && node scripts/witness-web.mjs` exited 1 at `1d2b6d8d3` on M1MacBookPro14in2021Office; the full output is in `/Users/ccheever/.snapback2-scheduled/logs/web.log` there.

    FAIL two offline tabs share one durable queue and transfer writer ownership
    AssertionError [ERR_ASSERTION]: an unadmitted row sends no owner mutation
    
    7 !== 5
    
        at sharedSessions (file:///Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:618:10)
        at async main (file:///Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:1240:5)
        at async file:///Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:1261:1
    {"name":"witness-web","kind":"witness","verdict":"fail","steps":[{"name":"a real account signs in through the starter's form","verdict":"pass","detail":{"principal":"user:9jvosR57MU_FOB8krvSC4g"}},{"name":"seed, drain, and open three chats …
<!-- /scheduled failure -->

Commits touching `snapback2/` since that green run, newest first (at most 20):

No green run of this check is recorded on this host yet.

## Requested outcome and acceptance

- Fix the regression, or the check if it is stale, and close this ticket in the commit that makes
  `cd snapback2 && node scripts/witness-web.mjs && node scripts/witness-web.mjs --signup && node scripts/witness-web.mjs --offline-replay` pass. Each scheduled run
  refreshes **Last red** at most once a day or when the failure changes, and adds **Passed again**
  once the check passes.
