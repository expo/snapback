**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI v0.145.0 — model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, approval never; non-interactive `codex exec` orchestrated by /llp-super-refine
**Date:** 2026-07-23
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** cli-runner

# LLP 0076 reviews — GPT family

## Round 1 — 2026-07-23

**Revision under review:** `llp/0076-bounded-streamed-actions.rfc.md`, sha256 `74f0276335b2c89528c9a9a1f07a973f661e8a89180a0b3fc0b74e6dfad1993a` (untracked file at repo HEAD `55033289`)
**Runtime detail:** codex session id 019f8e02-ef7a-7a30-b6ff-1266073d18d9, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check** — **MATCH**

- `shasum -a 256 llp/0076-bounded-streamed-actions.rfc.md` → `74f0276335b2c89528c9a9a1f07a973f661e8a89180a0b3fc0b74e6dfad1993a`
- `git rev-parse --short HEAD` → `55033289`
- `./ref-check --verbose` → 78 LLP documents, 1,779 references, 0 errors, 1 unrelated unchecked shorthand.

2. **Overall assessment**

This is a good capability boundary: it keeps network streaming action-only, preserves mutations as the sole durable-write path, and exposes progress through ordinary authoritative live-query commits rather than inventing a second client stream. The numeric profile and settlement vocabulary match LLP 0075’s frozen fixture exactly. A shared reader implementation, both transport adapters, a live capability identifier, limit diagnostics, and a genuine local action-to-mutation-to-native-push happy-path witness all exist.

It is nevertheless not ready to become gate-2 semantic authority. The single settlement field conflates local termination with certainty about a non-idempotent upstream effect; retry safety is neither provider-founded nor byte-correct; and the claimed cursor closure and per-operation authority checks are not implemented locally. Capability admission does not consistently use the implemented instance-live predicate, manifests cannot publish exact numeric limits, and the retained witnesses cover materially less than the RFC’s acceptance section.

The durable mutation fence is the strongest part of the implementation: a terminal row or lifecycle fence appears able to prevent a late commit. The larger claim—that cancellation, authority loss, reset, or watchdog abandonment also closes the physical reader before another successful read—is not yet established.

3. **Strengths**

- The RFC keeps its authority status honest: it explicitly leaves gate 2 open while Draft (`llp/0076-bounded-streamed-actions.rfc.md:24-25`), matching LLP 0074’s requirement that LLP 0076 be accepted with executable evidence first (`llp/0074-convex-competitive-strategy.rfc.md:217-225`).

- The action → nested mutation → authoritative live-query architecture is well chosen (`llp/0076-bounded-streamed-actions.rfc.md:16-22,82-93`) and agrees with the established action execution model (`llp/0028-cron-scheduled-execution.rfc.md:377-404`).

- The frozen limits match exactly across the RFC, LLP 0075, and the protocol JSON: 1 MiB total, 64 KiB buffered, 30 seconds wall time, 5 seconds idle, and 10 progress commits per second (`llp/0076-bounded-streamed-actions.rfc.md:52-61`; `llp/0075-convex-checkpoint-protocol.spec.md:249-267`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:69-78`). Rust and Cloudflare use matching total/chunk/wall/idle constants (`src/server.rs:760-764`; `cloudflare/src/coordinator.js:74-79`).

- The shared reader surface is real and appropriately small: locked ownership, `Uint8Array` delivery, pull-per-read behavior, and idempotent cancellation are implemented in one harness (`packages/snapback-harness/ctx-bootstrap.js:804-884`). The local success witness traverses the real action, nested-mutation, commit, and native-push path and observes at least three intermediate commits (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:100-138`).

- Distinct `complete`, `failed`, `cancelled`, `timed_out`, and `ambiguous` states match the frozen protocol (`llp/0076-bounded-streamed-actions.rfc.md:95-111`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:69-78`). Preserving ambiguity rather than collapsing it is the correct direction and follows LLP 0074 (`llp/0074-convex-competitive-strategy.rfc.md:386-399`).

- `bounded_response_stream_v1` is an actual closed capability identifier with a conjunctive process-live predicate, not merely a planned string (`src/manifest.rs:2961-3050,3448-3463`). Codegen derives the requirement from streamed action source (`packages/snapback-codegen/index.mjs:3133-3147`), and `/inspect` constructs a live instance manifest (`src/local.rs:4333-4362`).

4. **Concerns**

1. **Major — Settlement is not a coherent single-axis state machine.**

   Idle or wall timeout and explicit cancellation are local dispositions, while `ambiguous` describes uncertainty about an upstream effect. A non-idempotent request that is cancelled or times out after initiation but before a known result satisfies both rules in the RFC (`llp/0076-bounded-streamed-actions.rfc.md:105-111`). LLP 0070 explicitly preserves unknown external effects rather than converting them to ordinary failure (`llp/0070-durable-background-work.rfc.md:96-106,122-130`).

   Both transports choose metadata timeout before considering effect ambiguity, while keyed failures are classified as ordinary failure (`src/server.rs:1287-1314`; `cloudflare/src/coordinator.js:1836-1854`). The demo introduces another inconsistency: `settleReply` returns the existing durable winner, but the action ignores it and returns its locally inferred status (`demos/competitive-checkpoint/snapback/handlers.mjs:105-115,180-192`). A cancellation-versus-timeout race can therefore leave the row `cancelled` while the action reports `timed_out`.

   Resolve this with either orthogonal `localDisposition` and `upstreamCertainty` fields or a documented precedence rule in which ambiguity is retained as cause/state. Specify a phase matrix covering pre-initiation, initiated/no metadata, metadata received, partial body, cancel, timeout, transport loss, and concurrent durable settlement. The action must return the durable winning state.

2. **Major — Retry safety is neither provider-founded nor byte-correct.**

   The RFC permits non-GET retry only with a provider-recognized idempotency key (`llp/0076-bounded-streamed-actions.rfc.md:107-111`). Both implementations instead treat the mere presence of any syntactically valid key as proof of retry safety (`src/server.rs:1296-1313`; `cloudflare/src/coordinator.js:1839-1853`), and the demo selects that behavior from an authored boolean (`demos/competitive-checkpoint/snapback/handlers.mjs:145-150`).

   More fundamentally, each action retry resets its sequence to zero and derives durable sequence numbers from pairs of host reads (`demos/competitive-checkpoint/snapback/handlers.mjs:139-170`). Previously applied sequence numbers are silently skipped (`demos/competitive-checkpoint/snapback/handlers.mjs:63-86`). Different network segmentation can therefore associate “sequence 1” with different bytes, causing omissions or duplication. The supposed retry witness retries only `startReply`, never an interrupted stream (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:140-158`).

   Require a trusted provider/integration declaration for idempotency. Either prohibit retry after the first durable byte, or persist entity identity plus canonical byte offsets and hashes or a provider resume token. Acceptance must interrupt after durable progress and retry with deliberately different transport chunking.

3. **Major — The authority and cursor-lifecycle contract is not implemented as written.**

   The RFC promises service-authority validation on every open/read/cancel and physical closure after authority loss, reload, reset, or watchdog abandonment (`llp/0076-bounded-streamed-actions.rfc.md:67-93`). Locally, generic host validation checks abandonment, generation, and deadline, but not service authority (`src/server.rs:864-880,1005-1045`). A blocking read has no post-read lifecycle validation before returning bytes (`src/server.rs:1347-1435`), so a read begun before a lifecycle transition can succeed afterward.

   The external-effect cut also conflicts with its governing authority. LLP 0059 requires application-controlled request normalization before `Begin`, synchronous native initiation, then `Initiated` in `finally` (`llp/0059-session-projection-and-client-barrier.spec.md:1209-1215`). `fetchStream` performs `Begin`, then reads request properties and awaits response metadata, releasing the permit only afterward (`packages/snapback-harness/ctx-bootstrap.js:807-825`).

   Add runtime-owned cancellable cursor registration wired to authority terminalization, generation/reset, and watchdog signals. Revalidate after every awaited read before exposing bytes. Normalize the complete request before `Begin`, and define an initiation acknowledgement that occurs immediately after irreversible native enqueue rather than after response metadata.

4. **Major — The live capability predicate is not consistently used for artifact admission.**

   Accepted LLP 0058 requires all artifact capabilities to resolve against the server-owned support set before any effect (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:293-305,307-330`). The raw dev loader validates artifact shape, schema references, and cron, then installs functions without calling `require_capabilities` (`src/local.rs:3308-3340`). Runtime refusal occurs only when `streamOpen` is reached (`src/runtime.rs:1359-1372`), so earlier handler work can execute first.

   Conversely, complete-pair preflight checks requirements against static `local_v0_declared()` rather than the live instance manifest (`src/local.rs:3099-3140`), which can refuse the stream capability even when outbound actions are enabled. Thus dev admission is too permissive while paired admission is too conservative.

   Resolve both paths against the same exact instance manifest used by `/inspect`, before handler evaluation, and add a negative test proving that a stream-requiring artifact runs no handler or nested-mutation code when the capability is absent.

5. **Major — The executable-witness claim is materially overstated.**

   The local witness proves success/native push, start-row idempotency, durable cancellation, idle settlement, and failed-versus-ambiguous labels (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:100-237`). It does not prove streamed retry, slow-consumer buffering, all exact limit codes through the real path, physical upstream closure, active-cursor reset/authority/watchdog behavior, query/mutation `fetchStream` refusal, or complete diagnostic/private-data scans.

   Cloudflare tests only successful pulling, visible chunk size, the total-byte code, and reader cancellation (`cloudflare/test/acceptance.egress.mjs:253-281`), yet its manifest claims that witness earned idle, wall, progress-rate, watchdog, and typed-settlement evidence too (`cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json:118-140`). Its ambient-capability test checks ordinary `fetch`, not `ctx.fetchStream` (`cloudflare/test/acceptance.egress.mjs:283-288`).

   The retained local instrument also hardcodes the retired `local-ibex-sqlite.v1` target alias (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:238-245`), contrary to the protocol amendment requiring identity from the served manifest (`demos/competitive-checkpoint/acceptance/protocol.v0.json:8-16`).

   Create a machine-readable acceptance matrix mapping every RFC bullet to an integrated test and retained receipt. Narrow existing capability claims, derive target identity from the served manifest, and rerun prospectively.

6. **Moderate — Timeout and buffer semantics are not exact enough to enforce mechanically.**

   “64 KiB application-visible buffered bytes” does not identify whether it measures host-retained unread bytes, outstanding promises, bridge copies, or bytes retained by application code (`llp/0076-bounded-streamed-actions.rfc.md:46-61`). Local code enforces a 16 KiB read size but has no explicit 64 KiB accounting (`src/server.rs:1381-1435`). The shared reader also prevents a second owner but does not prohibit concurrent pending `read()` calls (`packages/snapback-harness/ctx-bootstrap.js:826-855`).

   Local checks idle/wall limits before a blocking read but neither uses the remaining idle budget nor revalidates after the read (`src/server.rs:1363-1435`). Cloudflare similarly waits up to a fresh five seconds rather than the remaining time since the last byte (`cloudflare/src/coordinator.js:1912-1958`). Existing limit tests based on already-expired timestamps do not witness boundary-crossing reads (`src/server.rs:30056-30120`).

   Define the precise accounting domain, pending-read rule, and deadline arithmetic. Add slow-consumer, concurrent-read, and just-before-deadline fault-injection tests.

7. **Moderate — The progress-rate and cursor-retention bounds differ from the stated profile.**

   The RFC limits durable progress commits (`llp/0076-bounded-streamed-actions.rfc.md:61,97-103`). Rust and Cloudflare instead count every nested mutation while any stream is open and consume the timestamp before knowing whether it commits (`src/server.rs:1048-1066`; `cloudflare/src/host-ops.js:275-285,513-522`). Unrelated or failed mutations therefore consume the budget, in addition to the demo’s separate row-level limiter.

   Both transports also retain every closed cursor identifier for the invocation while capping only concurrently open streams (`src/server.rs:795-813,1347-1450`; `cloudflare/src/coordinator.js:1722-1735,2018-2042`). Rapid open/cancel cycles therefore have no explicit total-retention bound.

   Specify whether attempts or successful durable transitions count, scope the limit by attempt identity, and cap total cursor creation or use bounded tombstones.

8. **Moderate — The diagnostic vocabulary exists, but the promised diagnostic contract does not.**

   All seven stream names are registered exactly (`packages/snapback-harness/envelope.mjs:16-50`), and the progress-rate code is emitted. However, `SNAPBACK_ACTION_STREAM_CANCELLED` has no observable refusal path: cancellation returns success, while Cloudflare uses the code only as an internal abort reason (`src/server.rs:1438-1450`; `cloudflare/src/coordinator.js:2024-2036`).

   Rust and Cloudflare stream-error builders provide operation and repair fields but no source locus (`src/server.rs:1454-1466`; `cloudflare/src/coordinator.js:1738-1748`). Rust’s invalid-shape diagnostic also retains raw `serde` error text, making the default diagnostic dependent on rejected input (`src/runtime.rs:1374-1388`). Cloudflare’s progress refusal contains only code and message (`cloudflare/src/host-ops.js:275-285`).

   Use one structured diagnostic schema on both targets, remove raw parser text, define whether cancellation is an error or successful transition, and add exact-shape plus secret/private-byte scans for every family.

9. **Moderate — Capability manifests cannot publish the exact enforced limits required by the RFC.**

   The target contract requires exact limits in the manifest (`llp/0076-bounded-streamed-actions.rfc.md:139-146`), but `ResourceLimit` contains only `name` and `status` (`src/manifest.rs:3268-3279`; `schemas/capability.manifest.schema.json:112-125`). The local manifest consequently names the limits without values (`demos/competitive-checkpoint/snapback/generated/capability.manifest.json:44-68`); Cloudflare places the numbers only in an unstructured prose field (`cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json:118-140`).

   Add typed value/unit/scope fields or make a versioned profile document the sole numeric authority and have manifests publish its digest.

10. **Minor — The implementation has already widened the nominal v1 surface.**

   The RFC specifies a reader subset and leaves full Web-stream adoption open (`llp/0076-bounded-streamed-actions.rfc.md:29-50,181-188`), but the shared harness already exposes async iteration (`packages/snapback-harness/ctx-bootstrap.js:858-875`). Either make that normative and test it or remove it until the open question is decided.

5. **Suggestions**

- Add a formal transition table keyed by request phase, local disposition, upstream certainty, durable winner, permitted retry, and diagnostic code.
- Generate Rust, Workerd, manifest, guide, and protocol constants from one machine-readable profile definition.
- Give every acceptance bullet a stable witness identifier, target, fault injection, expected receipt fields, and secret-scan rule.
- Define a cancellation latency objective and require the deterministic upstream server to record socket/reader closure.
- Separate transport pull numbering from durable byte identity; sequences should carry an offset and content digest.
- State explicitly whether this is a generic bounded arbitrary-URL HTTP response API. If so, list the inherited destination, redirect, DNS/IP, and private-network policy rather than relying on “same URL policy.”

6. **Open questions**

- At what exact phase is an upstream result “determined”: request enqueue, response metadata, complete body, or an integration-specific receipt?
- Are timeout/cancellation and upstream-effect certainty separate fields, or which one takes precedence?
- What trusted declaration proves that a provider recognizes an idempotency key?
- Are retries after durable progress prohibited, restarted from zero, or resumable by verified byte offset?
- Which runtime authority actively aborts a cursor on durable cancellation, session/service terminalization, reset, and future LLP 0070 job cancellation?
- Is the 64 KiB budget per cursor, action invocation, or target process, and which host/bridge queues count?
- Do failed and unrelated nested mutations consume the ten-per-second progress allowance?
- Is `SNAPBACK_ACTION_STREAM_CANCELLED` an observable diagnostic or only an internal cancellation reason?
- Which selected hosted target must satisfy the target contract? LLP 0075 identifies `single-instance-container-vm.v1` as the next executable adapter, while Cloudflare remains a narrow proof (`demos/competitive-checkpoint/acceptance/protocol.v0.json:56-60`; `llp/0075-convex-checkpoint-protocol.spec.md:367-372`).
- Is async iteration part of v1?

7. **Verdict**

Verdict: NOT READY

The settlement, retry, lifecycle-authority, capability-admission, and executable-evidence gaps must be resolved before this RFC can serve as LLP 0074 gate-2 authority.
