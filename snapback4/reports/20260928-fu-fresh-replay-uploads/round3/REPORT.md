# FU round 3 — retain unknown rotation outcomes

The three Astra findings are repaired. The refresh audit also fences repeated
explicit refresh calls and clock-driven scheduling in both tiers. Grok's
in-progress probe-loop observation reproduced and is repaired. Product changes
remain in three SDK files; no server, core, contract, capacity or wasm change.

Read the three lane prompts, prior reports/journal entries, and Astra's complete
NOT READY review. Grok contained progress notes at entry and was checked again
before finishing; its retained snapshot is `grok-review.md`. No completed Grok
verdict was available at the final check. This report does not assign it one.

Fetched origin: main advanced from `8861dd636` to `9ef49d43c` with unrelated PF
work. No merge was needed for the SDK fixes. The branch remains based on round 2
`7c94f7126`; the supervisor owns integration and its round-2 landing suite.
Nothing was pushed or published. `scripts/test.sh` was **not run** in round 3.

## Fixes and public evidence

- **Startup rotation:** retain its `SignIn` outcome. All refresh schedulers
  consult that outcome, including the local constructor, end of deferred
  startup and clock subscriptions. A nonretryable refusal stops scheduling;
  retryable `E_AUTH` now takes the same policy as other proven refusals instead
  of unconditionally deleting the session at construction. Ambiguous reset,
  body failure and `E_HTTP_RESPONSE` stop automatic retries. Repeated public
  `client.refreshSession()` calls return the original unknown failure without
  sending that bearer again. A new sign-in obtains a new bearer.
- **Ephemeral decoding:** use `readResponse()`; plain text, null, malformed
  refusal and invalid success envelopes return status-bearing
  `E_HTTP_RESPONSE`. Link and ordered waiting calls survive. Fetch/body loss
  still returns `E_OFFLINE`, retains the cause and drops waiting calls. No
  dispatched ephemeral call is replayed.
- **Jitter strength:** concurrent public uploads, downloads, queries and
  same-ID mutations in both tiers use four mocked random values. First waits
  are distinct **1000 / 1062.5 / 1125 / 1187.5 ms**, all at least the advertised
  second. Replacing jitter with constant `delay * 1.125` fails all eight cases.
- **Grok's provisional probe observation:** a previously acquired local client
  loses its change feed, receives probe overload, becomes reachable but still
  lacks verified identity. Its recovery loop formerly sent probes without a
  delay (the public control records 16 probes roughly 0–2 ms apart). A received
  overload now takes `pauseRefusal()` before returning to that loop. Reachability
  still proves neither identity nor acquisition. The new wait is explicitly
  classified and exercised by transient and persistent delivery faults.

Construction tests use `createLocalClient()`, public `createApp()` deferred
startup, and `createClient()`. They prime a real wasm device against a real
server, save a near-expiry bearer, then let that server consume it and answer
200 before discarding the reply. Schema, sync and probe return admission
refusals, allowing saved-state startup. No refresh timer survives; a public
query carrying a changed server clock cannot re-arm it, and repeated explicit
refreshes also send nothing. The only server refresh status is **200**, never a
subsequent 401. Proven overload and retryable-auth controls retain the 60-second
retry and adopt the successful successor when that timer fires.

Disposable negative controls under `target/fu-r3-controls/` restore the three
round-2 modules or replace the shared jitter function; no source mutation is
applied to the working SDK. See `negative-controls.mjs`, `negative-controls.json`
and their logs. Final round-2 controls fail **22** public cases; constant jitter
fails **8/8**. These are expected failures demonstrating regression strength.

## Refresh audit

An unknown result means the server may have consumed the bearer, including a
fetch reset, failed body read or malformed HTTP response. The retained outcome
belongs to the client instance. Successful rotation adopts the successor before
future rotation; storage failure after successful rotation never reuses its
known consumed predecessor.

| Path | Rotation owner and handling of an unknown result |
| --- | --- |
| Direct local constructor | The one pre-schema `rotateSession()` stores `refreshOutcome`. Saved-state startup may finish, but final scheduling consults that result and cannot retry the bearer. Principal and terminal-auth checks remain. |
| Online constructor | Its start callback calls `refreshCurrent()` once when due. That function records the outcome before scheduling; unknown results prevent timers and subsequent explicit calls. |
| Deferred startup (`createApp`, both tiers) | `prepareClient()` defers automatic work until account commit. Local `start()` uses `refreshCurrent()`; its final `scheduleRefresh()` cannot override failure. Online deferred start shares its ordinary start callback. |
| Scheduled refresh | Timer expiry calls the same coalesced `refreshCurrent()`. An explicit retryable refusal can arm the existing 60-second retry; an unknown result clears any timer and stops it. The timer's catch/reschedule path passes through the same guard. |
| Clock update | Both clock subscriptions call the guarded scheduler. Clock corrections cannot make an unknown predecessor reusable. |
| Public `client.refreshSession()` and app facade | Concurrent calls share the in-flight promise. After an unknown result, repeated calls return that same failure without dispatch. Closed, signed-out and store-replaced clients retain their lifecycle refusals. |
| On HTTP 401 / `E_AUTH` | There is **no automatic refresh-on-401 path**. Online `obsoleteRefusal()` and local `refusedSession()`/`postForCaller()` wait for an already-owned rotation or retry an ordinary request only when credentials changed. A current terminal auth refusal signs out; none starts another `/auth/refresh`. |
| Account switch / sign-in | Login/signup/guest issue a new session with one request. `createApp.open()` prepares it, commits ownership, retires the previous scope, then starts the new client. Old clients are fenced/closed; late successful rotations enter existing successor-revocation custody. An ambiguous old rotation does not start a second rotation. A failed switch retains the previous client and its remembered outcome. |
| Sign-out, close, logout-all | No new rotation. App logout-all waits for an already-owned one (`waitForRotation`) to choose its credential. Best-effort logout of a known token/successor is a distinct revocation request, never a replay of `/auth/refresh`. |
| Exported stateless `auth.refreshSession(url, token)` | Exactly one request per caller invocation; validated refusal/status/cause is returned. This low-level helper has no timer or retry owner. Callers must retain its outcome rather than independently resubmit an unknown predecessor; it is not a cross-client/process deduplication protocol. |

Code searched: every `rotateSession`, `refreshSession`, `/auth/refresh`,
`scheduleRefresh`, and auth-refusal branch under `packages/snapback4/src`,
including `auth.ts`, `client.ts`, `local.ts`, `client-start.ts`, `request-wait.ts`,
`app-client.ts`, `app.ts` and the revocation helpers. No new auth protocol or
persistent token-recovery mechanism is claimed.

## Validation and failure attribution

Final affected run: **464 pass / zero fail, cancelled or skipped**. The six files
are `overload`, `ephemeral-sender`, `session-security`, `online-session`,
`app-local-session`, and `delivery-fault-matrix`. This includes **118 overload
cases** and **317** delivery await cases (316 fault injections plus census).
Before the probe addition the same affected selection passed 461/461; both logs
are retained. The final refresh-focused run passed 24/24 and online-session
passed 13/13; the later probe change has its own public and fault-matrix checks.

The session model passes **52/52**, including all fixed regressions and **100
seeds per tier**, two tiers, three runtimes per sequence. This was a scoped
model run (`SNAPBACK4_SESSION_SEQUENCES=100`), not its default 5,000-seed sweep.
Whole guide: **98/98**. Package build/typecheck, docs budget, reference check and
whitespace checks pass. `FAILURES.md` lists every observed red, including the
intentional controls and test-development/setup mistakes. No unresolved test
failure; no environmental or unrelated-baseline failure was observed here.
There is no round-3 full-suite claim.

Wasm measured from the unchanged round-2 artifact: **2,040,545 B raw /
593,008 B GNU file-input gzip-9**, budget **593,719 B**, headroom **711 B**.
SHA-256 `f6e97419cd2dd84e358add161caafcc7e2948953cee507b7d25927b487d4f409`.
Rust 1.97.0, wasm-bindgen 0.2.127. No wasm rebuild was needed for SDK-only work;
no tool installation or shared-machine configuration change. See `wasm.json`.

## Scoped LLP orientation and maintenance

Applied `llp-orient` read-only within the Snapback 4 fence: LLP 3000 §7 /
`http-overload-diagnostics`, LLP 2000.000 §§6/11/12, LLP 3000.017 §2.4, and
LLP 3000.011.003.000 §2. Preserve bounded admission, ephemeral no-replay,
credential ownership, late-successor cleanup and durable mutation custody.
Read the paved ephemeral guide and client session reference. Updated LLP 3000,
the ephemeral guide and the published client reference in this change. Existing
annotations still resolve; the local scheduler now cites the governing outcome
rule. No new LLP, gate, capacity, dependency or contract shape. `local.ts`
remains at 1,500 lines. Hand-off: none.
