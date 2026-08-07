# Guide gap: browser auth custody never shows the IndexedDB adapter vs the volatile memory adapter

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Guide, Auth, JS client, Contract, IndexedDB
**Date:** 2026-08-06
**Governing:** LLP 0059, LLP 0061

## Problem

The sessions/headless guide pages say browser sessions use durable
`AuthCoordinator` custody, but they never show constructing the shipped
`createIndexedDbAuthCustodyStorage()` adapter exported by
`@expo/snapback-contract`, and they do not distinguish it from the volatile
`createMemoryAuthCustodyStorage` adapter used by many tests and demos.

The zerobugs control run (Lane 6b) hit this as a real defect: the control's
browser boot injected memory custody, `authExchange` advanced only a
document-lifetime custody record, and a full-page navigation truthfully
handshook as anonymous — memory custody looks like it works until a real
navigation reconstructs the page. The fix was injecting the shipped
`createIndexedDbAuthCustodyStorage()` adapter (LLP 0059 custody record in
IndexedDB, Web Locks where present, transactionally fenced lease fallback).
See `demos/zerobugs/control/PLAN.md` lines 1340–1387 (the reload-custody bug
and fix) and the deferred guide-gap list at lines 1389–1417, item 3 (lines
1405–1412).

File-drop is especially easy to overread here: its browser acceptance proves
relay/exchange/assets, but its source uses memory custody and has no reload
witness (`PLAN.md` lines 1367–1371), so it must not be borrowed as a
reload-persistence example.

## Resolution

Teach in the sessions (and/or headless) guide page:

- the carrier choice: shipped `createIndexedDbAuthCustodyStorage()` from
  `@expo/snapback-contract` for durable browser custody vs the volatile
  memory adapter appropriate only for tests/document-lifetime flows;
- an explicit warning that memory custody survives SPA route changes but not
  full-page navigation/reload, so a full-page restoration check is the
  witness that distinguishes them; and
- a snippet constructing the adapter and wiring it into the client/coordinator
  boot, per the zerobugs control's corrected `src/data/snapback.ts` pattern.

Filed from Lane A1 on behalf of the zerobugs Lane 6b run, which was
directory-scoped to `demos/zerobugs/control/` and deferred this
out-of-directory artifact rather than silently widening scope.
