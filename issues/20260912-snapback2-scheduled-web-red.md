# Snapback 2 scheduled check `web` is red

**Status:** Open
**Priority:** P2
**Date:** 2026-09-12
**Systems:** Snapback 2 scheduled checks (`snapback2/scripts/scheduled.mjs`), the React chat starter in real Chromium (`scripts/witness-web.mjs`)
**Scheduled check:** `web`
**Host:** M1MacBookPro14in2021Office
**First red:** `f129dd7b942a453db23251c8c6a11b94d5abcf1d` (2026-09-12)
**Last red:** `f129dd7b942a453db23251c8c6a11b94d5abcf1d` (2026-09-12)
**Last green before it:** `93be9f23614bcc2bdb35d41cefac35baa92f9d5f`

## Evidence and impact

<!-- scheduled failure -->
`cd snapback2 && node scripts/witness-web.mjs` exited 1 at `f129dd7b9` on M1MacBookPro14in2021Office; the full output is in `/Users/ccheever/.snapback2-scheduled/logs/web.log` there.

    FAIL two offline tabs share one durable queue and transfer writer ownership
    AssertionError [ERR_ASSERTION]: the deletion completed beneath the third tab's connection: its fresh partition holds no ledger
    
    1 !== 0
    
        at sharedSessions (file:///Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:778:10)
        at async main (file:///Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:1246:5)
        at async file:///Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/witness-web.mjs:1267:1
    {"name":"witness-web","kind":"witness","verdict":"fail","steps":[{"name":"a real account signs in through the starter's form","verdict":"pass","detail":{"principal":"user:GF5hyt2WLF0AkYgRFowyhA"}},{"name":"seed, drain, and open three chats …
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
