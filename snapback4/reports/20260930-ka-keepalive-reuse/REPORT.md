# KA round 0 — HTTP keep-alive reuse

Date: 2026-09-30. Branch: `sb4-intent/ka-keepalive-reuse`.
Starting main: `9d03e94623` (0.4.9). Nothing pushed or published.

## Result

The real idle-close race is reproduced against the starting dev binary and
Node transport. Eight deliberately timed cohorts of 48 SDK clients lost 16 of
384 final reads (4.17%); the fixed transport lost 0/384. The permanent regression
also fails on the starting implementation and passes after the fix. A forced
5.1-second pause *after selection*, before the actual write, still produces a
socket error with the fix but its one permitted retry returns the read.

The Linux idle experiments report `UND_ERR_SOCKET: other side closed`, not
calibration #27's literal ECONNRESET. A separate real TCP-reset control against
main's transport reproduces `read ECONNRESET`, including loss of a real dev
mutation's committed reply; the fixed transport recovers it without duplicating
the mutation. The control deliberately resets a connection; it is not evidence
that calibration's reset had this cause. We do not claim to have reproduced the
exact calibration event or measured its production incidence.

## Implementation

The bounded server advertises `Connection: keep-alive` and `Keep-Alive: timeout=5`.
The value derives from `floor(min(idle_timeout, header_timeout))`, rather than a
second hard-coded server policy. HTTP/1.0 requires explicit keep-alive. Exact
comma-separated `close`/`upgrade` tokens across all Connection fields win.
Forced-close refusals advertise close and no idle hint. tiny_http prepares the
normal response and the host's coalesced JSON; heartbeat frames use the same
connection headers. The five-second server deadlines and connection caps did
not change. Held `/changes` replies still have up to 25 seconds, two-second
heartbeats, and separate per-frame write deadlines.

The pinned private Node agent caps idle retention at 1,000 ms, with a 1,000 ms
hint safety threshold and maximum. Active response timeouts retain their existing
values. Correlation uses undici's request creation/send/trailer diagnostics and
an actual Client dispatch wrapper, through pool queues; async context is not
used to associate another caller's request. Weak maps/sets retain no global
history of completed requests or sockets. There is no process-wide dispatcher
replacement, and host fetch instrumentation still runs.

The transport snapshots URL, body and headers at the original dispatch, and
gives host instrumentation a fresh header copy for each attempt. Changing a
caller's options cannot change the repeated write ID, arguments or principal.

One retry qualifies only for ECONNRESET, EPIPE or UND_ERR_SOCKET after this exact
socket completed a previous SDK response and received zero bytes for this
attempt. Redirects, aborts, fresh connections and partial headers/bodies do not
qualify. The retry owns a new non-pooling agent; graceful close drains a streaming
response. A second failure uses the unchanged SDK error conversion to E_OFFLINE.
Delivered HTTP refusals remain under their existing E_RATE_LIMIT policy.

| Request | Why eligible, or excluded |
| --- | --- |
| Materialized POST `/q/*`, `/sync` | Read/sync protocol; repeat the same JSON body |
| GET `/`, `/schema`, `/probe`, `/changes`, `/write[/id]`, `/api.ts`, `/native.wasm` | Read/status/artifact requests; no asset view consumption |
| POST `/m/*` with nonempty ID and `retry_write: true` | Same principal/op/args/ID uses the existing durable receipt; SDK durable dispatchers and exit delivery add the field |
| Ephemeral `/m/*` | IDs alone do not deduplicate. The server checks prior durable receipts first, then rejects `retry_write` before executing an ephemeral operation, including after hot adoption |
| Auth, actions, asset upload, all asset GETs, unmarked mutations | No transport retry; asset GET may consume a one-view entitlement |
| Request objects or streamed request bodies | No automatic replay of a consumed body |

The durable outbox's existing retry and settlement ownership remains unchanged.
No contract.ts, engine/storage semantics, limits or wasm code changed.

## Reproduction and measurements

Host: Linux 6.8.0-138-generic x86_64; Node 24.13.1; undici 8.8.0;
Rust 1.97.0; Bun 1.3.14. This is a shared, busy host, not an isolated latency
benchmark. Each cohort warms every client, waits 3,500 ms, then induces 1,800 ms
of synchronous CPU work. Three and a half seconds is inside both the original
four-second client lease and five-second server lease. Waiting until 4.9 seconds
without blocking sooner would already retire the client's socket.

The ordinary pre-selection pause passes even before the fix: undici 8.8 checks
idle sockets before reusing them. The detecting fixture pauses in the diagnostic
sendHeaders callback after that check selected an idle socket but before the
writer transmits. No fake fetch, synthetic error or proxy is used in this test.
The server's actual idle deadline closes the socket. A single pause exposes a
burst of queued clients to the same boundary. The fixed one-second cap normally
retires the old sockets before this point. A separate 200 ms idle / 5,100 ms pause
forces the fixed transport through its retry instead of just proving prevention.

| Experiment | Cohorts × clients | Failed final reads | Log |
| --- | --- | --- | --- |
| Main, single detecting regression | 1 × 1 | 1/1 | baseline-repro.log |
| Main, selected-socket race | 8 × 48 | 16/384 | baseline-load-8.log |
| Main, pause before selection | 8 × 48 | 0/384 | baseline-before-selection-8.log |
| Fixed, same selected-socket fixture | 8 × 48 | 0/384 | fixed-load-8.log |
| Fixed, pause after selecting a still-live socket | 1 × 1 | 0/1; one underlying socket error | fixed-forced-race.log |
| Chromium, renderer pause, fixed server | 3 × 24 | 0/72 | browser.log |
| Chromium, renderer pause, main server | 3 × 24 | 0/72 | baseline-browser.log |

These are conditioned race-exposure rates, not a forecast for arbitrary replay
traffic. Initial 48-client discovery lost 3/48 (baseline-load.log), independently
of the eight-cohort sample. Larger 256 KiB query bodies (4×16, 48/64 failed) and
an earlier 1,480 ms pause (8×16, 67/128 failed) still produced UND_ERR_SOCKET,
not ECONNRESET; their complete logs and reset-probe.mjs are retained. The
separate descheduled-server test models a stopped dev process while its kernel
read deadline expires; it also fails on baseline, passes fixed and keeps the
server alive. It did not change the observed Linux error variant.

Calibration source: `~/sb4-intent/cal27-evidence/run-log.md`, lines 157 and 160.
The log records two failed verification reads followed by a successful third
attempt with fresh clients, with the backend alive and no crash. That is
consistent with, but does not establish, an idle-reuse race.

Re-run the committed regression and stress variant from snapback4/:

```sh
node --test packages/snapback4/test/keepalive-reuse.test.mjs
KA_CLIENTS=48 KA_ROUNDS=8 node --test packages/snapback4/test/keepalive-reuse.test.mjs
KA_IDLE_MS=200 KA_BLOCK_MS=5100 node --test packages/snapback4/test/keepalive-reuse.test.mjs
```

For the retained baseline, build starting commit `9d03e94623` in an isolated
checkout and supply that binary as SNAPBACK4_BIN plus KA_BASELINE_FETCH=1.
The original transpiled node-fetch.js is retained here; source-hashes.json binds
the original binary and changed transport/server source. The report tools take
the same switches. measurements.json retains cohort failure counts.

## Browser and Expo review

Chromium 151.0.0.0 passes 72 real SDK/dev reads after blocking renderer JS across
the idle deadline. Its network service owns socket polling outside the renderer;
Chromium's [HttpNetworkTransaction::ShouldResendRequest](https://raw.githubusercontent.com/chromium/chromium/main/net/http/http_network_transaction.cc)
already recovers a reused connection when no response headers were received.
We add no blanket fetch retry. That native recovery is broader than the new
Node byte-level qualification and remains browser behavior.

The installed React Native 0.86.3 sources delegate iOS to NSURLSession
(`Libraries/Network/RCTHTTPRequestHandler.mm`) and Android to OkHttp
(`ReactAndroid/src/main/java/com/facebook/react/modules/network/OkHttpClientProvider.kt`).
React Native pins OkHttp 4.9.2 in gradle/libs.versions.toml.
Their pool maintenance runs outside application JavaScript, so the Node mechanism
of blocking both application work and pool expiry does not apply. The server's
hint is available to those HTTP stacks too. Android's
[RetryAndFollowUpInterceptor](https://raw.githubusercontent.com/square/okhttp/parent-4.9.2/okhttp/src/main/kotlin/okhttp3/internal/http/RetryAndFollowUpInterceptor.kt)
recovers eligible failures with a new route/connection. Apple's
[QA1941](https://developer.apple.com/library/archive/qa/qa1941/_index.html)
explains that NSURLSession may automatically retry idempotent requests but can
return a lost-connection error for a POST. Consequently this is not a universal
native immunity claim. React Native fetch exposes neither reused-socket identity
nor first-byte progress. Adding an SDK retry based on its opaque rejection would
also retry fresh outages and violate this lane's condition. Such errors remain
E_OFFLINE; durable outbox writes retain recovery.

No iOS/Android simulator runtime was available on this Linux host; native source
review is explicitly not simulator qualification. The fleet inventory path in
AGENTS.md was absent. The server and Node tests include serve behind a locally
trusted TLS terminator (the shipped deployment topology); certificate verification
stays enabled. tiny_http's entire suite also runs with ssl-rustls enabled.

## Validation and failure ledger

Ran scripts/test.sh exactly once, exit 0. Exact summary:

    == 0 failure(s) in 1437 s

All 13 stages pass. Rust stage: 4,363 passes and 33 existing ignores; the docs
budget stage separately reruns one guide case. Main clients: 5,330 passes and
ten existing skips. Fixtures: 9/9. Serial models: 79/79, including both full
5,000-sequence session walks. No cancellations or lowered counts/timeouts.
Full-run failures: ours 0; baseline 0; environmental 0. The inherited nominal
60-second suite budget remains exceeded.

Qualification boundary: production source and artifacts remained unchanged
throughout this full run. During it, a separate additional regression found that
mutable caller fetch options could change a retry's URL/body/credentials. After
the full run ended, Node transport snapshots those inputs and the regression
was added to the permanent retry suite. That final correction receives affected
checks, not a second full run. suite-source-hashes.json binds the full-run
transport; source-hashes.json binds the final source. The results are not an
unchanged-final-source full-suite qualification. No push/publication or expanded
calibration claim is made.

- Affected HTTP/transport suite: 65/65 pass (affected.log).
- Retry + navigation with the final durable field: 44/44 pass (retry-navigation.log).
- Overload diagnostics/policy: 109/109 pass (overload.log).
- Final whole guide: 105/105 pass (guide-final.log).
- Vendored tiny_http with ssl-rustls: 51 tests and doctests pass (vendor-tests.log).
- Chromium: 1 test, 72 timed reads, pass (browser.log).
- Header/TLS/held-poll checks: 4/4 pass within browser-headers.log; its first
  browser fixture test is a recorded failure below.
- Await classification and docs budget pass; the two transport awaits are covered
  by real reset/committed-write tests below existing delivery caller boundaries.
- After the final input-snapshot correction: 87/87 affected checks pass, covering
  the 17 retry cases, real idle regression, HTTP headers/TLS/long polls, transport
  failures, QoS and navigation (final-affected.log). SDK typecheck/build pass.
  The standalone detecting snapshot test, delivery-await classification and
  forced post-selection idle race each pass 1/1 (snapshot-after.log,
  await-boundary-final.log, final-forced-race.log).
- Final reference audit: 525 LLP docs, 9,994 refs, zero errors or unchecked
  references (ref-check-final.log). git diff --check passes.

Recorded failures and dispositions (each failed case and compiler diagnostic is
listed with its log line in [FAILURES.md](./FAILURES.md)):

1. Environmental setup: baseline-sdk-build.log failed TypeScript because the
   cold tree had no generated wasm glue. build-wasm.sh followed by SDK build
   resolves it (baseline-sdk-ready.log). No product repair for this failure.
2. Baseline: baseline-repro.log (one), baseline-load.log (one), and six failed
   test cohorts in baseline-load-8.log are the intended detecting controls.
   The large-body and boundary probes also have expected baseline failures.
3. Ours, corrected: retry-initial.log has three failures (two reused-reset
   cases and the lost committed mutation). The first implementation incorrectly
   assumed undici exported its handler symbol. The final implementation uses
   request-creation diagnostics at Client dispatch; retry-2.log passes all 15
   original tests, and retry-navigation.log passes the additional ephemeral test.
4. Ours, corrected: browser-headers.log has one failed browser fixture because
   the query in media.q is named media.keepalivePing. Corrected fixture passes
   all 72 reads in browser.log; no browser product change was needed.
5. Ours, corrected: await-boundary-initial.log has one failure for the newly
   introduced transport awaits and changed durable dispatch expression. Reviewed
   and regenerated the existing boundary record; await-boundary.log passes 1/1.
6. Ours, corrected after the full run: snapshot-before.log has one failed
   immutable-request regression. The retry used the edited URL, ID and bearer.
   The final transport captures the original inputs; final-affected.log includes
   the permanent regression and snapshot-after.log is the identical standalone
   detecting fixture.
7. Expected baseline controls: baseline-headers.log fails 2/2 (dev and serve
   missing Keep-Alive); baseline-reset-control.log fails 2/2 on real ECONNRESET;
   baseline-descheduled.log fails 1/1. Additional large-body and boundary probes
   fail 3/4 and 5/8 cohorts respectively. Each log retains the exact failures;
   these are controls against old code, not final implementation failures.
8. Ours, evidence formatting: the staged whitespace check initially flagged
   trailing spaces on runner output's blank lines and extra EOF blank lines
   (staged-whitespace-initial.log). Retained logs normalize only those spaces
   and EOF blanks; assertions, stacks, measurements and outcomes are preserved.
   The final staged check passes.

Wasm: 1,978,828 B raw / 593,225 B gzip. Unchanged budget 593,719 B;
494 B headroom. No ratchet increase. Initial build and full-suite rebuild logs
retain the measured bytes. The final source digests are in source-hashes.json; full-run
digests are in suite-source-hashes.json and counts are in full-suite.log.
