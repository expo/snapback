# Snapback 4: immutable browser fixtures can invalidate live pages

Status: Resolved (fixture mechanisms; historical M5 event remains unattributed)
Date: 2026-10-05
Scope: Snapback 4 Playwright fixtures; LLP 3000 §Publication suite under contention

The 0.4.13 Darwin publication attempt 3 reported `page.evaluate: Execution
context was destroyed, most likely because of a navigation` during the
1,000-hook per-row test. Its reported line numbers match the fixture before
NZ `7e03a5cea9` disabled HMR and watching. That suppression was already on
this lane's base. The original M5 execution has no navigation/crash trace;
its exact trigger cannot be reconstructed from the exception alone.

A controlled late `react-dom` import in the historical fixture reproduces the
same context-destruction exception 60/60 under confined Linux CPU hogs and
30/30 on the Apartment mini. Server and websocket logs show the real dependency
optimizer requesting a full reload, followed by CDP's reload navigation and
then the exception. No crash, watcher event, early close/disconnect or server
restart appears. Without the controlled late import, both the historical
configuration and current main pass 60/60 isolated target runs on each host.

HMR suppression leaves optimizer invalidation active. The shared immutable
browser-server helper now explicitly prebundles the five React entries, disables
late discovery, HMR and watching, canonicalizes Darwin allow lists and gives
each fixture its own cache. The per-row regression fails on the optimizer's
reload request if prebundling is removed, even with HMR off. Seventeen maintained
Vite fixture sites use this setup. Explicit application/test reloads remain.

A separate intermediate mini failure exposed shared optimizer-cache replacement
when TMPDIR is inside a package tree. A two-server control reproduces its 504
for an entry not yet requested by the first page; private caches pass the same
control. The failed mini invocation is retained, not retried away.

Final complete per-row qualification passes 60/60 under Linux hogs and 30/30
on Darwin, with eight subtests per invocation. All original 1,000-row,
2,000-call, revalidating and zero-loading assertions remain. Other affected
checks and the canonical suite, commands, controls and raw evidence are in the
[PW report](../../snapback4/reports/20261005-pw-per-row-navigation/REPORT.md).
No SDK/engine/wasm source change or timeout increase. A future navigation now
has direct lifecycle, server, websocket and CDP evidence; this resolution does
not assert retrospective attribution of the uninstrumented M5 event.
