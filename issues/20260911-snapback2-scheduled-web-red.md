# Snapback 2 scheduled check `web` is red

**Status:** Open
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback 2 scheduled checks (`snapback2/scripts/scheduled.mjs`), the React chat starter in real Chromium (`scripts/witness-web.mjs`)
**Scheduled check:** `web`
**Host:** M1MacBookPro14in2021Office
**First red:** `f2dc1bdee72d0ca3da5c990eb6c07366ceda7b4f` (2026-09-11)
**Last red:** `f2dc1bdee72d0ca3da5c990eb6c07366ceda7b4f` (2026-09-11)
**Last green before it:** none recorded on this host

## Evidence and impact

<!-- scheduled failure -->
`cd snapback2 && node scripts/witness-web.mjs --offline-replay` exited 1 at `f2dc1bdee` on M1MacBookPro14in2021Office; the full output is in `/Users/ccheever/.snapback2-scheduled/logs/web.log` there.

    FAIL witness
    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    + actual - expected
    
      {
        ready: true,
        reason: 'ready',
    +   remaining: 2
    -   remaining: 1
      }
    
        at singleContextOfflineReplay (file:///Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:851:10)
        at async main (file:///Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:942:7)
        at async file:///Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:1256:1
    {"name":"witness-web","kind":"witness","verdict":"fail","steps":[{"name":"a real account signs in through the starter's form","verdict":"pass","detail":{"principal":"user:MN5lflj0w_z_a4KYDyjbWw"}},{"name":"witness","verdict":"fail","detail"…
<!-- /scheduled failure -->

Commits touching `snapback2/` since that green run, newest first (at most 20):

No green run of this check is recorded on this host yet.

## Requested outcome and acceptance

- Fix the regression, or the check if it is stale, and close this ticket in the commit that makes
  `cd snapback2 && node scripts/witness-web.mjs && node scripts/witness-web.mjs --signup && node scripts/witness-web.mjs --offline-replay` pass. Each scheduled run
  refreshes **Last red** at most once a day or when the failure changes, and adds **Passed again**
  once the check passes.
