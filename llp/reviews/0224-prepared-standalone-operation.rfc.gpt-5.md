# Review artifact — LLP 0224 (GPT family)

## Round 1

- **Round:** 1
- **Date:** 2026-08-10
- **Target:** llp/0224-prepared-standalone-operation.rfc.md, revision b, blob f221fdac90fd8faf1cc299149a79cbcdbb9d4b55
- **Capsule:** sha256-16 93c413b2601650f6 (target + Related LLPs + pilot lane evidence + line-numbered code excerpts; reviews excluded)
- **Reviewer runtime:** codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, --sandbox read-only, capsule cwd
- **Verdict:** NOT READY

Verbatim review follows (final codex message, unedited).

---

## 1. Summary

The prepared-standalone direction and supervisor-first readiness slice are well motivated by the pilot and broadly consistent with the related LLPs. However, the RFC currently overstates the activation readiness of existing releases, mischaracterizes the observed race as sessions settlement, and leaves the application receipt’s authority, discovery, and invalidation semantics ambiguous. Those gaps could produce premature or stale readiness success and materially change Phase 1 and Phase 2 implementation.

## 2. MATERIAL concerns

### M1. Existing releases are integrity-verified but explicitly not activation-eligible

The RFC says `buildRelease` already produces an immutable, capability-validated release needing only a native consumer, and proposes reusing its existing admission check (`llp/0224-prepared-standalone-operation.rfc.md`, lines 59–65 and 148–166). The public type instead fixes `ReleaseVerification.activationEligible` to `false` and exposes blocking gaps (`packages/snapback-cli/index.d.mts`, lines 238–272). Moreover, the current requirement calculation covers only schema requirements and function requirements (`code-excerpts/snapback-cli-index.mjs.excerpts.txt`, source lines 1307–1317), while the proposed start plan must also cover routes, API-envelope members, seed/initialization, and other startup obligations.

Suggested fix: describe the current release as an integrity-verified, content-addressed closure that is not yet activation-qualified. Make start-plan preparation an explicit qualification step that resolves the applicable blocking gaps and derives required capabilities from every declared startup obligation. Native `start --release` must refuse an unknown plan, an integrity failure, any unresolved activation gap, or any unsupported obligation. Add corresponding tamper, unknown-plan-version, and non-function-obligation admission proofs.

### M2. The RFC conflates application provisioning with sessions settlement and names the wrong auth invariant

The summary says the supervisor reports ready before sessions settle (`llp/0224-prepared-standalone-operation.rfc.md`, lines 32–40). LLP 0058 requires sessions deployment activation, `sessionActivationReady`, process-object construction, and function publication before listener bind (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md`, lines 832–838 and 868–882). The code instead proves a different ordering: `runDev` receives host readiness and only afterward calls `loadGenerated` (`code-excerpts/snapback-cli-index.mjs.excerpts.txt`, source lines 2296 and 2379–2386). Because the pilot retained neither the first failed response nor its exact diagnostic, it does not establish that auth mode itself was unsettled.

The predicate also says auth has `requested == active`; LLP 0058’s settled invariant is `active == desired`, with `requestedDeployment == null`, `modeState == settled`, and availability `available` (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md`, lines 608–652). A literal comparison of requested deployment to active deployment would never describe normal settled sessions.

Suggested fix: consistently call the observed gap “application deployment/provisioning settlement after host readiness,” without attributing the swallowed failure more narrowly. Define auth readiness using LLP 0058’s actual settled invariant (`active == desired`, settled/available), conditionally require positive `sessionActivationReady` for sessions, and separately require that the exact requested application generation and all `loadGenerated` obligations are active.

### M3. The receipt’s authority is split ambiguously between the server and `runDev`

The design calls readiness a “server-owned operational predicate” (`llp/0224-prepared-standalone-operation.rfc.md`, lines 118–126), but Phase 1 says `runDev` publishes the receipt after its `loadGenerated` promise succeeds while also adding an `OperationalReadinessV1` fact to `app.inspect` (`lines 170–176`). Those are materially different implementations: the supervisor can infer success from orchestration, while LLP 0024 requires CLI/HTTP/MCP to project one core fact rather than independently derive it (`llp/0024-agent-operating-surface.spec.md`, lines 82–87 and 131–140).

Suggested fix: name one authority explicitly. Prefer the server-owned `OperationalReadinessV1` as the canonical evaluation of current runtime state against an expected application identity. `runDev` should trigger provisioning, obtain and validate that core result, and only then atomically project it to the file; it must not manufacture the readiness fact solely from promise completion. Standalone start and `app.inspect` should consume the same evaluator.

### M4. `snapback wait` cannot discover the independently named application receipt

The proposed command accepts only `--ready-file <host>` (`llp/0224-prepared-standalone-operation.rfc.md`, lines 134–136), while startup accepts an arbitrary, independent `--application-ready-file` path (`lines 93–99`). `HostReadyDescriptor` is explicitly unchanged and contains no application-receipt location (`schemas/host-ready.schema.json`, lines 85–162). Therefore an application-level wait cannot know which receipt to validate.

Suggested fix: choose and specify one coherent interface: add `--application-ready-file <path>` to application-level wait, define a mandatory deterministic sibling path, or define application-level wait as a live query of the canonical operational-readiness fact with the file being an optional projection. Update the examples and Phase 1 harness migration accordingly.

### M5. Digest binding and a live nonce do not prevent same-process stale-readiness success

The RFC says a receipt becomes stale after a dev reload but says `wait` validates receipts plus the live nonce (`llp/0224-prepared-standalone-operation.rfc.md`, lines 134–144). A dev reload does not change `startupNonce`; the existing watch loop reloads within the same server process. An old receipt can therefore still pass nonce validation, and its self-described generation does not tell a waiter which new generation is currently requested. This is especially hazardous when a new supervisor attaches to an existing server or while a watch reload is in progress.

Suggested fix: define the receipt lifecycle at design level: a new launch/reload request invalidates the prior application receipt before work begins; successful publication is atomic and bound to the requested identity; and application wait either receives that expected identity or compares the receipt with a live core state that records the current request. Add same-process reload/in-progress reload and supervisor-reattach stale-generation tests, not only stale-nonce and restart tests.

## 3. MINOR concerns

### N1. Inaccurate Phase 2 factoring description

“Factor release/start-plan construction out of `runDev`” (`llp/0224-prepared-standalone-operation.rfc.md`, lines 181–186) implies machinery that does not exist there. `runDev` calls `generateApp` and constructs the existing `StartupArtifacts` carrier, while `buildRelease` is separate (`code-excerpts/snapback-cli-index.mjs.excerpts.txt`, source lines 1251–1345 and 2226–2267). Say instead that shared startup-obligation planning/evaluation is extracted without routing dev through release construction or changing `StartupArtifacts` v1.

### N2. Owning-LLP amendments land too late

Phase 1 changes the `app.inspect` fact and packaged dev loop, but amendments to LLPs 0024/0030/0041/0058 are deferred collectively to Phase 3 (`llp/0224-prepared-standalone-operation.rfc.md`, lines 190–196). Amend each owning contract alongside the phase that changes its surface.

### N3. Pilot status should be stated more carefully

The run record labels the pilot “calibration evidence only, not claim-eligible” (`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`, lines 1–4). The RFC may use it as design evidence, but should label the 74-versus-52 comparison accordingly.

### N4. `HostReadyDescriptor` security wording is too absolute

It carries no bearer bytes, but it names owner-only authority sidecars such as the admin-token, secret-read-root, and impersonation-capability files (`schemas/host-ready.schema.json`, lines 89–117 and 135–159). Replace “no bearer authority” with “no bearer bytes; trusted owner-only descriptor that may locate authority sidecars.”

### N5. One cited governing LLP is absent from Related

Phase sequencing invokes LLP 0189 (`llp/0224-prepared-standalone-operation.rfc.md`, lines 198–199), but it is neither in Related nor available in the capsule. Add the relationship or remove the unsupported dependency from this RFC.

## 4. AUTHOR-DECISION channel

### A1. Which initialization obligations are part of standalone application readiness?

**Question:** Must a complete start plan execute versioned seed installation and migrations before issuing application readiness, or leave them as separate operator actions?

**Options:**

1. Gate readiness on every idempotent initialization obligation explicitly declared in the start plan, while requiring migrations to be separately planned/applied and proven compatible before start.
2. Keep all seed and migration work separate; application readiness covers only code, routes, auth, and capability admission.
3. Let standalone startup automatically apply migrations.

**Recommendation:** Option 1. It preserves the RFC’s “explicitly requested initialization” semantics and a useful fresh-instance path without weakening LLP 0109’s explicit migration policy. Automatic migration during `start` should remain excluded. No rethink-scale challenge to any binding decision is raised.

VERDICT: NOT READY

## Round 2

- **Round:** 2
- **Date:** 2026-08-10
- **Target:** llp/0224-prepared-standalone-operation.rfc.md, revision c, blob 04b7e893094806581e0281f7cf8ab502683bc2c6
- **Capsule:** sha256-16 4c3f6e3000dbc1a4 (round-1 capsule + revised target + LLP 0189 + convex-lane scores; reviews excluded; delta enumerated in instructions)
- **Reviewer runtime:** codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, --sandbox read-only, capsule cwd; mutually blind from the Claude reviewer
- **Verdict:** NOT READY (pre-existing text clean; all MATERIALs IN-DELTA)

Verbatim review follows (final codex message, unedited).

---

## 1. Summary

Revision c is directionally coherent and substantially improves the readiness and capability story. The evidence supports the pilot characterization, layered readiness is preferable to changing `HostReadyDescriptor`, and the phased destination respects the binding decisions. However, four implementation-changing boundaries remain unresolved: how the server evaluates readiness relative to a requested closure, which authority determines supported capabilities, the production and custody of the start plan, and successor-activation authorization. The PRE-EXISTING text is clean of MATERIAL concerns; all MATERIAL findings below are IN-DELTA.

## 2. MATERIAL concerns

1. **M1 — IN-DELTA: `OperationalReadinessV1` lacks a defined requested-target input, so the server cannot be the sole readiness authority as written.**

   Evidence: `llp/0224-prepared-standalone-operation.rfc.md` §Layered readiness, lines 137–154, says the server evaluates whether the “exact requested release/generation” and all obligations are active, while Phase 1, lines 224–230, only has `runDev` call `loadGenerated` and then read `app.inspect`. Current `app.inspect` returns current runtime state without an expected generation or obligation set (`code-excerpts/src-host_ops.rs.excerpts.txt`, source lines 1385–1394). Meanwhile, `loadGenerated` discovers schema, functions, routes, API-envelope members, and seed in package code and provisions them through multiple paths (`code-excerpts/snapback-cli-index.mjs.excerpts.txt`, source lines 2022–2057 and 2060–2110). Without passing a closed expected target to the server, the server can report current state, but it cannot distinguish “no route obligation was declared” from “the route obligation was omitted”; `runDev` would have to make that determination, contradicting the one-authority rule. The same ambiguity affects `wait`: matching generation/artifact digests is insufficient if the live readiness fact has become false because auth or another nondigest predicate changed.

   Suggested fix: define the core evaluator as operating over a closed expected activation target—generation/release identity plus the complete declared-obligation digest. Phase 1 `runDev` and Phase 2 native start must pass that target to the same evaluator. The returned object must state readiness for that exact target and name unsatisfied obligations; the receipt should project that evaluated object. `wait` must require the live evaluation to remain positive, not merely compare digests.

2. **M2 — IN-DELTA: the supported-capability authority is ambiguous and can collapse into a release self-assertion.**

   Evidence: §Prepared-release capability story, lines 186–200, says preparation reuses the required-vs-supported check, and Phase 2, lines 240–246, says native start consumes and revalidates the release capability manifest. The current build check obtains both requirements and `supportedCapabilities` from generated release artifacts (`code-excerpts/snapback-cli-index.mjs.excerpts.txt`, source lines 1307–1317). Integrity verification proves those bytes were not altered after sealing; it does not prove that the executing native runtime implements every capability the release claims is supported.

   Suggested fix: make the executing runtime’s server-owned target-profile registry the support authority. The release may declare requirements and its intended target-profile identity, but native start must compare those declarations against its own supported-capability set and refuse an unknown profile, incompatible manifest version/digest, or unsupported obligation. `OperationalReadinessV1` should record the resulting server-owned admission decision.

3. **M3 — IN-DELTA: the start plan has no specified producer or custody lifecycle.**

   Evidence: lines 190–200 introduce a closed `snapback.start-plan.v1` referencing the immutable release; the canonical command, lines 110–116, supplies only `--release`; and Phase 2, lines 240–250, requires unknown-plan-version refusal without saying where the plan comes from or how native start receives it. The current release surface exposes an integrity-verified but permanently non-eligible release and no plan artifact (`packages/snapback-cli/index.d.mts`, lines 229–272). Depending on interpretation, the plan is embedded before sealing, added afterward and thereby outside the closure, supplied through an unstated flag, or created internally by native start. Those choices have different integrity, version-negotiation, and toolchain consequences.

   Suggested fix: choose and specify one lifecycle. The least disruptive choice is for native start to deterministically construct an internal versioned plan from the verified release, bind its digest into readiness, and reject unknown obligation-schema versions declared by the release. If the plan is instead an external artifact, name its producer, path/flag, digest binding, and relationship to the immutable release without creating a self-referential release digest.

4. **M4 — IN-DELTA: `start --release` does not define how it satisfies LLP 0058’s explicit successor-activation rule.**

   Evidence: LLP 0058 §Cold startup artifact carrier, lines 840–864, makes `--activate-startup-successor` the sole cold same-mode exception and explicitly says ordinary `snapback start` never implies it. LLP 0224’s canonical command supplies `--release` but not the activation flag, while Phase 2 promises an “explicit successor-activation” proof without defining whether `--release` is itself new activation authority or whether the existing flag remains required. This determines whether starting a new sessions release over an existing database safely refuses or silently activates code.

   Suggested fix: preserve LLP 0058’s existing explicit flag unless the RFC deliberately amends that authority boundary. State that `start --release` refuses a differing settled sessions deployment unless `--activate-startup-successor` is supplied, and test both refusal and activation. If selecting the alternative—that operator selection of a qualified release is sufficient activation intent—amend LLP 0058 in Phase 2 and document the new authority semantics. The owning LLP amendment cannot wait until Phase 3.

## 3. MINOR concerns

1. **N1 — IN-DELTA:** `snapback wait` is said to cross-check through `app.inspect`, but full `app.inspect` requires `AdminWrite` under LLP 0024 §Authority Tuple, lines 320–329. State that ready-file-based wait reuses the existing pinned, owner-only `adminTokenFile` handoff and fails closed when that authority is unavailable; do not accidentally make the full readiness fact public.

2. **N2 — IN-DELTA:** the receipt field list at lines 161–164 says it binds “release/deployment identity,” but Phase 1 dev runs have a generated deployment and no release. Describe this as a mode-discriminated identity: generated/deployment identity for dev and release/start-plan identity for standalone.

3. **N3 — IN-DELTA:** lines 176–182 say later health flows through the dev event stream, which does not exist in prepared standalone mode. Say that ongoing host health uses `/health`/inspection, with the dev event stream as the supervisor-specific projection.

4. **N4 — IN-DELTA:** Phase 1 exports only `application-ready.schema.json`, although `OperationalReadinessV1` becomes a versioned HTTP/host-ops fact. Add a generated schema for the core fact, or explicitly include its closed schema in the owning host-ops result schema.

5. **N5 — IN-DELTA:** the narrow LLP 0058 amendment is deferred to Phase 3 even though Phase 1 first binds operational readiness to LLP 0058 settlement facts. Move the predicate-binding amendment to Phase 1; any successor-activation amendment belongs in Phase 2.

## 4. AUTHOR-DECISION channel

1. **Start-plan custody.** Should the plan be internal to native start, embedded in the sealed release, or emitted as a separate digest-bound artifact? Recommendation: construct it deterministically inside native start from the verified release and treat the release’s obligation-schema version as the predecessor-compatibility boundary. This preserves the two-command flow and avoids an additional mutable artifact.

2. **Successor authorization.** Should `--release` itself authorize activation of a differing settled sessions deployment, or should callers retain `--activate-startup-successor`? Recommendation: retain the explicit flag. It preserves LLP 0058’s fail-closed rule and distinguishes selecting bytes from authorizing a durable deployment transition.

3. **Placement of `snapback wait` (existing OQ5).** Options are native, package CLI, or native with package delegation. Recommendation: native, with the package CLI delegating when present. Standalone environments need no JS dependency, and the native side already owns descriptor validation and the server-owned readiness fact.

4. **Seed and migration obligations (existing OQ2).** Recommendation: make an explicitly declared, versioned seed install readiness-gating through LLP 0109’s post-bind operation; keep migrations as separate operator steps for v1, with a start plan refusing any release that declares an unresolved migration requirement. This avoids silently redefining LLP 0109 or LLP 0081.

No rethink-scale challenge to the four binding decisions is warranted.

VERDICT: NOT READY
