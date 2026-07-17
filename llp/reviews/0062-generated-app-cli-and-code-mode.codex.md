**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI v0.144.5, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only; orchestrated by /llp-super-refine
**Date:** 2026-07-17
**Redacted:** no — repo-local review; reviewer instructed not to read credential files or llp/reviews/
**Method:** cli-runner

# LLP 0062 reviews — GPT/Codex family

## Round 1 — 2026-07-17

**Revision under review:** `llp/0062-generated-app-cli-and-code-mode.rfc.md`, sha256 `777a47c787e3e8d46cb8da5eae299dbb5d7e04ff2394a88683b54dcc8bc7e497` (untracked file at repo HEAD `dfd829e`)
**Runtime detail:** codex exec, session id 019f6f57-9bdb-7370-afc8-20f14493dcbf, workdir /Users/ccheever/projects/snapback, approval never; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

At repository HEAD `dfd829e`, the RFC was new/untracked. Before reviewing, I verified its SHA-256 as:

`777a47c787e3e8d46cb8da5eae299dbb5d7e04ff2394a88683b54dcc8bc7e497`

This exactly matches the revision specified for review.

I read the entire RFC and the requested Snapback LLPs 0010, 0012, 0019, 0024, 0031, 0042, 0055, 0056, and 0061. I also read Ibex LLPs 0013, 0014, 0022, 0028, and 0029 from the sibling `/Users/ccheever/projects/ibex/llp/` checkout, not the stale vendored submodule, and checked the identified generated artifacts, client, custody implementations, server registry, hosted gateway, and capability index.

The central product idea is good: a generic, agent-oriented CLI mechanically projected from generated application metadata is a natural Snapback surface, and code mode could materially reduce agent context and round trips. The proposed separation from operator host-ops and the refusal to execute server-supplied JavaScript are particularly sound.

The current plan is nevertheless not ready. Several normative claims conflict with implemented auth semantics, generated types, route policy, and the cited Ibex contracts. There are also unresolved security and feasibility questions around artifact disclosure, caching, credential custody, hosted support, result attribution, and code-mode execution. These are design blockers rather than implementation polish.

## 2. Strengths (with section citations)

- The “engine plus data” architecture is the right default (RFC §Summary, §1). The generated `api.mjs` is indeed an inert descriptor object, so dispatch can be synthesized without evaluating downloaded code. Explicitly rejecting execution of a served `api.mjs` avoids a serious remote-code-execution design trap.

- The application-plane/operator-plane separation is well reasoned (RFC §Position among existing surfaces). Refusing admin credentials and avoiding host-op `function.run` for scoped-token calls agrees with LLP 0024’s agent-principal amendment and LLP 0055 §Plane boundary.

- The underlying application-call substrate is real (RFC §Motivation, §2). The manifest contains stable function IDs, closed function kinds, auth requirements, dependency summaries, and syncability facts; operation argument schemas exist; and the headless client provides query, mutation, action, live subscription, reconnect, and disposal primitives.

- The machine-first UX is thoughtful (RFC §2, §7): JSON/JSONL defaults for non-TTY output, a separate diagnostic channel, explicit exit statuses, first-snapshot behavior, reconnect deduplication, and adversarial adapter-conformance tests are all appropriate for an agent-facing CLI.

- The proposal correctly keeps grants, memberships, and effective identity server-decided (RFC §2, §4). That matches LLP 0055 and LLP 0056 and avoids reimplementing authorization policy in the CLI.

- The Node boundary is described more honestly than most code-runner proposals (RFC §3): it acknowledges that a Node VM is not a hostile-code sandbox. Deferring REPL semantics is also wise (RFC §Future work); Ibex LLP 0022 shows that authenticated ingress, terminal behavior, imports, interrupts, history, and persistent bindings form a much larger contract than a simple loop.

- The atomic-envelope and build-identity direction is good (RFC §1, §5, §7), as are the explicit guide and capability-index obligations (RFC §Guide and capability-index obligations). These follow useful patterns from LLP 0061 rather than leaving distribution and documentation implicit.

## 3. Concerns

1. **[major] The authorization and discovery projection is incorrect, and two projections are insufficient.**

   Evidence: RFC §Summary, §2, §4, and §5 treat every non-`public` function as unavailable to anonymous callers. The implemented gate only rejects anonymous authority when `authRequirement === "authenticated"`; both `public` and `optional-user` accept anonymous invocation (`src/auth/invocation.rs:1418-1424, 1676-1687`). Every function in the todo manifest is `optional-user` (`demos/todo/snapback/generated/functions.manifest.json:9,43,79,131,168,221`). As written, the CLI would reject every todo function even though the server permits those calls, creating precisely the second auth semantics the RFC says it avoids.

   The authenticated projection has a second problem. LLP 0055 §Plane boundary allows `sbagt_` tokens only on generated function routes and `POST /connection/open`. The RFC does not say how an agent obtains non-public schemas without either expanding that boundary or presenting the long-lived `sbac_` to a new route. Giving “any authenticated principal” the full inventory also ignores an agent token’s grant-scoped function set.

   Resolution criteria: define a closed discovery-and-call matrix for `public`, `optional-user`, and `authenticated` across anonymous, human-session, and service-principal callers. Anonymous preflight must match the real invocation gate. Define whether an agent receives a grant-intersected metadata projection, and explicitly amend LLP 0055 if scoped tokens become valid on an artifact route. Test every requirement/principal combination, including presented-but-invalid credentials and out-of-grant functions.

2. **[major] The asserted callable TypeScript contract does not exist.**

   Evidence: RFC §Summary and §3 say that `await api.createTodo(...)` and async iteration over a live query typecheck against the existing `api.d.ts`. The actual `FunctionReference` is a descriptor interface with fields and a phantom argument type but no call signature (`api.d.ts:7-15`). `GeneratedApi` contains those descriptors (`api.d.ts:52-63`), while `api.mjs` contains plain frozen objects (`api.mjs:3-53`). There is no generated result type, no async-iterable type, and the declaration is an ES module rather than an ambient declaration for an injected global.

   Resolution criteria: define and generate a distinct code-mode declaration contract, for example a mapped `BoundApi<GeneratedApi>` with kind-specific callable signatures. Specify how an injected global is made visible to TypeScript, what query/mutation/action calls return, and whether unknown result types remain `unknown`. Add CI fixtures that typecheck the RFC’s mutation and live-query examples against the exact served declaration.

3. **[major] Serving or introspecting verbatim manifests discloses executable implementation source.**

   Evidence: RFC §2 says introspection returns manifest entries verbatim, while §5 serves the manifest and gives any authenticated principal the full envelope. Current manifest entries contain complete `runtime.IbexModule.source`, HostPlan step bodies, and `sourceSpan` (`functions.manifest.json:25-29, 97-118, 152-158`). The manifest schema requires `runtime`, and `IbexModule` requires `source` (`schemas/functions.manifest.schema.json:611-615, 695-708`).

   This directly conflicts with LLP 0031’s D3 hardening: `PublicFunctionManifest` deliberately removes handler source, HostPlan bodies, and source paths, while full source remains on the `AdminSecretRead`-gated twin. Treating source as non-executed data prevents execution but does not prevent disclosure.

   The anonymous declaration projection is also undefined: §5 includes `api.d.ts` in the envelope but describes the anonymous projection only as a manifest subset plus operation schemas. Serving the current full declaration would reveal every hidden function’s name and argument shape.

   Resolution criteria: define a new closed, versioned app-API metadata schema that never contains `runtime`, executable plan bodies, `sourceSpan`, or unrelated internals for ordinary app principals. Full implementation source, if exposed at all, must remain operator-gated. Generate a projection-specific declaration file or omit declarations from anonymous responses. Add source/path sentinels proving none can appear in public, session, service-principal, cached, or introspection output.

4. **[major] The proposed authenticated route does not fit the route registry, and its cache behavior can leak authenticated data.**

   Evidence: RFC §5 assigns the route to LLP 0031’s public system-static lane while also selecting anonymous versus authenticated output. Current `SystemStatic` registration permits only inert public admin assets and guide projections, with no credential resolution, invocation authority, effect, or session overlay (`src/server.rs:3914-3929`). Online auth checks and managed admission apply to app-data routes, not ordinary static routes (`src/server.rs:5483-5524, 6002-6029`). Performing Authorization handling inside the route handler would bypass the centralized policy semantics.

   The RFC uses one URL for different response bodies but specifies neither `Vary: Authorization` nor private/no-store behavior. Current response controls leave `PublicProjection` cacheable (`src/server.rs:4939-4998`). A shared cache could therefore publish an authenticated inventory to an anonymous caller.

   Resolution criteria: specify an explicit registered policy tuple or a new route class for app-principal metadata, including optional session/scoped-token resolution, invalid-bearer refusal, protocol negotiation, transition admission, response-publication fencing, and response sensitivity. Prefer separate public and authenticated endpoints; otherwise mandate `Cache-Control: private, no-store` and `Vary: Authorization`. Add registry, credential-class, transition-race, and shared-cache leakage tests.

5. **[major] The server has no defined way to receive, atomically activate, or byte-identify the proposed envelope.**

   Evidence: current provisioning posts only schema and `functions.manifest.json` (`scripts/demo-setup:58-68`); `SnapbackClient.loadFunctions` posts only that manifest, and the Rust handler accepts only `FunctionManifest` (`demos/_kit/client.mjs:2646-2657`, `src/server.rs:10712-10735`). The server never receives the operation schemas or `api.d.ts`. The RFC therefore leaves unexplained how an out-of-checkout server obtains the bytes it must serve, or how their activation is coupled to the executable function-manifest swap.

   The proposed cache key is also insufficient. `inputsHash` and `bundleHash` are semantic codegen/function identities, not hashes of the emitted envelope bytes. A generator change can alter schemas or declarations without changing those values. Anonymous and authenticated projections have different bytes but are assigned the same pair, and the key omits target origin, app, and projection class.

   Resolution criteria: define an atomic artifact-envelope ingestion, validation, persistence, activation, rollback, and restart contract. Couple its activation to the exact loaded function bundle. Add a canonical whole-envelope SHA-256 per projection and expose it as an ETag/identity header. Cache by normalized target origin, app ID, projection/authority class, and envelope hash; treat `inputsHash` and `bundleHash` as semantic cross-checks only. Test racing deployments, failed activation, restart, rollback, logout, and cross-origin cache collisions.

6. **[major] Function results, diagnostics, and service-principal attribution do not yet have one coherent contract.**

   Evidence: RFC §2 says a call prints “the result” and introduces generic CLI diagnostics such as `SNAPBACK_APP_CLI_AUTH_REFUSED`, but it does not define the canonical stdout envelope or how exact server diagnostics are retained. Current query calls return objects containing `.rows`; mutations return protocol envelopes containing `.result`, `.changed_count`, and other facts (`demos/todo/tests/acceptance/headless.mjs:88-110`). A `LiveQuery` can also be invoked once through `query`, while durable subscription is a different client operation.

   LLP 0012 §Diagnostic Schema requires adapters to preserve the shared diagnostic dialect. LLP 0055 §Audit additionally requires every service-principal response and post-resolution denial to carry a server-derived attribution block copied verbatim by CLI/MCP projections. A CLI-synthesized result that emits only an application value or replaces `SNAPBACK_AUTH_REQUIRED`/`GRANT_SCOPE_DENIED` with one generic code loses contract and audit information.

   The frozen introspection envelope is itself a new schema despite §2 saying it “adds no second schema”; the manifest’s `schemaVersion` cannot version fields such as `engineVersion` and `artifactIdentity`.

   Resolution criteria: define a versioned result envelope for every function kind and code mode, including exact application value, protocol facts, server attribution, and `diagnostics[]`. Preserve server diagnostic codes verbatim; exit numbers may classify them but must not replace them. Pin `call(LiveQuery)` versus `subscribe(LiveQuery)`, mutation unwrapping, JSON/JSONL framing, and TTY behavior. Give introspection its own `artifactKind` and schema version. Add parity tests comparing HTTP/headless/CLI output and attribution for the same invocation.

7. **[major] Credential custody is incomplete, and the claimed Node compromise bound is false without OS isolation.**

   Evidence: RFC §4 describes `sbac_` coming from “env or custody file” and then cites `AgentAuthorityFence`. Those are different concerns. `AgentAuthorityFence` consumes an already-minted scoped-token tuple including `grantId`, `tokenId`, and an in-memory bearer (`agent-authority.mjs:63-70`). Its filesystem adapter deliberately persists only durable fence metadata and recursively refuses bearer, token-ID, and secret fields (`agent-authority-filesystem.mjs:203-246`). The RFC does not define a long-lived credential vault, file format, location, grant selection, or token-mint metadata flow.

   The existing client also rejects raw bearer bypass and expects the fence to surround request start and result publication in the same process (`client.mjs:994-1022, 2195-2288`). Giving a token to a direct-networking child while keeping the durable fence in the parent does not preserve those semantics.

   Human custody is absent as well. `authExchange` and `authLogout` require `AuthCoordinator`, which requires transactional storage; only memory and IndexedDB storage are currently exported. A process-per-command `login` otherwise loses its session on exit, and direct child networking under a human session would expose the full session bearer.

   Finally, §3 simultaneously says a Node VM escape can do anything the invoking OS user can and that a compromised run is bounded by the scoped token. Both cannot be true. An escaped child can search user-readable files for the long-lived credential and use ambient OS networking. Hiding the path and scrubbing the environment reduce accidental exposure, not hostile-code authority.

   Resolution criteria: specify separate secure, target/app-keyed Node custody for human sessions and long-lived agent credentials, with permissions, symlink defenses, atomicity, locking, refresh, revocation, logout, and grant selection. Keep the headless client, every bearer, and `AgentAuthorityFence` in the parent; expose a closed API-call protocol over IPC to the worker. Correct the Node threat statement to say no hostile-code bound exists unless an OS sandbox, separate user/container, or equivalent containment is added. Test separate-process login/call/logout, concurrency, token expiry/rotation, revocation, and absence of credentials or paths from child environment, argv, stdio, diagnostics, temporary files, and caches.

8. **[major] The claimed hosted phase-one behavior is not currently available or scoped as a prerequisite.**

   Evidence: RFC §Motivation and §4 say hosted targets support anonymous and human-session use in phase one. The capability index marks human sessions and agent principals as local (`guide/capabilities.md:47-54`). Current Cloudflare acceptance advertises only `snapback.v0`/`dev`, declares hosted-auth capabilities unavailable, and explicitly verifies that the client never probes `/auth/session` (`cloudflare/test/acceptance.all-aboard.mjs:190-205, 226-232`). Rust’s `AuthDeploymentTarget::Hosted` is also categorically refused (`src/auth/deployment.rs:308-320`), and the Cloudflare gateway has no app-artifact route.

   “Self-hosted dev” is likewise not automatically trusted-local: LLP 0055 requires LLP 0060’s target-authored capability and expressly says a reverse-proxied local server is not trusted-local.

   The proposed `/_snapback/cli` payload lacks any server-owned principal/auth capability fact, even though §2 expects help to pre-refuse an agent credential on a hosted target. Inferring this from the URL would violate target honesty.

   Resolution criteria: publish an explicit phase-one target matrix. Either restrict human/agent support to witnessed local and trusted-local session targets, with hosted anonymous-only where actually supported, or make hosted sessions, artifact serving, and gateway wiring explicit prerequisites owned by this plan. Add a closed server-authored capability field to `/_snapback/cli` and test stale, unsupported, and contradictory capability combinations.

9. **[major] Code mode and live iteration lack a versioned executable-language and lifecycle contract.**

   Evidence: RFC §3 does not define whether input is a script or module, import syntax, top-level `await`, full versus erasable-only TypeScript, enum/namespace behavior, the meaning of “explicit output,” result serialization, thenables, `undefined`, `BigInt`, cycles, or multiple outputs. “Final expression” also has host-dependent behavior unless an exact source transformation and source goal are pinned. Ibex LLP 0028 promises full TypeScript lowering, not merely type stripping, so an unspecified Node erasure path cannot support the promised unchanged cross-host scripts.

   The live surface also requires new semantics not supplied directly by the client. The current live client exposes a callback-driven handle, not an async iterator. Resubscription intentionally publishes a fresh snapshot, and reconnect attempts continue indefinitely while demand exists. The RFC instead requires content deduplication, iterator disposal, and exhausted retries without defining structural equality, queue bounds, slow-consumer behavior, coalescing, cancellation, or retry budget.

   There are no CPU, memory, wall-clock, output-size, timer, or outstanding-call limits. A child that loops forever or leaves live handles open has no specified termination outcome.

   Resolution criteria: define a versioned `CodeModeSource` and `LiveIterator` profile covering syntax/source goal, transform and fingerprint, import policy, async behavior, result capture and serialization, error mapping, queue/backpressure rules, equality, retry/deadline budget, cancellation, disposal, and resource ceilings. Add cross-host fixtures for enums/namespaces, top-level await, forbidden imports, final-expression/output behavior, serialization edge cases, slow consumers, reconnect dedupe, iterator `.return()`, timeout, CPU exhaustion, and forced termination.

10. **[major] The normative Ibex phase directly conflicts with LLP 0029 and overstates LLP 0013’s security boundary.**

    Evidence: RFC §6 says the same `run script.ts` contract will be packaged through Ibex LLP 0029. LLP 0029 §4 explicitly removes `repl`, `eval`, and file-execution ingress and permits exactly one embedded entry. Its TypeScript entry is erased at compile time, never runtime. An embedded CLI engine therefore cannot accept arbitrary external TypeScript under LLP 0029 as written. The implementation is greenfield; the current Ibex CLI has no compiled-mode path.

    The “boundary becomes real” statement in RFC §3 is also unsupported. Ibex LLP 0013’s honest threat-model name is “supply-chain integrity,” not “sandbox”; genuinely hostile code retains instance/process isolation as layer one, and no exact target is currently advertised complete. Ibex LLP 0022 assigns ordinary file/piped source full Root authority and leaves a Quarantine route open. RFC 0062 defines neither a script principal nor separate engine/script policies, ingress authentication, endowments, or instance topology.

    There is an additional static-policy mismatch: LLP 0029 makes the embedded policy the total authority ceiling, while the generic CLI accepts an arbitrary runtime-selected URL or local directory. Supporting that generically requires broad network/filesystem authority unless startup attenuation is designed. Its mmap/startup argument applies to the embedded engine carrier, not to dynamically supplied TypeScript that still needs parsing and transformation.

    Resolution criteria: either move the Ibex phase to explicitly non-normative future research and remove “without changing this RFC’s contracts,” or revise the relevant Ibex contracts first. A normative phase must define authenticated script ingress, a Quarantine or new code-mode principal, separate engine and worker policies, target attenuation, runtime Oxc inclusion, and a separate Hermes instance/process for hostile scripts. It must keep credentials outside that worker and gate the security claim on an advertised-complete target. Acceptance must run through the actual compiled executable and include adversarial global/intrinsic walks, imports, `eval`/`Function`, environment, filesystem, ambient network, bearer extraction, CPU, and memory tests.

## 4. Suggestions (non-blocking improvements)

- Sequence the work into smaller proofs: local-directory `introspect`/`call`; safe served metadata; session and service-principal custody; Node code mode; then Ibex research. This would validate the CLI’s value before coupling every unresolved authority and runtime question.

- Make `AppApiEnvelope`, its public/grant-scoped projections, and `CodeModeBindings.d.ts` explicit generated artifacts listed in `artifacts.json`. Key operation schemas by stable function ID inside the envelope rather than relying on filenames.

- Use one parent-broker protocol on both hosts: scripts receive an opaque `api` capability whose calls cross IPC to the credential-owning parent. Node and Hermes workers could then share the same call ABI, cancellation, attribution, and refresh semantics without ever receiving a bearer.

- Put strict bounds on server-supplied data: total envelope bytes, function/schema count, nesting depth, regular-expression complexity, and `$ref` behavior. “Data, not code” avoids RCE but does not by itself avoid parser or validator denial of service.

- Treat `inputsHash`, `bundleHash`, and schema identities as opaque, versioned strings. Existing v0 and v1 artifacts already use different hash spellings and lengths.

- Add the `clients.app-cli` GAP row when the RFC lands, with owner and review date, and regenerate the guide manifest/flat projection. When routes land, list every exact and wildcard route in the surface map.

- Rephrase “composition, not new machinery.” The call primitives exist, but safe projections, envelope ingestion, route policy, caches, Node custody, IPC, and code execution are substantial new machinery.

- Soften the claim that server-side code mode is incremental. Sharing Hermes and a TypeScript dialect does not solve authenticated code ingress, resource limits, provenance, or isolation.

## 5. Open questions

1. Is anonymous discoverability intended to match anonymous callability, including `optional-user`, or is it deliberately narrower? If narrower, how can an explicit allowed call obtain its argument schema?

2. What metadata should a scoped agent token see: the public catalog, exactly its grant-scoped functions, or a broader safe inventory? Which LLP owns that new token-valid route?

3. May an ordinary human session see every non-public function’s shape, or should visibility be app-configured or membership-aware?

4. What is the canonical result of each function kind: the full wire response, an application value plus metadata, or another envelope? How are attribution and diagnostics preserved?

5. Where is the complete artifact envelope stored, and what transaction makes it active with the corresponding executable function bundle?

6. What exact TypeScript/JavaScript profile does code mode support, and how does an author import or reference the served declaration for an injected global?

7. Will the child ever receive a bearer, or will all application calls be parent-brokered? What happens when a token/session expires during a long-running script or subscription?

8. What are the human-session credential-store and agent-credential/grant-selection UX, including multiple apps, targets, grants, and concurrent CLI processes?

9. What is the witnessed phase-one target matrix: dev, trusted-local sessions, self-hosted, Cloudflare, and future hosted-auth deployments?

10. What are the exact live-query equality, buffering, retry, timeout, and slow-consumer rules?

11. Is an authenticated cached inventory usable after logout or while offline? If so, what disclosure policy, expiry, and deletion behavior apply?

12. Is Ibex phase two a committed contract or a research direction? If committed, which principal, ingress contract, runtime instance, and policy artifact govern submitted scripts?

## 6. Readiness verdict

The proposal has a strong core idea, but unresolved correctness, confidentiality, authority, custody, compatibility, and feasibility concerns remain. The anonymous-auth contradiction, source disclosure, unsafe projection/cache design, missing artifact publication path, undefined result and code-mode contracts, and Ibex incompatibility are all material blockers.

Verdict: NOT READY
## Round 2 — 2026-07-17

**Revision under review:** `llp/0062-generated-app-cli-and-code-mode.rfc.md`, sha256 `f57844a05bd22eaa2adacbf167540682077d1c9fc567cc37b077f6a697816cea` (untracked file at repo HEAD `dfd829e`; round-1 revision)
**Runtime detail:** codex exec, OpenAI Codex CLI v0.144.5, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, session id 019f6f6b-b463-7cd2-9495-93fd2eb1d047; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

I verified that the reviewed file’s SHA-256 is exactly `f57844a05bd22eaa2adacbf167540682077d1c9fc567cc37b077f6a697816cea`. Repository HEAD is `dfd829e`, and Git reports the RFC as new/untracked.

I read the complete RFC, all specified Snapback and sibling-Ibex LLPs, and the relevant generated artifacts, server, auth, headless-client, custody-source, hosted-gateway, and guide code. No credential, secret, or runtime custody/token material was inspected.

The proposal is a good idea. A generic engine driven by generated data is substantially better than generating per-app executables, and brokered code mode could materially improve agent ergonomics. The architectural direction should continue.

The current plan is not ready for acceptance, however. Several phase-one contracts are either incompatible with governing LLPs or insufficiently specified to implement consistently: hosted routing, local target binding, dev authentication, grant selection, envelope ingestion, artifact/version protocols, result and broker ABIs, token expiry, and the public disclosure boundary. The strongest revision would narrow phase one to targets whose routing and artifact lifecycle already exist, then freeze the wire and authority contracts before implementation.

## 2. Strengths (with section citations)

- The “one engine plus app data” model is the right abstraction. It follows the one-core/thin-projection discipline without generating another semantic implementation of calls (RFC 0062, “Summary,” “Position among existing surfaces,” and §1; LLPs 0019 and 0024).

- Refusing to execute served `api.mjs` is an important security decision. Treating the manifest, schemas, and declarations as bounded data avoids deliberate remote-code execution by the target server (RFC 0062 §1).

- The application/operator-plane separation is well handled. App calls use ordinary app-data routes and scoped app authority rather than `function.run`, admin tokens, or host-operation impersonation (RFC 0062, “Position among existing surfaces”; LLPs 0024 and 0055).

- The three-valued `authRequirement` interpretation is substantially correct: absent means effective `optional-user`, anonymous callers are rejected only for `authenticated`, and grant/membership decisions remain server-owned (RFC 0062 §§2 and 4; `src/auth/invocation.rs:1418-1425`; LLPs 0055 and 0056).

- Reusing `PublicFunctionManifest` is sound. It is an exhaustive typed allowlist that strips executable source, HostPlan bodies, and source paths (`src/manifest.rs:1654-1670, 1891-1947`; RFC 0062 §5; LLP 0031 D3).

- The separate `code-mode.d.ts` is genuinely necessary. Current `api.d.ts` describes inert references without call signatures, while `api.mjs` contains top-level inert descriptors (RFC 0062 §3; `demos/todo/snapback/generated/api.d.ts` and `api.mjs`).

- The parent-broker architecture is a useful attenuation seam, and §3 correctly admits that a Node VM is not hostile-code containment. That honesty agrees with Ibex LLP 0013’s supply-chain threat model.

- Keeping Ibex packaging non-normative is correct. Ibex LLP 0029 currently allows one embedded entry with no file/eval/REPL ingress, and LLP 0028 does not yet supply the required runtime transformation contract across this use case (RFC 0062 §6; Ibex LLPs 0028 and 0029).

- The acceptance outline is unusually concrete: source sentinels, forged adapter violations, TTY/non-TTY goldens, live reconnect tests, attribution parity, and host-portable code-mode fixtures are all valuable (RFC 0062 §7). The guide and capability-index obligations also align with LLP 0061.

## 3. Concerns

1. **Major — Hosted phase-one routing contradicts LLP 0060 and lacks a hosted distribution design.**

   RFC §§4–5 place public discovery at `/_snapback/app-api/envelope` and `/_snapback/cli`. Accepted LLP 0060 requires the first hosted profile to report `operatorSurface: "disabled"` and return a fixed 404 for every `/_snapback/*` route on the public app origin (LLP 0060, lines 777–795). LLP 0031 likewise reserves that prefix for system routes; its public static exceptions are build-owned admin and guide bytes. Current enforcement has only `AppData`, `SystemStatic`, and `SystemApi`, with `SystemStatic` restricted to admin/guide routes (`src/server.rs:3549-3561, 3910-3945`).

   Hosted deployment is also not an `/app/ensure` flow. The Cloudflare gateway imports generated deploy-time metadata, has an explicit route set, and otherwise falls through to assets/404. The RFC does not explain how schemas and declaration artifacts become atomically bound to the deployed gateway, coordinator, and handler bundle.

   **Resolution criteria:** Either remove hosted support from phase one, or select a root/`.well-known` application namespace and reconcile LLPs 0031 and 0060 explicitly. If hosted remains, specify deploy-time envelope generation and embedding, atomic deployment identity, route precedence, cache/CORS policy, and a hosted or Miniflare acceptance witness.

2. **Major — Local-directory mode has no network target or wrong-target protection.**

   RFC §1 makes `--app <url-or-dir>` the sole locator, yet the generated directory contains no target origin or port. `artifacts.json` carries app and artifact identities only. The headless client requires a `baseUrl` (`demos/_kit/client.mjs:994-1008`), and its ordinary calls ultimately dispatch through name-based routes. Consequently, local artifacts cannot perform a call without an unspecified second discovery mechanism, and app-A artifacts could invoke a same-named function on app B if paired with the wrong server.

   **Resolution criteria:** Define separate artifact and target inputs, or a closed target descriptor. Before any network operation, attest target `appId`, active artifact tuple, and envelope/function identity against the local artifacts and fail closed. Add tests for a missing target, wrong app, stale bundle, and same-named functions across two apps.

3. **Major — The local-dev authentication matrix is incorrect and leaves authenticated functions unusable.**

   RFC §4 says everyone in `snapback.v0/dev` is anonymous. In fact, LLP 0031 defines `AppAuth` in dev mode as client-supplied `ctx.auth` impersonation, and the query, mutation, and action rows use body auth as dev authority (LLP 0031, lines 291–295). The headless client exposes this through `userId`. Without a local-only dev identity projection, the CLI cannot exercise an `authRequirement: "authenticated"` function in an ordinary dev instance.

   **Resolution criteria:** Either add an explicit local-only dev-principal option using the existing AppAuth body contract, with prominent non-production semantics, or intentionally exclude authenticated dev functions and correct the matrix and capability claims. Acceptance must exercise an authenticated function in dev and prove that the identity option is refused outside dev mode.

4. **Major — Principal and grant selection are neither deterministic nor implementable from the specified inputs.**

   A stored human session and an `sbac_` source may coexist, but the RFC has no explicit principal selector or precedence rule. Current `SnapbackClient` makes `AuthCoordinator` and `AgentAuthorityFence` mutually exclusive (`client.mjs:1009-1016`).

   More seriously, an `sbac_` credential cannot discover whether it has zero, one, or several grants. The token-mint endpoint requires a caller-supplied `grantId`; the only grant-list endpoint requires a human session. Thus “refusal, not guessing, when ambiguous” cannot be implemented from a bare credential.

   The proposed discovery field also conflates static target support with current app posture. LLP 0012 explicitly distinguishes supported modes from the active/desired mode.

   Even anonymous sessions-mode calls need a coordinated sessions handshake: current client calls initially include a legacy auth body, which must be removed after protocol negotiation.

   **Resolution criteria:** Add an explicit `--principal anonymous|session|agent`; define source precedence without automatic authority escalation; require `--grant` or a closed credential profile containing a grant id unless a separately reviewed discovery protocol is added. Separate static support from current availability/readiness, and test anonymous sessions bootstrap plus every source-collision and grant-cardinality case.

5. **Major — Envelope ingestion omits the v0-dev path used by phase one.**

   RFC §5 says to extend the closed `provision` intent. LLP 0012 retains a separate legacy untagged v0-dev compatibility form, and the current headless `ensureApp()` sends that legacy `{schema, functions, seed}` body (`client.mjs:2663-2668`). The RFC does not say whether v0 migrates to an explicit form or how the legacy form carries the new envelope. Therefore atomic manifest/envelope activation is not defined for a primary phase-one target.

   **Resolution criteria:** Define closed ingestion for every admitted phase-one tuple, including the v0-dev compatibility path and v1-sessions provision path. Each must preflight and atomically persist the envelope with the exact function manifest it describes, with rollback and restart tests. Alternatively, remove served-envelope support from v0 phase one.

6. **Major — The new wire artifacts, caching protocol, and compatibility handshake are not specified.**

   RFC §5 says two things are versioned, but neither the envelope nor `/_snapback/cli` has a closed DTO, `artifactKind`, independent protocol version, committed schema, unknown-field policy, or source-of-truth implementation. This conflicts with the RFC’s correct observation that the nested manifest version cannot version introspection-added fields.

   “ETag-style header” leaves the actual validator, conditional request, cache-control, content-encoding, redirect, and digest representation undefined. Offline selection is also unspecified for a cache keyed by app id when discovery is unavailable.

   Finally, an old server cannot use an engine package-semver range to decide whether a future engine is backward-compatible. The promise to support a tuple’s unspecified “prior revision” is also inconsistent with LLP 0012’s closed exact tuple set.

   **Resolution criteria:** Define closed, independently versioned discovery and envelope DTOs with exact JSON Schemas and drift gates. Pin canonical bytes, content type, digest/header spelling, validators, revalidation, redirects, size limits, and offline lookup. Negotiate protocol versions and feature sets rather than hard-failing solely on package semver. Enumerate exact accepted artifact tuples; future tuples require an LLP 0012 amendment.

7. **Major — The result, broker, and stream ABIs are not defined tightly enough.**

   Existing success shapes differ materially:

   - Query: `{version, rows}`.
   - Mutation: `{version, changed_count, result, ctx_ledger?, receipt}`.
   - Action: `FunctionRunResult`, including `ok`, reads/writes, optional values, and an embedded diagnostic.

   RFC §2 names a “versioned result envelope” but gives no closed schema or per-kind mapping. Section 3 then says broker calls return the envelope while callable declarations promise only `Promise<unknown>`. It is unclear whether `await api.foo()` receives an application value or protocol envelope, and how a multi-call script preserves attribution, diagnostics, partial failures, and live events.

   Current non-2xx client handling also drops `json.attribution` while retaining only diagnostic and receipt (`client.mjs:2440-2459`). Its mandatory secret-reflection sanitization means diagnostics cannot safely be byte-verbatim.

   **Resolution criteria:** Commit closed schemas for call results, run results, broker messages, and stream events. Define exact per-kind success/error mappings, action `ok:false` handling, what callable functions and live iterators yield, cancellation, and multi-call attribution. Preserve server codes and safe semantic fields after mandatory redaction; extend the client seam to retain server-derived failure attribution. Add schema and parity goldens for all function kinds and error paths.

8. **Major — Durable watch behavior is left open despite inevitable scoped-token expiry.**

   RFC §2 promises durable `--watch`, but §Open questions defers automatic token refresh versus a documented ceiling. LLP 0055 gives scoped tokens a one-hour default, a 24-hour maximum, and terminalizes live carriers on expiry. Therefore an agent watch necessarily fails or rotates during ordinary use.

   **Resolution criteria:** Normatively choose automatic pre-expiry mint/reconnect when the parent has the long-lived credential, or a documented terminal ceiling with a typed diagnostic. Distinguish token replacement from credential rotation and authority-generation changes. Test expiry during watch and code-mode iteration, deduplication after reconnect, stale callbacks, failure to remint, and disposal.

9. **Major — The credential-isolation claim is stronger than the stated threat model permits.**

   “No bearer ever enters the script host” is repeated as an absolute, while §3 correctly admits that escaped Node code has the invoking user’s filesystem and networking authority. Session credentials are intentionally stored in user-readable custody, and `sbac_` may come from the environment or a file. Same-user escaped code can therefore obtain those credentials; the architecture only prevents intentional transmission through globals, argv, environment, and broker IPC.

   In addition, reusing the complete current headless client would read ambient `SNAPBACK_ADMIN_TOKEN` and expose operator methods (`client.mjs:994-996, 2642-2689`), contradicting “operator credentials rejected by construction.”

   **Resolution criteria:** Narrow the security claim to legitimate-channel non-transmission and explicitly state that VM escape may expose filesystem/environment credential sources. If hostile-script secrecy is desired, require OS isolation. Use an app-data-only client façade with no admin methods or ambient admin-token lookup, and test with planted admin/session/agent secrets that none enter child argv, environment, globals, broker messages, or app-data headers.

10. **Major — Public declaration disclosure is not governed by an exhaustive projection.**

    `PublicFunctionManifest` is a typed allowlist, but `api.d.ts`, `code-mode.d.ts`, and operation-schema text are separate generated artifacts. Arbitrary declaration or schema text could later contain comments, paths, source fragments, defaults, or free-form diagnostics. Treating this as “the same disclosure class as `/inspect`” does not provide the field-level guarantee required by LLP 0031. The proposed source sentinel only searches for handler bodies and `sourceSpan`.

    **Resolution criteria:** Define a public declaration/schema grammar or typed generation source that excludes comments, paths, source maps, implementation text, and unsafe free-form fields. Add planted sentinels across both declarations and every operation schema, plus field-by-field comparison against the intended public schema. Enumerate any additional disclosure deliberately retained.

11. **Minor — Canonicalization, serialization, and output-cap behavior are ambiguous.**

    “Canonical JSON” does not identify an ordering and number-normalization algorithm. “JSON-serializable” would allow `JSON.stringify` to silently coerce or drop values such as `undefined`, non-finite numbers, negative zero, sparse arrays, dates, maps, and custom objects. A byte-level “truncation” cap could produce invalid JSON/JSONL, breaking the frozen machine-output contract.

    **Resolution criteria:** Pin one canonicalization algorithm and strict JSON value profile, preferably matching LLP 0010’s no-silent-coercion discipline. Define output caps to emit a complete typed overflow result or no stdout payload—never truncated invalid JSON—and test boundary sizes.

12. **Minor — Legacy `authRequirement` does not project as the effective value.**

    Server semantics treat an absent requirement as `optional-user`, but `PublicFunctionDefinition` serializes `Option<AuthRequirement>` directly (`src/manifest.rs:1737-1749, 1891-1920`). A legacy omission therefore appears as `null`, not one of the three strings that help claims to list verbatim.

    **Resolution criteria:** Define `null`/absent as `optional-user` during envelope normalization or compatibly emit the effective value. Add legacy-manifest help, introspection, and anonymous-preflight tests.

13. **Minor — The supported Node and operating-system floor is unstated.**

    The repository pins Node 24. Existing filesystem agent custody imports current Node facilities and refuses Windows because it cannot prove POSIX permission and locking semantics (`agent-authority-filesystem.mjs:884-900`). “Runs on Node” therefore overstates phase-one portability.

    **Resolution criteria:** Pin the Node major and supported OS matrix, or provide equivalent custody implementations on additional platforms. Unsupported combinations must fail with a structured diagnostic before reading credentials.

14. **Nit — Several factual attributions need correction.**

    The hosted gateway already serves a generated capability artifact at `/inspect` and `/capability`, so it lacks API-envelope/type routes rather than “all artifact routes.” LLP 0042 already specifies mutation tool entries with explicit authority, so mutations are not wholly future MCP scope. LLP 0012 requires stable deterministic ids, but the exact `{appId}:{exportedName}` spelling is owned by LLP 0004.

    **Resolution criteria:** Correct those three statements and add Ibex LLPs 0013, 0014, and 0022 to `Related`.

## 4. Suggestions (non-blocking improvements)

- Prefer immutable content-addressed envelope URLs, with a small no-store discovery document pointing to the current hash. This simplifies races, intermediary caching, rollback, and transcript reproducibility.

- Generate an optional `app-cli.lock.json` containing the expected app id, artifact identity, and target binding. It could make local-directory invocations safe and make agent runs reproducible without embedding a mutable server URL into codegen artifacts.

- Add a read-only `doctor` command that verifies target identity, envelope compatibility, current auth posture, credential-source selection, and function visibility without invoking app code.

- Consider moving call transcripts into phase one behind an opt-in flag. They would provide immediate debugging value and mechanically produce acceptance fixtures.

- For a future Ibex host, investigate the existing `Quarantine` principal plus an explicitly passed broker handle instead of ambient target authority. That fits Ibex LLP 0013’s passed-capability model and LLP 0022’s restricted-ingress direction.

- Add an `explain-auth <function>` command that reports only manifest facts, selected principal class, target posture, and the server diagnostic from an attempted call. It should never attempt to predict memberships or grant-rule outcomes.

## 5. Open questions

- Is hosted support genuinely required in phase one, or should it follow a separate hosted artifact-distribution amendment?

- Should discovery be target-scoped or app-scoped, especially when one origin or path can multiplex applications?

- Should public app discovery live at a root application route, `/.well-known/`, or an amended reserved-prefix class?

- What exact object does `await api.function()` return: application value, full call envelope, or a typed result union?

- How should a multi-call script expose per-call attribution and diagnostics without flooding stdout or losing audit facts?

- Must agent invocations always name a grant, or is credential-authenticated grant discovery desirable enough to design?

- When multiple authority sources exist, should the CLI require `--principal` unconditionally or only on ambiguity?

- Should long-running agent watches remint automatically, and what happens when grant expiry prevents renewal?

- Are the public argument/type declarations intended to reveal the entire data model, and what exact text classes are forbidden?

- Which Node versions and operating systems must session and agent custody support in phase one?

- Is server-selected engine semver needed at all once explicit protocol and feature negotiation exists?

- For a future Ibex host, should scripts reuse `Quarantine` with an attenuated broker capability or receive a new principal class?

## 6. Readiness verdict

The core concept is worth pursuing, but unresolved routing, authority, protocol, lifecycle, and disclosure decisions prevent a safe and coherent implementation contract.

Verdict: NOT READY
## Round 3 — 2026-07-17

**Revision under review:** `llp/0062-generated-app-cli-and-code-mode.rfc.md`, sha256 `c77ae9589c09000436453bf249cbde0a6691cc2aee4bf185eeffebce2e0d85a4` (untracked file at repo HEAD `dfd829e`; round-2 revision)
**Runtime detail:** codex exec, OpenAI Codex CLI v0.144.5, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, session id 019f6f7d-34b1-7142-8c48-950102ce511b; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

I verified that the untracked file’s SHA-256 is exactly `c77ae9589c09000436453bf249cbde0a6691cc2aee4bf185eeffebce2e0d85a4` and that repository HEAD is `dfd829e`. I reviewed the entire RFC, the listed Snapback and sibling-Ibex LLPs, and the relevant generated artifacts and implementation. I did not consult `llp/reviews/` or credential material.

The proposal is a good idea with strong architectural instincts: one generic engine over declarative per-app data, a thin projection of the existing app-data client, explicit separation from the operator plane, content-addressed artifacts, and a credential-owning broker are all sound directions. The Node-boundary discussion and the analysis of future Ibex packaging are notably honest.

The design is not ready to implement against, however. Several central claims are internally inconsistent or cannot currently be satisfied: artifact identity is not bound to the actual invocation generation, the primary dev workflow has no complete discovery protocol, authenticated authority can be selected implicitly despite the “explicit” claim, trusted-local admission does not yet exist, the credential acceptance test forbids the headers authentication requires, and code mode returns its supposedly hidden intermediate values through stderr. Core result, broker-error, resource-limit, envelope, and cache contracts are also deferred to implementation rather than specified here.

These are design defects, not requests for the implementation to exist already. The overall direction should be retained, but the RFC needs another substantive revision.

## 2. Strengths (with section citations)

- The data-not-code boundary is exactly right (§1, “Engine plus data, never program source”). The full generated function manifest contains handler source, HostPlan bodies, and source spans, while `PublicFunctionManifest` strips those fields. The existing `api.mjs` contains inert descriptors, `api.d.ts` has no callable signatures, and the operation schemas are declarative JSON Schema. Refusing to execute JavaScript supplied by a target is the correct security decision.

- The “one core, thin projections” positioning is coherent (§“Position among existing surfaces”; §§2–4). The CLI remains an app-data client rather than acquiring operator authority, consistent with LLPs 0019, 0024, and 0042. Rejecting admin tokens and leases on this surface is especially important.

- The authorization posture is mostly disciplined (§2, “Subcommand surface”; §4, “Auth”). The RFC correctly identifies only two client-decidable refusals: anonymous against `authenticated`, and a principal class absent from target capabilities. Grant scopes, memberships, sealed-projection rules, and other authorization remain server-decided. This matches `AuthRequirement`, the anonymous invocation gate, and LLPs 0055/0056.

- Content-addressing is the right distribution primitive (§1 and §5). Separating freshness through `/current` from integrity through an immutable hash-addressed envelope is conceptually clean, and a principal-independent public artifact avoids `Vary` and credential-dependent cache leakage.

- The code-mode boundary is unusually honest (§3, “Boundary honesty”). The RFC correctly refuses to portray a Node VM as hostile-code containment and narrows the broker claim to bearer non-transmission. Its account of Ibex LLPs 0013, 0014, 0022, 0028, and 0029 is accurate: the current Ibex direction is supply-chain containment, Quarantine is not an existing external-script ingress, and the single-file executable contract does not presently admit arbitrary scripts.

- Hosted distribution is deferred rather than hand-waved (§4 target matrix; §5; §6). That is consistent with LLP 0060’s future hosted-profile constraints and avoids claiming that the current Cloudflare proof supplies hosted authentication or envelope distribution.

- The guide and capability-index obligations are well integrated (§“Guide and capability-index obligations”). Requiring a GAP row, guide page, CI-run examples, and route-map additions follows LLP 0061’s intended workflow.

- The acceptance plan is broad and appropriately adversarial (§7). The forged-input, disclosure-sentinel, cross-client parity, auth-matrix, remint, reconnect, and host-portability tests are the right kinds of evidence once the contracts below are corrected.

## 3. Concerns

1. **Major — Artifact identity is not bound to the invocation generation.**

   **Evidence:** §1 verifies a target and envelope before calling, and §2 stamps `envelopeHash` into CLI output. But current app-data calls are routed by function name and carry no expected envelope, bundle, or deployment identity. A deployment can change after `/current` or `/inspect` and before dispatch—or during watch reconnect/remint—so arguments validated against an old schema can reach a newer same-named function while the CLI reports the old envelope hash. Content-addressing authenticates artifact bytes; it does not bind a later invocation to those bytes.

   **Resolution criteria:** Every call and subscription must carry an expected active deployment or envelope identity that the server checks atomically with function selection. Successful responses must contain the server-derived active identity rather than a client-only stamp. The RFC must define whether a subscription pins its generation or terminates/reloads on deployment change, name the mismatch diagnostic, and require race tests that deploy between discovery and dispatch/reconnect.

2. **Major — The v0-dev workflow has no complete discovery and binding protocol.**

   **Evidence:** §1 requires target-advertised app and artifact identity before app-data traffic. Section 5 says v0 dev receives no provisioned envelope, uses only local `generated/`, and returns a typed 404 from the envelope route. Yet `/current` is specified around a current envelope hash, and target capabilities are also supposed to come from discovery. The primary development path therefore cannot follow the specified protocol. Existing `PublicInspect` already exposes the public schema/function manifests and `CapabilityManifest`, so the substrate exists; the RFC simply does not select it.

   **Resolution criteria:** Specify the exact v0 sequence and required fields—likely `/inspect` for the active schema/function pair and capabilities, plus `/auth/session` for current posture. Define comparison against local `inputsHash`, `bundleHash`, schema identity, and app ID; define unprovisioned and schema-only behavior; and add tests for a stale local directory and a dev server with no envelope.

3. **Major — “Explicit” principal selection still silently promotes ambient authority.**

   **Evidence:** §4 says the engine “never guesses,” selection is explicit, and there is “no automatic promotion from anonymous.” The next sentence automatically selects an authenticated source when exactly one is available. That source may be a persisted human session or an environment-supplied agent credential, changing an `optional-user` call from anonymous behavior to authenticated behavior without any command-line indication. “Available” and the treatment of malformed or stale sources are also undefined.

   **Resolution criteria:** Default to anonymous unless `--principal` is supplied. If convenience auto-selection is retained, make it an explicit `--principal auto` mode and specify the complete source inventory, precedence, invalid-never-fallback behavior, and ambiguity rules. Help and introspection should report the selected principal source without exposing secrets.

4. **Major — Long-lived agent credential custody and bootstrap are underspecified.**

   **Evidence:** §4 accepts `sbac_` from the environment or an explicit credential/profile file but defines no file schema, target/app binding, precedence, ownership/mode/symlink checks, redirect policy, or wrong-target behavior. Existing `agent-authority-filesystem.mjs` intentionally persists only the non-secret durable authority tuple and rejects bearer/token fields, so its 0600 claim does not secure the new long-lived credential file. The token-mint response supplies credential, grant, generation, and token coordinates but not the `actorUserId` required by `AgentAuthorityFence`; the RFC never defines the server-proven handshake that fills and validates that field. A secret-bearing mint request also must not follow redirects to another origin.

   **Resolution criteria:** Define a closed profile bound to normalized target origin, app ID, grant ID, and credential identity; hardened secret-file admission and deterministic source selection; invalid-never-fallback behavior; and no redirects on secret-bearing requests. Specify the mint → server-derived actor/authority descriptor → fence initialization/remint sequence and test crossed target/app/grant/actor tuples.

5. **Major — “Trusted-local” is treated as an existing capability when it is still an unmet prerequisite.**

   **Evidence:** The §4 matrix attributes trusted-local classification to LLP 0060. LLP 0055 instead records trusted-local admission as a landing prerequisite that must eventually bind to a target-authored deployment capability. LLP 0060 currently defines local versus hosted posture and hosted-auth capability facts; it does not define a trusted-local positive class. `src/auth/deployment.rs` likewise has only `AuthDeploymentTarget::{Local, Hosted}`. The existing loopback fence explicitly cannot distinguish a publicly reverse-proxied local process.

   **Resolution criteria:** Either define and implement the exact target-authored trusted-local capability and server-side service-principal admission gate in the governing LLPs, including withdrawal and reverse-proxy tests, or remove trusted-local from phase 1 and describe the remaining local posture without claiming that reverse-proxied instances are distinguishable.

6. **Major — The credential non-transmission acceptance criterion is impossible.**

   **Evidence:** §7 requires planted session and agent secrets to appear in no app-data request header. Authenticated app-data necessarily carries either a session bearer or scoped `sbagt_` token in `Authorization`; the headless client already does this, as LLP 0055 requires.

   **Resolution criteria:** State the invariant by credential class and channel:

   - No bearer enters child argv, environment, globals, IPC, console, or result output.
   - Admin tokens and long-lived `sbac_` credentials never enter app-data headers.
   - Anonymous/dev requests carry no bearer.
   - Session and agent app-data requests carry exactly the selected session or `sbagt_` bearer, inserted only by the parent.
   - `sbac_` appears only in the non-redirecting token-mint body.

   Acceptance must test those distinctions rather than asserting universal header absence.

7. **Major — Live-query attribution cannot currently meet the promised parity.**

   **Evidence:** §2 and §7 require server-derived attribution parity for every function kind and principal class. Finite query, mutation, and action paths attach attribution, but the current live-subscribe wire serializes `LiveSubscribeOutput`, which has no attribution field. LLP 0055 forbids wrappers from synthesizing attribution. The RFC explicitly identifies the non-2xx finite-client seam but does not identify this live-wire change.

   **Resolution criteria:** Extend live establishment and post-resolution error contracts with server-derived attribution. Define whether attribution is immutable subscription metadata or repeated with snapshots, how it behaves across scoped-token remint/resubscribe, and how pre-resolution versus post-resolution failures differ. Add HTTP/headless/CLI parity tests for those cases.

8. **Major — Code mode returns the intermediate values it claims to keep out of context.**

   **Evidence:** The Motivation says a 500-row intermediate stays in-process and only the final answer returns. Section 3 says every broker call’s full result document is emitted to stderr, while §2 defines that document to contain the application value. Ordinary agent tool execution captures stderr as well as stdout, so the 500 rows still enter context and logs. `console` also shares the supposedly structured stderr channel without a framing rule.

   **Resolution criteria:** Default audit events must omit `value`, retaining bounded metadata such as function/stable call ID, envelope identity, attribution, diagnostics, facts, value byte count, and digest. Full values should require an explicit transcript file or separate descriptor. Every non-TTY event, including console output, must have versioned framing and aggregate limits. Acceptance must prove a large intermediate appears in neither stdout nor stderr.

9. **Major — Result and broker failure contracts are promised but not specified.**

   **Evidence:** The RFC uses “working” artifact kinds, postpones the per-kind result mapping table and exact JSON Schemas to phase 1, and calls the broker schema a future deliverable. It specifies that a successful `api.foo()` resolves to the application value but not what auth, grant, role, function, transport, validation, or subscription failures become inside the script. It also does not decide whether a caught refusal permits exit 0 or whether an uncaught broker rejection exits according to the server category or generic script exit 10. The existing client’s ad hoc enriched `Error` objects cannot implicitly become a closed IPC contract.

   **Resolution criteria:** Before readiness, include or normatively reference versioned schemas for discovery, call results, broker requests, broker success/error responses, and stderr events; include the complete per-kind mapping table; define the script-visible error type and safe fields; and specify caught/uncaught behavior and deterministic exit precedence. Tests must cover caught and uncaught failures of every exit class.

10. **Major — The execution and resource-limit contract is incomplete.**

    **Evidence:** §3 calls resource ceilings frozen but supplies no finite defaults, maximum overrides, disabling rules, or accounting semantics. Plain `run script.ts` can therefore be read as unbounded. Heap, IPC message size, cumulative audit/console bytes, open subscriptions, and concurrent broker calls are uncovered. The Node evaluator is also unspecified: on the repository’s Node 24.14 runtime, `vm.SourceTextModule` is unavailable without `--experimental-vm-modules`, while the natural TypeScript stripping path is experimental and may emit warnings into stderr. The RFC says Node 24 “or newer,” whereas the repository pins `24.x`.

    **Resolution criteria:** Pin finite defaults and maximum override policy; define how retries, remints, reconnects, and subscriptions consume budgets; bound heap, IPC, open subscriptions, and aggregate outputs; and specify termination/flush behavior. Select the concrete module evaluator and TypeScript transform, required flags, warning/framing behavior, source-map behavior, and exact supported Node range.

11. **Major — Envelope identity, caching, and evolution are not precise enough for the claimed guarantees.**

    **Evidence:** Section 5 does not define the hash preimage or canonical envelope encoding, whether hashing covers compressed or uncompressed bytes, or how exact generated bytes survive deserialization and reserialization through the closed provision DTO. It names a blob cache key but not the last-known-good pointer needed for offline help/introspection, total disk limits, eviction, or atomic concurrent writers. It also says the DTOs reject unknown fields without scoping that rule. Recursive rejection would contradict LLP 0012’s v0 rule that additive nested-manifest fields are non-breaking and must be ignored by conforming adapters.

    **Resolution criteria:** Pin canonical envelope bytes and the SHA-256 domain; define opaque-byte or canonical provisioning, atomic storage/activation with the schema/function pair, cache headers and missing-hash diagnostic, last-known-good indexing, global/per-origin limits, eviction, restart, and concurrent-writer semantics. Restrict unknown-field rejection to envelope-owned wrapper layers or independently version the nested public projection through LLP 0012. Schema ingestion should also forbid network `$ref` resolution and pin the supported dialect/subset.

12. **Major — The proposed route class conflicts with LLP 0031’s governing proxy invariant.**

    **Evidence:** LLP 0031 defines root routes as app-data and everything under `/_snapback/*` as system surface, enabling a proxy to expose app-data while refusing the reserved prefix. `src/server.rs` enforces the corresponding `AppData`, `SystemStatic`, and `SystemApi` classes, with system-static limited to build-owned assets. Section 5 places public, deploy-varying app artifacts under that prefix and describes only a new route class, while route spelling remains an open question.

    **Resolution criteria:** Either make a dated LLP 0031 amendment normative and specify the new class’s proxy, carrier, method, cache, sensitivity, and authorization rules, or choose an app-plane namespace such as `/.well-known/snapback-app-api/` now. The selected phase-1 route should not knowingly require a different hosted path later.

13. **Minor — Scoped-token renewal and credential rotation are conflated.**

    **Evidence:** §2 discusses ordinary scoped-token remint and then says LLP 0055 rotation terminates the old family’s carriers. Token replacement preserves the durable authority tuple and retires an exact carrier; credential rotation changes the credential generation and terminates the old family.

    **Resolution criteria:** Use separate terms and specify reconnect tests for both ordinary token renewal and credential-family rotation.

## 4. Suggestions (non-blocking improvements)

- Consider a small Merkle-style envelope index whose members are individually content-addressed. Unchanged operation schemas and declarations could be reused across deployments, reducing cache churn without changing the logical atomic envelope identity.

- Generate `code-mode.d.ts` from the structured envelope in the trusted engine rather than serving declaration text, and provide an explicit `types` or `init` command that materializes it for editors. Also state plainly that `run` strips types but does not typecheck.

- Construct the injected API from frozen, null-prototype objects and test valid-but-hazardous function names such as `__proto__`, `constructor`, and `then`. In particular, an own `then` property can trigger promise/await thenable assimilation.

- Inject a concrete cancellation `signal` tied to timeout or parent termination, rather than only the `AbortSignal` constructor.

- Add `run -` for scripts supplied on stdin. It provides a compact agent workflow without introducing shell-quoted `-e` semantics.

- Return an HTTP `ETag` or `Content-Digest` equal to the envelope identity and include the server-derived active deployment identity in successful call/subscription facts.

- For capture-only development login, print the challenge ID and separate operator-plane retrieval instructions. The app CLI should never imply that it reads the operator-authorized mailbox itself.

## 5. Open questions

- Is each finite invocation pinned to the discovered deployment, or should the CLI automatically rediscover and retry after a generation mismatch? What is the corresponding rule for long-lived subscriptions?

- Should authenticated authority ever be selected without an explicit `--principal`, particularly when it comes from environment variables or persistent custody?

- What exact machine fact distinguishes trusted-local from an ordinary local process behind a public reverse proxy, and which component owns its attestation and withdrawal?

- Is `/_snapback/app-api` intentionally a third route-plane class, or should app artifacts live under a root or `/.well-known` app-data namespace from the outset?

- What are the final versioned schemas and evolution rules for discovery, envelopes, call results, broker failures, and audit events?

- Should code-mode audit values ever enter the invoking agent’s normal output channel, or only an explicit transcript sink?

- Which Node evaluator and TypeScript transformer are normative, and is typechecking an engine command, an editor-only workflow, or both?

- Should an app be able to restrict the publicly advertised function/type surface? If so, how is the same restriction applied consistently to `/inspect`, envelopes, and future MCP projection?

## 6. Readiness verdict

The architectural direction is worth pursuing, but the unresolved identity, authority, credential, output, wire-contract, and route-taxonomy issues are material. The RFC should remain Draft until the major concerns above have normative resolutions.

Verdict: NOT READY
## Round 4 — 2026-07-17

**Revision under review:** `llp/0062-generated-app-cli-and-code-mode.rfc.md`, sha256 `63d7439ed289d2383528792dcfc0332d513db1df1ee2d2deaa8b94c95f9bf0a2` (untracked file at repo HEAD `dfd829e`; round-3 revision)
**Runtime detail:** codex exec, OpenAI Codex CLI v0.144.5, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, session id 019f6f90-a344-73d0-a124-c4203fbac623; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

I verified that the file’s SHA-256 is exactly `63d7439ed289d2383528792dcfc0332d513db1df1ee2d2deaa8b94c95f9bf0a2` at repository HEAD `dfd829e`.

I read the entire RFC and checked its claims against the requested Snapback and sibling-Ibex LLPs, generated Todo artifacts, manifest/auth/server implementations, headless client, agent-custody source, Cloudflare gateway, and guide capability index. I did not consult `llp/reviews/` or any credential, token, custody-data, or secret files.

The proposal’s central idea is good: a generic, non-app-specific engine consuming source-free generated data is a strong way to give agents an ergonomic application CLI without creating a generated-code execution channel. The explicit authority selection, honest Node boundary, content-addressed artifact direction, structured diagnostics, and unusually concrete acceptance plan are all solid.

The RFC is not ready, however. It currently conflicts with the existing app-data MCP/result contract, cannot provide its universal generation-binding guarantee on the dev tuple, and contains several incorrect or incomplete delegated-agent lifecycle contracts. Its HTTP digest contract is invalid as written, and code mode still has unresolved safety and lifecycle semantics. These are design defects, not missing implementation.

## 2. Strengths (with section citations)

- The “engine plus data, never program source” boundary is the right architecture (§1, §5 “Disclosure posture”). The generated manifest really does contain executable handler source, while `PublicFunctionManifest` is an exhaustive typed projection that removes source and source spans. The operations schemas and inert generated API descriptors contain enough information to synthesize the CLI without executing `api.mjs`.

- The RFC correctly separates app-data authority from operator authority (§“Position among existing surfaces”, §4). Anonymous-by-default is particularly good: it matches the invocation gate’s actual behavior for `public`, `optional-user`, and `authenticated` functions and avoids ambient promotion from stored sessions or environment credentials.

- The dev/session distinction is accurate (§4 “Target matrix”). `DevImpersonation` is genuinely dev-only and is rejected in sessions mode. The RFC also correctly refuses to invent “trusted local” from URL or loopback heuristics when the deployment model currently exposes only Local and Hosted classes.

- Server-side generation binding is the correct goal (§1 “Binding holds at call time”). Atomic manifest/envelope activation and a server rejection when discovery races deployment would eliminate a real client-side validation race. The sessions-tuple design is directionally strong even though the dev tuple is unresolved.

- The code-mode boundary is refreshingly honest (§3 “Boundary honesty”). The parent/child broker is described as a credential non-transmission property, not as containment for hostile JavaScript. That is consistent with Ibex LLP 0013’s supply-chain framing and avoids pretending that a Node VM is a security sandbox.

- The RFC identifies real client seams rather than hand-waving them away (§2, §4, §7). The current headless client does ambiently consult `SNAPBACK_ADMIN_TOKEN`, and its non-2xx path preserves the diagnostic and receipt but drops the server’s attribution sibling. Both are correctly named as work that must be fixed.

- The machine contracts are unusually concrete (§2, §3, §6, §7): closed DTOs, distinct artifact versions, output framing, stable exit classes, strict JSON, live-query deduplication, bounds, disclosure sentinels, and forged-input tests. These make the proposal substantially more implementable than a conventional CLI RFC.

- Deferring hosted distribution and embedded-Ibex packaging is prudent (§6, §“Future work”). A Node-first implementation can validate the application surface and broker ABI before committing to a stronger executable host.

## 3. Concerns

1. **Major — the RFC conflicts with the existing app-data MCP and result-envelope contract.**

   **Evidence:** RFC §“Position among existing surfaces” characterizes LLP 0024 as an operator plane and says CLI and MCP share artifacts and authority, “not an engine.” RFC §2 then introduces `appCliCallResult`, while §3 defers MCP reconciliation.

   LLP 0019 §F1 instead requires one core and one result schema across CLI, HTTP, and MCP, explicitly including generated app data. LLP 0024 §“Generated App-Data MCP Catalog” already owns an app-data catalog and requires its calls to use the LLP 0024 result envelope. LLP 0024 is therefore not solely an operator surface.

   **Resolution criteria:** Make a dated LLP 0024 amendment or supersession an explicit phase-one prerequisite. Either:

   - define a shared app-data invocation/broker/result core projected by both the CLI and generated MCP catalog; or
   - explicitly replace LLP 0024’s app-data catalog/result contract, with shared schemas and drift/parity gates proving the two surfaces cannot diverge.

   “Future reconciliation” is insufficient while both documents make conflicting normative claims.

2. **Major — universal call-time envelope binding cannot work for dev targets or phase 1(a) as specified.**

   **Evidence:** RFC §1 says every call and subscription carries the expected envelope identity and that the server compares it atomically with its active generation. RFC §5 says the dev tuple neither serves nor ingests an envelope, and the legacy ensure form is not extended. RFC §6 then promises callable dev subcommands with no server changes.

   Current query, mutation, action, and subscription requests carry no expected envelope field. More fundamentally, `/inspect` can attest the active manifest/build identities but not the exact local operations schemas, declarations, or `code-mode.d.ts`. The current `artifacts.json` does not bind those output bytes to a server-known envelope identity, and LLP 0012’s `inputsHash` is a staleness input, not proof of exact generated output.

   **Resolution criteria:** Define the expected identity and server evidence separately for each tuple, then do one of the following:

   - ingest and atomically activate the dev envelope hash or an equivalent full-artifact identity;
   - extend dev provisioning so the server can verify the local envelope without serving it; or
   - explicitly weaken the dev guarantee and keep phase 1(a) network calls disabled until binding support lands.

   Acceptance must forge mismatches on both dev and sessions tuples.

3. **Major — the long-lived agent credential carrier contradicts LLP 0055 and the current routes.**

   **Evidence:** RFC §4 says `sbac_` is used only against token mint; §7 requires it to appear only in that request. LLP 0055 §“Credentials and tokens” permits the credential on pair, token mint, rotation, grant-request, and revoke-self lifecycle routes. The current `AgentPairRequest` requires the credential and the pair handler validates it in [server.rs](/Users/ccheever/projects/snapback/src/server.rs:7200).

   **Resolution criteria:** Either correct §§4 and 7 to permit `sbac_` only on an explicit closed list of non-redirecting, secret-classified lifecycle endpoints—including at least pair and mint and any supported rotation/revoke operations—or amend LLP 0055 and the protocol implementation to use a different pairing carrier. Add planted-secret tests for every permitted route and reject it everywhere else.

4. **Major — the proposed `AgentAuthorityFence` bootstrap cannot be implemented from the specified DTOs.**

   **Evidence:** RFC §4 says the token-mint response’s server-derived authority descriptor initializes the fence. The current mint response contains token, grant, credential, generation, and expiry facts, but no authority descriptor or `actorUserId` ([server.rs](/Users/ccheever/projects/snapback/src/server.rs:7272)). `AgentAuthorityFence` requires the actor plus credential, grant, token, and bearer tuple ([agent-authority.mjs](/Users/ccheever/projects/snapback/demos/_kit/agent-authority.mjs:63)). The opaque descriptor comes from `/auth/session`, not token mint; moreover, delegated authority’s effective `userId` is not necessarily its actor. The proposed persisted profile omits the actor identity needed after restart.

   **Resolution criteria:** Pin an exact bootstrap and restart sequence. It must either:

   - persist the server-derived durable actor/credential/grant tuple, mint a token, perform the authority handshake, and call the fence’s validated synchronization path; or
   - extend a named closed response DTO with all required server-derived facts.

   Tests must cover delegated authority, forged actor/effective-user substitution, and restart using only the admitted profile state.

5. **Major — credential rotation cannot use the claimed make-before-break subscription rule.**

   **Evidence:** RFC §2 defines scoped-token remint as make-before-break and then says credential-family rotation uses the “same resubscribe rule.” LLP 0055 §“Credentials and tokens” makes rotation revocation-strength: older generations fail immediately, their live connections are dropped, and queued work can be stranded. The server terminalizes invalidated tokens, while the client fence quiesces and blanks old authority before accepting a successor.

   **Resolution criteria:** Reserve make-before-break for same-grant scoped-token remint. Define rotation as a terminal authority cut followed by mint, reconnect, resubscribe, and full resynchronization, acknowledging the possible observation gap and applying JCS deduplication only after the new snapshot. Alternatively, amend LLP 0055 with a fully specified staged-successor protocol.

6. **Major — `pair` is not complete first-contact onboarding.**

   **Evidence:** RFC §4 says it adds no principals, calls `pair` an agent’s first contact, and provides no registration/import command. LLP 0055 §“Registration” creates the agent and its credential separately; pairing already requires that credential. The RFC’s credential-profile DTO explains storage but not how a conforming profile first comes into existence.

   **Resolution criteria:** Either add and specify registration or secure credential-import/profile-creation as part of phase one, or narrow `pair` to “grant onboarding for an already registered, credentialed agent” and explicitly state the provisioning precondition, starting state, and end-to-end acceptance fixture.

7. **Major — the HTTP integrity headers are invalid and ambiguous as written.**

   **Evidence:** RFC §5 says the uncompressed JCS SHA-256 is emitted as an equal `ETag` and `Content-Digest`, while transport compression is orthogonal. `Content-Digest` is a Structured Fields dictionary whose digest covers actual HTTP message content and is affected by content encoding; it is not a raw hexadecimal identity field. Strong ETags are quoted opaque validators and must correctly distinguish selected encoded representations. See [RFC 9530](https://www.rfc-editor.org/info/rfc9530/) and [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html).

   **Resolution criteria:** Pin exact wire bytes and choose one coherent model:

   - prohibit content encoding for the envelope, emit `Content-Digest: sha-256=:<base64>:` over the canonical body, and emit a correctly quoted ETag; or
   - retain compression, keep the canonical envelope identity in the path or a dedicated typed header, and emit encoding-correct `Content-Digest` and ETag values for each transmitted representation.

   Acceptance must cover identity and compressed responses, conditional requests, and recomputation from received bytes.

8. **Major — the supposedly value-free audit lane leaks application values.**

   **Evidence:** RFC §3 emits the value’s byte count and digest by default. No key, salt, domain separation, or preimage is specified. A stable unkeyed digest makes booleans, small enums, short identifiers, common status objects, and other low-entropy values dictionary-recoverable. It also leaks equality across calls and runs. Exact byte counts add another side channel.

   This is especially problematic because code mode is intended to keep intermediate results out of captured agent context.

   **Resolution criteria:** Omit the digest by default and either omit or coarsely bucket the size. If within-run equality evidence is necessary, use a domain-separated commitment keyed by a fresh parent-only per-run secret and specify its exact canonical preimage. Add low-entropy planted-value tests proving captured stderr cannot recover or correlate intermediate results beyond the explicitly accepted leakage.

9. **Major — code-mode completion and resource semantics are internally inconsistent.**

   **Evidence:** RFC §3 says exceeding the aggregate stderr ceiling causes typed elision and continued framing, but later says that exceeding any ceiling kills the child and exits 11. It also does not define normal teardown after the awaited default export resolves while timers, pending broker calls, or subscriptions remain. “First terminal condition wins” does not determine ordering for simultaneous timeout, broker rejection, serialization failure, and child exit. Finally, the list described as finite resource ceilings lacks a heap/RSS limit, so an accidental allocation can kill the host before the wall-clock timeout.

   **Resolution criteria:** Pin a parent-owned lifecycle state machine covering evaluation, default-export settlement, result serialization, cancellation, iterator disposal, stderr flushing, and child termination. Decide whether stderr overflow is terminal or eliding—not both. Define deterministic ordering for racing terminal events and add a finite child-memory ceiling. Test orphan intervals, unresolved calls, abandoned subscriptions, console flooding, OOM, and terminal-condition races.

10. **Minor — `/app-api/current` has the wrong route-sensitivity classification.**

    **Evidence:** RFC §5 assigns the new routes `PublicProjection`, then requires discovery to be `no-store`. LLP 0031 §“Independent policy axes” defines `PublicNoStore` precisely for a fixed typed public response that must neither be cached nor body-logged. Misclassification would prevent the centralized registry from enforcing the freshness property.

    **Resolution criteria:** Register `/app-api/current` separately as `PublicNoStore`; keep the immutable content-addressed envelope as `PublicProjection`. Add registry/router parity and cache-header tests for both.

11. **Minor — function selector and generated-property resolution are underspecified.**

    **Evidence:** The underlying artifacts distinguish stable `id`, route `name`, and optional `exportedName`. Current validation does not make exported names the sole unique identity, and the headless client ultimately dispatches using the function reference’s route name. RFC §2 merely defines `call <function>`, while §3 exposes exported names as object properties and lists only examples of hazardous names. LLP 0024 already uses the safer rule of canonical ID/reference, with human names accepted only when unique.

    **Resolution criteria:** Pin accepted selector forms and precedence, use the stable function ID internally and in results, define any `exportedName`/`name` fallback, and specify errors for ambiguity, absence, invalid identifiers, and every engine-reserved property.

12. **Major — credential references and pairing-code ingestion lack a safe carrier contract.**

    **Evidence:** RFC §4 admits a 0600 non-symlink profile whose credential may be “inline or by reference,” but it does not constrain reference kinds or require the referenced object itself to pass secure-open, ownership, mode, and non-symlink checks. It also does not say how the authority-creating `sbpc_` pairing code enters `pair`; a literal argv flag would expose it through shell history and process listings.

    **Resolution criteria:** Define a closed reference grammar and apply secure admission to every referenced credential target. Require pairing codes through a hidden prompt, secret fd/stdin protocol, or securely admitted file—not literal argv. Add planted-secret coverage across argv, environment, logs, diagnostics, audit output, and caches.

13. **Minor — several deployment/toolchain claims need narrower wording and corpus reconciliation.**

    **Evidence:**

    - RFC §§4–5 say LLP 0060 categorically fixes hosted `/_snapback/*` to 404. LLP 0060 §C2 pins that behavior for its first hosted-auth profile, not every possible hosted proof. The current Cloudflare gateway is dev-oriented and can route unknown paths into SPA asset fallback.
    - RFC §6 says “exactly the repo-pinned Node major (24.x),” while `.node-version` pins an exact `24.18.0` runtime and LLP 0010 distinguishes exact tested authority from package compatibility ranges.
    - Ibex LLP 0028 currently cites RFC 0062 as requiring embedded Ibex and potentially computed dynamic import, while this RFC makes embedded Ibex non-normative future work and refuses imports in v1.

    **Resolution criteria:** State that hosted is excluded because no hosted target currently ingests, identifies, or serves envelopes; require `/app-api` routing to precede asset fallback when hosted support lands. Separate the exact tested Node version from the supported package range. Amend Ibex LLP 0028 or state explicitly that RFC 0062 creates no phase-one embedded-Ibex or computed-import requirement.

## 4. Suggestions (non-blocking improvements)

- Add a checkout lock file recording target origin, app ID, envelope identity, and engine version, plus a `--frozen` mode. This would make CI and agent runs reproducible without making the server supply executable installation instructions.

- Consider putting engine metadata outside the generated function-property namespace—for example, a separate frozen `snapback` global—rather than reserving names such as `api.$envelopeHash` indefinitely.

- Reserve a versioned tagged-value extension point for future exact 64-bit integers, decimals, and binary values. LLP 0004 already anticipates these; strict JSON is reasonable for v1, but the frozen result contract should not block later negotiation.

- Add an early `doctor` command that checks engine compatibility, target tuple, local/served artifact identity, custody permissions, authority-fence bootstrap, and route availability. The proposal combines enough independent seams that a single diagnostic entry point would materially improve operability.

- Consider a profile-local token broker in later phases. LLP 0055 caps live tokens per grant at ten; many concurrent process-per-command watches could otherwise evict one another’s tokens.

- Give code mode an opt-in reproducible transcript format containing broker facts, canonical inputs, identities, diagnostics, and keyed result commitments, while keeping application values separate and explicitly encrypted or user-authorized.

## 5. Open questions

1. Which document and component owns the common app-data invocation/result contract: LLP 0024’s existing surface, RFC 0062’s broker, or a new shared lower-level contract?

2. What exact identity can a dev server attest that covers the local operations schemas and declarations, not merely its active function manifest?

3. Is phase-one agent onboarding expected to start from an existing `sbac_`, an invitation, an imported profile, or no agent state at all?

4. What exact server response or handshake provides the fence’s actor identity and durable authority tuple, especially for delegated effective users?

5. Is a credential rotation observation gap acceptable for live queries, and what guarantees—latest snapshot only, or replay—exist after resynchronization?

6. What information must default audit output reveal? Is call occurrence plus attribution sufficient, or is within-run value-equality evidence a real requirement?

7. What ends a successful code-mode run: settlement of the default export, exhaustion of all handles, or an explicit parent teardown immediately after result serialization?

8. Should operations schemas and model declarations always be anonymously public, or must phase one resolve the advertised-surface restriction currently left open?

9. How should remint scheduling tolerate server/client clock skew, and what should users expect when multiple CLI processes exceed the per-grant token-family cap?

## 6. Readiness verdict

The proposal is promising and worth pursuing, but its current revision leaves material correctness, protocol-coherence, feasibility, and secret-handling questions unresolved.

Verdict: NOT READY
## Round 5 — 2026-07-17

**Revision under review:** `llp/0062-generated-app-cli-and-code-mode.rfc.md`, sha256 `23db6c170c840bf0edf92a39985f986a5f622d1ab6ba2efbc3ada2e19db40646` (untracked file at repo HEAD `d4fcfaf` at review start; round-4 revision)
**Runtime detail:** codex exec, OpenAI Codex CLI v0.144.5, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, session id 019f6fd4-2821-7081-9078-cc0d82769d04; fresh session — no access to the orchestrating Claude session or the concurrent Claude-family round. Orchestrator notes: (1) a first attempt at this round (a separate fresh session) was terminated before producing any review output; it is not counted and no artifact exists for it. (2) The review body below includes the reviewer's own disclosure that one broad grep inadvertently surfaced two isolated lines from llp/reviews/ during evidence collection, discarded immediately; preserved verbatim as received.
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

I verified the revision: `shasum -a 256` returned exactly `23db6c170c840bf0edf92a39985f986a5f622d1ab6ba2efbc3ada2e19db40646`. The RFC is new and untracked. The shared checkout had advanced to `1ef45bbca512eaab68fe4d749977c35b9b55b74d`; because the requested baseline was `d4fcfaf`, I inspected tracked Snapback evidence at that revision with `git show`. `d4fcfaf` is an ancestor of the current checkout.

I read the complete RFC, all requested Snapback and sibling-Ibex LLPs, the generated Todo artifacts, and the named implementation surfaces. No credential values, secret material, or runtime custody/token files were read.

Independence note: no prior review was used. During evidence collection, one broad grep inadvertently surfaced isolated matching lines from two files under `llp/reviews/`; they were discarded immediately. Every finding below was independently established from the RFC, permitted LLPs, or code at `d4fcfaf`.

The proposal’s central idea is excellent: one generic engine consuming bounded, source-stripped app data is a better architecture than generated executable CLIs, and brokered code mode is a compelling agent interface. The RFC is unusually candid about authority, platform limits, hosted scope, and Node not being a sandbox.

The plan is not yet ready, however. Seven major issues remain: the pairing workflow lacks a required wire input; gapless token renewal conflicts with the current token cap and authority fence; write timeouts have undefined effect outcomes; redirects can forward body-carried credentials; the hard child-memory guarantee has no portable enforcement contract; the code-mode termination order is internally inconsistent; and the “value-free” audit lane can carry application data through diagnostics and facts.

## 2. Strengths (with section citations)

- **§1, “Engine plus data, never program source.”** This is the right trust boundary. The checked Todo artifacts support the proposed derivation model: stable `{appId}:{exportedName}` IDs, function kinds, auth requirements, read/write summaries, separate operation schemas, inert `api.mjs` descriptors, and a non-callable `FunctionReference` in `api.d.ts`. Refusing to execute server-supplied `api.mjs` is both simpler and materially safer.

- **§1 and §5, artifact identity and distribution.** Separating no-store discovery from immutable content-addressed envelopes is sound. The sessions-only call-time generation check closes a real race that the present name-based app-data routes cannot close. The RFC also correctly names the weaker dev guarantee rather than claiming impossible parity.

- **“Position among existing surfaces” and §2.** The app-data/operator-plane separation is correct and important. The existing full headless client can implicitly read `SNAPBACK_ADMIN_TOKEN`; specifying a reduced app-data-only façade avoids accidentally importing operator authority. Requiring reconciliation with LLP 0024’s result envelope and generated MCP catalog is preferable to creating another wrapper-specific result semantics.

- **§3, “Boundary honesty.”** The brokered parent/child split is useful even without claiming containment: it prevents accidental bearer transmission while explicitly acknowledging that Node `vm` is not a hostile-code sandbox. This agrees with Ibex LLPs 0013/0014, whose compartment boundary is supply-chain integrity rather than arbitrary hostile-code confinement.

- **§4, auth projection.** The default-anonymous posture, explicit principal selection, ambiguity refusal, and invalid-never-fallback rule are strong. The stated anonymous behavior matches `src/auth/invocation.rs`: only `authenticated` functions categorically reject anonymous callers. The dev-asserted lane also matches `DevImpersonation`, while the sessions server remains authoritative.

- **§5, public disclosure.** Reusing `PublicFunctionManifest` is well grounded. `src/manifest.rs` exhaustively strips handler source, HostPlan bodies, and source spans, and `/inspect` already exposes the source-stripped inventory. Treating operation schemas and declarations as new, deliberate disclosures—and requiring typed projections and planted sentinels—is appropriately cautious.

- **§6 and §7, phasing and acceptance.** Keeping hosted distribution and standalone Ibex packaging outside phase 1 avoids pretending dependencies already exist. The acceptance plan is exceptionally strong: tuple refusal, generation races, source-disclosure sentinels, auth matrices, host-portable code-mode fixtures, and output-channel leakage tests are the right kinds of proof. Naming the guide page and capability-index row as landing obligations is also appropriate for a Draft RFC.

## 3. Concerns

1. **The specified `pair` command cannot call the current pairing API. Severity: major.**

   **Evidence:** Section 4 says the agent is given a user-created pairing code, submits that code with requested scopes, polls, and persists the grant. At `d4fcfaf`, `AgentPairRequest` in `src/server.rs` requires both `pairingRequestId` and `pairingCode`; the user-facing pairing-code response returns those as separate fields. `sbpc_` is a random bearer spelling and does not encode the request ID. Supplying only the code therefore leaves the CLI unable to construct the closed request DTO.

   **Resolution criterion:** Specify a secure handoff containing both values—for example, a non-secret request-ID argument plus a separately admitted secret code, or a closed composite document accepted through prompt/stdin/secure file. Alternatively, amend LLP 0055 and the server protocol to support code-only lookup without weakening attempt limits or disclosure resistance. Add end-to-end acceptance showing that both fields survive handoff while the code never reaches argv, logs, environment, or audit output.

2. **Gapless token renewal conflicts with the current token cap and `AgentAuthorityFence`. Severity: major.**

   **Evidence:** Section 2 promises make-before-break remint and resubscription “with no gap.” LLP 0055 caps live tokens at ten; minting the eleventh revokes the oldest and closes its exact connections. In the current client, `AgentAuthorityFence.replaceCredentialValidated()` begins an authority barrier, and the registered transport participant aborts controllers and closes live streams before reopening under the successor carrier. Thus server-side token coexistence does not produce overlapping subscriptions through the current single-carrier fence. At the cap, minting the successor may itself evict the watch token before an overlap can be established. An unplanned sibling-invocation eviction necessarily already created a cut.

   **Resolution criterion:** Either specify and implement a real dual-carrier handoff—such as two independently fenced clients plus an atomic publication switch, with a reserved replacement slot or server-side predecessor replacement—or weaken the contract to bounded cut/resync with a possible observation gap. Distinguish scheduled renewal from unplanned cap eviction, and make the acceptance tests verify the chosen observable semantics rather than merely eventual reconnection.

3. **Mutation and action timeouts have undefined effect outcomes. Severity: major.**

   **Evidence:** Section 2 maps network failure and timeout to exits 6 and 9 for all calls; §3 exposes the same classes as catchable broker errors. Neither says whether a mutation or action was never dispatched, committed, is still running, or completed after cancellation. Current mutations support `clientMutationId`, but it is optional; receipts cannot recover a response lost after commit. Actions have no equivalent identity. Code-mode teardown cancels only the local broker request, not a server effect already underway. Current duplicate settlement is also reached after function preparation, so a deploy that removes or changes the function can obstruct replay-based recovery after the original commit.

   **Resolution criterion:** Pin outcome certainty by function kind. Mutations should receive a durable pre-dispatch identity that survives process exit and supports same-ID settlement recovery independently of current-generation dispatch. Actions need either durable idempotent settlement/status or an explicit machine-readable `outcome: "unknown"` with a request/trace identity and a prohibition on automatic retry. Test failure before dispatch, response loss after commit, timeout while an effect remains in flight, output failure after commit, and commit→deploy/remove-function→recovery.

4. **The lifecycle-route secret guarantee lacks a client-side no-redirect rule. Severity: major.**

   **Evidence:** Section 4 describes lifecycle routes as non-redirecting, and §7 requires `sbac_` to appear only in their request bodies. The existing headless client calls `fetch()` without a `redirect` option; Fetch defaults to following redirects. In particular, a 307 or 308 can replay a POST body containing `sbac_` or a pairing code to another URL or origin. A promise that the intended server handler does not redirect does not protect against a proxy, deployment error, or hostile target issuing one.

   **Resolution criterion:** Require `redirect: "error"` or equivalent terminal manual handling that never resends the body for every lifecycle request, preferably for all authenticated engine requests. Pin the normalized origin and allowed scheme. Add sentinel tests for same- and cross-origin 301/302/303/307/308 responses proving that no second hop receives a secret body or bearer header.

5. **The hard child-memory ceiling has no specified portable enforcement mechanism. Severity: major.**

   **Evidence:** Section 3 promises a finite child memory ceiling, hard maxima, deterministic exit 11, and protection against an allocation racing the wall clock. Node child processes do not provide the worker API’s `resourceLimits`. `--max-old-space-size` limits part of the V8 heap, not total RSS, external `ArrayBuffer`/native allocations, stacks, or mapped memory. “POSIX-only” does not identify an enforcement mechanism, and Linux- and macOS-specific limit facilities are not interchangeable. An arbitrary OOM or signal also cannot safely be classified as this configured ceiling without an enforcement witness.

   **Resolution criterion:** Define what “memory” measures and pin an enforceable mechanism for every supported phase-1 host, including macOS and Linux, with limits installed before child code executes and deterministic mapping to exit 11. Test ordinary heap and external/native allocation paths. Otherwise narrow the contract honestly to a V8 heap ceiling and remove the hard total-child-memory claim.

6. **The code-mode termination state machine contradicts its cleanup promise. Severity: major.**

   **Evidence:** Section 3 says the parent cancels broker calls, disposes subscriptions and timers, and only then fires `signal`, while also saying the signal exists so scripts can clean up. No grace period or child acknowledgment occurs before termination. Cleanup code consequently cannot rely on broker resources and may not run before forced exit. Terminal arbitration is also underspecified: “first observed” across a child settlement frame and parent deadline needs an observation authority, while result settlement is ranked ahead of resource ceilings even though a settled value can still fail strict serialization or the output-size ceiling.

   **Resolution criterion:** Add an explicit transition table. Treat result settlement as provisional until value validation and size admission complete; define parent-monotonic deadline versus frame-receipt ordering and late-frame behavior; fire abort before teardown with a bounded acknowledgment/grace protocol, or explicitly withdraw any cleanup guarantee; and define forced-kill and stderr-flush outcomes. Acceptance should cover each race, not only ordinary settlement.

7. **The “value-free” audit lane can leak intermediate application data. Severity: major.**

   **Evidence:** Section 3 places `diagnostics` and `facts` in each stderr audit record. `src/diagnostic.rs` explicitly documents that diagnostic `message` and `details` may contain source paths, handler text, arguments, or other operator-only context; its public projection therefore drops both. The current secret-reflection sanitizer protects known bearer-like or request-secret values, not arbitrary business data. A broker error caught by the script can consequently put the intermediate data the script intentionally suppressed onto stderr. Facts and receipts likewise need field-level treatment. Attribution is intended metadata, but its actor/effective-user/grant disclosure should be listed explicitly as accepted leakage.

   **Resolution criterion:** Define a closed audit-specific allowlist—at minimum stable diagnostic classification plus individually reviewed fields—and omit or keyed-commit everything else. Do not pass generic diagnostics or facts through merely because bearer strings were sanitized. Test planted sensitive values in messages, details, facts, receipts, and attribution on success, refusal, and caught-error paths.

8. **The strict JavaScript-to-JSON boundary is incomplete. Severity: minor.**

   **Evidence:** Section 2 rejects several important non-JSON values but does not decide negative zero, sparse or augmented arrays, accessors, hidden/symbol properties, custom prototypes, typed arrays, or `toJSON` coercion. If the child transfers a value through structured cloning or JSON serialization before validation, some of those distinctions are already lost or user code may have run. LLP 0010 already demonstrates a stricter pre-serialization posture.

   **Resolution criterion:** Adopt LLP 0010’s strict-value profile or define an equally complete profile, validate in the child before transfer and again in the parent, and add fixtures for these edge cases. The result schema alone is insufficient because it sees only the post-conversion representation.

9. **The shared invocation-input source remains inconsistent across the RFC, existing LLPs, and generated artifacts. Severity: minor.**

   **Evidence:** LLPs 0012, 0019, and 0024 describe argument validators as part of the function manifest. The checked generated manifest has no such validators; schemas live under `operations/`, currently named by exported function name. RFC 0062 correctly places those schemas in the envelope and proposes keying them by stable function ID, but its required LLP 0024 reconciliation emphasizes result semantics without explicitly correcting the input source. Section 1 also calls atomic whole-envelope replacement an existing LLP 0012 invariant; LLP 0012 currently specifies atomic whole-function-manifest replacement, while envelope atomicity is new.

   **Resolution criterion:** Make the required LLP amendments explicitly define the shared invocation source as the public manifest plus operation schemas keyed by stable function ID, including the authoritative filename-to-ID mapping and MCP parity gate. Relabel whole-envelope replacement as a new 0062/0012-amendment invariant.

10. **Immutable-envelope cache semantics are not fully pinned. Severity: minor.**

   **Evidence:** Section 5 says the envelope is “cacheable forever” but does not specify the successful response’s `Cache-Control`. The current `PublicProjection` classification does not automatically add immutable caching. More importantly, a typed 404 for an evicted hash can be cached heuristically; that same hash can later become current again after rollback, leaving a valid envelope hidden behind a stale negative cache.

   **Resolution criterion:** Pin exact success and failure directives—for example, public immutable caching for a verified 200 and no-store or tightly bounded caching for missing-envelope responses—and test rollback from an evicted hash through an intermediary cache.

11. **Two referenced-document/current-state drifts remain. Severity: minor.**

   **Evidence:** The RFC sometimes describes LLP 0060’s fixed `/_snapback/*` 404 as current hosted behavior. LLP 0060 specifies it for a future hosted-auth profile and states that no such deployment currently exists; the checked Cloudflare gateway has no general `/_snapback/*` fence and can fall through to static assets. Separately, Ibex LLP 0028 still treats Snapback 0062 as a forcing dependency for embedded Ibex and possibly computed dynamic import. RFC 0062 correctly says that citation predates its Node-only phase-1 scope, but does not make correcting 0028 a landing dependency.

   **Resolution criterion:** Reword hosted statements to distinguish current gateway behavior from the future LLP 0060 requirement, and amend Ibex LLP 0028 before either proposal uses the alleged Snapback dependency for sequencing or author decisions.

## 4. Suggestions (non-blocking improvements)

- Consider a small authority-bound operation journal: persist a request ID and request digest before dispatch, then offer `resolve <id>` or equivalent status lookup. That would turn process crashes and lost responses into explicit reconciliation rather than retry folklore.

- Render `api.d.ts` and `code-mode.d.ts` locally from the validated typed envelope IR, or validate them against a very narrow declaration grammar before materializing them. This reduces the server-authored text surface and gives the engine one source for runtime and editor bindings.

- Choose and document the stable evaluator route early. An AST transform from the import-free module profile to a stable script wrapper appears feasible without experimental Node module APIs. Explicitly include dynamic `import()` and `import.meta` in the refused surface and enumerate which standard JavaScript intrinsics remain available.

- Add a per-run hash chain over audit-frame metadata. It would make dropped or reordered audit records detectable without exposing application values or the fresh commitment key.

- Consider promoting `doctor` from future work once credential profiles and served envelopes land. The combination of tuple compatibility, custody permissions, pairing state, token fences, and artifact identity is complex enough that a read-only machine-readable preflight will likely pay for itself quickly.

## 5. Open questions

1. What exact artifact does the user hand to an agent during pairing: separate request ID and secret, or one closed composite representation?

2. Is “no gap” a real observable renewal guarantee? If so, what dual-carrier and token-cap protocol establishes it? If not, what bounded cut/resync semantics replace it?

3. What outcome vocabulary will distinguish not-dispatched, committed, rejected, still-running, and unknown writes? Should Snapback expose an authority-bound settlement-status endpoint?

4. What does the child memory limit measure, and which enforcement mechanism works on every supported phase-1 POSIX platform?

5. Does `signal` promise asynchronous cleanup, synchronous notification only, or no script cleanup before forced termination?

6. Which diagnostic, fact, receipt, and attribution fields are safe for the default audit lane, and which must be omitted or committed?

7. Will the shared invocation core be defined as `(public function projection, operations-by-stable-ID)`, and should that contract remain in LLP 0024 or move to a dedicated LLP?

8. Should advertised-surface restriction remain an all-or-nothing deploy setting governing both `/inspect` and the envelope, or is universal public shape disclosure an accepted permanent posture?

9. Which parser/transform implements code mode on exact Node 24.x without experimental APIs, and are dynamic import and `import.meta` categorically outside v1?

10. What exact positive and negative cache directives apply to envelope routes, especially across rollback to a previously evicted generation?

## 6. Readiness verdict

The core direction is strong and worth pursuing, but the unresolved pairing, renewal, effect-outcome, redirect, memory, lifecycle, and audit issues are material correctness and safety gaps in the design itself. They require RFC-level decisions and acceptance semantics, not implementation completion or full schema text.

Verdict: NOT READY
## Round 6 — 2026-07-17

**Revision under review:** `llp/0062-generated-app-cli-and-code-mode.rfc.md`, sha256 `7ed9287d101b3cccd36db2ddf27c507d4af538a6fba285ef8ff11183eb84d157` (untracked file at repo HEAD `1ef45bb`; round-5 revision)
**Runtime detail:** codex exec, OpenAI Codex CLI v0.144.5, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, session id 019f6fed-35bb-75b3-bc4d-2c828f5ede9f; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** NOT READY

### Review body (verbatim)

# 1. Overall assessment

I verified the exact revision: `llp/0062-generated-app-cli-and-code-mode.rfc.md` has SHA-256 `7ed9287d101b3cccd36db2ddf27c507d4af538a6fba285ef8ff11183eb84d157`. Repository HEAD is `1ef45bb`, and Git reports the RFC as new/untracked.

This is a good proposal with a strong central idea: one generic, data-driven app CLI; a strict app-plane/operator-plane separation; content-addressed public artifacts; and code mode whose credential-bearing parent brokers all app access. The phase structure is sensible, and the proposal is unusually honest about Node not being a hostile-code sandbox.

It is not ready to implement against, however. Several phase-1 contracts are contradictory or incomplete: target eligibility cannot currently be determined without a forbidden heuristic; envelope activation does not establish semantic correspondence with the functions it activates; envelope-less sessions cannot satisfy the required generation assertion; parameterized subscriptions have no argument surface; parent-side network inputs escape the resource limits; and mutation recovery is promised without a usable recovery operation. These are design issues, not demands for completed implementation.

# 2. Strengths (with section citations)

- The data-versus-program boundary is exactly right (RFC §1, “Engine plus data, never program source”). Current `functions.manifest.json` files embed handler source and HostPlan bodies, while `api.mjs` contains inert descriptors. Refusing to execute served JavaScript is the correct trust boundary; content addressing and bounded schema parsing complement it well.

- The application-plane/operator-plane separation is clear and valuable (RFC “Position among existing surfaces”). The current full headless client ambiently reads `SNAPBACK_ADMIN_TOKEN`, so requiring an app-data-only extracted core is a real safety improvement rather than architectural tidiness.

- The “one core, thin projections” direction is well aligned with LLP 0019 and LLP 0024 (RFC “Position among existing surfaces”; RFC §2). Naming the shared app-data invocation/result core, stable-ID mapping, parity gates, and attribution seams avoids creating a CLI-specific second semantics.

- The auth projection is mostly accurate and disciplined (RFC §4). Current code confirms the closed `public | optional-user | authenticated` requirement, legacy normalization to `optional-user`, anonymous refusal only for `authenticated`, dev-only impersonation, sessions-mode refusal of dev assertions, the pairing DTO’s request-id-plus-code shape, server-derived attribution, and the hosted refusal. Defaulting to anonymous and making `auto` refuse ambiguity are good choices.

- Credential handling is thoughtfully designed (RFC §§3–4). Long-lived agent credentials stay off app-data requests; scoped tokens remain in the parent; redirects on secret-bearing requests are terminal; the child receives no bearer through legitimate channels; and the RFC correctly distinguishes that non-transmission property from sandboxing.

- Code mode’s boundary honesty is excellent (RFC §3, “Boundary honesty”). Its language is consistent with Ibex LLP 0013’s supply-chain-integrity framing and avoids claiming that a Node VM contains hostile code. The strict-value profile, bounded audit lane, keyed commitments, no ambient fetch, and parent-owned teardown are sound ingredients.

- The Ibex scoping is unusually careful (RFC §6). Ibex LLP 0028 currently overstates this RFC’s embedded-Ibex dependency, and LLP 0029’s single embedded entry cannot accept arbitrary scripts. The RFC identifies both mismatches, keeps phase 1 independent, and makes the correcting Ibex-side amendment a landing obligation.

- The acceptance section is strong (RFC §7): forged bindings, disclosure sentinels, redirect sentinels, auth matrices, generation races, output leaks, resource ceilings, and cross-projection result parity are the right adversarial tests.

# 3. Concerns

1. **Major — phase-1 target eligibility has no explicit target-owned capability.**

   RFC §4 says hosted targets are out of phase 1, that capability facts come from discovery or `/inspect`, and that the engine must never infer target class from a URL. Sessions discovery gets a new target-capability field, but dev targets are said to use the existing capability manifest.

   Current `CapabilityManifest` has no app-CLI or artifact-distribution capability, and `TargetCapabilityId` is closed to eight unrelated values. Both local and Cloudflare targets advertise an admissible `snapback.v0`/`dev` tuple. Distinguishing them via `targetProfileId`, `localServerLifecycle`, runtime engine, or URL would be exactly the inference the RFC and LLP 0012 prohibit.

   **Resolution criteria:** Define a named, target-owned app-CLI/artifact-distribution capability, its positive predicate, schema owner, and active-posture relationship. It must appear consistently in `/inspect` and sessions discovery. Pin tests where local v0/dev and local v1/sessions advertise the appropriate support while Cloudflare v0/dev refuses without URL, profile-id, or correlated-capability inference.

2. **Major — envelope activation neither proves semantic correspondence nor follows the accepted schema-authority decision.**

   RFC §5 says the server accepts the envelope as opaque canonical bytes, bounds and hashes it, stores it byte-exact, and activates it atomically with the function manifest. Atomic activation proves simultaneity, not correspondence. A provisioner could submit function manifest A with envelope B, or alter B’s operation schemas while retaining self-asserted `inputsHash` and `bundleHash` values. The call-time check would confirm that B’s envelope hash is active, but not that its validation schemas, kinds, auth requirements, and function set describe the functions actually executing.

   This also exposes an ownership conflict. RFC §5 classifies the discovery document, envelope wrapper, call result, introspection, and broker frames collectively as engine-owned schemas. Accepted LLP 0037 makes Rust types authoritative for shared shapes the server parses or emits. Pure client artifacts such as introspection and parent/child broker frames can naturally be engine-owned; server-constructed discovery and server-visible admission/generation DTOs cannot be assigned wholesale to the Node engine without an explicit reconciliation.

   **Resolution criteria:** Partition schema ownership explicitly. Keep purely client/IPC DTOs engine-owned, while Rust owns every server-parsed or server-emitted shared DTO and generates its schemas. At activation, parse a bounded Rust-owned envelope admission projection and compare the app id, tuple, `inputsHash`, `bundleHash`, complete stable-ID function projection—including kind and effective auth requirement—and the exact operation-schema key/digest set against the schema/function pair being activated. Preserve opaque canonical bytes for serving, but reject wrong-app, stale-manifest, changed-kind/auth, missing-schema, and swapped-schema combinations before activation.

3. **Major — the envelope-less sessions fallback contradicts mandatory generation binding.**

   RFC §1 requires every sessions call and subscription to carry an expected envelope identity, checked atomically against the active generation. RFC §5 says an older sessions generation with no envelope degrades to `--artifacts` and remains an admissible tuple.

   Local artifacts cannot supply an identity that the active generation does not possess. Omitting the assertion would use the explicitly unchecked compatibility path and violate the “every sessions call” guarantee.

   **Resolution criteria:** Choose one of two coherent contracts:

   - local artifacts permit only help, introspection, and types until the app is redeployed with an envelope; network operations return a typed redeploy-required refusal; or
   - define a distinct legacy generation identity derived from authoritative active manifests, carried by discovery and asserted at call time.

   Add acceptance coverage for the chosen envelope-less sessions behavior.

4. **Major — `subscribe` cannot invoke parameterized live queries.**

   RFC §2 gives `call` an `--args-json` surface but gives `subscribe <liveQuery>` none. Parameterized live queries already ship: `graffiti:listCells` requires `boardId`, and `card-game:myHand` requires `gameId`. The current headless `subscribeLive` method accepts `args`.

   Therefore the proposed generic CLI cannot subscribe to a valid existing class of generated functions.

   **Resolution criteria:** Add `--args-json '<json>'` and `--args-json -` to `subscribe`, with the same schema validation and no-network-on-invalid-input behavior as `call`. Also pin the default and mutual-exclusion rules for `--first-change`, `--watch`, and `--timeout`. Test at least one required-argument live query rather than only the todo demo.

5. **Major — remote responses can exhaust the credential-bearing parent before any advertised ceiling applies.**

   RFC §1 bounds envelope parsing, and RFC §3 bounds child heap, broker messages, stderr, subscriptions, calls, and final output. It does not bound app-call, auth-lifecycle, or live-update responses before decoding in the parent.

   The current headless core buffers HTTP responses with `res.text()` and materializes complete WebSocket messages before `JSON.parse`. A buggy or hostile target, or simply an app returning a very large value, can exhaust the parent before the result/output ceiling emits its typed overflow document. The child heap limit does not protect the process holding credentials.

   **Resolution criteria:** Pin finite per-class request/response/frame limits and enforce them before full text or JSON materialization. Define handling for missing or dishonest `Content-Length`, chunked bodies, decoded-size expansion, and WebSocket maximum payloads; define the diagnostic and exit mapping; and add oversized HTTP, compressed/chunked, auth-response, and WebSocket tests proving bounded parent memory and orderly cleanup.

6. **Major — phase-1 mutation recovery is promised but has no usable surface.**

   RFC §2 says every mutation gets a durable `clientMutationId`, persisted until settlement, and that an unknown outcome can be recovered with the same id. It simultaneously forbids automatic write retries. The command surface exposes neither a caller-supplied/reuse flag nor a recovery command, while `resolve <id>` and the authority-bound journal are deferred to future work.

   The current headless client already accepts a supplied `clientMutationId`, so the missing piece is the design surface, not feasibility. As written, nothing consumes the persisted id after the command reports `outcome: "unknown"`.

   **Resolution criteria:** Either add a phase-1 recovery operation—such as an explicit same-id replay/settlement command or flag—with target, authority, function, and argument-digest binding plus locked crash-safe persistence, or remove the phase-1 persistence/recovery claim and report the id solely as evidence of an unresolved outcome. The acceptance criterion must match the chosen contract.

7. **Major — mint-per-invocation is undefined above the scoped-token cap for ordinary calls.**

   RFC §4 acknowledges that sibling invocation can evict a watch token, but its tests cover a sequential burst and watch healing. The live per-grant cap is ten, and minting the eleventh token revokes the oldest. More than ten concurrent process-per-command invocations can therefore revoke one another between mint and dispatch or while work is in flight. This affects queries, mutations, and actions, not only subscriptions.

   The future profile-local broker would solve much of this, but it is explicitly not phase 1. An ordinary auth refusal is particularly problematic for a mutation whose outcome may already be unknown.

   **Resolution criteria:** Specify phase-1 behavior for `N > cap` concurrent commands: for example, cross-process bounded admission, an explicit concurrency refusal before mint, or operation-class-specific recovery where reads may remint/retry, mutations use the same id, and actions never retry automatically. Add above-cap concurrent query, mutation, action, and watch tests.

8. **Minor — the RFC omits the accepted LLP that actually owns the auth semantics it projects.**

   Accepted LLP 0058 owns `AuthRequirement`, the exact v0/dev and v1/sessions pairs, the shared invocation gate, source registry, and sessions body closure. Current code’s `@ref` annotations point to LLP 0058. RFC 0062 instead attributes most of this to LLP 0012 and does not list 0058 in `Related`.

   **Resolution criteria:** Add LLP 0058 as governing, state that the CLI projects rather than redefines its semantics, and route any generation-assertion or invocation-source additions through the appropriate 0058 amendment.

9. **Minor — several closed DTO details are presently ambiguous or factually too narrow.**

   Concrete cases:

   - For sessions codegen, `schema.manifest.json` and `functions.manifest.json` are v1, while `artifacts.json`, the capability manifest, and generated API descriptor formats remain v0. RFC §5 does not name the sole local artifact-tuple authority.
   - RFC §3 admits diagnostic “code and classification” into the audit lane, but the current safe projection has the concrete fields `code`, `severity`, and `subsystem`; no field named `classification` exists.
   - RFC §5 says `PublicFunctionManifest` strips “exactly” handler source, HostPlan bodies, and `sourceSpan`. It also removes diagnostic message/details and other cron/config/function source spans.

   **Resolution criteria:** Name schema/functions manifests or the generated envelope as the tuple authority and explicitly exclude independent artifact/API format versions; define the exact audit diagnostic fields or a versioned derived classification; and describe public disclosure as an allowlist/exhaustive projection rather than an incomplete “exactly” list.

10. **Minor — the secret and filesystem contracts should cover all carrier classes and all existing custody invariants.**

    Connection capability tokens are bearers carried in a header and WebSocket subprotocol, but the RFC’s planted-secret inventory names admin, session, `sbac_`, and `sbagt_` material without explicitly naming connection tokens. Also, the session/profile store description mentions 0600, atomic replacement, and advisory locking, while existing filesystem custody additionally enforces owned 0700 directories, owned/single-link/bounded files, symlink and unsafe-ancestor refusal, fsync ordering, and crash recovery.

    **Resolution criteria:** Add connection tokens to the no-child/no-log/no-audit/no-redirect taxonomy and tests. Reference or factor one exact POSIX secret-store contract for session custody and credential profiles, including directory, ownership, link, symlink, lock-loss, and crash-window behavior.

# 4. Suggestions (non-blocking improvements)

- Do not make one hazardous exported name disable the whole app CLI. Keep ergonomic `api.foo` aliases for safe names, but add a stable fallback such as `api.byId("app:function")` or `snapback.function(id)`. This handles `then`, `constructor`, non-identifiers, and future reserved names without making otherwise valid apps unusable.

- Pin `/app-api/envelope/{hash}` to an exact grammar, preferably 64 lowercase hexadecimal characters, with explicit malformed-hash status and cache behavior. The route registry automatically gives registered GET routes HEAD and OPTIONS behavior; document and test those rather than calling the routes simply “GET-only.”

- Define when the code-mode result is snapshotted relative to the signal-first cleanup grace. Cleanup can currently mutate an already-settled object before serialization. Either structured-clone the admitted result before firing `signal`, or explicitly make post-settlement cleanup mutations part of the result semantics.

- Add a read-only “execution plan” mode that resolves target, artifact identity, principal source, stable function id, kind, and argument digest without dispatching. This would give agents a compact way to diagnose binding and principal ambiguity without duplicating server-side authorization prediction.

- Reconcile the existing guide claim that served-guide routes are `all | shipped`: the Cloudflare gateway does not serve them, while the future LLP 0060 hosted profile intentionally fixes `/_snapback/*` to 404. RFC 0062 correctly reuses only the identity pattern and should say so explicitly.

- Before landing the RFC, add the promised `clients.app-cli` GAP row and regenerate the guide projections. Also add the legacy-absent-`authRequirement` golden proving help and introspection display `optional-user`, never null.

# 5. Open questions

1. What exact target-owned capability says that a target supports local-artifact CLI use, served envelopes, generation assertions, and each principal class? Are these one capability or several independently versioned facts?

2. Is an envelope-less sessions generation callable at all? If yes, what authoritative identity replaces the absent envelope hash?

3. Which Rust type owns the server-side envelope admission projection, and which DTOs remain genuinely client-only and engine-owned?

4. What is the phase-1 user action after a mutation reports `outcome: "unknown"`? Is explicit same-id replay enough, or is a settlement lookup required?

5. What concurrency guarantee should one grant receive when independent CLI processes exceed the scoped-token cap?

6. What are the parent-side decoded-byte limits for finite results, auth responses, discovery, live frames, script input, and stdin arguments, and which exit class owns each overflow?

7. What is the default `subscribe` mode when neither `--first-change` nor `--watch` is supplied, and how may `--timeout` combine with them?

8. Should hazardous export names lose only their property alias, or should they make the entire app surface unavailable?

# 6. Readiness verdict

The core proposal is worth pursuing, and most of its security posture is stronger than the current client surface. The unresolved major concerns are nevertheless material correctness, coherence, safety, and implementability issues in the phase-1 design contract.

Verdict: NOT READY
## Round 7 — 2026-07-17

**Revision under review:** `llp/0062-generated-app-cli-and-code-mode.rfc.md`, sha256 `a9988327d514f4c62de45b90ced8113cd92c1773ad922ccf9fd57e867427367f` (untracked file at repo HEAD `1ef45bb`; round-6 revision)
**Runtime detail:** codex exec, OpenAI Codex CLI v0.144.5, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, session id 019f700a-9c7c-7bb1-8074-226ee9db84ab; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Orchestrator note: a first attempt at this round (a separate fresh session) was terminated mid-evidence-collection before producing any review output; it is not counted and no artifact exists for it.
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

I verified before reviewing that the SHA-256 of the exact untracked file is `a9988327d514f4c62de45b90ced8113cd92c1773ad922ccf9fd57e867427367f`, matching the revision supplied. Repository HEAD was `1ef45bb`.

This is a good proposal with a strong central architecture: one generic engine, app-specific data artifacts, explicit authority selection, and no execution of server-supplied JavaScript. The Node-first implementation plan is realistic, and the Ibex phase is deferred honestly.

It is not ready, however. Several guarantees—trusted-local agent admission, token-cap coordination, envelope safety, mutation recovery, and code-mode compatibility—are not enforceable by the mechanisms currently specified. These are design issues rather than missing implementation.

## 2. Strengths (with section citations)

- **The engine/data separation is exactly the right foundation** (§1, §5). The generated `api.mjs` contains inert descriptors, while `functions.manifest.json` contains executable handler source; refusing to execute served JavaScript is therefore a meaningful security boundary rather than stylistic preference.

- **Artifact and generation binding are thoughtfully designed** (§1). In particular, the sessions-mode call-time expected-envelope assertion closes the deploy race between argument validation and same-named function selection. The explicit distinction between integrity, binding, and generation-race failures should make agent recovery materially better.

- **The auth projection mostly matches the implemented authority model** (§2, §4). Default-anonymous selection, explicit `dev`/`session`/`agent` principals, refusal of ambiguity, and leaving grants, memberships, and kind-sensitive rules to the server agree with `AuthRequirement`, the anonymous gate in `src/auth/invocation.rs`, LLP 0055, and LLP 0056.

- **The RFC resists creating a second result protocol** (Position, §2). Requiring an LLP 0024 amendment and a shared app-data core is preferable to letting the CLI, MCP catalog, headless client, and HTTP arm drift into similar but incompatible envelopes.

- **The code-mode boundary is unusually honest** (§3, §6). The parent owns credentials, calls are brokered, values use a strict portable profile, resource limits are explicit, and the RFC correctly states that Node’s VM is not a hostile-code sandbox. That matches LLP 0010 and the Ibex LLP 0013/0014 threat model.

- **The staged plan is credible** (§6). Local-artifact commands can land without server work; envelope distribution and generation binding come next; code mode follows. Deferring standalone Ibex packaging is correct because Ibex LLP 0029 currently permits one embedded entry and no external script ingress, while LLP 0022’s Quarantine path is not yet that facility.

- **The acceptance plan is substantive** (§7). It emphasizes forged identities, stale generations, redirects carrying secrets, disclosure sentinels, lifecycle races, strict serialization, and cross-arm parity rather than relying only on happy-path snapshots.

## 3. Concerns

1. **Severity: major — Target eligibility cannot presently prove agent-safe locality, and the proposed capability is assigned to the wrong authority.**

   **Evidence:** Section 4 advertises agent principals on local sessions targets while also acknowledging that the local fence cannot distinguish a direct local server from one exposed through a public reverse proxy. LLP 0055 makes that distinction an explicit prerequisite: a reverse-proxied local process is not trusted-local, and bind/profile facts alone are insufficient. A static `app-cli.target` value returned by `/inspect` is forwardable through that same proxy and therefore cannot prove how the client reached the backend.

   The wire ownership is also incorrect. LLP 0058 owns `supportedCapabilities`; `TargetCapabilityId` in `src/manifest.rs` is closed to eight identifiers and requires a schema revision and positive predicate for a ninth. LLP 0060 instead owns the separate structured `hostedAuth` descriptor. The RFC’s proposed capability contains structured facts—principal classes, envelope support, and generation assertions—so it does not naturally fit the existing string-id set.

   **Resolution criteria:** Phase 1 must either restrict agent credential use to a directly verified loopback/Unix-socket path as a necessary condition, or land a deployment-bound, non-forwardable trusted-local attestation before advertising agent support. The RFC must also define the capability’s exact owner and shape: either amend LLP 0058 with the required predicates and schema changes, or introduce a distinct structured descriptor. Acceptance must include a public reverse proxy in front of an otherwise identical local sessions server and prove agent credentials never cross it.

2. **Severity: major — Pairing and long-lived credential custody do not form one coherent protocol.**

   **Evidence:** LLP 0055 specifies that the agent initially submits the pairing code and requested scopes, receives a pending request, and later polls with `pairingRequestId`. Section 4 instead requires the request id as an initial input and says the user hands both values to the agent. The shipped `AgentPairRequest` and `auth_agent_pair` handler in `src/server.rs` currently require both, so the RFC matches current code but silently contradicts its governing LLP.

   The resulting `sbac_` profile is also under-specified. The RFC allows the credential inline in the profile, but explicitly applies secure-file admission only to a referenced credential file. The existing `agent-authority-filesystem.mjs` custody adapter cannot simply store it: it deliberately rejects bearer, token-id, and other secret fields. Generic language in §6 about “custody stores” does not define atomic update, ownership, link, ACL, symlink, locking, and recovery semantics for this new secret-bearing DTO.

   **Resolution criteria:** Choose one pairing wire and make LLP 0055, the RFC, and `AgentPairRequest` agree through a named dated amendment. Separately define a versioned secret-profile store with the full POSIX ownership, mode, link, ACL, bounded-read, locking, atomic-replace, and crash-recovery contract—or require credentials to remain in an external securely admitted file or OS credential provider. No secret class, including login codes, should be accepted as a literal argv value.

3. **Severity: major — The token-cap admission guarantee is impossible with the stated client-only concurrency gate.**

   **Evidence:** Section 4 mints one scoped token per process and never persists or explicitly releases it. LLP 0055 gives tokens a one-hour default TTL, caps live tokens at ten per grant, and makes mint eleven revoke the oldest; `mint_scoped_token` implements exactly that behavior. A process releasing its local admission slot does not remove its server token. Consequently, sequential short commands can evict an older live watch or long-running mutation even when concurrent process count stays below the proposed bound.

   The coordination key is also `(profile, grant)`, while the server cap is per grant. Two profiles, custody roots, machines, or non-CLI minters sharing a grant bypass one another. This contradicts both the “never silently revoking a sibling” guarantee and the acceptance case that expects healing after sibling eviction.

   **Resolution criteria:** Use a server-visible reservation/release protocol, protect active tokens from eviction, reuse tokens through a shared local broker or pool, or explicitly weaken the guarantee and specify terminal/unknown-outcome behavior after external eviction. Any client coordination must at least be keyed by normalized target, app, and grant independently of profile, and its guarantee must be scoped honestly to participating clients. The promised mint-throttle and server-relative-TTL amendment to LLP 0055 must be an explicit phase-1 prerequisite.

4. **Severity: major — Envelope admission does not yet establish the identity, correspondence, or disclosure guarantees claimed in §5.**

   **Evidence:** The identity is defined as SHA-256 over RFC 8785 canonical bytes, but ingestion hashes the opaque bytes received without requiring the server to verify that they are actually the JCS serialization. Equivalent noncanonical JSON can therefore receive a different identity.

   The server also byte-serves declaration strings and operation schemas supplied by the provisioner. Self-reported digests establish internal consistency, not safe derivation: a declaration or schema can contain arbitrary comments, paths, source text, or free-form fields while retaining a valid digest. This is weaker than `PublicFunctionManifest`, whose exclusions are enforced by a Rust-owned exhaustive projection.

   Finally, current `FunctionManifest`/`FunctionDefinition` records contain no argument-schema digest or operation-set root outside the proposed envelope. Without an independent activated commitment, replacing an operation schema and recomputing the envelope’s own digest remains self-consistent.

   **Resolution criteria:** Admission must perform bounded parsing, reject duplicate/non-I-JSON forms, JCS-reserialize, and require exact byte equality—or redefine identity over raw received bytes. Public schemas and declarations must be synthesized from closed server-validated DTOs or validated against a closed permitted structure before publication. Operation-schema digests, or one canonical operation-set root, must be committed by a separately activated Rust-owned artifact and checked atomically. Negative tests must recompute all envelope-local hashes after substitution.

5. **Severity: major — `code-mode.d.ts` permits a newer-envelope/older-engine compatibility failure.**

   **Evidence:** Section 3 puts both engine-owned ambient globals and app-owned bindings into the served envelope. It explains that an older envelope may under-declare a newer engine, but not the reverse: a newer envelope may declare a global or behavior an older installed engine does not inject. Section 5 makes the server-authored engine range advisory and defines no hard code-mode-surface version, so an old engine can typecheck a script against a declaration it cannot execute.

   **Resolution criteria:** Either ship engine-owned ambient declarations with the installed engine and keep only app-owned bindings in the envelope, or introduce a hard-negotiated code-mode surface version/fingerprint with exact compatibility rules. Acceptance must exercise both skew directions, including a newer server envelope against an older engine.

6. **Severity: major — Durable mutation recovery is not bound to the authority or generation that created the uncertain outcome.**

   **Evidence:** Section 2 persists only target, function, and argument digest with `clientMutationId`. The server’s idempotency machinery additionally binds `auth_fingerprint` and `authority_instance_id`. A replay under another profile, dev user, session, agent grant, or delegated authority can therefore fail to recover an existing settlement; if the original request never committed, it can instead execute under the newly selected authority. The record also omits the sessions envelope identity, allowing an unsettled mutation to run against changed code after a deploy.

   **Resolution criteria:** Persist the app identity, expected envelope generation, selected principal/profile, and a renewal-stable server-derived authority descriptor. Re-attest these before replay and refuse locally before dispatch on any mismatch. Tests must cover cross-profile, cross-user, cross-grant, and cross-generation replay and prove zero dispatch. Replaying against a new generation should require an explicit operator override, not happen during automatic refetch.

7. **Severity: major — The claimed all-channel minimization and diagnostic-safety contract has two escape paths.**

   **Evidence:** Sections 2 and 3 preserve unspecified “safe semantic fields” in ordinary results and broker errors. `Diagnostic.details` in `src/diagnostic.rs` is arbitrary JSON, while `PublicDiagnostic` deliberately exposes only code, severity, and subsystem because messages/details may contain source, paths, or arguments. Only the audit lane receives a closed field allowlist.

   Separately, `console` arguments are emitted to stderr without a value-filtering contract. A script can accidentally `console.log(rows)` and place the entire 500-row intermediate into the agent transcript. The §7 fixture proves only that one script did not do so; it cannot establish the Summary’s claim that only the selected result enters context across every channel.

   **Resolution criteria:** Make `PublicDiagnostic` the default basis for every child, result, broker, and stderr projection, with any extra semantic fields admitted through a versioned code-indexed allowlist. Make console value-free/summarized by default, local-transcript-only, or an explicit full-value opt-in; otherwise narrow the RFC’s context-minimization claim. Acceptance must plant sensitive values through every diagnostic and console path.

8. **Severity: minor — Dev artifact attestation can be validated against a stale cached `/inspect` response.**

   **Evidence:** Section 1 relies on `/inspect` before network operations against dev targets. The current route is `PublicProjection`, and the shared response controls do not add `Cache-Control: no-store` to that class. A stale proxy/cache response can therefore validate stale local artifacts while calls reach newer dev code, extending the accepted reload race indefinitely.

   **Resolution criteria:** Give the attestation response explicit non-cacheable or mandatory-revalidation semantics, or add a dedicated fresh identity endpoint. Add a stale intermediary-cache test to the dev binding suite.

## 4. Suggestions (non-blocking improvements)

- Consider a per-user local authority broker that holds a small reusable token pool in memory and multiplexes CLI invocations over authenticated IPC. It would solve token churn, coordinate subscriptions, and centralize refresh without persisting scoped bearer material.

- Represent the envelope as a closed structured “surface graph” and synthesize `api.d.ts` and `code-mode.d.ts` at the client/server boundary. This would reduce public-string validation, compatibility, and digest-correspondence problems simultaneously.

- Use Node’s permission machinery or an optional OS sandbox as defense in depth for code mode, following the posture already used by LLP 0010’s stricter evaluator. The RFC should continue to describe this as hardening, not as a hostile-code guarantee.

- Before landing the RFC, add the promised `clients.app-cli` GAP row to `guide/capabilities.md`, the new LLP 0031 route-matrix rows, and an explicit acceptance item for correcting Ibex LLP 0028’s stale Snapback citation.

## 5. Open questions

- Is the current request-id-plus-code pairing DTO the intended protocol, or should implementation return the request id after code presentation as LLP 0055 specifies?

- Is phase-1 agent support strictly direct-loopback/Unix-socket, or is a reviewed trusted-local deployment attestation required before any agent lane ships?

- Should app-CLI support be a ninth `TargetCapabilityId`, or a separate structured descriptor whose fields can evolve independently?

- Is the desired token model per invocation, reusable per authority, or broker-owned? What guarantee is expected when another machine or client mints under the same grant?

- Is the public envelope threat model merely “correct official codegen,” or must the server defend against malformed, buggy, or malicious provision artifacts? The current prose attempts the stronger guarantee.

- What stable authority identity should mutation recovery bind for renewed sessions and reminted agent tokens, and how should an operator intentionally authorize replay against a new generation?

## 6. Readiness verdict

The core product and architecture are worth pursuing, but the unresolved authority, admission, compatibility, and recovery issues are material. The RFC needs revision and another independent review after those contracts are reconciled.

Verdict: NOT READY
## Round 8 — 2026-07-17

**Revision under review:** `llp/0062-generated-app-cli-and-code-mode.rfc.md`, sha256 `d7293f8f1724aaad80cd0b8ffd7b3569f3b9672374a96bfdabf006cc02109b9f` (untracked file at repo HEAD `1ef45bb` at review start; round-7 revision)
**Runtime detail:** codex exec, OpenAI Codex CLI v0.144.5, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, session id 019f701c-9b51-72f0-be6d-bd30fa2576ac; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

I verified the document’s SHA-256 is exactly `d7293f8f1724aaad80cd0b8ffd7b3569f3b9672374a96bfdabf006cc02109b9f`. At review start, repository HEAD was `1ef45bb` and the RFC was new/untracked, matching the brief. The shared workspace later advanced to `471fe33`; the RFC bytes remained unchanged, and that intervening custody-hardening commit does not affect the central findings below.

I read the entire RFC, every requested Snapback and sibling-Ibex LLP, and the relevant generated artifacts, runtime/auth, client, custody, route, gateway, and guide code. I did not read `llp/reviews/` or credential/secret material.

The proposal is a good idea. A generic engine consuming an app-specific, source-free API description is the right architecture for an agent-oriented CLI. The authority projection, content-addressed distribution, generation binding, write-outcome semantics, and honest description of Node’s non-sandbox boundary are especially strong.

It is not ready, however. Several claimed guarantees are internally contradictory or impossible with the specified trust roots. Most importantly, the current design can publicly preserve unknown source-bearing fields, cannot independently prove operation-schema correspondence, cannot provide its promised token-cap non-eviction behavior, and does not define a coherent physical ownership model for code-mode declarations. The phase plan also depends on server changes it says are unnecessary and omits an existing target profile.

## 2. Strengths (with section citations)

- The “one engine plus data” decision is sound. Refusing to execute server-supplied `api.mjs` avoids turning API discovery into arbitrary code execution, while the defensive parsing and ingress-size limits correctly recognize that data can still be a denial-of-service vector (§Summary; Design §1).

- The proposal preserves Snapback’s existing authority model instead of growing a CLI-specific one. Operator and app planes remain separate, anonymous is the default, authority selection is explicit, malformed credentials never fall back, and authorization details remain server-decided (§Position among existing surfaces; Design §4). These claims agree with the current invocation gate and `AuthRequirement` implementation.

- Artifact freshness, integrity, and execution binding are separated well. Content-addressed immutable envelopes, a no-store current pointer, server-side expected-generation assertions, and explicit dev-mode residual risk form a coherent race model (§1; §5).

- The result and write-outcome design is unusually careful. Mutation IDs are persisted before dispatch, lost responses become `outcome: "unknown"`, automatic write retries are prohibited, and replay is bound to arguments and authority rather than merely to an opaque ID (§2).

- Code mode’s parent/child split is valuable even though it is not containment. Keeping legitimate bearer transmission out of the child prevents common accidental disclosures, while §3 explicitly says a Node VM escape regains the invoking user’s OS authority. That is the correct, honest boundary (§3, “Boundary honesty”).

- The phase scoping is generally responsible. Hosted distribution is not treated as already present, and the RFC correctly identifies why Ibex LLP 0029’s single embedded entry cannot presently host arbitrary external scripts. Its characterization of Ibex LLP 0013 as supply-chain containment rather than a hostile-code sandbox is accurate (§6; Future work).

- The acceptance section tests hostile and skewed states rather than only happy paths: noncanonical envelopes, swapped schemas, generation races, secret sentinels, redirect behavior, lost mutation responses, attribution parity, and resource-limit races (§7).

## 3. Concerns

1. **Major — Additive nested fields defeat the source-stripped public-envelope guarantee.**

   Section 5 says strictness applies only to envelope wrappers while unknown fields inside the nested manifest remain additive and are ignored. It also requires the server to preserve and serve the envelope byte-for-byte. At the same time, §5 and §7 claim the nested manifest is an exhaustive public allowlist from which planted source/path fields cannot escape.

   Those properties cannot coexist. Today `PublicFunctionManifest` is constructed safely when the server converts a trusted full manifest, but it is not a strict deserialization type; its generated schema permits additional properties. An opaque provisioned envelope can therefore include an unknown `source`, `path`, or similar member. Admission ignores it, byte-exact storage preserves it, and the public immutable route serves it.

   **Resolution criteria:** Envelope admission must require exact value equality between its nested function projection and a server-derived `PublicFunctionManifest`, including rejection of unknown fields. Alternatively, define a separately typed and security-classified extension map whose values are safe to serve. The RFC must explicitly reconcile this stricter public boundary with LLP 0012’s general additive-field rule.

2. **Major — Operation-schema correspondence has no independent root of trust.**

   Section 5 requires activation to detect a substituted operation schema even when every envelope-local digest has been recomputed; §7 makes that an acceptance test. But current function definitions and manifests contain no argument validator or per-function schema digest. The operation schemas are generated later as independent files, presently keyed by exported-name filenames.

   The proposed operation-set root is computed from the envelope and then retained as the server commitment. That detects later corruption, but it cannot prove that schema A belongs to function A. `bundleHash` may indirectly commit to the authoring input, but the server has neither the preimage nor an expected per-function schema digest with which to verify the supplied schema.

   **Resolution criteria:** The independently activated function/provision artifact must carry a canonical schema digest keyed by stable function ID, or carry an independently authenticated validator IR from which the server derives that digest. Activation must recompute the received schemas and compare them to that independent authority atomically. The recomputed-swap acceptance test should remain.

3. **Major — Declaration ownership and declaration admission are contradictory and underspecified.**

   Section 3 first says ambient engine declarations ship with the installed engine and that the envelope contains only app-owned bindings. A few lines later, it says the merged file contains all ambient globals and “ships in the envelope.” The `types` command and §5 likewise place `code-mode.d.ts` in the envelope.

   This reintroduces both skew directions the ownership split is intended to eliminate. In addition, the current declaration artifact is opaque TypeScript text. The RFC does not name a closed declaration IR, canonical grammar, parser, or renderer through which Rust admission can prove the absence of arbitrary comments, paths, source fragments, and free text.

   **Resolution criteria:** Name three distinct physical products:

   - an app-owned binding artifact or closed declaration IR in the envelope;
   - engine-owned ambient declarations shipped with the installed engine;
   - a separately named merged output produced by `types`.

   Pin which owner versions the hazardous-alias suppression set. If raw declaration text remains server-delivered, specify a versioned canonical grammar/parser and adversarial admission suite; a closed IR rendered by the installed engine would be simpler and safer.

4. **Major — The process-concurrency gate cannot guarantee non-eviction of active sibling tokens.**

   Section 4 says a cross-process gate bounded by the advertised per-grant token cap prevents participating invocations from silently revoking a sibling token. The actual cap applies to all unexpired token rows, not active processes. Minting token eleven revokes the oldest live token.

   A concrete counterexample is one watch plus nine completed commands whose short-TTL tokens have not yet expired. Those completed processes release their admission slots. The next process is admitted below the process cap, but its mint revokes the oldest token—potentially the active watch. The RFC acknowledges this eviction immediately before making the stronger non-eviction claim. Keeping slots until token expiry would instead break the required sequential burst of hundreds of commands.

   **Resolution criteria:** Specify a mechanism that satisfies both acceptance cases: an exact-token release/revoke route, a non-evicting or reserved mint primitive, a server-visible live-token lease ledger, or moving the shared broker into phase 1. The solution must prove that active queries, writes, actions, and watches are not selected as eviction victims by participating clients while sequential completed commands remain practical.

5. **Major — “Loopback origin” is not a sufficient credential-destination specification.**

   Section 4 makes URL-level loopback eligibility the phase-1 fence before transmitting long-lived agent credential bodies, but does not define the permitted hostname grammar, DNS behavior, connected-peer validation, or environment-proxy behavior. Redirect refusal protects later hops; it does not protect the first request if `localhost` resolves elsewhere or Node is configured to use an environment proxy.

   This matters because the RFC permits unencrypted HTTP for loopback targets and promises that non-loopback recipients will not receive agent credentials.

   **Resolution criteria:** Either admit only literal `127.0.0.1` and `[::1]` origins through a direct, explicitly proxy-disabled transport, or resolve and pin every connected peer as loopback. Specify userinfo, IPv4/IPv6, DNS, path normalization, proxy environment, and connection reuse behavior. Add negative proxy/DNS tests before any session or agent carrier is sent.

6. **Major — The phase-1 decomposition and target matrix are not coherent.**

   Section 4 makes the new structured `app-cli.target` descriptor the only permitted target-eligibility authority and forbids inference from URL, profile, tuple, or correlated capabilities. Current `/inspect` has no such descriptor. Nevertheless, sub-stage (a) claims the dev CLI, auth cells, binding, and output contracts require no server changes.

   The same stage owns output contracts, while the shared LLP 0024 result core is scheduled later in sub-stage (b), despite being called a prerequisite elsewhere. Finally, the claimed full phase-1 target matrix omits the existing `remote-service-sqlite-ibex` profile—an independently managed HTTPS service that is neither the loopback-local row nor the future hosted-auth/Cloudflare row.

   **Resolution criteria:** Revise the dependency graph so that the LLP 0058 descriptor schema and server `/inspect` emission land before any compliant stage-(a) eligibility decision, and the LLP 0024 shared result mapping lands before the first CLI result contract ships. Add a remote-service row with explicit anonymous/session/agent behavior and tests, or explicitly advertise `app-cli.target` as unavailable there. The phase list should also name its required LLP 0055 and 0058 amendments.

7. **Minor — The diagnostic fields treated as intrinsically safe are not closed values.**

   The RFC treats `code`, `severity`, and `subsystem` as the safe basis for every public/audit projection. `severity` is closed, but the current `code` and `subsystem` fields are arbitrary strings copied into `PublicDiagnostic`. A planted value can therefore ride those nominally safe channels even though `message` and `details` are stripped.

   **Resolution criteria:** Bound and validate diagnostic codes against the registered vocabulary, and make `subsystem` a closed enum or tightly bounded grammar. Extend disclosure sentinels to every base field.

8. **Minor — Export-name acceptance contradicts the specified fallback behavior.**

   Section 3 says hazardous, reserved, or invalid names merely lose their property alias and remain callable through `snapback.function(stableId)`. Section 7 instead tests “refused hazardous/reserved/invalid export names.” Current codegen rejects non-identifiers and ECMAScript reserved words, while valid hazards such as `then`, `constructor`, and `__proto__` remain possible.

   **Resolution criteria:** Split the cases explicitly: valid hazardous or engine-reserved names suppress the alias and succeed through the stable-ID fallback; authoring-invalid/reserved names are rejected by codegen or forged-envelope admission.

9. **Minor — Public artifact fetches are not explicitly credential-free.**

   The envelope is described as public and principal-independent, but the current shared client normally performs an auth handshake and attaches selected authority on app-data requests. A naïve client-core lift could therefore send session or scoped credentials to `/app-api/current` and `/app-api/envelope/*` even though they are unnecessary.

   **Resolution criteria:** Require a bare, credential-free, non-redirecting fetch path for discovery and immutable envelopes, and test that no admin, session, agent, connection, or cookie carrier is attached.

## 4. Suggestions (non-blocking improvements)

- Consider replacing raw declarations and independently keyed schemas with one closed `AppApiIR` containing public function facts and normalized validator/data-model IR. The installed engine could deterministically render help, JSON Schema, and declarations. This would remove several skew and disclosure surfaces at once.

- Generate the target matrix from target-owned descriptors and test it against every public `targetProfileId`, rather than maintaining the RFC table independently.

- During the client-core lift, expose separate browser-safe and Node-only package entry points. Add a browser-bundle test proving filesystem custody and lock helpers cannot enter the browser dependency graph.

- Pin unknown JSON Schema keywords to fail closed. Expansion of the accepted 2020-12 subset should be an explicit engine/envelope compatibility event.

- Keep the promised `clients.app-cli` capability-index GAP row in the RFC landing commit, then replace it with the guide page and route-map rows when phase 1 lands.

## 5. Open questions

1. What independently authenticated artifact is authoritative for each function’s argument schema: the function manifest, a validator IR, or a new operation-manifest root?

2. Should declaration text be transported at all, or should the engine render it from closed public data plus its own ambient declarations?

3. Which token-cap solution is intended for v1: exact-token release, non-evicting mint/reservations, or the shared profile-local broker?

4. What exact phase-1 behavior should `remote-service-sqlite-ibex` advertise for anonymous, human-session, and agent principals?

5. Is literal-IP direct transport acceptable for the initial agent lane, or must `localhost` and custom loopback names be supported with connected-peer verification?

6. What is the final exact mapping between `appCliCallResult` and LLP 0024’s existing `hostOpsResult` fields, especially `target`, `authority`, `artifacts`, `facts`, and public attribution?

7. Should the server construct the canonical public envelope from admitted components rather than store a provisioner-supplied envelope byte-exact? That would make the server’s typed projection the actual disclosure authority.

8. Should an app be able to reduce its public introspection/envelope surface, and if so, which artifact owns that policy so `/inspect` and `/app-api` cannot diverge?

## 6. Readiness verdict

The core product direction is strong and worth pursuing, but the current Draft has unresolved correctness, disclosure, safety, and phasing blockers. These require design amendments, not implementation completion.

Verdict: NOT READY
## Round 9 — 2026-07-17

**Revision under review:** `llp/0062-generated-app-cli-and-code-mode.rfc.md`, sha256 `96955c32c4cc4b017093e9ffd2d57fcdda40ef221ec45ad65e1ad635b8e379da` (untracked file at repo HEAD `471fe33`; round-8 revision)
**Runtime detail:** codex exec, OpenAI Codex CLI v0.144.5, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, session id 019f702f-786b-73b2-b9fe-24ae6522e3e6; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

I verified the reviewed file’s SHA-256 is `96955c32c4cc4b017093e9ffd2d57fcdda40ef221ec45ad65e1ad635b8e379da`, exactly matching the requested revision. Repository HEAD was `471fe33`, and the RFC was new/untracked.

The proposal has an excellent core idea: one generic engine consuming source-stripped, generated app metadata is substantially better than generating executable CLIs per app. The RFC is unusually candid about security boundaries, compatibility, authority, and uncertain write outcomes.

It is not ready for acceptance, however. Several load-bearing contracts remain contradictory or incomplete: shared result ownership, complete artifact correspondence, one-half provisioning, authenticated local server identity, credential rotation, token-cap accounting, diagnostic forward compatibility, and cross-repository Ibex sequencing. These are design gaps, not missing implementation.

## 2. Strengths (with section citations)

- **The fundamental architecture is sound.** Treating generated artifacts as data and refusing to execute served `api.mjs` avoids turning code generation into a remote-code-execution channel (LLP 0062 §Summary, §1). The current generated `api.mjs` is indeed inert descriptor data, while the full function manifest can contain handler source; reusing Rust’s exhaustive `PublicFunctionManifest` projection is the correct disclosure boundary.

- **The app-data/operator-plane separation is well preserved.** The RFC explicitly excludes admin credentials, ambient `SNAPBACK_ADMIN_TOKEN`, and host-ops `function.run` from the app CLI (LLP 0062 §Position among existing surfaces). This addresses a real hazard in the current headless client, which otherwise reads `SNAPBACK_ADMIN_TOKEN` from the environment.

- **Artifact publication is thoughtfully designed.** Stable function IDs, exact public-projection equality, JCS canonicalization, content addressing, independent operation-schema digests, generation assertions, strong validators, immutable caching, and `no-store` negative responses form a coherent integrity story (LLP 0062 §1, §5). The proposed app-data placement beside `/inspect` also fits LLP 0031’s route taxonomy and the current server registry.

- **The authority projection largely matches the implementation.** Anonymous is the default; anonymous reaches `public` and `optional-user`, while `authenticated` requires user-carrying authority; dev impersonation remains dev-only; and agent authority stays grant-scoped and server-derived (LLP 0062 §4). These claims agree with `AuthRequirement`, `ResolvedAppAuthority`, and the invocation gate in `src/auth/invocation.rs`.

- **Code mode is honest about its boundary.** The parent/child design materially reduces accidental bearer disclosure without claiming that Node’s process or VM mechanisms contain hostile code (LLP 0062 §3). The strict value profile, bounded IPC, terminal-state ordering, audit-field allowlist, and host-portable acceptance suite are all strong choices.

- **Write uncertainty and live-query behavior receive first-class treatment.** Durable mutation IDs, explicit replay, authority/generation binding, no automatic write retry, JCS snapshot deduplication, and named resynchronization gaps are much stronger than the usual CLI treatment of transport failure (LLP 0062 §2).

- **The RFC correctly identifies current implementation seams.** The existing headless client buffers complete HTTP bodies, follows redirects by default, drops some non-success attribution, and keeps several app-data capabilities in demo code. The RFC names the required lift and hardening rather than assuming those properties already exist (LLP 0062 §2, §4, §6).

- **Acceptance coverage is unusually comprehensive.** It spans tuple skew, disclosure sentinels, generation races, malformed framing, write uncertainty, auth combinations, JCS cross-language agreement, credential non-transmission, and code-host behavior (LLP 0062 §7).

## 3. Concerns (each numbered, with severity major/minor/nit, concrete evidence, and explicit resolution criteria)

1. **Major — The shared result contract and its owner are contradictory.**

   **Evidence:** LLP 0062 §Position says there is “one result envelope, shared,” and §2 says `appCliCallResult` is the canonical app-data profile and “never a CLI-only schema.” Section 5 then assigns “the call-result presentation” to the engine as a genuinely client-only DTO. LLP 0019 and LLP 0024 describe one result schema across HTTP, CLI, and MCP, while LLP 0037 says a DTO parsed or emitted by the server belongs to Rust.

   It is therefore unclear whether HTTP, headless, MCP, and CLI share an identical serialized DTO, share only semantic fields under different wrappers, or use a Rust-owned core inside an engine-owned `appCliCallResult`.

   **Resolution criteria:** Choose one model and state it normatively. Identify the exact shared DTO and owner, say whether each projection serializes it identically, and define any wrapper-to-core mapping. If `appCliCallResult` is engine-specific, remove the claims that it is the one shared envelope and make parity tests distinguish semantic-core parity from wrapper identity.

2. **Major — The artifact graph is not completely bound to an independent trust root.**

   **Evidence:** Section 5 independently binds operation schemas to the activated function artifact through stable-ID digests, but declaration files are only checked against a permitted grammar or structure. A provisioner can substitute a grammatically valid but semantically unrelated `api.d.ts` or `code-mode.d.ts`, recompute the envelope hash, and satisfy the described admission checks.

   The local stage-(a) path has a related gap. The current `artifacts.json` lists filenames but not member digests, and `functions.manifest.json` has no argument-schema digest map. The RFC introduces that map for server activation but never explicitly requires the local loader to verify it. Consequently, stale or swapped local operation schemas could validate or reject arguments under an otherwise matching app/bundle tuple.

   **Resolution criteria:** Define a complete correspondence root for both local and served artifacts. The local loader must verify every operation schema and declaration member before help, introspection, typing, or invocation. Declaration semantics must either be derived from independently authenticated structured metadata or checked against that metadata, not merely grammar-validated. Add local and served tests for swapped schemas and declarations with all envelope-local hashes recomputed.

3. **Major — Envelope behavior for permitted one-half provisioning updates is unspecified.**

   **Evidence:** LLP 0012 explicitly permits later schema-only or function-only provisioning, using the loaded attested sibling to complete the pair. `api.d.ts`, operation schemas, and the envelope identity depend on that completed pair. LLP 0062 says envelope activation is atomic with the function-manifest swap, but does not say what happens when only the schema changes, only functions change, or an older provisioner omits the new envelope field.

   Retaining the old envelope would serve stale declarations or schemas. Dropping it silently would disable network use. Neither behavior is selected.

   **Resolution criteria:** Specify that every effectful v1-sessions update atomically activates either:

   - a newly correspondence-checked envelope for the completed candidate pair, or
   - an explicit envelope-absent generation under a named backward-compatibility rule.

   An envelope for either replaced half must never survive as current. Acceptance must cover schema-only, function-only, rollback, restart, and legacy-provisioner cases.

4. **Major — Literal loopback does not authenticate the server before the long-lived agent credential is disclosed.**

   **Evidence:** Section 4 requires literal `127.0.0.1` or `[::1]`, direct transport, connected-peer verification, disabled proxies, and terminal redirects. These checks prove locality, not server identity. The engine then sends the long-lived `sbac_` to lifecycle routes before the later server-derived authority handshake can protect anything.

   Another local OS user or process can bind the configured unprivileged port while the legitimate server is stopped or restarting, reproduce public discovery metadata, and receive the credential-bearing mint or pairing request. LLP 0060 explicitly says loopback proves nothing beyond listener locality. LLP 0055’s custody contract, meanwhile, claims protection against other OS users, excluding only malicious processes already running as the same effective user.

   **Resolution criteria:** Before presenting `sbac_`, bind the target to an authenticated local server identity. Acceptable designs include a Unix-domain socket with verified peer credentials and a protected endpoint record, or a pinned server key with a signed challenge. Specify restart/key-roll behavior and test a hostile listener occupying the configured loopback port. Alternatively, explicitly weaken the threat model to trust every loopback listener and reconcile that decision with LLP 0055’s cross-user custody guarantee.

5. **Major — Credential-family rotation cannot satisfy the promised watch resynchronization semantics.**

   **Evidence:** Section 2 says a watch resynchronizes “under the new” credential generation, and §7 requires a mid-watch rotation test. The current rotation implementation returns the sole successor secret to the caller while immediately invalidating the predecessor generation and its tokens. The RFC provides no `rotate` command or protocol by which an already-running watch obtains that successor.

   A credential referenced through an environment variable cannot change inside the running process. A file-backed reference could change, but no secure notification, reread, replacement, or lost-rotation-response protocol is specified.

   **Resolution criteria:** Either define credential-family rotation as terminal for watches, or specify the complete successor-adoption workflow: who performs rotation, how the process obtains the successor, secure atomic store replacement, file notification or polling, behavior for environment-backed sources, bounded waiting, new token minting, re-attestation, fence replacement, and lost-response recovery.

6. **Major — The token-cap guarantee lacks crash and reconciliation semantics.**

   **Evidence:** Section 4 promises accounting of unexpired tokens and bounded admission that will not silently evict a participating sibling. Current storage caps a grant at ten live tokens and evicts the oldest on mint. The RFC adds clean-end exact-token release and says tokens are never persisted, but does not explain how admission state remains accurate when a process is killed after minting and before release.

   Pairing also returns a first live scoped token, while the RFC says `pair` persists only the grant ID and does not define whether that token is adopted or immediately released. Current pairing token IDs include a pairing-request prefix, whereas `AgentAuthorityFence` currently requires canonical UUIDv7 token IDs.

   **Resolution criteria:** Pin a crash-safe, non-secret reservation/reconciliation model—or weaken the no-sibling-eviction claim. Define release authorization, exact-token isolation, idempotency, lost-response behavior, and the pairing token’s disposition. Add kill-after-mint, failed-release retry, concurrent-watch, stale-reservation, and pairing-token tests.

7. **Major — Diagnostic forward-skew rules conflict.**

   **Evidence:** Section 2 requires preservation of server diagnostic codes. Section 3 says audit codes are validated against a registered vocabulary. Section 5 says there are exactly two compatibility gates: artifact tuple and engine-owned DTO version. LLP 0012 explicitly permits diagnostic code names to grow additively without a tuple change, and the current `PublicDiagnostic.code` and `subsystem` fields are strings rather than closed enums.

   A newer compatible server can therefore emit a code unknown to an older engine. The engine cannot simultaneously reject it as outside its vocabulary, preserve it, and claim that diagnostic vocabulary is not a third compatibility gate.

   **Resolution criteria:** Specify forward-skew behavior. A reasonable rule is to accept bounded, syntactically valid unknown codes; preserve `code`, `severity`, and bounded `subsystem`; mark whether the code is recognized; and admit code-specific extra fields only for known codes. An unknown code must not alone cause a version mismatch or be rewritten to a CLI code.

8. **Major — The Ibex corpus still imposes contradictory phase-one sequencing.**

   **Evidence:** LLP 0062 §6 correctly says phase one has no embedded-Ibex dependency and that arbitrary external script ingress conflicts with existing Ibex contracts. Sibling Ibex LLP 0028 nevertheless describes Snapback code mode as executing through embedded Ibex and includes that composition in its acceptance direction. Ibex LLP 0029 says v1 prototypes the Snapback CLI while its executable format permits one embedded entry and expressly forbids eval, REPL, and file-execution ingress.

   LLP 0062 requires only “filing” a correction to Ibex 0028 and does not name the corresponding 0029 correction. Filing does not make the governing corpora coherent.

   **Resolution criteria:** Before LLP 0062 becomes Accepted, land reviewed amendments to both Ibex 0028 and 0029 that remove any phase-one dependency, preserve their current ingress restrictions, and place external script ingress and separate engine/worker authority under a future reviewed phase-two contract.

9. **Minor — Several public compatibility identities remain unresolved or internally unclear.**

   **Evidence:** The final binary name and `/app-api` route spellings remain open questions even though they are public phase-one interfaces. Section 2 says `types --out` materializes `api.d.ts` and `code-mode.d.ts`; §3 says it merges app declarations with engine ambient declarations into a named output. The resulting file topology and import relationship are not clear.

   **Resolution criteria:** Before acceptance, select the route and binary names or define an explicit versioned alias strategy. Pin the exact `types --out` directory contents, filenames, references/imports, and which file the acceptance suite typechecks.

## 4. Suggestions (non-blocking improvements)

- Promote the RFC’s structured declaration IR idea into phase one. Serving canonical typed IR and rendering `.d.ts` locally would make semantic correspondence, compatibility, hazardous-name suppression, and future language bindings substantially easier to verify.

- Consider moving the profile-local token broker from future work into the first agent-capable release. A small same-user Unix-socket broker could centralize long-lived credentials, rotation, mint capacity, and token release while leaving ordinary CLI commands stateless.

- Produce a content-addressed local artifact lock file even for dev mode. Besides closing integrity gaps, it would make bug reports and cached introspection reproducible with one identity.

- Explicitly decide that v1’s advertised app shape is public, rather than leaving the restriction knob open indefinitely. If restriction is later added, define it once for `/inspect`, envelopes, help, and generated MCP catalogs.

- Add property-based tests around artifact-member permutation, duplicate JSON keys, JCS number boundaries, declaration grammar, and diagnostic forward skew. These are especially suitable for generative testing.

- Keep the proposed guide capability row and route-map changes in the same landing change. The current capability index does not yet contain `clients.app-cli`, but the RFC correctly treats that as a landing obligation rather than pretending the capability already exists.

## 5. Open questions

- What authenticated local endpoint identity will protect `sbac_` before any lifecycle request is sent?
- Is the canonical app-data result a single serialized DTO, a shared semantic core, or a family of projection-specific wrappers?
- What independent artifact binds both declaration semantics and local operation schemas to the activated schema/function pair?
- What is the exact envelope transition rule for schema-only, function-only, rollback, and legacy-provisioner updates?
- Can watches recover from credential rotation for every supported credential source, or should rotation be terminal?
- How does same-host token admission reconcile cleanly after process death, lost release responses, and pairing-created tokens?
- How are unknown future server diagnostic codes preserved without creating a third compatibility gate?
- What are the final binary name, route names, and `types --out` file topology?
- Should v1 explicitly commit to public schema/declaration disclosure, with surface restriction deferred to a later compatibility event?
- Which document permanently owns the shared app-data invocation/result core after the initial LLP 0024 amendment?

## 6. Readiness verdict

The architectural direction is strong, but the unresolved issues above affect security, artifact correctness, provisioning atomicity, authority continuity, and cross-document coherence. They must be resolved at the design level before implementation can reliably target the contract.

Verdict: NOT READY
## Round 10 — 2026-07-17

**Revision under review:** `llp/0062-generated-app-cli-and-code-mode.rfc.md`, sha256 `3827d1452f3c2e8f8e4b70f5e5f16f40eae038337419ea3d351ddab0768b27b6` (untracked file at repo HEAD `471fe33`; round-9 revision)
**Runtime detail:** codex exec, OpenAI Codex CLI v0.144.5, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, session id 019f70ec-c16e-7120-bf05-4131b07c85e6; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Brief noted the two recorded author decisions (loopback trust; filed ibex amendments) as decisions to evaluate for honesty/coherence per LLP 0005; the review found both "represented honestly."
**Verdict:** NOT READY

**Orchestrator disposition (author decision, LLP 0005):** After this round the author-approved exit criterion applied — ten rounds completed, the Claude-family reviewer READY for six consecutive revisions, the GPT/Codex-family reviewer finding a new stratum of majors each round. Per the author's recorded decision (2026-07-17), the document moves Draft → Review with this round's concerns carried as named amendment-phase residue in `issues/20260717-app-cli-review-residue.md`; they are inputs to the dated LLP 0012/0024/0043/0055/0058 amendments and the frozen phase-1 deliverables, not silently dropped.

### Review body (verbatim)

# 1. Overall assessment

I verified the revision before reviewing it: `shasum -a 256 llp/0062-generated-app-cli-and-code-mode.rfc.md` returned exactly `3827d1452f3c2e8f8e4b70f5e5f16f40eae038337419ea3d351ddab0768b27b6`. Repository HEAD was `471fe33`, and the RFC was untracked as stated.

I read the entire RFC, the requested Snapback and sibling-Ibex LLPs, and the load-bearing generated artifacts and implementation seams. I did not consult `llp/reviews/` or any secret, credential, custody-data, or token files.

The proposal is a good idea. A generic, generated-artifact-driven application CLI with brokered code mode fits Snapback’s agent-first direction unusually well. The separation between application authority and operator authority is sound; the public-envelope design is substantially safer than executing generated or server-supplied JavaScript; and the RFC is commendably honest about local trust, hosted exclusions, phase boundaries, and future Ibex work.

The plan is nevertheless not ready to implement as written. Several problems are normative design contradictions rather than missing implementation: mutation settlement retention is incomplete, stage (a) cannot obey the final capability rules, declaration ownership and integrity are not fully specified, session-refresh concurrency contradicts the coordinator being reused, and the HTTP digest contract is incorrect for HEAD and transformations. These need resolution before implementation can reliably converge on one behavior.

The two recorded author decisions are represented honestly:

- The accepted loopback-listener trust model names the credential-capture residual and does not overclaim what literal-loopback and peer-address checks prove. I would not have treated this as strong local server authentication, but the RFC does not pretend that it is.
- The Ibex 0028/0029 amendments are accurately described as filed but not landed, non-normative for phase 1, and necessary before standalone packaging. Their current contracts really do conflict with arbitrary runtime script ingress. This is coherent and not a phase-1 blocker.

# 2. Strengths (with section citations)

- The application-plane boundary is correct (§Position). The engine avoids admin authority, ambient `SNAPBACK_ADMIN_TOKEN`, and host-op `function.run`. This agrees with LLP 0024 and the current invocation gate: scoped agent tokens resolve only on generated app-data paths.

- The “data, never program source” decision is strong (§1, §5). Current function manifests embed handler source, while `PublicFunctionManifest` is an exhaustive allowlist projection. Serving that projection plus closed schemas is materially safer than importing `api.mjs`, and the RFC correctly accepts that declarative input still needs resource bounds and structural validation.

- Stable identity and generation binding are well conceived (§1). Stable `appId:exportedName` IDs agree with LLP 0004 and LLP 0012, and the sessions-only expected-envelope assertion offers compatibility for existing clients while closing the old-schema/new-function race for opt-in callers.

- The result and output design is agent-friendly (§2). JSON/JSONL defaults for non-TTY output, stable exit classes, explicit unknown write outcomes, strict-value serialization, and preservation of server diagnostic codes are the right shape for automation. The division between a shared Rust-owned semantic core and an engine-owned presentation wrapper is also consistent with LLP 0019, LLP 0024, and LLP 0037.

- Code mode has an honest boundary (§3). Brokered application calls prevent accidental bearer transmission without claiming a hostile-code sandbox. The RFC explicitly states that a VM escape has the invoking user’s OS authority, including access to user-readable custody files. That is the right security claim.

- The authority model is disciplined (§4). Anonymous is genuinely the default; `auto` is explicit and ambiguity-refusing; dev assertions remain dev-only; sessions remain server-derived; and agent profiles preserve actor/effective-user distinctions. The current Rust code confirms the three-valued `AuthRequirement`, optional-user default, anonymous gate, and `DevImpersonation` behavior.

- The pairing discrepancy is handled properly (§4). The implemented wire does require both `pairingRequestId` and the secret code, and the RFC calls for reconciliation with LLP 0055 rather than silently describing a nonexistent code-only request.

- Target and hosted claims are conservative (§4, §5). The RFC correctly rejects URL/profile inference, treats `app-cli.target` as a structured target-owned descriptor rather than a ninth `TargetCapabilityId`, and keeps hosted delivery out of phase 1. This aligns with LLP 0058’s closed eight-value capability set and LLP 0060’s structured `hostedAuth` precedent.

- Distribution is placed on the right route plane (§5). Root app-data routes beside `/inspect`, rather than `/_snapback/*`, agree with LLP 0031 and remain compatible with LLP 0060’s future public-origin operator-route refusal.

- The acceptance plan is unusually serious (§7). It covers disclosure sentinels, generation races, credential non-transmission, target matrices, canonicalization, resource ceilings, and cross-arm parity. The guide/GAP obligation also correctly follows LLP 0061.

# 3. Concerns

1. **Major — the mutation settlement lifecycle omits the required acknowledgement protocol.**

   Section 2 says every mutation gets a durable `clientMutationId`, persisted “until settled,” and that an unknown result can be replayed. It never says when or how a consumed settlement is acknowledged to the server.

   Existing Snapback semantics require this. LLP 0043 defines standalone and piggyback acknowledgement; `MutationRequest` already carries `acknowledgedClientMutationIds`; `/client-mutations/acknowledge` exists; and `src/storage.rs:961–971` permits reclamation only after the client has durably removed the ID from its replay queue. The server has bounded record/byte caps and returns `SNAPBACK_CLIENT_MUTATION_RETENTION_FULL` when settlements are never acknowledged (`src/storage.rs:9251–9267`).

   Either naive ordering is unsafe:

   - Never acknowledge, and normal CLI usage eventually exhausts retention.
   - Acknowledge before durable local consumption/removal, and a crash can destroy the only settlement proof while leaving a replayable local ID.

   Deployment recovery is also underspecified. Current mutation paths authorize and select the current function before settlement lookup (`src/local.rs:4938–4986, 5301–5328`). If the function has been removed or renamed, `--accept-new-generation` cannot recover an already committed result. Section 7 merely names “commit-then-deploy obstructing replay” without pinning the terminal outcome.

   **Resolution criteria:** Add LLP 0043 to `Related` and explicitly adopt or amend its protocol. Define a durable client state machine—at minimum pending, settlement-received, durably consumed, acknowledgement-pending, acknowledged/removed—and pin fsync, stdout/result publication, standalone/piggyback ACK, retry, and crash ordering. Unknown outcomes must not be acknowledged. Specify whether removed/renamed-function settlements remain resolvable through a non-executing authority-bound settlement endpoint or become permanently unknown with a pinned exit/outcome. Add crash-point, ACK-loss, retention-pressure, and deploy/removal acceptance cases.

2. **Major — independently releasable stage (a) contradicts the capability-absent rule.**

   Sections 2 and 4 require the engine to refuse locally when the selected principal class is absent from `app-cli.target`, and §4 explicitly says eligibility is never inferred from URL, profile ID, tuple, or correlated capability fields. Yet §6 makes stage (a) independently releasable against unchanged local-dev servers, permits anonymous and dev calls, and delays `app-cli.target` plus its `/inspect` emission until stage (b). Current `CapabilityManifest` has no such descriptor.

   Therefore stage (a) must either:

   - treat the unchanged local target as capability-absent and refuse every call it exists to make; or
   - infer eligibility from older fields, contrary to §4 and with different behavior once stage (b) lands.

   Calling stage (a)’s contracts “already final” makes a temporary compatibility interpretation unavailable unless it is explicitly versioned.

   **Resolution criteria:** Move the structured descriptor and local `/inspect` emission into stage (a), or stop treating stage (a) as an independently releasable final-contract engine. The amendment should pin the exact top-level field name, descriptor version, closed values, and fail-closed absent-field behavior; it should not call the descriptor an “id” unless a descriptor registry is actually introduced.

3. **Major — declaration ownership, naming, and independent integrity are incomplete.**

   There are two related contradictions.

   First, `code-mode.d.ts` names two different byte products:

   - §2 defines it as the locally materialized merge of engine ambient declarations plus app bindings.
   - §3 says those are physically distinct inputs and nothing engine-owned rides the envelope.
   - §5 says the envelope itself contains `code-mode.d.ts`.

   Second, §§1 and 5 place operation-schema and declaration-member digests in the function artifact, keyed by stable function ID. But current `api.d.ts` is jointly generated from functions and schema. It contains app-wide declarations such as `GeneratedDataModel`, shared `Id`/reference interfaces, permissions, memberships, contexts, and ephemeral types. Those bytes have no function stable ID and change during schema-only updates. A zero-function application still has such declarations.

   This breaks the promised independent trust root and half-update story: an envelope hash proves internal integrity, but a provisioner can recompute it after swapping an app-wide declaration; the unchanged function artifact cannot attest schema-owned bytes during a schema-only update.

   **Resolution criteria:** Give the app-only envelope binding and merged local output distinct names and DTO roles—for example, `code-mode.bindings.d.ts` versus `code-mode.d.ts`. Partition declaration ownership exactly: schema/app-global leaves must be attested by the schema artifact, while operation schemas and callable bindings may be attested by function stable ID. Pin member segmentation and exact hashed bytes. Add zero-function, schema-only, function-only, and forged table/shared-declaration cases in which all envelope-local hashes have been recomputed.

4. **Major — the claimed cross-process session-refresh serialization is not supplied by the reused coordinator.**

   Section 4 says concurrent process-per-command invocations serialize refresh under the filesystem store’s advisory lock so a raced refresh cannot trigger the family alarm.

   The current `AuthCoordinator.withCredentialRotation` deliberately releases storage ownership before performing network refresh (`packages/snapback-contract/auth-coordinator.mjs:1100–1135`), following LLP 0059’s rule that network I/O does not run under the custody lock. Its test explicitly proves that both competing refresh callbacks run and that final CAS rejects the loser (`auth-coordinator.test.mjs:1356–1395`). A new filesystem storage adapter cannot change that coordinator-level ordering by itself.

   **Resolution criteria:** Choose and specify one protocol. Either retain existing concurrent refresh plus CAS/supersession semantics, requiring the loser to observe the successor before any family alarm, or design a separate bounded, crash-safe cross-process refresh lease distinct from the custody lock, including fencing, expiry, and lock ordering. Do not claim that the existing advisory lock spans the exchange unless LLP 0059 and the coordinator are intentionally changed.

5. **Major — the HTTP integrity contract is incorrect for HEAD and incomplete for transformations and bodyless responses.**

   Section 5 says the GET envelope route automatically answers HEAD, while `Content-Digest` covers the transmitted body. The route registry confirms that every registered GET accepts HEAD (`src/server.rs:4994–4999`).

   `Content-Digest` is defined over actual message content, and RFC 9530’s HEAD example computes it over the empty body; `Repr-Digest` is the field that can identify the selected GET representation on HEAD. [RFC 9530 §2](https://www.rfc-editor.org/rfc/rfc9530.html#section-2), [RFC 9530 Appendix B.2](https://www.rfc-editor.org/rfc/rfc9530.html#appendix-B.2). Reusing the GET body digest after Axum strips the HEAD body would therefore be wrong. The acceptance text also promises conditional requests without defining digest behavior for bodyless 304 responses.

   The pinned response directive, `public, max-age=31536000, immutable`, also lacks `no-transform`. Without it, an intermediary may legitimately transform content even though this protocol requires canonical identity-coded bytes. [RFC 9111 §5.2.2.6](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.6).

   **Resolution criteria:** Pin a method/status matrix for GET 200, HEAD 200, 304, OPTIONS, and errors. GET 200 may carry `Content-Digest` over its canonical bytes; HEAD should omit it or use the empty-content digest and optionally carry `Repr-Digest`; bodyless responses must not retain a digest for nonexistent content. Add response `no-transform`, require the engine to request identity encoding and reject unexpected content coding, and test HEAD, 304, and an intermediary attempting transformation.

6. **Minor — hazardous alias suppression contradicts authoring and admission rules.**

   Section 3 says invalid identifiers and engine-reserved names merely lose their property alias and remain callable through `snapback.function(id)`. Section 7 instead requires authoring-invalid and reserved names to be rejected by codegen and forged-envelope admission. Current codegen rejects them (`packages/snapback-codegen/index.mjs:925–963`).

   **Resolution criteria:** Restrict alias-only suppression to names that are valid app exports but hazardous as object/thenable properties, such as `then`, `constructor`, and `__proto__`. Keep syntactically invalid and authoring-reserved exports invalid throughout codegen, admission, and documentation.

7. **Minor — session login-code custody is not pinned.**

   The agent pairing code receives explicit hidden-prompt/stdin/secure-file rules and an argv prohibition. `login` merely says it drives `authRequestCode`/`authExchange`. LLP 0057 classifies the exchange code as secret material, but §7’s planted-secret cases name pairing codes and not session codes.

   **Resolution criteria:** Pin accepted challenge-code channels, forbid literal argv/environment input, make redirects terminal for request-code/exchange, and add code/address redaction and no-second-hop sentinels.

8. **Minor — unknown diagnostic codes lack a frozen exit fallback.**

   Section 3 correctly accepts bounded unknown server diagnostic codes under forward skew and forbids mapping them to exit 8. The frozen exit table does not say how an unknown code maps when it arrives inside an HTTP-200 action/function envelope rather than through a classifiable HTTP status.

   **Resolution criteria:** Define a stable fallback based on wire locus and result kind, preserve the unknown server code, and add future-code fixtures for ordinary non-2xx responses, action `ok: false`, live terminal frames, and brokered errors.

# 4. Suggestions (non-blocking improvements)

- Split this 1,520-line RFC into an umbrella decision plus independently reviewable contracts for artifact distribution/generation binding, CLI/auth/result semantics, and code mode. LLP 0005 specifically recommends directory form when a large RFC contains independently timed subtopics; this RFC’s three stages meet that condition.

- Prefer a canonical structured declaration IR over publicly transported `.d.ts` source. The engine could render both app-only and merged files locally. A Merkle-like envelope manifest, with schema and function artifacts independently attesting their owned leaves, would solve the current ownership problem and make eventual Ibex portability cleaner.

- Pin the child spawn contract even though it is not presently a blocker: minimal scrubbed environment, `NODE_OPTIONS` removed, proxy and credential variables absent, only framed stdio plus one broker descriptor inherited, and all other descriptors closed. Add an inherited-FD sentinel.

- For Ibex phase 2, preserve LLP 0029’s one compiled parent entry and put arbitrary source in a separately armed worker/process that receives only broker IPC. This makes LLP 0013’s hostile-code isolation boundary more literal than evaluating arbitrary source inside the credential-owning compiled process.

- Add the promised `clients.app-cli` GAP row when this RFC lands. Decide whether the guide vocabulary gains a `remote-service` target or whether the eventual page is an `all` page with an explicit partial target matrix.

- Tighten two pieces of copy: `max-age=31536000` is one year of freshness, not literally “cacheable forever,” and the Cloudflare gateway exposes more public routes than its capability manifest; the relevant claim is simply that it has no `/app-api` envelope routes.

# 5. Open questions

- What constitutes durable consumption for a process-per-command CLI: successful full stdout write, a locally journaled result, or an explicit user acknowledgement?

- Must a committed settlement remain recoverable after its function is removed or renamed? If so, what non-executing authority check replaces current-function lookup?

- Is independently releasing stage (a) valuable enough to justify moving the target descriptor earlier, or should stage (a) remain an internal landing step?

- Should declarations remain validated text, or should phase 1 adopt structured IR and render `.d.ts` locally?

- Should refresh races retain the existing concurrent-request/CAS model, or is a separate cross-process refresh lease worth its additional failure modes?

- What is the exact `app-cli.target` field name, version, absent default, and distinction between static target capacity and runtime availability?

- Does phase 1 intentionally make all schema and argument shapes public, or should the RFC resolve its open advertised-surface restriction before freezing the envelope?

- What stable exit class should an older engine use for a syntactically valid but unknown server diagnostic in each wire locus?

# 6. Readiness verdict

The proposal’s direction is strong, but the unresolved mutation, staging, declaration-integrity, refresh-concurrency, and HTTP-contract concerns are material correctness and feasibility issues. They must be resolved before the RFC is ready to implement against.

Verdict: NOT READY