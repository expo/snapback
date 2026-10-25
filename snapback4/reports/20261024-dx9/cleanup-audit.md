# DX9 client teardown audit

AST census of all packages/snapback4/test/*.mjs files and initial lexical scan
of packages/*/test/**/*.mjs. The AST census groups t.after calls by their owning
function and finds a removal callback registered before a later close/stop/kill.
All 18 initial directly matched files now use the shared teardown stack. The two
reported cross-helper cases, social-starter and acquisition, use the same stack.
The retained-history fixture already closes clients, stops/reaps its server,
and removes scratch in one nested finally hook; it was inspected unchanged.

The helper registers one node:test hook, executes callbacks in reverse acquisition
order, attempts later cleanup after an exception and reports AggregateError.
The injected-close/removal-failure regression verifies that kill and reap run
before removal. Existing test assertions and case counts are retained.

Repaired direct-census files:

- `app-storage.test.mjs`
- `following-hook-react.test.mjs`
- `online-journal-browser.test.mjs`
- `proof-contract.test.mjs`
- `proof-fixtures.test.mjs`
- `replacement-fixture.test.mjs`
- `server-clock-wire.test.mjs`
- `subscription-pressure-e2e.test.mjs`
- `upload-browser.test.mjs`
- `upload-hooks.test.mjs`
- `upload-intents.test.mjs`
- `wave9-dx.test.mjs`
- `web-admission-review.test.mjs`
- `web-receipt-upgrade.test.mjs`
- `web-review.test.mjs`
- `web-session-authority.test.mjs`
- `web-start.test.mjs`
- `worker-regressions.test.mjs`

This static census does not prove arbitrary dynamic helper lifetimes. Helpers
with removal in a finally after awaited host/browser shutdown were not mechanically
rewritten. The 75-file initial lexical list overapproximated separate test scopes
and scratch unrelated to a server's writable store. Scoped file runs are recorded
in WORKSTREAM-REPORT.md; Mac runs were explicitly skipped.

A second AST pass over every client package found seven combined-hook files:
social-browser, horizon-boundary, device-residency, presence-live,
presence-composed, repair-b and worker. They now use the stack too, splitting
client/browser shutdown from writer shutdown/removal where a close could throw.
The shared app-server helper also joins that stack. Retained-history was
confirmed to use nested finally; its lexical match is safe. All 163 tests in
the additional seven files pass. The subscription-pressure driver shutdown
is registered after browser acquisition so it drains its pages before browser
close; the scoped run caught and corrected that ordering dependency.
