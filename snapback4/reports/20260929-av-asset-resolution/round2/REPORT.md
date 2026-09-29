# Lane AV — asset resolution, round 2

2026-09-29; branch `sb4-intent/av-asset-resolution`. First command fetched and
merged origin/main: already up to date. Starting HEAD
`99427c205` (round 1). Nothing pushed or published.

Read all three lane prompts, both prior reports, Astra's complete NOT READY
review and Grok's available notes at the start. Governing context and the
skill-location fallback are in context.md. Final review check is recorded below.

## Review fixes and detecting evidence

1. **Progress-sensitive stalls.** Streaming response bytes renew both the
   five-second attempt inactivity timer and the thirty-second inactivity timer
   that includes queue/backoff. A healthy video can take arbitrarily longer
   while delivering bytes. Four attempts, ten seconds backoff and six active
   bodies remain the bounds. Empty chunks do not count as progress. The stream
   reader cancels incomplete bodies and releases its lock. A real loopback HTTP
   video delivering a byte every 500 ms completes at six seconds with exact
   bytes/type and one request. Deterministic ordinary and one-view 36-second
   streams cross both
   former deadlines; a subsequent ordinary body stall still retries and completes.
2. **Headers precede refusal bodies.** Capture Retry-After as an absolute
   deadline when headers arrive. A stalled/erroring/invalid JSON body preserves
   HTTP status and the minimum. Without a valid refusal it is E_HTTP_RESPONSE,
   not a fabricated E_RATE_LIMIT. Valid E_RATE_LIMIT retains its meaning. Both
   delta-seconds and HTTP-date regressions show no premature second request,
   exact recovery metadata and cancellation of the stalled stream.
3. **Credential rotation retains cooldown custody.** Return the same
   rate-limit refusal rather than recursing into a fresh transfer budget.
   A held old-bearer request returns Retry-After after rotation; no request uses
   the new bearer until subsequent permitted recovery. Authentication refusal
   handling otherwise stays unchanged.
4. **Detecting hook cooldown regression.** The hook receives a real
   createClient.asset E_RATE_LIMIT outcome. The test fires focus and link
   offline→online before the deadline and requires one total request and the
   same error state. It advances Date.now to the deadline and separately proves
   focus, reconnect and deferred timer recovery each reach ready. An unmount
   branch requires cancellation of its pending timer. It restores the clock
   and closes
   both hook/transport. Replacing the hook's deadline predicate with true fails
   specifically at “focus before Retry-After cannot send: 2”. The mutation was
   repeated against the final hook in an isolated source copy with the same
   detecting result (mutant-cooldown-final.log.gz).

The first three defects fail the new tests on round-1 source (five red tests in
before.log.gz). The fourth fails the targeted mutation (mutant-cooldown.log.gz).
No test bound, server cap, authorization rule, view consumption rule or wasm
ceiling changed. Existing once/revocation and full/partial retention tests remain.

Native buffered fetches expose no intermediate byte progress; their opaque
fetch/Blob waits still have the five-second bound. The guide and manual state
this limitation, and native image/video views can use host-managed assetSource.
This round does not claim a native progress API or qualify a new native host.
The response body reader applies only when a readable stream exists.

LLP 3000.008.002.000 §6 and the assets/media card/client manual now describe
inactivity and preserved cooldowns. The await census was reviewed: three additional
asset-download awaits are stream/body consumption, outside delivery receipt
custody. Only that module's boundary fingerprint changes; no delivery fault
site or recipe was removed.

Calibration d-02 attribution remains as in round 1: its likely transient-failure
mechanism reproduces independently; the original grader's actual transport
cause is unproven. The valid author-profile avatar recipe is unchanged.

## Grok's completed review

Grok completed NOT READY while the single full run was in its Rust phase.
Its full input is input-grok-final.md (progress-only start copy also retained).
The shared slow-body finding is fixed above, including a 36-second progressing
one-view body with exactly one Range probe and one non-range transfer.

The additional local-client finding reproduced on real process and wasm:
34 avatar requests queued behind six held transfers all returned synthetic
E_AUTH after token rotation, despite the new session remaining live. Local
asset now handles an obsolete refusal before media invalidation. Only E_AUTH
that can safely retry crosses to current credentials; admission refusal objects
and ambiguous once failures retain their original outcomes. Obsolete success
still revokes its handle and never consumes another view. Both devices now
return 34/34 ready using only the new bearer; the pre-existing receipt-confirmed
cached avatar and live URL remain usable. No server authority was broadened.

The hook now remembers one recovery event received while busy, and coalesces
early recovery events into one timer at Retry-After. It clears the timer when
loading starts or the effect ends. A failed recovery does not loop. Tests fail
before the fix for both lost events, require deferred readiness without another
focus/reconnect, and require timer cancellation on unmount.

Grok's surviving bare-status mutation now fails six explicit recovery tests
(408/429/500/502/503/504). Its documentation correction is included: the asset
state has `why` when status is denied/error. The guide no longer describes
`denied.why` or `error.why` as object properties.

A further rotation-at-backoff-boundary test detected that returning synthetic
E_AUTH after the pause could still reset the transfer budget. The downloader
now preserves its previous refusal and absolute deadline at that boundary.

## Verification

The single `scripts/test.sh` run exited **1**, with the exact summary:

```text
== 1 failure(s) in 1324 s
   client tests
```

Rust: **4,311 passed / 0 failed / 33 ignored**. Clients: **4,612 passed /
1 failed / 10 skipped / 0 cancelled**. Final models: **79/79**; fixture wrapper:
**9/9**. Every other stage passed. Its one failure is **ours**, described below;
none is baseline or environmental. No second full run or green full-suite claim
is made after its fixture correction. The inherited 60-second target remains
exceeded; no ceiling or test timeout changed.

Independent affected checks (overlapping groups, do not add the counts):

- Final React: **57 passed**, zero failures (react-final-2.log.gz).
- Download/online-session regressions: **41 passed** (retry-final.log.gz);
  the final ordinary/one-view 36-second stream test and await classification
  additionally pass **2/2** (final-boundaries.log.gz).
- Final session/terminal/avatar group: **32 passed** (grok-lifecycle-final.log.gz).
- Process/wasm rotation plus boundary checks: **4 passed** (rotation-final-2.log.gz);
  explicitly confirmed retained-byte setup: **3 passed** (rotation-retention-final.log.gz).
- Avatar/retry pressure/list/Blob/session-terminal lifecycle group: 104 passed,
  zero failures (lifecycle.log.gz), covering online, process and wasm.
- Final whole guide: 98 passed, zero failures (guide-grok-final.log.gz).
- Await boundary classification: 1 passed (await-classification.log.gz).
- Complete overload/admission file: **109 passed**, zero failures
  (overload-final.log.gz), including the corrected exact-jitter fixtures.
- Controlled 500-ms body decoding / 500-ms remaining minimum: **1 passed**
  (elapsed-body-final.log.gz).
- Package build/typecheck and ref-check pass: **523 LLP docs, 9,861 refs in
  29,021 files; 0 errors, 0 unchecked** (ref-check-final-2.log.gz).

The full run has one client failure, ours: the existing web asset-jitter
fixture assumed no body time while sampling only waits >=1,000 ms. With
Retry-After captured at headers, a one-ms decode can validly leave 999 ms; the
fixture then omits one of four samples. Both exact-jitter fixtures now hold
Date.now fixed for that zero-decoding-time calculation, retaining every exact
assertion and timeout. The separate stalled-body tests exercise real elapsed
time. The whole overload file passes **109/109** after this fixture correction.
The added elapsed-body test independently requires the second request at the
original one-second minimum after a 500-ms decode, proving the shorter wait
does not mean an early request.

Every red execution and its attribution is in FAILURES.md. Logs are compressed
with deterministic gzip after completion. No full-suite result is inferred from
focused results; scripts/test.sh runs exactly once. Grok's later changes and
the jitter fixture correction received the additional affected checks above.
The guide was rerun after the final prose changes; the new retained-byte
precondition and elapsed-body case were also verified separately.

Canonical wasm rebuilt by that suite: 2,040,529 B raw / 592,975 B gzip-9,
744 B below the unchanged 593,719 B cap. SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
See wasm.json and the wasm build stage in test-sh.log.gz.

Commands from snapback4/ on Node v24.13.1:

```sh
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/asset-retry.test.mjs packages/snapback4/test/online-session.test.mjs packages/snapback4/test/react.test.mjs
node --test packages/snapback4/test/react.test.mjs
node --test packages/snapback4/test/asset-avatars.test.mjs packages/snapback4/test/asset-pressure.test.mjs packages/snapback4/test/asset-lists.test.mjs packages/snapback4/test/asset-blob-lifecycle.test.mjs packages/snapback4/test/online-terminal-entrypoints.test.mjs
node --test --test-name-pattern='every delivery await' packages/snapback4/test/delivery-fault-matrix.test.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-lang --test guide
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh
```

Both complete reviews are addressed; final input hashes/recheck are recorded
in review-checks.json. Source hashes and the suite's exit/counts accompany the
report. The change is committed locally with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Nothing pushed or published.
