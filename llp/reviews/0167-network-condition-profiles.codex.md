# LLP 0167 network condition profiles review — Codex family

## Round 1 — 2026-08-04

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec --sandbox
read-only`, model `gpt-5.6-sol`, reasoning effort medium
**Date:** 2026-08-04
**Redacted:** no
**Target revision:** v0.1, sha256
`2485c4e2ceaa8c819e658662f421354b1855fbf253d4617168bf428b41ae8cc7`
(working tree at c7e3bdfe0)
**Instruction hash (shared r1 prompt):**
`07f38f6c49ece2624dafa110f6e80d7bb839b06ed40f56eeef08a0d20a80272c`
**Method:** fresh codex exec run over the working tree with the same
shared round-1 instructions as the Fable reviewer, mutually blind;
instructed not to read anything under `llp/reviews/` concerning 0167.
Blindness is instruction-based over a shared working tree (self-attested);
no 0167 review artifacts existed in the repo during the run (the Fable
review was sealed outside the repo until this run completed). Review body
recorded verbatim below.

---

The RFC identifies a real gap, and most repository facts check out: the manifest profiles are unread, Zero delays in its API, Snapback sleeps client-side, both Cloudflare test knobs exist, Rust has no network-latency injection knob, and the disconnect route exists. The proposed bounded, non-durable, server-owned control is directionally strong. It is not ready, however, because its central latency semantics do not match the bakeoff boundary it claims to normalize, and the offline-profile ownership and production authority rules remain contradictory or unresolved.

1. **[MATERIAL] The proposed post-commit acknowledgement delay does not match Zero’s injected-authority boundary and can expose authoritative live state before the delayed acknowledgement.** Zero sleeps before `handleMutateRequest`, hence before handler execution and commit (`demos/zero-bakeoff/apps/latency-kanban/zero/api.ts:24-31`), while the RFC requires delay after handler execution (`llp/0167-network-condition-profiles.rfc.md:113-124`) and nevertheless says both arms inject at the same logical boundary (`llp/0167-network-condition-profiles.rfc.md:228-231`). Rust performs post-commit live fanout before constructing the mutation response (`src/local.rs:12879-12975`, `src/server.rs:20207-20256`), and Cloudflare explicitly awaits fanout before returning the response (`cloudflare/src/coordinator.js:3820-3829`, `4585-4620`, `5186-5192`). Thus `mutationAckDelayMs: 1000` with `liveDeltaDelayMs: 0` can let an observer—and potentially the mutating client’s authoritative subscription—see the commit immediately while only HTTP settlement is delayed. Suggested disposition: decide whether `optimistic` means authoritative processing latency, downstream acknowledgement latency, or coordinated authoritative-observation latency. Either move the profile boundary to match Zero, change Zero to the selected post-commit boundary, or stop claiming equivalence; then pin the intended ordering among commit, actor live delivery, observer delivery, and acknowledgement in acceptance.

2. **[MATERIAL] Production/hosted safety is simultaneously decided, bypassable, and left open.** The profile model says `normal` is the only profile a production-shaped instance may run (`llp/0167-network-condition-profiles.rfc.md:99-103`), but startup accepts a profile name or arbitrary JSON (`llp/0167-network-condition-profiles.rfc.md:139-141`), only the console is explicitly described as hosted-disabled (`llp/0167-network-condition-profiles.rfc.md:155-163`), and OQ3 still asks whether hosted profiles are permitted (`llp/0167-network-condition-profiles.rfc.md:258-261`). Moreover, an environment-selected slow profile survives every restart, contradicting the safety rationale that a forgotten profile cannot outlive its session (`llp/0167-network-condition-profiles.rfc.md:142-147`). Existing code already provides a fail-closed `ServerProfile` and per-operation profile gate (`src/admin.rs:113-171`, `214-275`). Suggested disposition: resolve OQ3 before acceptance and specify one central rule enforced for startup, API, host-ops, MCP, and console. A defensible v1 is to reject every non-`normal` profile under `Prod` or authenticated hosted serving, including environment configuration; any future fork exception should require explicit derived-instance identity, not the informal phrase “production-shaped.” Also narrow the “cannot outlive its session” claim to runtime-set profiles or give non-normal runtime settings a defined lease/expiry.

3. **[MATERIAL] `offlineStretch` has no coherent owner or executable meaning in this profile registry.** The RFC defines profiles as bundles applied at response-delay seams (`llp/0167-network-condition-profiles.rfc.md:82-96`), then admits `offlineStretch` is not implemented by those seams while saying its duration is nevertheless parameterized there (`llp/0167-network-condition-profiles.rfc.md:105-111`). The existing route performs immediate teardown only (`src/server.rs:23896-23920`); it does not hold a client offline or schedule reconnection, and LLP 0146 D6 is a proposed “build sixth” scenario seam rather than an existing timed-connectivity implementation (`llp/0146-agentic-authoring-affordances.rfc.md:769-788`). Suggested disposition: either remove `offlineStretch` from the server network-profile registry and leave it as a harness/scenario condition, or explicitly broaden the model to composite conditions and identify the component that owns disconnect, reconnection suppression, duration, cleanup, and acceptance. A name with no consuming behavior should not be presented as adopted.

4. **[MATERIAL] The control operation’s authority contract is not compatible with the current operation-level policy model as written.** The RFC proposes one `host.networkProfile` operation with `get` and `set` modes (`llp/0167-network-condition-profiles.rfc.md:148-154`) but distinguishes read and write authority only on the HTTP routes. Snapback currently derives a static `AdminRead` or `AdminWrite` requirement from each registered operation (`src/admin.rs:188-208`, `2817-2869`); `writes_require_token` itself is inspection metadata, not the gate (`src/admin.rs:2648-2657`, `2706-2717`). The cited “agent-callable” disconnect precedent is also overstated: the admin route exists (`src/server.rs:8700-8706`), but it is absent from LLP 0024’s operation table and the control-MCP tools. Suggested disposition: pin either separate read/set operation IDs or declare the combined operation wholly `AdminWrite`, register its non-production profile requirement, and describe the HTTP route in terms of `RoutePolicy::AdminWrite` plus the shared operation authorizer. Correct the disconnect precedent to “existing admin-gated runtime perturbation.”

5. **[implementation-phase] Profile capture and wire-marker compatibility need an explicit implementation rule.** A runtime toggle can otherwise cause admission telemetry, delayed bytes, and the marker to observe different active profiles. Live envelopes are schema-generated wire types (`src/live_wire.rs:1-25`, `38-120`), so a per-frame annotation is a real protocol/schema change rather than free metadata. Suggested disposition: capture one immutable effective profile—including provenance—at each response/frame’s delay-admission point and use that snapshot for delay, marker, and telemetry; add the socket marker through the generated compatibility path and expose the HTTP header through CORS where browser assertions need to read it.

Strengths worth preserving: server-side placement, a true zero-cost `normal` fast path, refusal rather than silent clamping, visible attribution, runtime settings that reset to startup configuration, and the explicit separation from deterministic D6 ordering controls.

VERDICT: NOT READY

## Round 2 (delta) — 2026-08-04

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec --sandbox
read-only`, model `gpt-5.6-sol`, reasoning effort medium
**Date:** 2026-08-04
**Redacted:** no
**Target revision:** v0.2, sha256
`fa8333819d6f3917d31e2e73d6049f484876557b47d915c2a1890b4b086c5749`
**Instruction hash (shared r2 delta prompt):**
`06a29371c9a5c392384639274c736db3f9999f12a98bd68172c894b4427391e3`
**Method:** fresh codex exec run, delta round per LLP 0010 §2 addendum
(delta enumerated in prompt, IN-DELTA vs PRE-EXISTING classification
required); instructed not to read `llp/reviews/`, which now contains 0167
round-1 artifacts (instruction-based blindness, self-attested). Review
body recorded verbatim below.

---

v0.2 substantially improves honesty around post-commit injection, authorization, markers, and manifest ownership, and its repository claims about the existing delay knobs and bakeoff hacks are accurate. It is not ready, however, because the new observation semantics do not yet define a realizable coordinated release boundary, the Cloudflare implementation shape can violate the “observation never state” invariant, and the hosted refusal is attached to the wrong authority signal.

1. [MATERIAL] [IN-DELTA] Equal ack and live-delta durations do not make `optimistic` coordinated or prevent delta-before-ack observation. Evidence: the RFC applies delay when each write would otherwise occur and claims equal delays avoid the inversion (llp/0167-network-condition-profiles.rfc.md:120-150), but local fanout is enqueued before the mutation handler returns (src/local.rs:12921-12975; src/server.rs:20243-20258), while Cloudflare completes fanout before constructing the mutation response (cloudflare/src/coordinator.js:3820-3829, 4595-4625). Independent equal timers can therefore release the delta first; on Cloudflare, naïve sequential waits can make the ack delay additive. Suggested disposition: define one commit-relative release deadline or another explicit coordination primitive, state the intended ack-versus-delta ordering at that deadline, and test both arms against it.

2. [MATERIAL] [IN-DELTA] The “delay never perturbs state or server-internal interleavings” invariant lacks the lock-boundary rule required by the current Cloudflare architecture. Evidence: mutation handling runs inside `runExclusive` (cloudflare/src/coordinator.js:1803-1805), whose tail remains occupied until the returned promise settles (cloudflare/src/coordinator.js:304-343); fanout is awaited within that promise (cloudflare/src/coordinator.js:3823-3829, 5186-5192). Waiting at the present send/response sites would therefore stall later handlers and alter commit admission and settlement interleavings, contradicting llp/0167-network-condition-profiles.rfc.md:120-129. Suggested disposition: require a two-phase boundary that snapshots and prepares egress under the existing serialization authority, then performs all wall-clock waiting after releasing invocation, instance, commit, and storage locks; add concurrent-mutation acceptance proving unchanged commit order and overload behavior.

3. [MATERIAL] [IN-DELTA] `ServerProfile` is not an authoritative hosted/production-serving discriminator, and the proposed fail-closed gate has no corresponding Cloudflare authority source. Evidence: `ServerProfile` is `Dev|Demo|Test|Prod` and an explicit environment value wins even on a non-loopback bind (src/admin.rs:113-118, 278-299); the repository separately represents authenticated hosted serving with `AppState.hosted_serving`, explicitly absent on local targets and not synthesizable from headers (src/admin.rs:1944-1949, 2128-2162). The Cloudflare coordinator has admin-token and testing gates but no `ServerProfile` machinery (cloudflare/src/coordinator.js:1919-1951). This contradicts the factual premise at llp/0167-network-condition-profiles.rfc.md:168-175 and leaves the safety-critical “every surface” refusal under-specified. Suggested disposition: bind refusal to authenticated hosted-serving/deployment authority on Rust, define the equivalent authoritative deployment classification on Cloudflare, treat `ServerProfile` only as a secondary local environment policy, and accept contradictory/missing-authority cases only by refusing.

4. [MATERIAL] [IN-DELTA] The client-observable bakeoff envelope is too weak to establish same-profile comparability, and the proposed manifest ownership does not define where arm-specific injection facts live. Evidence: acceptance requires only that ack and observer latency meet a floor (llp/0167-network-condition-profiles.rfc.md:144-150, 293-299), so 1,001 ms and 30,000 ms both pass as “equivalent”; yet LLP 0138 requires shared network profiles and separately reported latency axes (llp/0138-zero-replicache-bakeoff.plan.md:92-109). The current shared environment manifest has only one `optimistic.authoritativeMutationLatencyMs` value (demos/zero-bakeoff/protocol/environment.v1.json:17-22), while the app acceptance manifest contains no selected profile or injection-point declaration (demos/zero-bakeoff/protocol/acceptance/latency-kanban.v1.json:1-16). Suggested disposition: specify a bounded observation window or tolerance for each axis, define a versioned shared-profile plus arm-specific injection-location schema, and require each acceptance arm to cite that exact profile and location.

5. [implementation-phase] [PRE-EXISTING] The built-in `demo-slow` profile has no deterministic field values. Evidence: it is only described as “a moderate all-lane delay” (llp/0167-network-condition-profiles.rfc.md:110-116), despite named profiles being intended to carry stable cross-surface semantics. Suggested disposition: pin its exact lane delays and jitter before implementation or make it an explicitly configurable example rather than a built-in contract.

VERDICT: NOT READY

## Round 3 (delta) — 2026-08-04

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec --sandbox
read-only`, model `gpt-5.6-sol`, reasoning effort medium
**Date:** 2026-08-04
**Redacted:** no
**Target revision:** v0.3, sha256
`5294657d50d519429270ebdac9f7b831b0c94de7291cc4de4514528a9db04d23`
**Instruction hash (shared r3 delta prompt):**
`a14b469b3791231375833b66f720d61cd65fd11584e7280029e8a7ae149ce38b`
**Method:** fresh codex exec run, delta round per LLP 0010 §2 addendum;
llp/reviews/ off-limits (instruction-based blindness, self-attested).
Review body recorded verbatim below.

**Orchestrator disposition note (not part of the review):** all four
MATERIAL concerns are IN-DELTA; none are in pre-existing text. Round
budget (3) exhausted — per the delta-convergence rule the fixes are
applied as v0.4, which is UNREVIEWED. Dispositions: #1 non-commit
responses stamp from result readiness (applied v0.4); #2 jitter sampled
once per commit, shared across its egress (applied v0.4); #3 throughput
criterion qualified to identical open-loop arrivals with declared
tolerance/interval + deadline-witness (applied v0.4); #4 arm-specific
refusal acceptance matrix added (applied v0.4). #5 implementation-phase,
carried to the implementation program.

---

The two-phase design is implementable in both arms: Rust already prepares and durably enqueues live frames during post-commit work while the HTTP envelope is assembled after the managed `Local` scope, and Cloudflare can split its currently awaited `fanOut` into preparation under `runExclusive` followed by deadline waiting and sending outside the tail. `AppState.hosted_serving` is the correct positive hosted-serving authority, `ServerProfile::Prod` is coherent as a secondary local safeguard, and `SNAPBACK_TESTING` is a real deployment binding used consistently for Cloudflare test-only capabilities. However, v0.3 leaves two release semantics undefined and its new acceptance criteria do not fully or reliably verify the concurrency and refusal invariants, so it is not ready.

1. **[MATERIAL] [IN-DELTA] Mutation acknowledgements without a commit have no defined deadline basis.** Evidence: the RFC applies delay to the mutation-ack lane but defines mutation deadlines only relative to commit (`llp/0167-network-condition-profiles.rfc.md:118-140`); Rust explicitly returns receipts for rejected mutations (`src/server.rs:20167-20175`) and derives rejected receipts from the current version without a commit (`src/local.rs:12440-12463`), while Cloudflare returns handler failure before calling `commit` (`cloudflare/src/coordinator.js:3820-3823`) and successful no-op commits can return before establishing `nowMs` (`cloudflare/src/coordinator.js:3838-3844`). Suggested disposition: define rejected and successful-no-op mutation responses as stamping from result readiness, or define another explicit non-commit reference point, and add acceptance coverage for both.

2. **[MATERIAL] [IN-DELTA] The jitter sampling domain is undefined and can violate the claimed shared deadline.** Evidence: deadlines include “(+ jitter)” while equal lane delays are said to produce one shared ack/delta deadline (`llp/0167-network-condition-profiles.rfc.md:124-133`); `demo-slow` has equal lane delays and 250 ms jitter (`llp/0167-network-condition-profiles.rfc.md:107-112`), yet acceptance requires equal-lane skew to remain scheduler noise (`llp/0167-network-condition-profiles.rfc.md:346-349`). Ordinary per-item jitter would create intentional cross-connection skew of up to the jitter range, not scheduler noise. Suggested disposition: specify one jitter sample shared by every ack and live frame for a commit when lane delays are equal—or qualify the shared-deadline and acceptance guarantees to zero jitter.

3. **[MATERIAL] [IN-DELTA] The throughput criterion does not isolate serialization-authority blocking from response-coupled workload behavior.** Evidence: only the state-equivalence criterion is qualified to open-loop scripted arrivals (`llp/0167-network-condition-profiles.rfc.md:337-340`); the next criterion requires concurrent-mutation throughput to “match” normal without fixing arrivals, measurement boundaries, or tolerance (`llp/0167-network-condition-profiles.rfc.md:341-345`). A closed-loop client necessarily submits less work while awaiting delayed acknowledgements even when every wait is correctly outside all authorities. Suggested disposition: require identical open-loop arrivals, define a commit-throughput tolerance and measurement interval, and directly witness that later commits are admitted before earlier release deadlines.

4. **[MATERIAL] [IN-DELTA] Acceptance does not cover the newly defined fail-closed classification matrix.** Evidence: the design separately requires Rust refusal for `hosted_serving`, explicit local `ServerProfile::Prod`, and missing/contradictory classification, plus Cloudflare refusal unless `SNAPBACK_TESTING === '1'` (`llp/0167-network-condition-profiles.rfc.md:195-211`); acceptance checks only a generic hosted-serving refusal (`llp/0167-network-condition-profiles.rfc.md:362-365`). The repository confirms these are distinct signals: `hosted_serving` is optional positive authority (`src/admin.rs:1947-1949`), installation requires a hosted target (`src/admin.rs:2152-2193`), and `SNAPBACK_TESTING` is an actual independently supplied test binding (`cloudflare/test/harness.mjs:257`). Suggested disposition: add an arm-specific acceptance matrix covering Rust local non-Prod allow, explicit Prod refusal, hosted authority refusal, hosted-target/missing-authority refusal, and Cloudflare `1` allow versus missing/`0` refusal, including startup-env activation.

5. **[implementation-phase] [IN-DELTA] Both arms need an explicit prepared-egress carrier and release scheduler, but the repository presents no feasibility blocker.** Evidence: Rust serializes and enqueues live payloads during post-commit processing (`src/local.rs:21855-21897`, `src/local.rs:22075-22149`) and assembles the mutation response after the managed write returns (`src/server.rs:20207-20256`); Cloudflare currently keeps `fanOut` and its awaits inside the promise tracked by `runExclusive` (`cloudflare/src/coordinator.js:308-343`, `cloudflare/src/coordinator.js:3820-3829`, `cloudflare/src/coordinator.js:5186-5260`). Suggested disposition: during implementation, return prepared HTTP/frame bytes plus commit identity, profile snapshot, and clamped deadline from the serialized phase, then perform all timer waits and physical sends in an outer release layer.

VERDICT: NOT READY
