# Snapback 2 scheduled check `expo` is red

**Status:** Open
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback 2 scheduled checks (`snapback2/scripts/scheduled.mjs`), the Expo chat starter on the iOS simulator (`scripts/witness-expo.mjs`)
**Scheduled check:** `expo`
**Host:** Charlies-MacBook-Pro-M5Max-Black
**First red:** `f2dc1bdee72d0ca3da5c990eb6c07366ceda7b4f` (2026-09-11)
**Last red:** `f2dc1bdee72d0ca3da5c990eb6c07366ceda7b4f` (2026-09-11)
**Last green before it:** none recorded on this host

## Evidence and impact

<!-- scheduled failure -->
`cd snapback2 && node scripts/witness-expo.mjs` exited 1 at `f2dc1bdee` on Charlies-MacBook-Pro-M5Max-Black; the full output is in `/Users/ccheever/.snapback2-scheduled/logs/expo.log` there.

    AssertionError [ERR_ASSERTION]: {"loaded":false,"nativeError":"The file “Snapback Chat” couldn’t be opened.","viewed":false,"files":[]}
    
    false !== true
    
    2. MEDIA FAIL — warm image 2/3
    AssertionError [ERR_ASSERTION]: {"loaded":false,"nativeError":"The file “Snapback Chat” couldn’t be opened.","viewed":false,"files":[]}
    
    false !== true
    
    2. MEDIA FAIL — warm container custody
    AssertionError [ERR_ASSERTION]: view-once asset s2id-9665317c1e134556aeef396e7da0582a-0000000000002401 bytes on disk: /Users/ccheever/Library/Developer/CoreSimulator/Devices/4453C3E4-C3B2-4D3F-A961-21E7AAB88780/data/Containers/Data/Applicat…
    2. FAIL — login, inbox drain, three chats, two photos and warm indexed search — {"opened":["conversation-1","conversation-2","s2id-9665317c1e134556aeef396e7da0582a-0000000000000001"],"neverOpened":"s2id-9665317c1e134556aeef396e7da0582a-0000…
    3. PASS — offline and two queued sends — [{"state":"queued","intent":"s2id-9665317c1e134556aeef396e7da0582a-0000000000003401:1","ids":["s2id-9665317c1e134556aeef396e7da0582a-0000000000003402","s2id-9665317c1e134556aeef396e7da0582a-000000000…
    4. MEDIA FAIL — cold ordinary image
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    
    false !== true
    
    4. MEDIA FAIL — cold container custody
    AssertionError [ERR_ASSERTION]: view-once asset s2id-9665317c1e134556aeef396e7da0582a-0000000000002401 bytes on disk: /Users/ccheever/Library/Developer/CoreSimulator/Devices/4453C3E4-C3B2-4D3F-A961-21E7AAB88780/data/Containers/Data/Applicat…
    4. FAIL — SIGKILL at barrier; exact pre-swap state across all five stores and twin prediction — {"stores":{"state":1,"metadata":191,"rows":32,"answers":10,"outbox":4,"bytes":3},"searchProbe":{"runtime":{"typedArrayFromSet":[]},"postings":{"…
    5. MEDIA FAIL — cold ordinary image
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    
    false !== true
    
    5. MEDIA FAIL — cold container custody
    AssertionError [ERR_ASSERTION]: view-once asset s2id-9665317c1e134556aeef396e7da0582a-0000000000002401 bytes on disk: /Users/ccheever/Library/Developer/CoreSimulator/Devices/4453C3E4-C3B2-4D3F-A961-21E7AAB88780/data/Containers/Data/Applicat…
    5. FAIL — SIGKILL at rest; same cold state — [{"name":"cold ordinary image","error":"AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\nfalse !== true\n"},{"name":"cold view-once image","result":{"loaded":false,"native…
    6. PASS — persistent carrier fault reports over control — "E_OFFLINE_CARRIER over live control; recovery passed"
    7. PASS — post-commit 503, exactly-once replay and FIFO — {"intents":[{"intent":"s2id-9665317c1e134556aeef396e7da0582a-0000000000003401:1","id":"s2id-9665317c1e134556aeef396e7da0582a-0000000000003402","state":"committed"},{"intent":"s2id-96…
    8. PASS — Unicode indexed prediction and expiry agree warm and held — {"removed":"s2id-9665317c1e134556aeef396e7da0582a-0000000000001801","preserved":"s2id-9665317c1e134556aeef396e7da0582a-0000000000003402","search":"held"}
    9. PASS — Expo driver conformance and transaction rollback checks — {"journalMode":"wal","checks":["journal_mode readback","BLOB 1","BLOB 1048576","BLOB 0","JSON tuple key round trip","missing row is undefined","rollback on throw","real COM…
    10. PASS — persist online, relaunch and drain — {"queueDrained":true}
<!-- /scheduled failure -->

Commits touching `snapback2/` since that green run, newest first (at most 20):

No green run of this check is recorded on this host yet.

## Requested outcome and acceptance

- Fix the regression, or the check if it is stale, and close this ticket in the commit that makes
  `cd snapback2 && node scripts/witness-expo.mjs` pass. Each scheduled run
  refreshes **Last red** at most once a day or when the failure changes, and adds **Passed again**
  once the check passes.
