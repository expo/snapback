# Snapback 2 scheduled check `expo` is red

**Status:** Open
**Priority:** P2
**Date:** 2026-09-13
**Systems:** Snapback 2 scheduled checks (`snapback2/scripts/scheduled.mjs`), the Expo chat starter on the iOS simulator (`scripts/witness-expo.mjs`)
**Scheduled check:** `expo`
**Host:** Charlies-MacBook-Pro-M5Max-Black
**First red:** `485018648782c692122788c8a094d145008c65c8` (2026-09-13)
**Last red:** `20ca0dc3ccccb4ba159bf32bea12a1ce2f165f4c` (2026-09-14)
**Last green before it:** none recorded on this host

## Evidence and impact

<!-- scheduled failure -->
`cd snapback2 && node scripts/witness-expo.mjs` exited 1 at `20ca0dc3c` on Charlies-MacBook-Pro-M5Max-Black; the full output is in `/Users/ccheever/.snapback2-scheduled/logs/expo.log` there.

    1. FAIL — build, owner seed, and outward control
    Error: /Users/ccheever/.snapback2-scheduled/repo/snapback2/target/debug/snapback2 dev --project /Users/ccheever/.snapback2-scheduled/repo/snapback2/target/e2-expo-app --json exited 1
    {"code":"E_OWNER_START_TIMEOUT","family":"owner","guide":"owner/dev","message":"detached owner did not become ready within 10 seconds","rewrite":"inspect .snapback/log.jsonl and run snapback2 dev --foreground"}
    
        at ChildProcess.<anonymous> (file:///Users/ccheever/.snapback2-scheduled/repo/snapback2/scripts/expo-project.mjs:25:19)
        at ChildProcess.emit (node:events:509:28)
        at ChildProcess._handle.onexit (node:internal/child_process:295:12)
    2. NOT RUN — login, inbox drain, three chats, two photos and warm indexed search (step 1 failed)
    3. NOT RUN — offline and two queued sends (step 1 failed)
    4. NOT RUN — SIGKILL at barrier; exact pre-swap state across all five stores and twin prediction (step 1 failed)
    5. NOT RUN — SIGKILL at rest; same cold state (step 1 failed)
    6. NOT RUN — persistent carrier fault reports over control (step 1 failed)
    7. NOT RUN — post-commit 503, exactly-once replay and FIFO (step 1 failed)
    8. NOT RUN — Unicode indexed prediction and expiry agree warm and held (step 1 failed)
    9. NOT RUN — Expo driver conformance and transaction rollback checks (step 1 failed)
    10. NOT RUN — persist online, relaunch and drain (step 1 failed)
<!-- /scheduled failure -->

Commits touching `snapback2/` since that green run, newest first (at most 20):

No green run of this check is recorded on this host yet.

## Requested outcome and acceptance

- Fix the regression, or the check if it is stale, and close this ticket in the commit that makes
  `cd snapback2 && node scripts/witness-expo.mjs` pass. Each scheduled run
  refreshes **Last red** at most once a day or when the failure changes, and adds **Passed again**
  once the check passes.
