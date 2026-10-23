# View-once assets: K0-Q records the view before bytes; http-bounds expects finalize-after-complete

Status: Open
Date: 2026-10-23
Scope: Snapback 4 serving assets (`serve` asset door, `assets.rs`); `packages/snapback4/test/http-bounds.test.mjs`
Severity: P2 (red package test on main since K0-Q)

`http-bounds.test.mjs` "one-view assets finalize only after a complete non-range
response" (~137–185) expects the first full GET of a view-once asset to answer
200 with `Content-Length: 8388608`, and only a later GET to answer 410
`E_ASSET_VIEWED`. Since the K0-Q fix rounds (landed 901a362705 / 46c6cdd056),
the view-once record is committed **before** any bytes are sent (`assets.rs`
~219–227), so that a refused or unknown commit never sends the bytes. The K0
note accepts "one lost view" when a committed record's response is lost. The
SDK-UNK baseline run (2026-10-23) shows the test receiving 410 where it expects
200, at both `06a9d2c47f` and the SDK branch tip, so the failure predates
SDK-UNK and is on main.

The two contracts conflict. One: finalize only after a complete non-range
response, so an aborted or ranged read does not consume the view. Two:
commit before bytes, so the bytes are never sent without a durable view.
Decide which governs, update the asset LLP and the K0 note to match, and
then either change the door or update the test. The lead leans to commit
before bytes, with ranged/aborted reads not consuming the view, if the door
can tell a non-range full read before committing. Confirm first which
request in the test consumed the view (the pipelined pair, the range probe,
or the aborted read).

Raw baseline evidence: the SDK-UNK baseline report on expo-build-450a,
`/tmp/sdkbase-report-tsk5f0fc/REPORT.md` (not in git).
