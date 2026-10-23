# View-once assets: K0-Q records the view before bytes; http-bounds expects finalize-after-complete

Status: Resolved
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

## Author ruling (2026-10-23)

A view-once asset's view is consumed when a full, non-range read **starts**.
The view-once record commits before any bytes are sent, as K0-Q does today,
so the bytes are never delivered without a durable view. A ranged read or a
read the server can tell was aborted before it was admitted does not consume
the view. Update the asset LLP and the K0 note to this contract, and change
`http-bounds.test.mjs` to assert it: a full GET answers 200 and consumes the
view, a later GET answers 410 `E_ASSET_VIEWED`, and a range probe before the
full GET does not consume the view. First confirm which request in the
current test consumes the view.

## Resolution (2026-10-23, VIEW-ONCE)

The full GET that deliberately destroys its socket after receiving 200 headers
consumed the view. The range probe returned 416 `E_ASSET_RANGE` without
consumption. The following truncated-file pipelined GET therefore received
410 `E_ASSET_VIEWED`; the baseline reproduced that failure at the pipelined
response assertion, before the test reached its final complete GET.

The shared door retains K0-Q's commit-before-response ordering and now rejects
requests on a response chain the server already aborted, before admitting a
view. Refused or unknown view commits still return before any asset bytes can
be sent. A confirmed view remains consumed after transport loss or truncation.
The HTTP test uses independent fresh assets for complete delivery, abort after
headers and truncated pipelined delivery. It asserts range refusal, a complete
200 body and a subsequent 410 exactly under the author's start-time contract.

Rust HTTP witnesses run against both SQLite file and memory storage. They
prove range probes and known pre-admission cancellation leave the view
available, then hold delivery after COMMIT, observe the durable consumed view
while the socket has no response bytes, release the complete body and verify
410. The Postgres witness calls the same engine view-commit method, opens a
new connection and verifies durable duplicate refusal and per-principal state.

Postgres HTTP assets remain outside the existing public profile: LLP
3000.009.001.000 §3.4 explicitly leaves asset-schema admission, blob locations
and upload/serve wiring to P1b. The attempted HTTP witness reached that exact
`StoreUnsupported { family: "assets" }` fence. The PG witness is ledger coverage,
not a claim of public Postgres asset delivery.

The asset RFC (LLP 1006's Snapback 4 timing overlay), LLP 3000 §7, the
committer RFC's K0-Q note and the assets guide now state the same contract.
Qualification results and process cleanup are recorded in `snapback4/JOURNAL.md`.
