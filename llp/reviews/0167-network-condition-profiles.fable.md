# LLP 0167 network condition profiles review — Fable family

## Round 1 — 2026-08-04

**Reviewer family:** Anthropic Claude (Fable 5)
**Provider / runtime:** Claude Code `general-purpose` subagent, model
`claude-fable-5`
**Date:** 2026-08-04
**Redacted:** no
**Target revision:** v0.1, sha256
`2485c4e2ceaa8c819e658662f421354b1855fbf253d4617168bf428b41ae8cc7`
(working tree at c7e3bdfe0)
**Instruction hash (shared r1 prompt):**
`07f38f6c49ece2624dafa110f6e80d7bb839b06ed40f56eeef08a0d20a80272c`
**Method:** fresh non-author Fable session (subagent with no authoring
context) over the working tree; instructed to read LLP 0167 in full plus
the Related set (0010, 0017, 0024, 0042, 0043, 0054, 0107, 0129, 0138,
0146 D6, 0154, 0155, 0158) and to spot-check the cited code facts
(environment.v1.json, zero api.ts, snapback acceptance.mjs,
coordinator.js delay seams, admin write gating, disconnect route);
instructed not to read anything under `llp/reviews/` concerning 0167.
Blindness is instruction-based over a shared working tree (self-attested);
no 0167 review artifacts existed at launch. Orchestrated by the Fable
session that authored the draft, which therefore does not count as a
reviewer; this artifact records the subagent's review verbatim.

---

Overall assessment: This is a well-motivated, well-bounded RFC whose central factual claims check out against the repository. I verified the bakeoff asymmetry it leads with — the Zero arm injects latency inside its push endpoint (`demos/zero-bakeoff/apps/latency-kanban/zero/api.ts:9,25`: `startApi(databaseURL, latencyMs = 1000)` / `Bun.sleep`) while the Snapback arm sleeps in the test client *before* calling `client.mutate` (`demos/zero-bakeoff/apps/latency-kanban/snapback/tests/acceptance.mjs:29,41-46`), so the in-flight machinery genuinely goes unexercised. Also verified: no code reads the manifest's `networkProfiles` block; the two coordinator test knobs exist behind `SNAPBACK_TESTING === '1'` (`cloudflare/src/coordinator.js:2333, 4128`); the Rust server has no latency-injection knob of any kind; the disconnect route exists (`src/server.rs:8702`); the `writes_require_token` gate and `RoutePolicy::AdminWrite` class are real (`src/admin.rs:2716`, `src/server.rs:7163`); the LLP 0010 sleep-ban quote is verbatim; the LLP 0155 acceptance gate and separate-measurement guardrail are as cited (`llp/0155:858-878`); and the D6 seam inventory matches (`llp/0146:781-787`). The seam placement, non-persistence, honesty requirements, and sleep-ban reconciliation are the right decisions, and the boundary against D6/0154/0054 is drawn cleanly. Two coherence/correctness defects keep it from READY, both cheaply fixable: the document overstates its relationship to the environment manifest's field vocabulary and silently drops the manifest's upstream-latency half, and the per-response jitter field as specified can contradict the RFC's own "no reorder" boundary claim.

1. **[MATERIAL]** The "implements a vocabulary the corpus has already declared" / "registry starts from the fields the environment manifest already declares" claims are untrue at the field level, and upstream latency is silently dropped. Evidence: `demos/zero-bakeoff/protocol/environment.v1.json` declares `downstreamLatencyMs`/`upstreamLatencyMs` (under `normal`), `authoritativeMutationLatencyMs`, and `durationMs`; none of the RFC's four fields (`mutationAckDelayMs`, `liveDeltaDelayMs`, `queryResponseDelayMs`, `jitterMs`) appear there. Only the three profile *names* are shared. More substantively, `upstreamLatencyMs` (request-side delay) is inexpressible at a post-handler seam — request-side delay changes when mutations *commit* and therefore multi-client settlement interleavings, which is exactly what "the profile perturbs observation, never state" excludes — yet the RFC neither implements it nor declares it out of scope, and OQ1 doesn't name it. The acceptance criterion "the manifest-named profile applied server-side" also leaves the manifest schema migration unowned. Disposition: reword the claim to names-only adoption; explicitly rule request-side delay out of scope (with the observation-vs-state rationale, pointing residual ordering needs at D6) or add it as a lane; and have this RFC own versioning `environment.v1.json` to the built vocabulary.

2. **[MATERIAL]** Per-response jitter can violate the RFC's own "no reorder" boundary on the live-delta lane. Evidence: profile model — "`jitterMs` // optional uniform jitter added per response" — versus the boundary section's claim to own "wall-clock delay of otherwise unchanged, **in-order** responses… no drop, no reorder, no duplication." Independent per-frame jitter timers on one socket can deliver frame B before frame A, which is a D6-class perturbation this RFC disclaims. Disposition: one sentence specifying that delay and jitter are applied to the per-connection in-order flush queue (FIFO preserved; jitter delays the head, never races frames), and an acceptance bullet asserting in-order delivery under jitter.

3. **[implementation-phase]** "Two env-gated, capped, test-only knobs" is half-true: the subscription-stage seam is capped (`Math.min(delayMs, 1000)`, `cloudflare/src/coordinator.js:4130`), but the nested-commit seam applies the raw env value with no cap (`coordinator.js:2333-2338`). Disposition: correct the sentence; the discrepancy actually strengthens the OQ4 fold-or-document argument.

4. **[implementation-phase]** The host-ops precedent claim overstates: "the connection-disconnect control is already an agent-callable runtime perturbation" — disconnect is an admin HTTP route (`src/server.rs:8702`), not an LLP 0024 operation (absent from the operation-ID table) nor an LLP 0042 MCP tool. Disposition: rephrase as admin-surface precedent and acknowledge that hoisting a perturbation into host-ops/MCP is new with this RFC — which is an argument for deciding OQ2's `debug.*` family question deliberately.

5. **[implementation-phase]** The socket "frame annotation" marker is a client-protocol surface change, but LLP 0093 (client protocol) is absent from Related and from the design. Disposition: add 0093 to Related and route the frame-annotation shape through the protocol spec, its fixtures, and the Swift client at implementation time.

6. **[implementation-phase]** "Production-shaped instance" (profile model), "hosted target" (console bullet, OQ3), and the enforcement locus are underspecified: the only-`normal` rule is stated in a parenthetical, the category is undefined (hosted-dev vs hosted-prod vs 0158 fork), and it is unstated whether enforcement is startup refusal, PUT refusal, or both, and under which `SNAPBACK_*` code. Disposition: define the category once, name the refusal code, and state that the rule holds as interim default until OQ3 rules. The mitigation stack (non-persistence, banner, marker, ceiling, startup line) is otherwise sound.

7. **[implementation-phase]** Observability attribution amends LLP 0154 (Accepted) — recording the active profile with latency measurements — but unlike the LLP 0017 amendment, which the RFC explicitly proposes, the 0154 amendment is only implied. Disposition: name it as a proposed 0154 amendment alongside the 0017 one.

Strengths worth preserving: the honesty requirements (response marker, always-on console banner, telemetry attribution, startup line) treated as first-class acceptance criteria rather than afterthoughts; the non-persistence decision as the primary forgotten-toggle mitigation; the sleep-ban reconciliation, which reads LLP 0010's "the harness is missing a capability" clause exactly as written and keeps the deterministic harness wall-clock-free; the refuse-don't-clamp ceiling; and the disciplined boundary that claims latency only, leaving drop/reorder/duplication to D6 and LLP 0054's unratified scheduler.

VERDICT: NOT READY

## Round 2 (delta) — 2026-08-04

**Reviewer family:** Anthropic Claude (Fable 5)
**Provider / runtime:** Claude Code `general-purpose` subagent, model
`claude-fable-5`
**Date:** 2026-08-04
**Redacted:** no
**Target revision:** v0.2, sha256
`fa8333819d6f3917d31e2e73d6049f484876557b47d915c2a1890b4b086c5749`
**Instruction hash (shared r2 delta prompt):**
`06a29371c9a5c392384639274c736db3f9999f12a98bd68172c894b4427391e3`
**Method:** fresh non-author Fable subagent, delta round per LLP 0010 §2
addendum (delta enumerated in prompt, IN-DELTA vs PRE-EXISTING
classification required); instructed not to read `llp/reviews/`, which now
contains 0167 round-1 artifacts (instruction-based blindness,
self-attested). Review body recorded verbatim below.

---

The v0.2 delta is a substantial and honest hardening: every repository-facing factual claim I checked is now accurate — the coordinator's two test knobs and their asymmetric capping (`Math.min(delayMs, 1000)` at `cloudflare/src/coordinator.js:4127-4131` vs. the raw uncapped `SNAPBACK_TEST_NESTED_COMMIT_DELAY_MS` at 2333-2338), the pre-commit placement of Zero's injection (`demos/zero-bakeoff/apps/latency-kanban/zero/api.ts:25`, `Bun.sleep` before `handleMutateRequest`), the client-side sleep-before-mutate in the Snapback arm (`.../snapback/tests/acceptance.mjs:41-46`), the names-only relationship to the manifest's divergent field vocabulary (`environment.v1.json` uses `downstreamLatencyMs`/`authoritativeMutationLatencyMs`, which the RFC now does not pretend to adopt), the no-code-reads-it claim (grep confirms only protocol JSON and an unrelated `offlineStretchMs` fixture field), the disconnect precedent's true status (admin-gated HTTP route at `src/server.rs:8702`, absent from the LLP 0024 table and the 0042 MCP tool list), the fail-closed `ServerProfile` machinery (`src/admin.rs:113,278-298`, unknown → `Prod`), the verbatim LLP 0010 ban text, LLP 0093's schema-generated live envelope families, and LLP 0155's separate-measurement requirement. The new observation-semantics section resolves the document's previously weakest joint — what a delay is and is not allowed to touch — with a defensible post-commit rule, and the retreat from a same-boundary bakeoff claim to a client-observable envelope is the correct epistemic position given the arms genuinely do not share an injection point. The authority chokepoint, snapshot rule, and both refusal codes are coherent and collision-free (`SNAPBACK_NETWORK_PROFILE_*` is unused in the codebase). Remaining concerns are specification-precision items that identify no defective decision.

1. **[implementation-phase] [IN-DELTA]** The hosted-refusal category is defined only in Rust terms while the seam is specified for both arms. The activation gate keys off "the server's existing fail-closed `ServerProfile` machinery (`src/admin.rs`)", but the Cloudflare coordinator — where the observation-semantics section also places the delay points — has no `ServerProfile` analogue; it self-describes as "the Cloudflare production profile" (`cloudflare/src/coordinator.js:4482`) with only the `SNAPBACK_TESTING === '1'` posture. As written, the interim rule leaves the coordinator-arm implementation reachable only through an unnamed category. Disposition: one sentence naming the coordinator's hosted/non-hosted determination (e.g., `SNAPBACK_TESTING` deployments as the non-hosted class) or explicitly parking the coordinator arm behind OQ3; no decision in the document is wrong, the mechanism is just unnamed for one arm.

2. **[implementation-phase] [IN-DELTA]** The FIFO rule's queue-head wording is ambiguous between two observably different delay models. "Delay and jitter apply to the head of each connection's in-order flush queue" reads as per-frame head-of-line service delay, under which a burst of N live frames drains in ~N×d (throughput collapse), whereas the "real network condition" analogy and the bakeoff comparison imply pipeline latency (each frame deadline-stamped enqueue+d, flushed in order), under which a burst shifts by d. Both satisfy per-connection FIFO and the client-observable floor, so no acceptance criterion is broken, but demos and latency-bearing suites will behave visibly differently under sustained delta streams. Disposition: pin the model (the deadline-stamp reading, with jitter clamped to preserve order, better matches the section's own analogy) at spec/implementation time.

3. **[implementation-phase] [IN-DELTA]** The byte-identical acceptance criterion silently assumes an open-loop fixture. Delaying acks changes when ack-awaiting clients issue their next mutations, so a multi-client fixture whose request schedule reacts to responses can legitimately settle in a different order under `optimistic` vs. `normal` without any server-side state perturbation — the server-scoped "commit ordering unchanged" claim stays true, but the byte-identical comparison would fail for closed-loop fixtures. Disposition: qualify the criterion with "for a fixture whose request schedule does not depend on response timing" (or pin the fixture as scripted arrivals); the existing Latency Kanban fixture likely already satisfies this.

4. **[implementation-phase] [PRE-EXISTING]** `demo-slow` is a named built-in with no defined field values ("a moderate all-lane delay"), unlike `normal` and `optimistic`, so two implementations could ship different `demo-slow`s and both claim conformance. Disposition: assign concrete values (or delegate to the spec phase explicitly) before anything asserts on `demo-slow` behavior; harmless at RFC altitude.

VERDICT: READY

## Round 3 (delta) — 2026-08-04

**Reviewer family:** Anthropic Claude (Fable 5)
**Provider / runtime:** Claude Code `general-purpose` subagent, model
`claude-fable-5`
**Date:** 2026-08-04
**Redacted:** no
**Target revision:** v0.3, sha256
`5294657d50d519429270ebdac9f7b831b0c94de7291cc4de4514528a9db04d23`
**Instruction hash (shared r3 delta prompt):**
`a14b469b3791231375833b66f720d61cd65fd11584e7280029e8a7ae149ce38b`
**Method:** fresh non-author Fable subagent, delta round per LLP 0010 §2
addendum; llp/reviews/ off-limits (instruction-based blindness,
self-attested). Review body recorded verbatim below.

**Orchestrator disposition note (not part of the review):** READY; all
five concerns implementation-phase. #2 (explicit-vs-defaulted `Prod`)
and #4 (timestamp-free projection) clarified in v0.4 (UNREVIEWED); #3
folded into OQ3 (dedicated Cloudflare deployment classification); #1
(Workers delivery anchoring: `waitUntil`/DO alarms, hibernation stance)
and #5 (per-arm definition of "restart") carried to the implementation
program.

---

This delta round substantially strengthens the document, and every load-bearing repository claim the v0.3 delta makes verifies against the code. The two-phase commit-relative release is well matched to both arms' actual structure: on Cloudflare, `handleMutation` runs inside `runExclusive` and awaits `fanOut` before returning the ack (cloudflare/src/coordinator.js:1804, 3820–3830), so the delta's twin rules — wait outside the `runExclusive` tail, never stack ack delay behind awaited fanout — target precisely the two ways a naive implementation would go wrong there, and the new acceptance criterion (admission order and throughput match `normal`) tests exactly that hazard; on the Rust side, live delivery already flows through durable pending obligations plus notifier wakes, which accommodates deadline-stamped release without holding engine locks. The authority re-keying is verified: `AppState.hosted_serving` is `Option<HostedServingHandle>` with a doc comment stating it is "absent on every local target and cannot be synthesized from request headers" (src/admin.rs:1949), matching the RFC's characterization exactly; `ServerProfile` resolution fail-closes to `Prod` (src/admin.rs:290–298); the coordinator's `SNAPBACK_TESTING === '1'` gating is pervasive and real, and the two test knobs have exactly the claimed cap semantics (`Math.min(delayMs, 1000)` for the subscription-stage seam, raw uncapped env value for the nested-commit seam at coordinator.js:2333–2338). Motivating facts (manifest `networkProfiles` block including `optimistic` at 1,000 ms and the verbatim `performanceRule`; Zero's `startApi(databaseURL, latencyMs = 1000)`; the Snapback arm's client-side `delayedMove`; the disconnect route being a write-gated HTTP route absent from the host-ops table; the LLP 0010 sleep-ban wording) all check out. The remaining concerns are implementation-phase refinements, not defective decisions.

1. **[implementation-phase] [IN-DELTA]** Phase-2 delivery anchoring on Cloudflare is unspecified: the codebase deliberately awaits fanout inside the invocation because "floating work after the response is not a delivery contract on real Workers (ENG-23576)" (comment above cloudflare/src/coordinator.js:3828), so delayed frames released outside `runExclusive` need an explicit lifetime anchor (`waitUntil` on the held ack invocation, DO alarms) and a stance on hibernation/eviction while a ≤30 s deadline timer is pending. The design decision (wait outside serialization authorities) is correct; name the anchoring mechanism in the implementation ticket.

2. **[implementation-phase] [IN-DELTA]** "An instance explicitly profiled `Prod` refuses" is ambiguous against the same sentence's "fail-closed to `Prod`": `resolve_profile` yields `Prod` both for the literal `"prod"` and as the fail-closed default for unknown values and non-loopback absence (src/admin.rs:296–298). Both readings fail closed on hosted instances (the primary `hosted_serving` key governs), but one clarifying clause should say whether a defaulted-`Prod` non-hosted instance refuses, so implementers don't special-case "explicit."

3. **[implementation-phase] [IN-DELTA]** The Cloudflare non-hosted class is conflated with the test flag: `SNAPBACK_TESTING === '1'` also unlocks `testingOnly` functions and other test seams (coordinator.js:1000, 1314, 2333), so a Cloudflare demo deployment wanting `demo-slow` must also accept test-only surface exposure — in tension with motivation #2's interactive-demo use case on that arm. The choice is fail-closed and explicitly interim pending OQ3; the OQ3/implementation resolution should consider a dedicated deployment-classification binding rather than piggybacking the test flag.

4. **[implementation-phase] [IN-DELTA]** "Byte-identical" commit facts need a timestamp-free projection: both arms stamp wall-clock time into rows at commit (`nowMs = Date.now()` into `_createdAt`/`_updatedAt`, coordinator.js commit path), so even the open-loop qualification cannot make raw row bytes identical across two runs; the criterion's parenthetical "(versions, settlement order)" already scopes it correctly — the acceptance comparator just needs to compare that projection, worth one clarifying clause at implementation time.

5. **[implementation-phase] [PRE-EXISTING]** "Restarting the server clears any runtime-set profile" is crisp for the Rust process but underdefined on the Cloudflare arm, where a Durable Object hibernates or is evicted without any operator-performed restart — a runtime-set `demo-slow` could silently revert mid-demo. The honesty surfaces (live banner, markers) make this observable rather than dangerous; define "restart" per arm during implementation.

VERDICT: READY
