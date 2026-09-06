I'll start by loading the review and LLP orientation skills, then inspect the immutable Snapback2 delta, exact source, and governing LLPs without touching other-family artifacts.This is a local independent review of a frozen commit, not the GitHub review skill. I'll orient on the workspace, the patch, and the governing LLPs next.I'll read the patch and locate SSE-related source and LLPs, staying inside this capsule.The patch continues past the first hunks. I'll read the rest and the full SSE, live, and client paths.**READY**

Independent grok xhigh static review of `1957b95910044ffbb0292ad8a814da303a34dbdc` against `62fa434d8`. Tests in this capsule were **not executed** (`node_modules` and `dist/` are absent). Native device acceptance is **not** inferred from the new unit tests.

---

## Provenance

- **Family:** grok
- **Runtime:** grok-4.6 xhigh
- **Date:** 2026-09-06
- **Method:** static review of `revision.patch`, exact source under `snapback2/`, and governing LLPs 1002 §4 and 1013 §2 decision 6
- **Blindness:** no other-family reviews, product-fix reports, parent plans, builder diaries, or scores
- **Edits / network / publishing:** none

---

## Overall assessment

The production defect is real and the delta matches it. Frozen Expo 54 / RN 0.81.5 keeps `whatwg-fetch` 3.6.20 as the global `Response`. That constructor accepts a `ReadableStream` but does not expose `body`; it stringifies the stream into `_bodyText` (`"[object ReadableStream]"`). `SharedSse` was reconstructing each demultiplexed child with `new Response(body)`, so `parseSse` hit `if (!response.body)` and the client published `E_NETWORK: SSE response has no body` even when `createExpoClient` used streaming `expo/fetch` for the physical `POST /api/live` (LLP 1013 §2 decision 6; LLP 1002 §4 native-logical-streams note).

The fix stops treating logical children as HTTP `Response` objects. A child is now `{ ok:# Independent review: Snapback2 native SSE logical-body fix

**Revision:** `1957b95910044ffbb0292ad8a814da303a34dbdc` against `62fa434d8`  
**Family / runtime:** grok-4.6 @ xhigh  
**Date:** 2026-09-06  
**Method:** static review of `revision.patch`, exact source under `snapback2/`, and governing LLPs 1002 and 1013. No other-family reviews, product-fix reports, parent plans, builder diaries, or scores. No network, no edits, no publishing.  
**Executed tests:** none. This capsule has no `node_modules` and is not a git worktree, so the new regressions were not run. Claims below are from reading the delta and tracing call sites, not from a test process.

## Verdict

**READY**

No unresolved production-correctness, same-class boundary, multiplexing, refusal, HTTP-status, cancellation, cleanup, or public-API defect in this delta. Residual device qualification is already named in LLP 1002 and is outside this small source fix.

## What the delta does

Published 0.0.6 multiplexed live children by reconstructing a `Response` around a locally created `ReadableStream`. On frozen Expo 54 / RN 0.81.5, that constructor is `whatwg-fetch` 3.6.20: it stores the init, stringifies a stream to `"[object ReadableStream]"`, and never exposes `body`. `parseSse` then throws `SSE response has no body`, which `Client.stream` wraps as retryable `E_NETWORK`. Physical `expo/fetch` can still stream; the child wrap was a second, incompatible `Response`.

The fix stops wrapping. A child is `{ ok: true, body }` and `parseSse` / `ReconnectingSse` take a structural `{ ok, body }` instead of `Response`. Physical `/api/live` still uses the real fetch result and still checks `response.ok` before parse.

## Production trace

**Failing 0.0.6 path (native `createExpoClient`):**

1. `createExpoClient` supplies `expo/fetch` (`snapback2/packages/snapback2/src/expo/index.ts:40-43`; LLP 1013 §2 decision 6).
2. `SharedSse.read` POSTs `/api/live` and parses that physical body (`live.ts:117-132`). This layer can work.
3. After `data: {"session":...}`, `open` used to do `new Response(body, { headers: { "Content-Type": "text/event-stream" } })`.
4. `ReconnectingSse` called `parseSse` on that object (`sse.ts:176-178` → `sse-parser.ts:13-14`).
5. Global `Response` has no readable `body` → `Error("SSE response has no body")` → `E_NETWORK` (`client.ts:949-954`) → reconnect loop, no query/channel deliveries.

**Fixed path:** `live.ts:81` assigns `response = { ok: true, body }` where `body` is the stream created at `live.ts:64-77`. `parseSse` calls `body.getReader()` on that stream. The whatwg-fetch constructor is no longer on the live child path.

Same-class search of production `new Response(`: the only streaming reconstruction was this child wrap. Remaining production `new Response` uses string/bytes (`client-upload.ts` XHR text; test harness JSON), not SSE.

## Requested axes

### Query / channel multiplexing

Unchanged. One physical POST `/api/live`, control `add`/`remove` by child id, independent `ReadableStream` per `open()` (`live.ts:34-83`, `194-204`). Query vs channel still splits on path prefix for coalesce vs overflow (`live.ts:162-169`). New tests subscribe to `api.messages.thread` and `api.typing` on one live connection and assert a single `/api/live` request (`client-regressions.test.ts:89-126`).

### Refusal parsing

Unchanged. Demux still writes `data: ${JSON.stringify(frame.data)}` (`live.ts:156-161`). Query refusals go through `wireSubscription`, which forces `live: false` (`client-wire.ts:181-186`); channel refusals through `wireChannelDelivery` (`client-wire.ts:190-195`). `ReconnectingSse.terminal` still stops that child only (`sse.ts:205-208`; `client.ts:464-466`, `576-578`). Terminal session frames on a removed id still call `connection.terminal` (`live.ts:136-139` → `expireSession` at `client.ts:931`). The second new test sends `E_AUTH_SESSION` on a closed query id and asserts token/custody clear without delivering more query events (`client-regressions.test.ts:154-161`).

### HTTP status

Physical and logical remain split, as LLP 1002 now states.

- Physical `/api/live` and `/api/live/control`: real fetch `Response`. `!ok` → `responseRefusal` (`live.ts:121-124`, `211`), which uses `response.json()` and `response.status` (`client-wire.ts:278-297`).
- Logical children: always `{ ok: true, body }` (`live.ts:81`). That matches the old `new Response(stream)` default (status 200, `ok === true`). HTTP status never belonged on a demuxed child.

`ReconnectingSse` still does `if (!response.ok) throw response` (`sse.ts:177`). For `SharedSse` children this branch is dead, as it was when children were synthetic 200 Responses. HTTP failures reject `open()` with `SnapbackRefusal` instead of resolving `!ok`.

### Cancellation and cleanup

Unchanged control flow, now on the raw child stream:

- Child abort/cancel → `remove()` (`live.ts:53-62`, `76`) → control `remove`, physical socket stays up.
- `Client.close` / `closeTransports` → `SharedSse.close` (`live.ts:86-104`; `client.ts:1372-1376`) → abort physical, `close: true` if a session exists, cancel the physical body.

`parseSse` still cancels the reader on abort and `releaseLock()` (`sse-parser.ts:42-73`). The new tests assert `cancelled === 1`, `!body.locked`, physical `signal.aborted`, and a `close` control after `value.close()` (`client-regressions.test.ts:123-125`, `163-165`). Closing one query leaves the channel live (`client-regressions.test.ts:145-155`).

### Native vs web

- **Native `createExpoClient`:** physical `expo/fetch` (has `body`) + logical `{ ok, body }`. This is the 0.0.6 hole.
- **Web / Node `createClient`:** physical host `Response.body` still parsed in `read()`; logical children no longer go through `new Response`, so web does not depend on constructor teeing. `parseSse` only needs `getReader()`.
- **Native `createClient()` without `expo/fetch`:** physical `/api/live` still uses whatwg-fetch and still cannot stream. Pre-existing; LLP 1013 already requires `createExpoClient`. Not this bug and not this fix.

### Public API compatibility

`ReconnectingSse` / `parseSse` / `SseResponse` are not package exports (`package.json` `exports` has `./client`, `./expo`, etc., not `./sse`). `CreateClientOptions.fetch` is still `typeof fetch` and still returns a host `Response` for real HTTP. User fetch is not given logical children. Invocation contract in LLP 1002 §9 is preserved.

## Coverage (static; tests not executed)

The new regressions are the right analog for this delta, not a device witness.

`nativeLive` (`client-regressions.test.ts:28-81`):

- Loads `whatwg-fetch` via `react-native/package.json` (devDependency `react-native@0.81.5`).
- Probes the constructor: `ok === true`, `"body" in probe === false`, `_bodyInit` is the stream, `_bodyText === "[object ReadableStream]"` — that is 3.6.20 `Body._initBody`’s non-blob/non-string fallback `String(bodyInit)`.
- Replaces `globalThis.Response` with that constructor.
- Keeps Node’s `Response` as `StreamingResponse` for the fetch fixture, standing in for Expo `FetchResponse.body`.

Without the source change, `new Response(childStream)` would use the swapped constructor and the tests would fail on `SSE response has no body`. With the change, SharedSse never touches the global constructor.

Covered by the new tests: constructor probe; query+channel multiplex; independent `E_RULE` terminals; peer survival; in-flight `E_AUTH_SESSION` on a removed child; one physical live socket; cancel/close/lock.

Not in the new tests, and not required of this delta: HTTP 4xx/5xx on `/api/live` or `/api/live/control` (still `responseRefusal` on the physical object); channel overflow; `Last-Event-ID`; heartbeats; idle 30s. Those paths are unaltered and already exercised on Node `Response` in `client.test.ts` / `live-fixture.ts`. Hermes-expo (`tests/hermes-expo.ts`) still subclasses Node `Response` (streaming) and would not have caught this bug; the new tests exist because of that.

LLP 1002:430-440 is accurate: these tests do not qualify a device; recorded native M6 stays **FAILED** until rerun. Unit success would not be native acceptance.

## Strengths

- Fixes the actual constructor boundary: logical children were never HTTP responses; forcing them through `Response` was the native failure mode.
- Physical HTTP validation, demux framing, terminal-session evidence, and cancel/close are not rewritten.
- Same-class check is complete for production streaming `Response` reconstruction.
- Regression pins RN’s real `whatwg-fetch` constructor and keeps a streaming fetch stand-in, which is the 0.0.6 split.
- LLP 1002 records the 0.0.6 symptom, the structural child, and the non-claim on device qualification.

## Non-blocking notes (not CHANGES_REQUIRED)

- `sse.ts:177` `throw response` on `!ok` still throws a non-`Error`. Dead for SharedSse children (`ok: true`). If a future `open()` returned `{ ok: false, body: null }`, `subscriptionError` would stringify `[object Object]`. Same class as the old `throw Response`. No current caller hits it.
- `nativeLive` mutates `globalThis.Response` for the test (`client-regressions.test.ts:63-65`). Node 24’s test runner isolates files by process; `context.after` restores within the file. Do not treat that as production risk.
- This review did not run `packages/snapback2` tests (no install in the capsule).

## Recommended next step

Land as-is. Treat native M6 as a separate acceptance rerun, as LLP 1002 already requires.
