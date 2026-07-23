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

## Round 2 — 2026-07-23

**Revision under review:** `llp/0076-bounded-streamed-actions.rfc.md`, sha256 `f0bf6813a9f4bdb047113877e39b57f751928a43623ac7a92d236d51dc5bb9bc` (content MATCH; the reviewer noted HEAD had advanced to `742c5b4d` because the orchestrating session committed the round-1 revision mid-round — the file is tracked and clean at that commit, content identical to the pin)
**Runtime detail:** codex session id 019f8e17-1709-7762-960d-62b58aba9844, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Inspected both host implementations, the shared shim, the witnesses, the generated manifests, and the pinned ureq dependency source; did not build.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check**

**MISMATCH.**

- `shasum -a 256 llp/0076-bounded-streamed-actions.rfc.md` returned `f0bf6813a9f4bdb047113877e39b57f751928a43623ac7a92d236d51dc5bb9bc`: document pin **MATCH**.
- `git rev-parse --short HEAD` returned `742c5b4d`, not the stated `55033289`: repository pin **MISMATCH**.

I reviewed the exact pinned document bytes against the repository currently on disk at `742c5b4d`. `./ref-check --verbose` also completed successfully with 0 errors and one unrelated unchecked shorthand.

2. **Overall assessment**

This is a good and necessary proposal. The narrow, pull-driven, action-only reader is the right shape; durable mutation-mediated progress is preferable to pretending an action or HTTP stream is itself transactional; and the RFC correctly refuses to treat this as a general streaming API. Its evidence-status section is unusually candid about what has and has not been proven.

The Revised-header claims are partially substantiated. The common Ibex/Workerd reader surface exists, `bounded_response_stream_v1` and its live-instance predicate exist, all named diagnostic strings occur in code, and both local and Cloudflare executable witnesses exist. But several claimed semantics are not actually enforced end to end: cancellation and unsupported diagnostics do not surface as specified, local and Workerd differ on wall-clock behavior, the 64 KiB buffer limit is not defined or enforced locally, capability admission is inconsistent, and the reference application violates durable-winner precedence.

More importantly, there are semantic blockers beyond missing tests. A single settlement enum cannot represent both why Snapback stopped and whether a non-idempotent upstream effect happened; retry has no single-runner fence; authority loss can leave the durable row permanently `running`; and a blocked read is not linearized against authority terminalization. LLP 0074 gate 2 therefore should remain open.

3. **Strengths**

- The scope is disciplined: one action-only, single-reader, pull-driven profile with explicit cursor limits and non-goals, rather than an implicit commitment to general streaming (`llp/0076-bounded-streamed-actions.rfc.md:37-83`, `llp/0076-bounded-streamed-actions.rfc.md:260-267`).

- Durable progress through ordinary nested mutations fits the accepted action model, where actions are not transactions and publication crosses the mutation commit gate (`llp/0076-bounded-streamed-actions.rfc.md:100-129`, `llp/0028-cron-scheduled-execution.rfc.md:377-404`, `llp/0028-cron-scheduled-execution.rfc.md:524-536`).

- The headline numeric values and terminal vocabulary match LLP 0075 and the frozen protocol JSON, apart from the wall-clock interpretation discussed below (`llp/0076-bounded-streamed-actions.rfc.md:62-73`, `llp/0075-convex-checkpoint-protocol.spec.md:249-267`, `demos/competitive-checkpoint/acceptance/protocol.v0.json:69-79`).

- The target capability is real, not merely planned. It has an exact closed identifier, a positive predicate requiring outbound actions plus a registered implementation, codegen inference, and a live-instance unit witness (`src/manifest.rs:2961-3033`, `src/manifest.rs:3448-3463`, `src/manifest.rs:3865-3882`, `packages/snapback-codegen/index.mjs:3133-3147`).

- The shared reader and both host implementations are substantive: the harness exposes `Uint8Array`, cancellation, reader ownership, and async iteration, while both targets have open/read/cancel operations (`packages/snapback-harness/ctx-bootstrap.js:804-884`, `src/server.rs:1179-1450`, `cloudflare/src/coordinator.js:1719-2042`).

- The local happy-path witness genuinely traverses action → nested mutation → commit → native live push, observes multiple durable commits, and checks private-reader exclusion (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:100-137`).

- The Draft does not falsely claim gate closure and explicitly records many missing witnesses and implementation gaps (`llp/0076-bounded-streamed-actions.rfc.md:224-258`; `llp/0074-convex-competitive-strategy.rfc.md:217-231`).

4. **Concerns**

1. **Major — Settlement collapses local termination cause and upstream-effect certainty.** The RFC says an unprovable non-idempotent transport failure is `ambiguous`, but then classifies every explicit cancellation as `cancelled`, every idle/wall expiry as `timed_out`, and mid-body loss after response metadata as `failed` with the effect recorded as executed (`llp/0076-bounded-streamed-actions.rfc.md:131-141`). Cancellation or timeout can occur after request initiation while the provider outcome remains unknown, and response metadata does not prove that a business effect committed. This conflicts with LLP 0074’s prohibition on collapsing ambiguity and LLP 0070’s requirement that ambiguous external effects resolve only through lookup or stable idempotency (`llp/0074-convex-competitive-strategy.rfc.md:379-396`, `llp/0070-durable-background-work.rfc.md:122-130`). The fixture schema cannot record the promised distinction (`demos/competitive-checkpoint/snapback/schema.mjs:16-30`). Resolve this with two durable axes—such as `terminalCause` and `upstreamEffectCertainty/outcome`—or give ambiguity precedence while retaining timeout/cancellation as secondary causes.

2. **Major — Retry is neither serialized nor safely idempotent.** The RFC permits retry before first durable progress under the same attempt (`llp/0076-bounded-streamed-actions.rfc.md:143-150`), but `ActionStreamRequest` carries no attempt identity or execution generation (`src/runtime.rs:86-103`). `startReply` returns the same attempt to concurrent callers without granting one caller an execution lease, duplicate sequences are discarded without comparing their bytes, and the action clears its pending bytes even when a progress write was not applied (`demos/competitive-checkpoint/snapback/handlers.mjs:16-33`, `demos/competitive-checkpoint/snapback/handlers.mjs:63-86`, `demos/competitive-checkpoint/snapback/handlers.mjs:139-193`). Two callers can therefore reopen the upstream request before either commits progress and then splice or lose differently segmented data. Both hosts also treat mere presence of an idempotency key as proof that a transport failure is retry-safe, although the RFC admits provider recognition is not machine-checkable (`src/server.rs:1296-1313`, `cloudflare/src/coordinator.js:1839-1854`, `llp/0076-bounded-streamed-actions.rfc.md:148-150`). Define client operation key → server attempt ID → provider key separately; add an atomic single-runner lease/fencing generation; bind every progress/terminal mutation to it; compare duplicate offsets or digests; and retain `ambiguous` unless provider idempotency is trusted.

3. **Major — No trusted actor owns terminalization after authority, generation, or watchdog loss.** Cursor closure is host-owned, but durable terminal settlement is left to an authored mutation (`llp/0076-bounded-streamed-actions.rfc.md:92-129`). Accepted authority rules prevent the abandoned action from committing after generation retirement, service-authority terminalization, or watchdog failure (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1107-1110`, `llp/0059-session-projection-and-client-barrier.spec.md:1115-1124`, `llp/0028-cron-scheduled-execution.rfc.md:427-433`). The attempt can consequently remain `running` forever, with no durable “winner” to return. Caller cancellation also reaches the physical reader only when a later progress mutation observes the terminal row; a stalled read may not attempt that mutation until idle timeout (`llp/0076-bounded-streamed-actions.rfc.md:106-110`). Specify a trusted compare-and-set terminalizer or lease-expiry reconciler, plus a direct attempt-to-cursor cancellation signal, and execute races for every lifecycle cause.

4. **Major — The promised per-read authority fence is absent.** The RFC says every read revalidates invocation, generation, service authority, and watchdog, and that terminalization prevents another successful read (`llp/0076-bounded-streamed-actions.rfc.md:85-104`). Local validation omits service authority and occurs only before the blocking read; bytes are returned without post-read revalidation (`src/server.rs:864-881`, `src/server.rs:1347-1435`). Workerd likewise performs only a pre-operation abandonment check; its read closure receives no lifecycle control and does no check after awaiting the native reader (`cloudflare/src/host-ops.js:509-512`, `cloudflare/src/coordinator.js:1722-1729`, `cloudflare/src/coordinator.js:1899-2000`). LLP 0059’s existing Begin/Initiated permit protects initial fetch initiation, not later body pulls (`llp/0059-session-projection-and-client-barrier.spec.md:1209-1215`). Hold an exact permit through pull and byte handoff, or perform an equivalent fenced post-pull check, and add an authority-terminalization-during-blocked-read witness.

5. **Major — The frozen resource semantics conflict and are not enforced consistently.** LLP 0075 and the JSON define a 30-second wall-clock ceiling, whereas this RFC permits up to a five-second overshoot (`llp/0075-convex-checkpoint-protocol.spec.md:249-267`, `demos/competitive-checkpoint/acceptance/protocol.v0.json:69-79`, `llp/0076-bounded-streamed-actions.rfc.md:75-80`). Workerd enforces an absolute remaining-wall deadline (`cloudflare/src/coordinator.js:1942-1966`), while local checks only before a blocking read (`src/server.rs:1363-1408`). Worse, local caps ureq’s overall request timeout at the five-second idle window (`src/server.rs:1258-1270`); the locked ureq 2.12.1 dependency defines that timeout across response-body reading (`Cargo.lock:3995-3998`, `/Users/ccheever/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ureq-2.12.1/src/request.rs:59-62`, `/Users/ccheever/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ureq-2.12.1/src/agent.rs:471-477`). A continuously productive stream can therefore fail around five seconds and be mislabeled idle (`src/server.rs:1388-1397`). Make the wall limit absolute or amend LLP 0075 prospectively, and separate overall, idle, connect, and per-read timers.

6. **Major — Backpressure and the 64 KiB buffer ceiling are not enforceable as written.** The RFC itself admits that the accounting domain is undefined (`llp/0076-bounded-streamed-actions.rfc.md:235-237`). Local has a 16 KiB read size but no 64 KiB buffer counter, despite advertising buffered bytes as `Enforced` (`src/server.rs:760-764`, `src/server.rs:1381-1387`, `src/manifest.rs:3395-3410`). The shared reader permits unlimited simultaneous `read()` calls from its single owner; Workerd host calls run outside the invocation mutex and have no per-cursor in-flight lock (`packages/snapback-harness/ctx-bootstrap.js:826-856`, `cloudflare/src/coordinator.js:1899-2000`, `cloudflare/src/coordinator.js:2936-2977`). Concurrent pulls can exceed the stated memory bound and leave fallback remainder/cancellation ordering undefined. Define whether the limit is per cursor or invocation and which host, bridge, VM, and network queues count; serialize pulls per cursor; account aggregate retained bytes; and mark manifest rows non-enforced until a slow-consumer witness passes.

7. **Major — The diagnostic names exist, but the public contract does not.** All eight stream names occur in runtime code or registries (`src/runtime.rs:138-160`, `src/runtime.rs:2884-2910`, `src/server.rs:1250-1450`, `src/server.rs:18002-18134`), but three are not observable as specified. Reads after cancellation return EOF rather than `SNAPBACK_ACTION_STREAM_CANCELLED`, matching the Cloudflare witness but contradicting the RFC (`llp/0076-bounded-streamed-actions.rfc.md:173-175`, `packages/snapback-harness/ctx-bootstrap.js:835-849`, `src/server.rs:1347-1354`, `cloudflare/test/acceptance.egress.mjs:272-280`). `SNAPBACK_ACTION_STREAM_UNSUPPORTED` and `SNAPBACK_REPLY_PROGRESS_RATE_EXCEEDED` are absent from both handler-envelope allowlists and can fold to `SNAPBACK_HANDLER_FAILED` (`src/runtime.rs:2884-2923`, `packages/snapback-harness/envelope.mjs:16-58`). Capability admission instead emits `SNAPBACK_CAPABILITY_UNSUPPORTED` (`src/manifest.rs:3645-3675`). Choose EOF or cancellation-error semantics, distinguish admission from runtime fallback, preserve every promised code through both envelopes, and add real-action exact-code and diagnostic-shape witnesses.

8. **Major — Durable-winner precedence is contradicted by the reference fixture.** `settleReply` returns an already committed terminal winner, but `streamReply` ignores that result and returns its local inference (`demos/competitive-checkpoint/snapback/handlers.mjs:105-114`, `demos/competitive-checkpoint/snapback/handlers.mjs:184-192`). A cancellation/timeout race can leave the durable row `cancelled` while the action reports `timed_out` or `failed`, directly violating the RFC’s authoritative-winner rule (`llp/0076-bounded-streamed-actions.rfc.md:139-141`). Return the mutation result and add permutations covering cancellation, timeout, completion, and failure racing at both sides of the commit cut.

9. **Major — Capability admission can both over-admit and under-admit streamed actions.** Raw development loading installs function artifacts without resolving their required capabilities, while complete-pair preflight checks the conservative static manifest rather than the outbound-enabled live instance (`src/local.rs:3308-3340`, `src/local.rs:3099-3140`, `src/manifest.rs:3448-3463`). Thus one path can admit a streamed action with egress disabled while another can reject it when egress is actually enabled. Codegen inference is also a textual `fetchStream(` regex, so alias or bracket access can omit the requirement (`packages/snapback-codegen/index.mjs:3133-3147`). Require an explicit or AST-derived function capability, resolve it against the exact served instance in every loader before effects, and execute an outbound-disabled negative admission witness.

10. **Moderate — The frozen fixture and acceptance plan need a prospective rebinding.** The RFC example and demo use string mutation names, conflicting with LLP 0075’s generated-reference-only rule (`llp/0076-bounded-streamed-actions.rfc.md:46-54`, `demos/competitive-checkpoint/snapback/handlers.mjs:160-191`, `llp/0075-convex-checkpoint-protocol.spec.md:171-190`). LLP 0075 speaks of retry keyed by a server-issued attempt identity, while LLP 0076 deduplicates start by a client key (`llp/0075-convex-checkpoint-protocol.spec.md:249-264`, `llp/0076-bounded-streamed-actions.rfc.md:113-123`). The RFC also leaves “selected hosted target” unnamed, while LLP 0075’s adjudication identifies `single-instance-container-vm.v1` as the next executable adapter and treats Cloudflare as an ineligible narrow proof (`llp/0076-bounded-streamed-actions.rfc.md:188-198`, `llp/0075-convex-checkpoint-protocol.spec.md:350-372`). Amend LLP 0075 prospectively with the reviewed semantics, replace string calls with generated references, name each target profile, and distinguish runtime-engine conformance from hosted-adapter evidence.

11. **Moderate — Acceptance remains only partially executable and evidenced.** The local suite contains six checks covering the happy path, start-row replay, durable cancellation, idle settlement, and two transport labels; it does not execute interrupted retry, slow consumption, exact real-path total/wall/rate codes, physical closure, active-cursor lifecycle loss, query/mutation `fetchStream` refusal, or receipt scans (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:43-60`, `demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:100-236`). Workerd exercises only pulling, visible chunk size, a non-discriminating shared limit code, and terminal-after-cancel behavior (`cloudflare/test/acceptance.egress.mjs:253-280`). The retained local receipt also names the retired target alias (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:238-245`). This agrees with the RFC’s own gap list (`llp/0076-bounded-streamed-actions.rfc.md:224-258`), but gate closure needs a per-target receipt matrix with explicit oracles for buffer accounting, socket closure, lifecycle races, exact diagnostic details, and secret scanning.

5. **Suggestions**

- Rename `SNAPBACK_REPLY_PROGRESS_RATE_EXCEEDED` to a profile-neutral host code before receipts make the current fixture-specific name permanent.

- Store a byte offset, content digest, and execution-generation token with every progress patch; duplicate sequence numbers should be accepted only when the offset and digest agree.

- Specify request-side limits for URL length, headers, body, redirects, and idempotency keys. The RFC currently says they are bounded without defining a cross-target profile (`llp/0076-bounded-streamed-actions.rfc.md:42-43`).

- Define `cancel(reason)` precisely. The common reader currently ignores the reason (`packages/snapback-harness/ctx-bootstrap.js:846-849`); either omit it from v1 or constrain and redact its diagnostic representation.

- Bound closed-cursor tombstones or define a total cursor-creation ceiling per invocation, not only four concurrently open cursors (`src/server.rs:1347-1450`, `cloudflare/src/coordinator.js:1719-1735`).

- Publish typed value/unit fields or a profile digest in manifests before consumers use `bounded_response_stream_v1` to distinguish resource profiles.

6. **Open questions**

- Is settlement one axis or two, and what exact durable values represent local cause versus upstream-effect certainty?

- Which trusted actor settles or reconciles a row after the action loses mutation authority?

- What fence linearizes authority terminalization, cancellation, and a blocked or concurrent `read()`?

- Is the 30-second limit absolute, and exactly which buffered copies count toward 64 KiB?

- What are the distinct identities and trust rules for the client operation, Snapback attempt, execution generation, and upstream provider key?

- Should reads after explicit cancellation return EOF or raise `SNAPBACK_ACTION_STREAM_CANCELLED`?

- Which hosted profile must pass the full suite, and does a positive capability row mean experimental implementation availability or accepted product support?

7. **Verdict**

Verdict: NOT READY

The settlement model, retry fencing, lifecycle ownership, read-authority linearization, and frozen resource bounds require resolution before this RFC can safely become semantic authority.

## Round 3 — 2026-07-23

**Revision under review:** `llp/0076-bounded-streamed-actions.rfc.md`, sha256 `d6025be1cf1ae39ab46ad251589a6ca87ac1dbb63d0c93bfc6b5537b9ce37e88` (MATCH at repo HEAD `3dd38c29`; the reviewer confirmed the HEAD blob has the same hash and the working tree is clean)
**Runtime detail:** codex session id 019f8e2b-53ed-75c1-8837-beed92e406a4, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Inspected both hosts, the shared shim, the witnesses, the generated manifests, and the envelope allowlists; did not build.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check**

MATCH.

- `shasum -a 256 llp/0076-bounded-streamed-actions.rfc.md` → `d6025be1cf1ae39ab46ad251589a6ca87ac1dbb63d0c93bfc6b5537b9ce37e88`
- `git rev-parse --short HEAD` → `3dd38c29`
- The HEAD blob has the same SHA-256, and `git diff --quiet -- llp/0076-bounded-streamed-actions.rfc.md` exited `0`.

2. **Overall assessment**

The narrow bounded-streaming direction is a good idea. The action-only reader, ordinary mutation commits, native live-query observation, explicit limits, and refusal to promise direct client-response streaming form a disciplined v1 shape. The five frozen limits and settlement names match LLP 0075 and its machine fixture exactly, and substantial implementation exists on both Ibex and Workerd.

The RFC is nevertheless not semantically ready. `ambiguous` is internally contradictory; mere idempotency-key presence is treated as provider recognition; the reference pattern can return a different terminal result from the durable winner; cancellation is not bound to the active cursor; retry concurrency can mix bytes; and the required effect-certainty axis cannot be represented. The local external-effect cut also conflicts with accepted LLP 0059, while per-read service-authority validation is absent.

These are not merely missing tests. Positive capability manifests currently advertise an incomplete profile and mark undefined resource limits `Enforced`. The document should remain Draft, the capability claims should be withdrawn or explicitly marked proposed, and the settlement/attempt/cursor state machine should be closed before gate 2 is reconsidered.

3. **Strengths**

- The scope is admirably narrow: actions receive the reader while queries and mutations do not, clients continue to observe authoritative commits, and direct response, upload, WebSocket, SSE, and durable cursor ownership are excluded (`llp/0076-bounded-streamed-actions.rfc.md:38-49,51-108,351-358`).

- The shared surface is real rather than aspirational: the harness implements one-reader locking, `Uint8Array` chunks, async iteration, open/read/cancel operations, and action-only availability for both host transports (`packages/snapback-harness/ctx-bootstrap.js:804-891`).

- The numeric contract is aligned. The RFC’s 1 MiB, 64 KiB, 30 s, 5 s, and 10/s limits and settlement kinds match LLP 0075 and `protocol.v0.json`; the RFC clearly identifies 16 KiB reads and four cursors as additional profile limits (`llp/0076-bounded-streamed-actions.rfc.md:83-105`; `llp/0075-convex-checkpoint-protocol.spec.md:249-267`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:69-79`).

- The transactional late-patch concept is sound: progress and terminal mutations inspect the attempt row inside the committing transaction, so once terminal state wins, later patches are rejected (`llp/0076-bounded-streamed-actions.rfc.md:125-157`; `demos/competitive-checkpoint/snapback/handlers.mjs:63-124`). This fits the accepted action model in LLP 0028 (`llp/0028-cron-scheduled-execution.rfc.md:389-404,429-436`).

- `bounded_response_stream_v1` genuinely exists in the closed capability vocabulary and has an instance-live outbound-action predicate (`src/manifest.rs:2961-3033`; `src/local.rs:4333-4362`; `schemas/capability.manifest.schema.json:160-173`). All eight RFC diagnostic strings also exist in code, including the intentionally internal cancellation reason (`src/runtime.rs:138-160`; `src/server.rs:1186-1449`; `cloudflare/src/coordinator.js:1751-2042`).

- The evidence-status section is unusually candid about unfinished work and correctly prevents the happy-path witness from being mistaken for full conformance (`llp/0076-bounded-streamed-actions.rfc.md:266-349`). `./ref-check --verbose` also passed with zero errors.

4. **Concerns**

1. **Major — settlement classification is internally contradictory and unsafe around idempotency keys.**

   The RFC says any non-idempotent transport failure not provably before initiation is `ambiguous`, then immediately classifies mid-body non-idempotent loss as `failed` plus an effect fact (`llp/0076-bounded-streamed-actions.rfc.md:170-176`). That leaves consumers unable to know whether `ambiguous` denotes a cause, an effect-knowledge state, or only a pre-metadata phase.

   The retry rule requires a provider-recognized key, but both hosts treat mere `idempotencyKey` presence as retry-safe (`llp/0076-bounded-streamed-actions.rfc.md:182-189`; `src/server.rs:1296-1313`; `cloudflare/src/coordinator.js:1839-1853`). The reference action lets a client supply `upstreamIdempotent` (`demos/competitive-checkpoint/snapback/functions.mjs:129-135`). An explicit `Idempotency-Key` header can also override the metadata key while classification still trusts metadata-key presence (`src/server.rs:1271-1281`; `cloudflare/src/coordinator.js:1819-1853`).

   Resolve this with a normative phase × method × trusted-provider-policy table. Unknown provider contracts must remain ambiguous/no-retry. Canonicalize one effective forwarded key and reject metadata/header disagreement. Define `ambiguous` narrowly or move uncertainty entirely onto the effect-certainty axis, retaining a documented projection for LLP 0075.

2. **Major — terminal settlement, durable-winner precedence, and cancellation are not coherent in the reference pattern.**

   The RFC requires an orthogonal effect-certainty fact and says the committed durable winner must be returned (`llp/0076-bounded-streamed-actions.rfc.md:159-180`). The schema stores only a free-form `status`, and the stream host surface exposes no trusted initiation fact (`demos/competitive-checkpoint/snapback/schema.mjs:16-30`; `src/runtime.rs:109-125`).

   More concretely, `settleReply` returns an already-committed winner, but `streamReply` discards that result and returns its local inference (`demos/competitive-checkpoint/snapback/handlers.mjs:105-114,184-192`). `completeReply` maps every competing terminal state to `SNAPBACK_REPLY_CANCELLED` (`demos/competitive-checkpoint/snapback/handlers.mjs:89-102`). A cancel during a blocked read can therefore persist `cancelled` while the action returns `timed_out`.

   Product cancellation only patches the row; it has no direct cursor signal (`demos/competitive-checkpoint/snapback/handlers.mjs:117-124`). `ActionStreamRequest` carries no attempt or execution identity, and `streamReply` opens upstream before checking or leasing the attempt (`src/runtime.rs:93-103`; `demos/competitive-checkpoint/snapback/handlers.mjs:145-165`). Invoking an already-terminal attempt can consequently initiate another external request.

   Resolve this with a trusted terminal CAS returning `{winner, cause, effectCertainty, sequence}`, which every path returns verbatim; bind attempt and runner-generation identities to cursor registration; and have cancellation, authority loss, generation retirement, and watchdog abandonment directly race that CAS and abort the cursor.

3. **Major — retry fencing permits duplicate effects and mixed stream content.**

   The RFC prohibits retry after first durable progress but leaves enforcement to the author (`llp/0076-bounded-streamed-actions.rfc.md:150-157,182-189`). `startReply` has no single-runner lease, so concurrent callers can open the same upstream attempt (`demos/competitive-checkpoint/snapback/handlers.mjs:16-32,139-150`).

   Duplicate sequences are accepted solely by number, without validating byte offset or digest, and the action clears its pending bytes even when `applied` is false (`demos/competitive-checkpoint/snapback/handlers.mjs:63-86,158-170`). Two runners with different segmentation can therefore commit one runner’s sequence 1 and another’s sequence 2. The existing “retry” witness merely repeats `startReply` sequentially (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:140-148`).

   Resolve this with distinct client-operation, Snapback-attempt, runner-generation, and provider-key identities; an atomic single-runner lease; committed offsets and digests; identical-duplicate validation; explicit handling of lost mutation acknowledgements; and a rule that all uncommitted bytes are discarded before a permitted pre-first-commit restart. This should align with LLP 0070’s fenced-claim model (`llp/0070-durable-background-work.rfc.md:80-100`).

4. **Major — the stream crosses accepted authority fences incorrectly.**

   LLP 0059 requires all application-controlled `Request` normalization before `Begin`, followed by synchronous native initiation and immediate `Initiated` acknowledgement (`llp/0059-session-projection-and-client-barrier.spec.md:1209-1215`). Ordinary guarded fetch follows that order (`packages/snapback-harness/ctx-bootstrap.js:157-170`).

   `fetchStream` instead calls `Begin` before reading `req.url`, method, headers, body, and key, allowing getters or proxies to execute inside the authority cut. It then waits for the entire blocking open operation before acknowledging `Initiated`, even on validation refusal (`packages/snapback-harness/ctx-bootstrap.js:807-825`; `src/server.rs:1194-1317`). This defect is local too, not merely a Workerd accuracy issue.

   The RFC also promises exact authority validation on every operation (`llp/0076-bounded-streamed-actions.rfc.md:112-115`). Local validation checks only abandonment, app generation, and deadline; the blocking read has no post-pull authority check (`src/server.rs:864-881,1347-1435`). Workerd similarly checks invocation abandonment rather than the promised service authority (`cloudflare/src/host-ops.js:509-549`). Authority can therefore terminalize during a blocked read and bytes can still be handed to the action.

   Resolve this by normalizing before `Begin`, moving initiation ownership into the trusted host at the actual network-enqueue cut, and holding an exact authority permit through pull and handoff or performing an equivalent fenced post-pull check. Add deterministic terminalization-during-open and terminalization-during-read witnesses.

5. **Major — the buffering, backpressure, and absolute-deadline contracts are not defined or enforced.**

   “Application-visible buffered bytes” cannot literally include bytes retained indefinitely by application code. The RFC later concedes that the accounting domain is undefined and concurrent reads are unlimited (`llp/0076-bounded-streamed-actions.rfc.md:87-89,316-322`). The shared reader has no in-flight-read serialization (`packages/snapback-harness/ctx-bootstrap.js:829-849`).

   Local enforces a 16 KiB read size but has no 64 KiB counter (`src/server.rs:760-771,1381-1435`). Workerd rejects a single upstream chunk over 64 KiB but does not account aggregate bridge copies or pending reads (`cloudflare/src/coordinator.js:1931-1999`). A read racing `cancel()` can also complete after cancellation because no shared linearizer or post-await cursor check exists (`cloudflare/src/coordinator.js:1942-1999,2030-2042`).

   Both targets begin the 30-second body clock only after response metadata, and local checks it only before a blocking read (`src/server.rs:1282-1334,1363-1408`; `cloudflare/src/coordinator.js:1827-1877`). That does not enforce one absolute deadline across open and terminal read.

   Define precisely which host, network, bridge, and VM queues count; whether the limit is per cursor or invocation; and read/cancel linearization. Permit one in-flight pull per cursor, record a test-visible high-water mark, and capture one absolute deadline before outbound initiation.

6. **Major — the capability contract conflates a transport surface with an author-authored protocol and already overclaims both.**

   The RFC admits that terminal checks, row throttling, and retry fencing are not host-enforced (`llp/0076-bounded-streamed-actions.rfc.md:150-157`). Yet `bounded_response_stream_v1` is advertised as a positive target capability. Accepted LLP 0058 defines presence in `supportedCapabilities` as positive server support, while LLP 0074 says Draft subsystem authorities confer no capability claim before acceptance and executable witnesses (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:293-329`; `llp/0074-convex-competitive-strategy.rfc.md:208-230`).

   The raw dev loader never resolves function requirements against the target, while complete-pair preflight uses the static outbound-disabled manifest instead of the served instance manifest (`src/local.rs:3120-3140,3308-3415`). The local capability fact marks the stream implementation registered unconditionally (`src/manifest.rs:3086-3097`).

   Both positive manifests mark buffered bytes `Enforced` despite the missing accounting, and neither names the 16 KiB read-size or four-cursor limits (`src/manifest.rs:3395-3410`; `cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json:57-77`). The Cloudflare runtime fact claims wall, idle, progress, watchdog, and typed settlement evidence that its stream test does not exercise (`cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json:132-140`; `cloudflare/test/acceptance.egress.mjs:253-281`).

   Keep the positive predicate false until full conformance, or add a proposed/experimental maturity state that admission cannot treat as support. Resolve every install path against the same served manifest and mark unproved limits `Missing`. Consider separating the host transport capability from a generated durable-progress-pattern capability.

7. **Major — the acceptance contract is mechanically incomplete, and exact diagnostics do not all survive the real envelope.**

   The local suite has six checks. It genuinely proves native-push intermediate commits, ordered happy-path content, cancellation-row fencing, idle settlement, and failed/ambiguous labels (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:43-46,100-237`). It does not prove interrupted retry with changed segmentation, slow-consumer buffering, real-action wall/progress codes, lifecycle closure, query/mutation `fetchStream` refusal, physical upstream cancellation, or stream receipt scans. The claimed source duration is hardcoded rather than measured (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:127-133,323-335`). The RFC accurately lists most omissions (`llp/0076-bounded-streamed-actions.rfc.md:277-285`).

   Rust wall/idle/rate tests directly manufacture host state instead of traversing the required action → mutation → commit → push path (`src/server.rs:30055-30120`; `llp/0076-bounded-streamed-actions.rfc.md:262-264`). The Workerd witness checks only full pull, visible chunk size, total-byte refusal, and reader cancellation (`cloudflare/test/acceptance.egress.mjs:253-281`).

   `_UNSUPPORTED` and `SNAPBACK_REPLY_PROGRESS_RATE_EXCEEDED` are absent from both handler-envelope allowlists and fold to `SNAPBACK_HANDLER_FAILED` (`src/runtime.rs:2884-2923`; `packages/snapback-harness/envelope.mjs:16-59`). Workerd also discards structured diagnostic details when reconstructing host-call errors (`packages/snapback-harness/workerd/handler-server.mjs:476-487`). The retained local receipt still carries the retired target alias (`demos/competitive-checkpoint/acceptance/results/local-streaming.v0.json:1-10`).

   Resolve this with a machine-readable acceptance matrix mapping each bullet and target to a command, revision, assertions, and receipt. Add barriers for blocked reads and mutation precommit, upstream close timestamps, buffer high-water, lifecycle races, exact action-envelope codes, and privacy scans.

8. **Moderate — LLP 0075’s authoring and change-control contracts are not yet reconciled.**

   LLP 0075 requires generated references and prohibits stringly function names, but both the RFC example and fixture call mutations by string (`llp/0075-convex-checkpoint-protocol.spec.md:179-190`; `llp/0076-bounded-streamed-actions.rfc.md:60-74`; `demos/competitive-checkpoint/snapback/handlers.mjs:160-178`). The RFC acknowledges that a prospective amendment is required (`llp/0076-bounded-streamed-actions.rfc.md:346-349`).

   LLP 0075 also snapshots Draft LLP 0076 as of 2026-07-22 and requires a prospective amendment for outcome-affecting changes (`llp/0075-convex-checkpoint-protocol.spec.md:87-96`). The substantial 2026-07-23 settlement and retry revisions are not among protocol v0.3’s listed amendments (`demos/competitive-checkpoint/acceptance/protocol.v0.json:32-41`).

   Convert the canonical pattern to generated references and prospectively amend LLP 0075 plus the JSON protocol before any rerun.

9. **Moderate — streamed requests do not inherit ordinary fetch’s opaque-secret boundary.**

   The RFC says streams use the same secret-redaction policy as ordinary outbound fetch (`llp/0076-bounded-streamed-actions.rfc.md:53-57`). Accepted LLP 0036 requires action-only opaque handles and host-boundary unwrap/redaction (`llp/0036-app-secrets-and-config.rfc.md:562-597`).

   Workerd descriptor handles cannot expose their values; ordinary `ctx.fetch` accepts secret placement slots, but `ctx.fetchStream` forwards only raw URL, headers, body, and key (`packages/snapback-harness/ctx-bootstrap.js:195-229,774-824`). The coordinator’s streamed open path performs no descriptor resolution or value-aware scrubbing (`cloudflare/src/coordinator.js:1819-1835`), unlike ordinary host fetch (`cloudflare/src/coordinator.js:2071-2103`).

   Either add the same per-function opaque placement seam to streamed requests and witness it, or explicitly exclude secret-bearing streams from v1. The latter would materially narrow the intended AI-provider use case.

5. **Suggestions**

- Replace the opening example with complete pseudocode showing generated mutation references, progress-result handling, committed-winner return, terminal CAS, and `finally` cancellation.

- Move the safety-critical attempt lease, terminalizer, throttle, offset, and digest logic into a generated or host-owned coordinator. The current reference implementation getting several author obligations wrong is evidence that these should not be repeated manually by each application.

- Distinguish the host’s attempted-mutation abuse fence from the application’s committed-progress limit. Both hosts currently consume their timestamp before commit, including for failed or unrelated nested mutations (`src/server.rs:1048-1066`; `cloudflare/src/host-ops.js:275-285,520-522`). A generic stream-mutation code would be clearer than `SNAPBACK_REPLY_*`.

- Bound or eliminate closed-cursor tombstones, which currently grow with every sequential open/cancel during an invocation (`src/server.rs:811-813`; `cloudflare/src/coordinator.js:1722-1735`).

- Use one canonical URL parser across targets and document the presently implicit method, request-body, header-count, header-size, URL-size, response-header truncation, and redirect rules (`src/server.rs:1194-1255`; `cloudflare/src/coordinator.js:1760-1817`).

- Name the exact hosted narrow-proof target. The positive Cloudflare artifact is app-specific, while LLP 0075 has prospectively selected `single-instance-container-vm.v1` for the hosted checkpoint (`cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json:1-21`; `llp/0075-convex-checkpoint-protocol.spec.md:120-127,367-372`).

6. **Open questions**

- What exact fact does `ambiguous` add beyond `effectMayHaveExecuted`, especially after response metadata?

- Which lifecycle event maps to which terminal cause and effect certainty, and what is the maximum cancellation-to-upstream-close latency?

- Does explicit reader cancellation itself durably settle an attempt, or must it always follow a durable cancellation winner?

- What queues count toward 64 KiB, is the bound per cursor or invocation, and are concurrent reads rejected or serialized?

- How is provider idempotency recognition established without client influence, and how is “mutation committed but acknowledgement lost” resolved?

- Does the 30-second deadline start before request initiation, before metadata fetch, or only after cursor creation, and which code wins against the action watchdog?

- Should target support mean only the bounded reader transport, or also the durable progress, retry, settlement, and cancellation pattern?

- How does LLP 0070’s `cancelRequested` state race success, failure, lease expiry, and cursor cancellation? Its current state machine specifies no outgoing terminal transition from `cancelRequested` (`llp/0070-durable-background-work.rfc.md:64-83`).

- Are authenticated secret-bearing AI-provider streams part of v1 on every claimed target?

7. **Verdict**

Verdict: NOT READY

Internal settlement contradictions, missing authority/cancellation/retry fences, false-positive capability claims, and incomplete end-to-end evidence must be resolved before acceptance or LLP 0074 gate 2.

## Round 4 — 2026-07-23

**Revision under review:** `llp/0076-bounded-streamed-actions.rfc.md`, sha256 `40a2b735d031bd7b45a13132b00716e95519ad34a4f402015061510bf6446201` (document pin MATCH; HEAD moved from `7e5b54b8` to `23578f49` mid-review via a concurrent commit that did not touch the reviewed paths, per the reviewer's diff check)
**Runtime detail:** codex session id 019f8e41-d7ce-7db0-b59d-3a0d0690daf9, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Inspected both hosts, the shim, witnesses, manifests, and the action-watchdog timing; did not build.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check**

**MISMATCH at capture time; the document pin itself MATCHES.** Before review, I ran `shasum -a 256 llp/0076-bounded-streamed-actions.rfc.md` and `git rev-parse --short HEAD`; they returned the requested SHA-256 `40a2b735d031bd7b45a13132b00716e95519ad34a4f402015061510bf6446201` and HEAD `7e5b54b8`. A final recheck returned the same document hash but HEAD `23578f49`. `git diff --name-only 7e5b54b8..23578f49 -- <reviewed paths>` was empty, so the intervening commit did not change the reviewed evidence.

The implementation and witness checks cover the on-disk working tree: `git status --short -- <reviewed paths>` showed relevant implementation files modified and several fixture/witness files untracked, so those facts are not reproducible from the pinned commit alone. `./ref-check --verbose` completed with 84 LLP documents, 1,779 references, zero errors, and one unchecked annotation.

2. **Overall assessment**

This is a good idea and largely the right architecture: action-only, pull-driven response consumption; ordinary nested mutations as the durable progress boundary; explicit finite limits; and no pretense that an action itself is transactional or returns a streamed client response. The frozen numeric bounds agree exactly with LLP 0075 and its protocol JSON.

The RFC is also unusually candid about what remains unfinished. Unfortunately, several unfinished items are central semantics rather than routine implementation work. The meaning of `ambiguous` and the effect-certainty axis is not closed; the existing `Initiated` fact cannot prove provider initiation; retry classification trusts an unverified key; concurrent retries can corrupt progress; and the reference implementation violates its own durable-winner rule.

The Revised claim is therefore only partly supported. The shared Ibex/Workerd reader surface, live capability predicate, named diagnostic families, local native-push witness, and Workerd regression witness exist. They do not yet establish the promised backpressure, authority, settlement, secret-placement, diagnostic-envelope, or target-parity contract. This RFC is a strong design and gap ledger, but it is not yet sound enough to accept as gate-2 semantic authority.

3. **Strengths**

- The scope boundary is clear: upstream bytes are consumed only by actions and durable visibility still comes from ordinary commits and live queries (`llp/0076-bounded-streamed-actions.rfc.md:49-60`, `llp/0028-cron-scheduled-execution.rfc.md:377-404`).

- The five frozen bounds match exactly: 1 MiB, 64 KiB, 30 seconds, 5 seconds, and 10 commits/second (`llp/0076-bounded-streamed-actions.rfc.md:99-115`, `llp/0075-convex-checkpoint-protocol.spec.md:249-267`, `demos/competitive-checkpoint/acceptance/protocol.v0.json:69-78`).

- The layered-fence model correctly acknowledges that prior mutation commits remain visible and that terminal checks belong inside each progress transaction (`llp/0076-bounded-streamed-actions.rfc.md:145-179`, `llp/0028-cron-scheduled-execution.rfc.md:531-536`).

- The implementation surface is real rather than aspirational: target-neutral request/chunk types and default refusal exist (`src/runtime.rs:86-161`), the shared reader bridge exists (`packages/snapback-harness/ctx-bootstrap.js:804-884`), and both local and Workerd hosts implement open/read/cancel operations (`src/server.rs:1179-1450`, `cloudflare/src/coordinator.js:1719-2043`).

- The local happy path genuinely traverses action → nested mutation → commit → native WebSocket observation and asserts three-plus intermediate commits with ordered final content (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:100-137`, `demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:323-367`).

- All named diagnostic families exist literally in producers or registries, including `_UNSUPPORTED`; `_CANCELLED` is deliberately only an internal cancellation reason (`llp/0076-bounded-streamed-actions.rfc.md:235-260`, `src/runtime.rs:138-160`, `src/server.rs:1048-1063`, `src/server.rs:1347-1466`, `cloudflare/src/coordinator.js:2024-2027`).

- The evidence ledger accurately identifies most outstanding blockers and respects LLP 0074’s rule that Draft authority cannot close gate 2 (`llp/0076-bounded-streamed-actions.rfc.md:304-412`, `llp/0074-convex-competitive-strategy.rfc.md:217-231`).

4. **Concerns**

1. **Major — The settlement model is not a closed state machine.** `ambiguous` remains both a terminal cause and a proxy for effect uncertainty, while an equally uncertain mid-body failure is represented as `failed + effect-may-have-executed`; the RFC itself still asks what `ambiguous` adds (`llp/0076-bounded-streamed-actions.rfc.md:181-215`, `llp/0076-bounded-streamed-actions.rfc.md:431-433`). The reference schema contains only one `status` field (`demos/competitive-checkpoint/snapback/schema.mjs:16-30`). Moreover, LLP 0059’s `Initiated` acknowledges synchronous invocation **or synchronous refusal**, so it cannot prove that a provider may have acted (`llp/0059-session-projection-and-client-barrier.spec.md:1209-1215`, `src/auth/service_fence.rs:208-214`). The bridge currently calls it in `finally` even though request validation happens afterward (`packages/snapback-harness/ctx-bootstrap.js:807-825`, `src/server.rs:1186-1255`). Resolve this with closed enums for local terminal cause, request/effect certainty, and retry disposition; define every legal combination and derive the five compatibility settlement kinds from that model. Use a distinct conservative host fact rather than repurposing the authority-permit acknowledgement.

2. **Major — Retry/idempotency can under-report uncertainty and corrupt content.** A keyed non-GET is currently classified as retry-safe from mere field presence despite the RFC admitting that provider recognition is unverified (`llp/0076-bounded-streamed-actions.rfc.md:208-224`). Both hosts allow an explicit `Idempotency-Key` header to override the metadata field but still classify from the metadata field, so the provider-visible key and retry classification can disagree (`src/server.rs:1274-1313`, `cloudflare/src/coordinator.js:1819-1853`). Separately, repeated starts share an attempt without a runner lease, duplicate sequence numbers require no byte offset or digest match, and the action discards an `applied:false` response (`demos/competitive-checkpoint/snapback/handlers.mjs:21-32`, `demos/competitive-checkpoint/snapback/handlers.mjs:63-86`, `demos/competitive-checkpoint/snapback/handlers.mjs:158-171`). This conflicts with LLP 0070’s fenced-at-least-once model and LLP 0028’s whole-action cron replay behavior (`llp/0070-durable-background-work.rfc.md:96-100`, `llp/0070-durable-background-work.rfc.md:128-130`, `llp/0028-cron-scheduled-execution.rfc.md:294-319`). Resolve with a trusted provider declaration, one canonical provider-visible key, a canonical request digest, a single-runner lease/generation, and offset-plus-digest validation. Exclude automatically retried cron/durable invocations until those bindings exist.

3. **Major — The reference pattern violates durable-winner precedence.** The RFC says the committed row wins every settlement race (`llp/0076-bounded-streamed-actions.rfc.md:204-206`). `settleReply` returns that winner, but `streamReply` ignores the return value and reports its own inferred status (`demos/competitive-checkpoint/snapback/handlers.mjs:105-114`, `demos/competitive-checkpoint/snapback/handlers.mjs:184-192`). `completeReply` also maps every non-running state through a cancellation-shaped error (`demos/competitive-checkpoint/snapback/handlers.mjs:89-102`). Cancellation while blocked on the slow source can therefore leave a durable `cancelled` row while the action returns `timed_out`; the current test cancels only after progress and misses this race (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:160-208`). Resolve with one terminal compare-and-set mutation whose typed result always becomes the action result, plus barrier-controlled cancellation/timeout/completion races.

4. **Major — Authority loss and cancellation do not yet fence a blocked pull through byte handoff.** The RFC promises service-authority validation on every operation (`llp/0076-bounded-streamed-actions.rfc.md:130-154`), but local `validate_live` checks only abandonment, generation, and deadline (`src/server.rs:864-880`). Workerd captures a cursor, awaits the native pull, and can return bytes without checking whether concurrent cancellation removed that cursor (`cloudflare/src/coordinator.js:1899-2015`, `cloudflare/src/coordinator.js:2030-2036`). Durable cancellation also has no direct attempt-to-cursor signal, while lifecycle abandonment can leave the authored row permanently `running`; the RFC acknowledges both gaps (`llp/0076-bounded-streamed-actions.rfc.md:329-341`). Resolve with attempt-bound cursor identity and an exact permit or epoch rechecked after every await, plus a trusted terminal compare-and-set/reconciler independent of the abandoned action.

5. **Major — The resource profile is not enforced with the stated semantics.** Local has no 64 KiB buffer counter, the shared reader permits concurrent outstanding reads, and Workerd lacks a per-cursor pull mutex (`src/server.rs:760-771`, `packages/snapback-harness/ctx-bootstrap.js:835-845`, `cloudflare/src/coordinator.js:1899-1999`). Both hosts start their 30-second clock after response metadata, not before the outbound operation (`src/server.rs:1282-1334`, `cloudflare/src/coordinator.js:1823-1879`); local also cannot bound a blocking read by the remaining wall budget (`src/server.rs:1363-1408`). The default action watchdog is itself 30 seconds and its execution deadline is up to 50 ms earlier, so a default action cannot reach the stream’s 30-second timeout and then durably settle it (`src/server.rs:745-764`, `src/server.rs:1626-1643`). Finally, the 100 ms fence records mutation admission rather than successful commit linearization (`src/server.rs:1048-1067`, `cloudflare/src/host-ops.js:275-285`, `cloudflare/src/host-ops.js:513-522`). Resolve by defining the exact buffer accounting domain, serializing pulls, carrying one deadline from pre-fetch through terminal read, reserving terminalization grace outside the action watchdog, and measuring spacing at successful commit.

6. **Major — The diagnostic contract is not preserved end to end.** The exact names exist, but `_UNSUPPORTED` and `SNAPBACK_REPLY_PROGRESS_RATE_EXCEEDED` are omitted from both handler allowlists and therefore fold to `SNAPBACK_HANDLER_FAILED` (`src/runtime.rs:2884-2923`, `packages/snapback-harness/envelope.mjs:12-58`). Trusted host errors construct operation, limit, received-summary, and repair details, but the settlement wrapper and both decoders retain only code and message (`packages/snapback-harness/ctx-bootstrap.js:1049-1074`, `src/runtime.rs:2261-2287`, `packages/snapback-harness/workerd/handler-server.mjs:455-488`, `packages/snapback-harness/envelope.mjs:61-89`). Malformed-request diagnostics also retain raw deserializer text, which can contradict the value-free requirement (`src/runtime.rs:1374-1387`, `llp/0076-bounded-streamed-actions.rfc.md:228-233`). Resolve with a trusted structured error envelope that preserves scrubbed details without permitting handler-forged codes, and test every code/detail field through the public action result.

7. **Major — Capability and frozen-fixture authorities currently contradict the evidence.** LLP 0074 forbids gate closure until LLP 0076 is accepted with executable witnesses (`llp/0074-convex-competitive-strategy.rfc.md:217-231`). Nevertheless, positive capability membership already authorizes admission and manifests mark buffered bytes `Enforced` (`src/manifest.rs:3031-3033`, `src/manifest.rs:3385-3410`, `src/manifest.rs:3452-3463`, `src/manifest.rs:3645-3675`, `demos/competitive-checkpoint/snapback/generated/capability.manifest.json:44-68`, `demos/competitive-checkpoint/snapback/generated/capability.manifest.json:115-124`). Cloudflare makes the same positive claim and asserts evidence its regression witness does not contain (`cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json:17-20`, `cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json:57-77`, `cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json:138`). Separately, LLP 0075 requires prospective amendment for outcome-affecting authority changes, but its JSON remains single-axis and its generated-reference-only rule conflicts with the string mutation names in the reference pattern (`llp/0075-convex-checkpoint-protocol.spec.md:87-96`, `llp/0075-convex-checkpoint-protocol.spec.md:171-190`, `demos/competitive-checkpoint/acceptance/protocol.v0.json:78`, `demos/competitive-checkpoint/snapback/handlers.mjs:139-192`). Demote the capability to non-admissible experimental maturity, mark unproved limits `Missing`, convert the fixture to generated references, and prospectively amend LLP 0075 and the JSON for the closed two-axis model.

8. **Major — The accepted secret-placement contract is absent from streamed fetch.** LLP 0036 requires opaque handles, host-boundary placement, and value-aware scrubbing (`llp/0036-app-secrets-and-config.rfc.md:562-604`). The stream path forwards raw URL/header/body/key strings (`cloudflare/src/coordinator.js:1751-1822`), while only ordinary fetch resolves secret descriptors and constructs a redactor (`cloudflare/src/coordinator.js:2045-2103`). This directly contradicts the RFC’s claim that streaming shares ordinary fetch’s secret policy (`llp/0076-bounded-streamed-actions.rfc.md:64-67`) and is acknowledged as a mandatory gap (`llp/0076-bounded-streamed-actions.rfc.md:378-384`). Resolve by adding the same opaque placement seam and staged-value redactor to stream open, then scan action envelopes, receipts, response errors, URLs, and private bytes.

9. **Major — The acceptance contract is not currently executable as claimed.** The local witness proves ordered happy-path bytes and three-plus commits, but reports the 800 ms duration as a constant; its retry test only repeats `startReply`, and its cancellation test checks row stability rather than upstream socket closure (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:100-188`, `demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:323-335`). Direct host tests cover several codes but do not satisfy the RFC’s real action/mutation/commit path requirement (`src/server.rs:29994-30120`, `llp/0076-bounded-streamed-actions.rfc.md:300-302`). The Workerd witness uses only 8×4096-byte chunks at 25 ms and proves pull size, total refusal, and reader cancellation—not durable progress, wall/idle/rate settlement, authority loss, certainty, or secrets (`cloudflare/test/acceptance.egress.mjs:111-130`, `cloudflare/test/acceptance.egress.mjs:253-339`). Its harness explicitly describes Miniflare as a regression surface, not hosted evidence (`cloudflare/test/harness.mjs:1-13`). Require a per-bullet receipt matrix on every manifest-positive target, including the protocol’s next executable `single-instance-container-vm.v1` target (`demos/competitive-checkpoint/acceptance/protocol.v0.json:56-60`).

10. **Moderate — The normative surface is broader than the non-goals suggest.** Arbitrary HTTP(S), six methods, headers/body, a custom reader, and async iteration amount to a general bounded response-byte API (`llp/0076-bounded-streamed-actions.rfc.md:64-128`). Neither host rejects `text/event-stream`, so the SSE non-goal can only exclude framing/reconnect semantics, not consuming SSE bytes (`llp/0076-bounded-streamed-actions.rfc.md:414-421`, `src/server.rs:1179-1345`, `cloudflare/src/coordinator.js:1751-1885`). The host also rate-fences every nested mutation whenever any cursor is open, changing unrelated action behavior (`llp/0076-bounded-streamed-actions.rfc.md:254-260`, `src/server.rs:1048-1066`). Resolve by stating the byte-stream commitment precisely and moving progress throttling behind an explicit generated progress primitive, or narrowing the admitted surface.

5. **Suggestions**

- Encode `minimumProgressSpacingMs: 100`, its clock point, and whether failed attempts consume a slot in the protocol JSON; `authoritativePatchRatePerSecond: 10` alone is underspecified (`demos/competitive-checkpoint/acceptance/protocol.v0.json:77`).

- Add a target conformance table mapping every limit, settlement combination, diagnostic, and acceptance bullet to a named executable receipt.

- Refuse redirects in v1 or specify hop count, cross-origin header behavior, request replay, idempotency-key handling, and effect certainty; both hosts currently use default redirect behavior (`src/server.rs:1262-1286`, `cloudflare/src/coordinator.js:1829-1835`).

- Bound or evict closed-cursor tombstones; both hosts retain every closed UUID until invocation completion despite only bounding concurrently open cursors (`src/server.rs:1347-1450`, `cloudflare/src/coordinator.js:1722-1735`, `cloudflare/src/coordinator.js:2018-2042`).

- Remove `releaseLock()` from v1 if reader transfer is intentionally unsupported; the current implementation never clears its `locked` flag (`packages/snapback-harness/ctx-bootstrap.js:826-855`).

- State numeric URL/header/body/key admission bounds in the RFC or explicitly classify them as target-local safeguards; the code enforces numbers not present in the claimed sole numeric authority (`llp/0076-bounded-streamed-actions.rfc.md:99-115`, `src/server.rs:1194-1255`).

6. **Open questions**

- Is `ambiguous` durable authority, or a derived compatibility/retry-policy view over effect certainty?

- What exact host-observable event separates `not_sent_proven` from `may_have_executed`, given synchronous refusal and redirects?

- Who may declare provider idempotency semantics, and how are that declaration, the effective key, and the canonical request digest bound to an attempt?

- Who terminalizes the durable row when generation, service authority, or watchdog abandonment prevents the action from committing?

- What queues count toward 64 KiB, and are concurrent `read()` calls rejected or serialized?

- Does v1 exclude cron and LLP 0070 durable-job execution until a runner lease exists, or must this RFC define that binding now?

- Must every manifest-positive target pass every acceptance bullet, including the selected hosted target?

- Is progress cadence measured at admission, commit linearization, or successful completion?

7. **Verdict**

Verdict: NOT READY

The core settlement, retry, lifecycle-fencing, boundedness, and capability-evidence contracts require resolution before this RFC can serve as accepted gate-2 authority.

## Round 5 — 2026-07-23

**Revision under review:** `llp/0076-bounded-streamed-actions.rfc.md`, sha256 `983749efaca5ea8497fce081ee0741d6a51efa061965b0dedc60b123b53fef89` (MATCH at repo HEAD `56534268`)
**Runtime detail:** codex session id 019f8e53-24cd-7530-8e11-05518bcfd763, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Inspected both hosts, the shim, witnesses, manifests, guide, and the action-runtime clock restrictions; did not build.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check**

**MATCH.**

- `shasum -a 256 llp/0076-bounded-streamed-actions.rfc.md` → `983749efaca5ea8497fce081ee0741d6a51efa061965b0dedc60b123b53fef89`
- `git rev-parse --short HEAD` → `56534268`

Both the document pin and repository revision match the requested review target.

2. **Overall assessment**

This is a good proposal in direction and scope. It correctly avoids promising a general client-facing streaming API, fixes concrete resource bounds, separates workflow settlement from external-effect certainty, and recognizes that retries become unsafe once durable progress is visible. The low-level reader is real and shared by the Ibex and Workerd arms, and the numeric profile agrees with LLP 0075’s frozen fixture (`llp/0076-bounded-streamed-actions.rfc.md:63-144`; `llp/0075-convex-checkpoint-protocol.spec.md:249-267`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:69-78`).

It is not yet a complete semantic authority, however. The RFC’s most important safety mechanisms—trusted terminalization, attempt identity, runner leases, crash-safe effect classification, asynchronous cancellation, and per-read authority fencing—are requirements without an implementable ownership or transport design. The current implementation provides the bounded reader primitive, but not the durable control plane required to enforce the RFC’s settlement guarantees (`llp/0076-bounded-streamed-actions.rfc.md:176-278,380-468`).

That distinction matters because `bounded_response_stream_v1` is already positively advertised, guide material describes it as shipped, and LLP 0074 treats false-positive capability claims as a gate failure. LLP 0074 gate 2 should therefore remain open until the durable semantics and executable receipts exist (`llp/0074-convex-competitive-strategy.rfc.md:217-231,341-343`).

3. **Strengths**

- The scope is disciplined: an action-only pull reader, no direct client byte stream, and explicit exclusions for uploads, arbitrary streaming, and premature durable-work reuse (`llp/0076-bounded-streamed-actions.rfc.md:63-71,76-113,475-487`).

- The frozen numeric profile matches LLP 0075 and `protocol.v0.json`: 16 chunks at 800 ms, at least three progress commits, 1 MiB total, 64 KiB chunks, 30-second wall time, 5-second idle time, 10 progress writes per second with 100 ms spacing, four cursors, and the same five settlement kinds (`llp/0076-bounded-streamed-actions.rfc.md:115-144,197-204`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:69-78`).

- The two-axis model is an important improvement over a single status field. Separating workflow outcome from external-effect certainty, refusing retries after visible progress, and requiring a single-runner lease are sound foundations (`llp/0076-bounded-streamed-actions.rfc.md:197-219,243-278`; `llp/0070-durable-background-work.rfc.md:96-106,122-130`).

- The shared reader surface exists. Ibex embeds the common bootstrap (`src/runtime.rs:2766-2771`), Workerd imports it (`cloudflare/src/handler-worker.js:11-16`), and the bootstrap implements `read`, idempotent `cancel`, terminal-only `releaseLock`, and async iteration (`packages/snapback-harness/ctx-bootstrap.js:804-891`).

- The capability identifier and instance predicate exist in the closed manifest machinery (`src/manifest.rs:2961-3033`; `schemas/capability.manifest.schema.json:160-173`). The named diagnostic literals also exist across the runtime implementations (`src/runtime.rs:138-160`; `src/server.rs:1048-1066,1186-1435`; `cloudflare/src/coordinator.js:2024-2028`).

- The local happy-path witness exercises the valuable end-to-end chain—action, nested mutation, and live WebSocket observation—with ordered chunks and at least three durable commits (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:100-137`). Cloudflare also has direct reader tests for pull behavior, chunk sizing, the total-byte limit, and idempotent cancellation (`cloudflare/test/acceptance.egress.mjs:253-281`).

- The implementation ledger is unusually candid about what remains missing. It identifies the terminalizer, lease, authority fence, wall timer, buffer proof, admission rule, capability overclaim, diagnostic envelope, and cross-authority work instead of presenting them as complete (`llp/0076-bounded-streamed-actions.rfc.md:358-468`).

4. **Concerns**

1. **Major — The trusted terminalizer and single-runner lease do not yet have an implementable ownership model.**

   The RFC makes durable progress an authored pattern, then requires a trusted terminalizer and lease that can act after the original authority disappears (`llp/0076-bounded-streamed-actions.rfc.md:176-195,243-269`). The host request contains no attempt identity, lease generation, progress-row reference, or terminalization plan (`src/runtime.rs:86-103`). The demo schema likewise has status, attempt count, idempotency key, sequence, and timestamps, but no runner generation or terminalizer capability (`demos/competitive-checkpoint/schema.mjs:16-31`); opening the stream supplies no such token (`demos/competitive-checkpoint/handlers.mjs:139-150`).

   Consequently, the generic runtime has no trusted way to locate an application-defined progress row, prove which runner owns it, or perform its terminal CAS. Resolve this by specifying a host-owned `StreamAttemptV1` record or registered terminalization plan and an opaque attempt token binding fetch, progress, cancellation, lease renewal/takeover, and terminal settlement.

2. **Major — `wireInitiated` and idempotent retry classification are neither crash-safe nor trustworthy.**

   The RFC requires a durable `wireInitiated` fact after bytes are handed to the outbound stack (`llp/0076-bounded-streamed-actions.rfc.md:209-219,247-256`). A crash between transmission and durable publication loses precisely the fact needed to distinguish `failed` from `ambiguous`. The current implementations also treat mere presence of an idempotency key as enough to avoid ambiguity (`src/server.rs:1287-1314`; `cloudflare/src/coordinator.js:1836-1854`), while the RFC itself acknowledges that an author assertion or unrecognized key can underreport effects (`llp/0076-bounded-streamed-actions.rfc.md:234-241,271-278`).

   This permits duplicate effects if a caller supplies a key that the provider ignores. Use a conservative durable state such as `definitely_not_initiated | initiation_possible | response_observed`, premarking uncertainty before transmission, and require a trusted provider/method declaration before treating a key as retry-safe. A phase × trigger × method × provider-recognition table should define settlement, certainty, retry permission, and diagnostic mapping.

3. **Major — The reader lifecycle conflicts with accepted authority and secret-handling rules.**

   LLP 0059 requires all application-controlled request normalization before `Begin` and ends the permit after synchronous native invocation or refusal (`llp/0059-authority-lifecycle.spec.md:1209-1215`). The shared bridge begins authority before evaluating the request URL, headers, body, and key and retains it through the asynchronous start operation (`packages/snapback-harness/ctx-bootstrap.js:807-824`). Local liveness validation checks abandonment, application generation, and deadline, but not the complete service-authority predicate (`src/server.rs:864-880`). A blocking read is validated before awaiting upstream data, with no post-read discard fence (`src/server.rs:1347-1435`), exactly the gap the RFC records (`llp/0076-bounded-streamed-actions.rfc.md:383-388`).

   In addition, ordinary `ctx.fetch` supports opaque secret slots, while `fetchStream` accepts raw URL/header/body fields (`packages/snapback-harness/ctx-bootstrap.js:774-824`). That does not satisfy LLP 0036’s opaque-handle placement and redaction contract (`llp/0036-outbound-egress.rfc.md:562-604`).

   Resolve this by normalizing only trusted values before `Begin`, using a narrowly scoped permit per pull, rechecking authority after every blocking read before returning bytes, discarding late bytes, and reusing the opaque secret-descriptor and redaction seam.

4. **Major — The stated backpressure, buffer, and deadline bounds are not presently enforced as defined.**

   The bridge does not prevent multiple outstanding `reader.read()` calls on one cursor (`packages/snapback-harness/ctx-bootstrap.js:826-845`). Workerd consequently may have multiple underlying reads pending and only validates each returned chunk independently (`cloudflare/src/coordinator.js:1942-1999`). Local cursor state has no buffered-byte accounting (`src/server.rs:766-771`). Thus “64 KiB per-action fetchStream buffer” is currently a chunk-size assertion, not a measured bound covering host, bridge, VM, pending promises, copies, and multiple cursors.

   The local implementation checks the 30-second wall limit before a blocking read, not after it, while its HTTP client configuration also applies five-second request/read-related timeouts (`src/server.rs:1258-1267,1363-1435`). The resulting timeout precedence and diagnostic are not the profile described by the RFC.

   Require at most one outstanding pull per cursor, define exactly which representations and whether wire or decoded bytes count toward 64 KiB, instrument peak buffered memory, and bind each blocking read to the minimum remaining wall/idle deadline with a post-read check.

5. **Major — Durable caller cancellation is not connected to physical stream cancellation or the authoritative settlement winner.**

   The RFC says caller cancellation may be observed at the next progress mutation (`llp/0076-bounded-streamed-actions.rfc.md:167-172`), yet also requires prompt physical closure and no later writes (`llp/0076-bounded-streamed-actions.rfc.md:343-350`). If the runner is blocked waiting for bytes, no mutation occurs to deliver cancellation, so the connection remains open until another byte or watchdog timeout.

   The demo’s settlement mutation returns the durable CAS winner (`demos/competitive-checkpoint/handlers.mjs:105-114`), but the action discards that value and returns its locally selected status (`demos/competitive-checkpoint/handlers.mjs:184-192`). Its completion helper also maps any already-terminal row to `cancelled`, rather than returning the actual winner (`demos/competitive-checkpoint/handlers.mjs:89-103`). The acceptance test checks that sequence stops changing for 250 ms, not that the upstream socket closes (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:160-188`).

   Add an attempt-scoped abort channel from durable settlement to the live cursor, require every completion path to return the durable CAS winner, and test the cancellation/read race with observable upstream close plus an indefinite no-more-bytes source.

6. **Major — `bounded_response_stream_v1` is already a positive capability claim despite acknowledged semantic gaps.**

   The identifier is live in the schema and closed enum (`src/manifest.rs:2961-3033`; `schemas/capability.manifest.schema.json:160-173`). The local predicate relies partly on a registration fact that is statically true (`src/manifest.rs:3071-3097`) and generated local manifests advertise support and enforced buffer limits (`schemas/capability.manifest.local-dev-sqlite-ibex.outbound-actions.json:54-68,115-124`). Cloudflare’s generated manifest claims the full timeout, progress, watchdog, and typed-settlement profile (`cloudflare/generated/capability.manifest.all-aboard.json:17-20,63-76,132-140`), although its cited acceptance test covers only the raw-reader subset (`cloudflare/test/acceptance.egress.mjs:253-281`). The guide likewise marks the capability shipped (`guide/backend/actions-and-fetch.md:9-13,96-131`; `guide/capabilities.md:43`).

   LLP 0058 makes positive support a meaningful compatibility assertion, not simply proof that a symbol was registered (`llp/0058-capability-manifests.spec.md:302-339`). Retract the positive identifier until the profile passes its receipts, or split it into a truthful raw-reader capability and a separate durable streamed-action protocol capability.

7. **Major — The frozen fixture and current witnesses do not cover the RFC’s complete observable contract.**

   The numeric bounds and five settlement kinds match, but effect certainty is now a mandatory second axis (`llp/0076-bounded-streamed-actions.rfc.md:197-219`) and is absent from the frozen fixture (`demos/competitive-checkpoint/acceptance/protocol.v0.json:69-78`). LLP 0075 requires prospective amendment for post-freeze changes that affect observable outcomes (`llp/0075-convex-checkpoint-protocol.spec.md:87-96`). Calling certainty “not a sixth settlement kind” does not remove the need to version its schema and evidence.

   Existing local acceptance proves ordered happy-path progress, start-row deduplication, and selected terminal labels (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:100-147,194-236`). It does not prove interrupted-stream idempotent retry, slow-consumer peak buffering, physical cancellation, two-axis output, all lifecycle closure paths, or secret privacy. Exact wall/idle/progress codes are covered by direct host tests with injected state rather than the required real action-to-live-query path (`src/server.rs:30055-30120`). The Cloudflare witness is also not a receipt for LLP 0075’s currently selected hosted adapter, `single-instance-container-vm.v1` (`llp/0075-convex-checkpoint-protocol.spec.md:120-127,367-372`).

   Amend LLP 0075 and `protocol.v0.json` prospectively, then provide a named receipt for every RFC acceptance bullet on both the local arm and the selected hosted target.

8. **Moderate — Diagnostic literals exist, but exact structured diagnostics do not survive the full transport path.**

   The runtime envelope’s passthrough set omits at least `SNAPBACK_FETCH_STREAM_UNSUPPORTED` and `SNAPBACK_REPLY_PROGRESS_RATE_EXCEEDED`, allowing them to collapse to `SNAPBACK_HANDLER_FAILED` (`src/runtime.rs:2884-2923`; `packages/snapback-harness/envelope.mjs:16-58`). The Workerd handler transport discards diagnostic details (`packages/snapback-harness/workerd/handler-server.mjs:476-488`). Rust FFI stringifies errors, and `Display` preserves only code and message; the final parser reconstructs only limited fields (`src/runtime.rs:2261-2287,2431-2434`; `src/diagnostic.rs:189-195`). That does not meet the RFC’s structured diagnostic contract (`llp/0076-bounded-streamed-actions.rfc.md:280-287`).

   Define one structured diagnostic representation across host operations, FFI, handler envelopes, and action results, and test every required code plus its stable detail fields end to end.

9. **Moderate — The canonical example cannot be implemented on the documented action surface.**

   The example uses `Date.now()` and does not demonstrate lease acquisition, sequence/offset validation, terminal CAS, cleanup, or returning the durable winner (`llp/0076-bounded-streamed-actions.rfc.md:85-102`). `Date.now()` is denied in both action runtimes (`src/runtime.rs:2638-2660`; `packages/snapback-harness/workerd/strip.mjs:228-259`), while `ctx.runtime.now` is fixed for the invocation rather than a monotonic elapsed clock (`src/runtime.rs:1298`; `cloudflare/src/host-ops.js:232-240,655-656`). Authors therefore lack the clock used by the example to obey the 100 ms progress fence.

   Replace it with a complete, runnable example using a supported monotonic elapsed-time source or a host-provided progress helper that coalesces writes and performs the final terminal CAS.

10. **Major — The durable-work and cron exclusion is documentary rather than mechanically enforced.**

   The RFC records that cron/durable invocation must be rejected until a cancellation handoff exists (`llp/0076-bounded-streamed-actions.rfc.md:396-405,475-487`). Accepted LLP 0028 routes cron through the ordinary action path and permits whole-egress replay (`llp/0028-cron-scheduling.rfc.md:294-329,514-522`). The current bootstrap rejects non-actions, but does not distinguish an interactive action from a cron or durable-work action (`packages/snapback-harness/ctx-bootstrap.js:885-891`).

   Add invocation-origin metadata and an admission check that rejects cron/durable use with a stable diagnostic until the LLP 0070 handoff protocol exists.

5. **Suggestions**

- Split the capability into `bounded_response_reader_v1` for the real raw primitive and a later `durable_streamed_action_v1` for attempt leases, durable progress, cancellation, certainty, and terminalization.

- Provide a generated `ctx.runProgressMutation` or attempt handle that owns sequence numbers, offset/digest checks, rate coalescing, cancellation observation, and the terminal CAS. This would avoid applying the current action-wide nested-mutation rate fence mechanically to unrelated writes (`llp/0076-bounded-streamed-actions.rfc.md:308-314`).

- Add a lifetime cursor-creation bound, not only four concurrently live cursors. Both implementations retain closed cursor identifiers, so repeated create/cancel cycles can grow tombstone state (`src/server.rs:811,1438-1450`; `cloudflare/src/coordinator.js:1722-1735,2018-2042`).

- Build a small executable state-machine model covering crash points, authority loss, cancellation, lease takeover, upstream bytes, progress CAS, and terminal CAS. Model-check invariants such as “no progress after terminal settlement” and “at most one effectful retry without trusted idempotency.”

- Publish a conformance matrix mapping every normative statement to a local receipt, hosted receipt, or explicit gap. The RFC’s current ledger is a strong start (`llp/0076-bounded-streamed-actions.rfc.md:358-468`).

6. **Open questions**

- Who owns the durable attempt ledger and terminalizer: the host, generated application code, or an application-registered plan?

- What exact token binds cursor ownership, runner generation, progress sequence, cancellation, and terminal settlement?

- Which providers and methods have trusted idempotency semantics, and how is that registry versioned?

- What is the authoritative precedence table when cancellation, timeout, upstream failure, lease loss, and uncertain external effects coincide (`llp/0076-bounded-streamed-actions.rfc.md:489-503`)?

- Are the 1 MiB and 64 KiB limits measured on wire bytes, decoded bytes, VM-visible bytes, or all retained copies, and how are concurrent cursors charged?

- What supported monotonic clock or host helper lets an action obey the 100 ms progress spacing?

- Is effect certainty part of the frozen protocol row, a diagnostic-only field, or a separate versioned record requiring an LLP 0075 amendment?

- Which hosted adapter must produce the gate-2 receipt now that Cloudflare is not LLP 0075’s selected hosted target?

7. **Verdict**

Verdict: NOT READY

The RFC has a sound core, but trusted terminalization, crash-safe effect classification, authority fencing, enforceable resource bounds, and complete conformance evidence must be resolved before it can serve as LLP 0074’s gate-2 authority.

## Round 6 — 2026-07-23

**Revision under review:** `llp/0076-bounded-streamed-actions.rfc.md`, sha256 `7ac5fff1793eeba297b71694085aeb546823b1258a196da61a90d99763de83a3` (MATCH at repo HEAD `99e8e993`)
**Runtime detail:** codex session id 019f8e68-0999-7a02-8568-dc31ad5d9f80, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Inspected both hosts, the shim, witnesses, and manifests; did not build. (Fable's concurrent round-6 review returned READY; this Codex round remained NOT READY on deeper spec-completeness items — atomic linearization point, cancellation propagation, per-cursor attempt modeling — that the author is tracking as gaps/open questions.)
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check**

**MATCH.**

- `shasum -a 256 llp/0076-bounded-streamed-actions.rfc.md` returned `7ac5fff1793eeba297b71694085aeb546823b1258a196da61a90d99763de83a3`.
- `git rev-parse --short HEAD` returned `99e8e993`.

2. **Overall assessment**

The proposal has the right overall shape: an action-only, pull-driven response stream; durable progress through ordinary mutations; explicit transport limits; and a two-axis distinction between terminal cause and external-effect certainty. The write-ahead `initiationState`, trusted terminalizer, and runner-lease concepts are sensible responses to the hardest failure modes.

The five fixture bounds and five public settlement kinds match LLP 0075 and the frozen protocol JSON exactly. A shared reader API, local and Workerd host operations, live capability predicate, diagnostic literals, and partial executable witnesses also exist.

It is nevertheless not ready for acceptance or LLP 0074 Gate 2. The atomic late-effect fence is not fully specified, cancellation cannot reliably interrupt a blocked pull, retry safety depends on an untrusted idempotency assertion, and buffering semantics remain undefined. The current code implements the transport skeleton but not the proposed durable attempt, certainty, lease, or terminalization model, while positive capability manifests already advertise support.

3. **Strengths**

- The scope is disciplined around action-side response consumption, with no streamed client response or general durable-execution promise (`llp/0076-bounded-streamed-actions.rfc.md:75-127,523-535`).

- The frozen limits—16 KiB/read, 64 KiB buffering, 2 MiB total, 30 seconds wall time, and 5 seconds idle—and the settlement kinds match both authorities exactly (`llp/0076-bounded-streamed-actions.rfc.md:129-146,216-224`; `llp/0075-convex-checkpoint-protocol.spec.md:249-267`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:69-78`).

- The three-state write-ahead model is appropriately crash-conservative and correctly distinguishes request initiation from LLP 0059’s authority permit named `Initiated` (`llp/0076-bounded-streamed-actions.rfc.md:228-253`; `llp/0059-session-projection-and-client-barrier.spec.md:1209-1215`).

- The RFC recognizes that cancellation safety requires both a trusted terminalizer and a lease-generation fence, rather than relying on cooperative authored code alone (`llp/0076-bounded-streamed-actions.rfc.md:277-312`). That direction is consistent with LLP 0070’s claim-and-fence model (`llp/0070-durable-background-work.rfc.md:85-106`).

- The shared reader surface is real and is consumed by both targets (`packages/snapback-harness/ctx-bootstrap.js:804-891`; `src/runtime.rs:2766-2770`; `cloudflare/src/handler-worker.js:11-16`). Local and Cloudflare witnesses exercise actual action-to-native streaming rather than a wholly synthetic mock (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:100-237`; `cloudflare/test/acceptance.egress.mjs:253-281`).

- All documented diagnostic names have at least a source literal or producer in the repository (`llp/0076-bounded-streamed-actions.rfc.md:323-360`; `src/runtime.rs:138-160`; `src/server.rs:1053-1063,1186-1450`; `cloudflare/src/host-ops.js:275-285`; `cloudflare/src/coordinator.js:2024-2028`).

- The evidence ledger is unusually candid about missing terminalization, buffering, cancellation, and conformance work (`llp/0076-bounded-streamed-actions.rfc.md:401-521`).

4. **Concerns**

1. **Major — The late-effect fence has no specified atomic linearization point.** The RFC first requires an authored progress mutation to check attempt and terminal state transactionally, then places the lease, terminal state, initiation state, and certainty in a host-owned `StreamAttemptV1` (`llp/0076-bounded-streamed-actions.rfc.md:180-184,205-214,281-306`). It never establishes that the host-record check and app-data patch commit atomically. A terminalizer can therefore win after the check but before the patch commits. Likewise, persisting `initiation_possible` and then sending leaves a cancel/timeout race in which the request begins after terminal settlement (`llp/0076-bounded-streamed-actions.rfc.md:228-243`). Accepted authorities promise a commit-cut fence, not a precheck (`llp/0028-cron-scheduled-execution.rfc.md:428-442`; `llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1116-1119`). Resolve this by choosing one authoritative attempt record and requiring a final-commit hook or shared serializable transaction that compares attempt generation, lease generation, and terminal absence. Request initiation needs a Begin→Initiated permit on that same record, with terminalization installing a pending marker and draining the permit before winning.

2. **Major — Cancellation cannot reliably reach a blocked upstream pull, and `reader.cancel()` has ambiguous durable meaning.** The normative pattern waits for the next progress mutation to observe cancellation (`llp/0076-bounded-streamed-actions.rfc.md:186-191`). If the action is blocked in `read()`, no mutation occurs; the RFC itself records the missing attempt-to-cursor signal (`llp/0076-bounded-streamed-actions.rfc.md:432-438`). This fails LLP 0075’s upstream-propagation requirement and the RFC’s own physical-closure acceptance criterion (`llp/0075-convex-checkpoint-protocol.spec.md:254-256`; `llp/0076-bounded-streamed-actions.rfc.md:386-393`). Furthermore, the classification maps explicit reader cancellation to `cancelled`, while the reference handler calls `reader.cancel()` as cleanup before settling other causes (`llp/0076-bounded-streamed-actions.rfc.md:255-263`; `demos/competitive-checkpoint/snapback/handlers.mjs:180-192`). Resolve this with an immediate trusted cancellation signal that prevents new pulls, aborts or drains the in-flight pull, and fences stale commits. Specify whether cursor cancellation is transport-only or itself competes for durable terminal settlement.

3. **Major — The settlement model lacks a closed legal-state and precedence table.** The fail-safe rule says effects may have executed whenever initiation is not `definitely_not_initiated`, but other normative text uses the narrower phrase “host-provable initiation” (`llp/0076-bounded-streamed-actions.rfc.md:209-214,245-246,262-263`). That can lose the precise crash uncertainty represented by `initiation_possible`. The document also leaves open what `ambiguous` adds beyond the certainty axis and does not map watchdog, lease expiry, reset, service loss, or network failure deterministically to public settlement kinds (`llp/0076-bounded-streamed-actions.rfc.md:172-178,255-275,281-290,545-549`). Resolve this with an exhaustive producer/transition table, a separate internal terminal reason, deterministic projection to the five frozen kinds, and host-only certainty derivation.

4. **Major — A single attempt record is incompatible with four concurrent upstream cursors.** V1 permits four cursors per action, but the durable pattern describes one attempt, one scalar `initiationState`, one provider-key classification, and one terminal certainty (`llp/0076-bounded-streamed-actions.rfc.md:146,195-203,299-306`). Two requests can have different initiation and response-observation states, which one scalar cannot represent. The opaque attempt token is also absent from the public surface, including how a nested mutation receives it without making it a replayable authored capability (`llp/0076-bounded-streamed-actions.rfc.md:88-127,299-306`). Resolve this by limiting each durable attempt to one upstream stream, or introduce per-request child records under a parent attempt. Keep public stable identifiers separate from non-serializable, lease-generation-bound authority handles.

5. **Major — Retry safety relies on an untrusted idempotency assertion.** A keyed non-GET may be classified as idempotent even though provider recognition is author-asserted; the RFC acknowledges that a false assertion can turn `ambiguous` into `failed` (`llp/0076-bounded-streamed-actions.rfc.md:268-275,314-321`). This is weaker than LLP 0070’s requirement for an integration-owned lookup or stable-idempotency path (`llp/0070-durable-background-work.rfc.md:122-130`). Key reuse is also unspecified: the existing start handler returns an attempt without proving identical owner, request, conversation, or provider-key bytes, and duplicate sequence writes do not validate payload identity (`demos/competitive-checkpoint/snapback/handlers.mjs:21-32,63-86`). Resolve this by treating non-GET requests as non-idempotent unless a trusted provider adapter attests the key semantics; scope client keys, persist a canonical request digest, reject changed reuse, and distinguish client dedup, server attempt, and provider idempotency keys.

6. **Major — Backpressure and byte accounting are not yet an enforceable contract.** “One reader” does not prevent concurrent `read()` calls, while the ledger admits unlimited concurrent pulls and missing aggregate-buffer accounting (`llp/0076-bounded-streamed-actions.rfc.md:118-127,464-470`). Wire versus decoded bytes, bridge/VM copies, concurrent-cursor charging, and idle timing remain open (`llp/0076-bounded-streamed-actions.rfc.md:550-551`). The shared reader forwards each call without an in-flight guard (`packages/snapback-harness/ctx-bootstrap.js:835-845`); local enforcement exposes only the 16 KiB read cap (`src/server.rs:760-771,1381-1388`); and Workerd retains per-chunk remainder rather than enforcing a defined aggregate (`cloudflare/src/coordinator.js:1981-1999`). Workerd also checks the four-cursor count before awaiting `fetch()` and inserts afterward, permitting racing opens to exceed the cap (`cloudflare/src/coordinator.js:1751-1758,1823-1835,1857-1879`). Resolve this with one in-flight pull per cursor, atomic cursor reservation, an exact counted-buffer model, a decoding boundary, and explicit per-cursor versus per-invocation accounting.

7. **Major — The progress-rate obligation is not reliably usable by action authors.** Ten commits per second is specified as a strict 100 ms minimum interval, but the example approximates it by committing every two reads while action wall time is unavailable/fixed (`llp/0076-bounded-streamed-actions.rfc.md:106-112,139-144`). Accepted action semantics provide injected deterministic time, not an ambient monotonic elapsed clock (`llp/0028-cron-scheduled-execution.rfc.md:596-610`). LLP 0075 freezes only 16 chunks over at least 800 ms, not their cadence, so a bursty conforming source can defeat the example (`llp/0075-convex-checkpoint-protocol.spec.md:165-169`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:69-78`). Resolve this by landing a host-owned progress coalescer or monotonic elapsed/sleep primitive and making the paved example use it.

8. **Major — The current positive capability claim overstates implementation conformance.** The runtime predicate presently reduces support to live outbound capability plus a registered fact, and the local fact is statically positive (`src/manifest.rs:3018-3033,3086-3097,3645-3675`). Generated local and Cloudflare manifests consequently publish positive support and `Enforced` limits (`demos/competitive-checkpoint/generated/capability.manifest.json:54-67,115-124`; `cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json:17-20,132-140`). Yet the runtime request and cursor records contain no `StreamAttemptV1`, lease, initiation state, or certainty fields (`src/runtime.rs:86-103`; `src/server.rs:796-814`), and the demo schema still has a single authored status axis (`demos/competitive-checkpoint/snapback/schema.mjs:16-30`). This conflicts with LLP 0058’s positive-support semantics and LLP 0074’s Gate 2 requirement (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:302-340`; `llp/0074-convex-competitive-strategy.rfc.md:206-231`). Suppress `bounded_response_stream_v1` until the complete conformance suite passes; advertise experimental discovery through a separate non-admissible maturity field if needed.

9. **Major — Existing host paths do not preserve the promised authority and secret boundaries.** The RFC requires revalidation across every blocked read and preservation of opaque secret placement (`llp/0076-bounded-streamed-actions.rfc.md:161-170`). Local cursor validation checks generation and deadline, while service authority is held only around stream opening and no equivalent post-read revalidation occurs before handing bytes back (`src/server.rs:864-881,1005-1045,1387-1435`). The shared stream method forwards URL, headers, body, and key directly, unlike ordinary fetch’s opaque-secret-slot resolution (`packages/snapback-harness/ctx-bootstrap.js:774-820`); Workerd similarly takes the direct stream-fetch path rather than the ordinary secret/redaction boundary (`cloudflare/src/coordinator.js:1823-1835,2045-2156`). Finally, malformed-request serde text is embedded verbatim in a diagnostic and has not been shown value-free (`src/runtime.rs:1375-1387`), contrary to the diagnostic rule and LLP 0036 (`llp/0076-bounded-streamed-actions.rfc.md:323-330`; `llp/0036-secret-definition-and-runtime-delivery.rfc.md:562-604`). Route stream normalization through the same trusted secret and authority machinery as ordinary fetch, and add adversarial teardown and secret-value scans.

10. **Major — The stated acceptance contract is not currently executable end to end.** The local witness covers a happy path and authored settlement rows but does not prove cancellation closes the physical source, stale-runner rejection, crash-after-premark certainty, or retry under different segmentation (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:100-237,323-367`). Cloudflare checks only basic pull, chunk, limit, and cancel behavior (`cloudflare/test/acceptance.egress.mjs:253-281`). The 16 KiB read and four-cursor limits are not explicit acceptance bullets at all (`llp/0076-bounded-streamed-actions.rfc.md:129-146,374-399`). Although every diagnostic family has a code literal, the stable-envelope allowlists omit at least `_UNSUPPORTED` and `_RATE_LIMITED`, so exact end-to-end preservation is not established (`src/runtime.rs:2884-2923`; `packages/snapback-harness/envelope.mjs:16-50`). Resolve this with a target-paired matrix covering every limit, code, settlement/certainty combination, authority loss, secret scan, crash cut, cancellation race, concurrent read, and stale-lease commit through the real action chain.

11. **Major — Retryable cron and durable-job contexts are neither safely integrated nor normatively denied.** LLP 0074 requires cancellation when a caller, job, or deployment stops and an explicit LLP 0070 relationship (`llp/0074-convex-competitive-strategy.rfc.md:438-456`). The RFC defers job-claim binding and only mentions exclusion in its gap ledger, while its non-goal does not actually deny `fetchStream` inside a retryable action (`llp/0076-bounded-streamed-actions.rfc.md:186-191,439-448,523-535`). LLP 0070 explains that an expired worker can continue an external request unless a fence or integration-owned idempotency path prevents it (`llp/0070-durable-background-work.rfc.md:96-130`). Resolve this by making admission reject retryable cron/job contexts for v1, or specify a composite job-claim/stream-lease fence and immediate cancellation handoff.

12. **Moderate — LLP 0075 reconciliation and receipt identity are incomplete.** LLP 0075 snapshots Draft authorities as of 2026-07-22 and requires a versioned amendment for outcome-affecting changes; the two-axis state, write-ahead initiation model, terminalizer, and lease were revised on 2026-07-23 (`llp/0075-convex-checkpoint-protocol.spec.md:70-96`; `llp/0076-bounded-streamed-actions.rfc.md:216-253,277-312`). The RFC’s statement that the unchanged five settlement names need no amendment does not cover these new gate-eligibility requirements (`llp/0076-bounded-streamed-actions.rfc.md:221-224`). The canonical example also uses a string mutation name despite LLP 0075 requiring generated app-data references (`llp/0076-bounded-streamed-actions.rfc.md:113-115`; `llp/0075-convex-checkpoint-protocol.spec.md:171-190`). Finally, the protocol names `local-dev-sqlite-ibex`, while the local receipt witness still emits `local-ibex-sqlite.v1` (`demos/competitive-checkpoint/acceptance/protocol.v0.json:56`; `demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:238-245`). Resolve these through a prospective LLP 0075/protocol amendment, generated mutation references, and one canonical target identifier.

5. **Suggestions**

- Separate the normative profile from the implementation/evidence ledger, retaining the ledger as a clearly dated conformance appendix.

- Consider naming the surface `fetchBoundedStream` or otherwise making the v1 profile explicit in the API; `fetchStream` sounds broader than the non-goals permit.

- Define an internal terminal-reason enum independently of the five public settlement kinds, then generate target conformance tests from its projection table.

- Add model-based concurrency tests for terminal CAS versus pre-commit mutation, cancel during blocked pull, crash at every initiation cut, concurrent same-key starts, lease takeover, and concurrent reads.

- Document request-shape limits separately from response-stream bounds. Local and Workerd currently enforce additional URL, header, body, and key constraints that are not part of the RFC’s claimed sole numeric authority (`src/server.rs:1194-1255`; `cloudflare/src/coordinator.js:1760-1817`).

- Add structured trace events for attempt generation, initiation transition, cursor open/close, terminal winner, certainty derivation, and rejected stale commits, with no request or secret values.

6. **Open questions**

- What exact storage transaction or final-commit hook makes authored progress and host-owned attempt state atomic?

- Is one `StreamAttemptV1` limited to one upstream request, or does every cursor receive a child attempt record?

- Does `reader.cancel()` merely close transport, or is it authorized to win durable `cancelled` settlement?

- Which trusted terminalizer triggers map to each public settlement kind, and what is their precedence when causes race?

- What trusted mechanism recognizes provider idempotency semantics, and how is changed reuse of a client key rejected?

- Which bytes and queues count toward 16 KiB, 64 KiB, and 2 MiB, and when exactly does the idle timer run?

- What host-supported primitive lets authors satisfy the progress cadence without nondeterministic wall-clock access?

- Will retryable cron and durable-job contexts be denied in v1 or receive a composite job/stream fence?

- When is `bounded_response_stream_v1` eligible for positive publication: implementation registration, target-paired conformance, or both?

7. **Verdict**

Verdict: NOT READY

The proposal’s core direction is strong, but its atomic fence, cancellation propagation, settlement model, retry trust, backpressure semantics, and executable target conformance must be resolved before acceptance.
