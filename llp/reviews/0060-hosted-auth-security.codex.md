**Reviewer family:** GPT (OpenAI Codex)
**Provider / runtime:** OpenAI Codex CLI v0.144.4 (`codex exec`, non-interactive), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, workdir = repo root, session id 019f62c9-0711-7e22-ba50-e399c26192ad; 373,291 tokens used. Orchestrated by the ENG-24996 cross-family review gate (LLP 0005 review loop via /llp-review).
**Date:** 2026-07-14
**Redacted:** no redaction applied — no secrets in the reviewed material; reviewer instructed not to read `.agent-local-secrets.md`, credential files, or `llp/reviews/`, and not to quote secret material. Sending repository content to OpenAI was authorized by the human-directed ENG-24996 review-gate assignment.
**Method:** cli-runner — fresh session, blind to all archived reviews. The brief identified the document as a mixed RFC (ENG-24607) — part landed local enforcement/claim-honesty boundary, part deliberately-unbuilt hosted/browser-v2 future — and directed the reviewer at spec-vs-code fidelity for the implemented boundary and soundness of the pinned future contract, with MATERIAL/MINOR/EDITORIAL severities.

# LLP 0060 reviews — GPT family

## Round 1 — 2026-07-14

**Reviewed:** `llp/0060-hosted-auth-security.rfc.md`, sha256 `09eb415d0d95d269bba792f916aca9ee7403d6386f28412a5b9ad57cca80cfef` (committed at repo HEAD `fdfdd94`).
**Verdict:** NOT READY

### Review summary

## Overall assessment

The proposal has the right decomposition and an unusually honest distinction between landed controls and future hosted guarantees. The normal CLI plaintext fence, negative capability reporting, coordinated credential projections, and CSP baseline are substantially faithful to the shipped implementation.

It is not ready for ratification, however. Several central implemented claims are false at public composition boundaries: an unknown detached bind is treated as loopback, the public client retains a coordinator-less bearer path, resumed tabs lack the required lifecycle gate, and ambiguous logout failures retain predecessor custody. The future hosted conjunction also omits frozen LLP 0039 requirements and can become positive without direct-origin protection, shared auth-state linearization, fleet-safe failure handling, or sender-binding delegated connection credentials. These are core security-contract defects, not merely missing wire-format detail.

## Strengths

- The implemented/future split is admirably explicit: the document disclaims hosted TLS, trusted source derivation, shared throttling, replica convergence, and sender-constrained credentials while limiting current evidence to the local boundary (`llp/0060-hosted-auth-security.rfc.md:47-54`, `llp/0060-hosted-auth-security.rfc.md:516-535`).

- The ordinary CLI D1 path is faithful and well ordered. It resolves one bind IP, rejects unsupported hosted composition before database-path preparation, validates desired or active sessions before listener creation, and gives session posture precedence over the dev override (`src/cli.rs:1294-1310`, `src/cli.rs:1581-1586`, `src/cli.rs:1681-1687`, `src/admin.rs:121-145`). Middleware runs its refusal before credential/body processing, with bearer-sentinel coverage for both active and desired sessions (`src/server.rs:5205-5250`, `src/server.rs:15487-15555`).

- The capability mechanism is a strong fail-closed foundation. The five fields are closed, local facts are explicitly negative, four- and five-axis derivations are mechanical, public blockers are name-only, and all 32 combinations are tested (`src/auth/deployment.rs:89-169`, `src/auth/deployment.rs:201-237`). The standalone generated schema requires all five fields and rejects unknown fields and values (`schemas/auth.hosted-capabilities.schema.json:40-69`, `tests/artifact_schemas_v0.rs:706-720`).

- Within the coordinator-backed path, custody is well constructed: the durable record is closed and phase-checked, ordinary views omit the bearer, the narrow transport accessor exposes it only against a current capture, and wakeups contain revision metadata rather than credentials (`packages/snapback-contract/auth-coordinator.mjs:223-298`, `packages/snapback-contract/auth-coordinator.mjs:514-537`, `packages/snapback-contract/auth-coordinator.mjs:1150-1204`). Exchange, refresh, and known-success logout paths use closed projections and captured-authority fencing (`demos/_kit/client.mjs:1541-1668`).

- C2 correctly refuses to equate browser defenses with an XSS boundary. The implementation supplies restrictive headers, exact inline-script hashes, Trusted Types, and response-specific CSP preservation, with tests hashing the bytes actually served (`src/server.rs:4062-4144`, `src/server.rs:15608-15712`).

- The local reverse-proxy limitation is accurately stated and agrees with the governing runtime-security RFC: loopback proves only the local bind, not the public edge (`llp/0060-hosted-auth-security.rfc.md:152-156`, `llp/0009-code-execution-security.rfc.md:66-79`).

## Concerns

1. **MATERIAL — Detached embedded routers fail open when the bind is unknown.**

The RFC says middleware repeats D1 for embedded composition (`llp/0060-hosted-auth-security.rfc.md:129-138`, `llp/0060-hosted-auth-security.rfc.md:441-442`). In code, `ServerContext::detached()` represents an unknown bind as `loopback: true`; `AppState::detached()` installs that context, public builders can select sessions posture, and public `server::app()` returns a serveable router (`src/admin.rs:456-464`, `src/admin.rs:1167-1195`, `src/admin.rs:1226-1228`, `src/server.rs:6864-6872`). The middleware trusts only the stored boolean (`src/server.rs:4406-4412`).

LLP 0017 asserts detached routers are not HTTP-served, but neither the type nor API enforces that assertion (`llp/0017-admin-console-inspection-surface.rfc.md:550-554`). An embedder can therefore place a detached sessions router on a non-loopback listener while the claimed defense-in-depth path sees loopback.

*Resolves with:* Represent bind posture as `Unknown | Loopback | NonLoopback`, with `Unknown` failing closed for desired or active sessions, or require a validated-bind capability before a serveable router can be produced. Preserve a separately named test-only loopback constructor and add an unknown/non-loopback embedding regression.

2. **MATERIAL — `AuthCoordinator` is not the sole browser session-custody path.**

C1 says the coordinator is the sole custody authority (`llp/0060-hosted-auth-security.rfc.md:273-280`). `SnapbackClient`, however, publicly accepts and stores a standalone `bearerToken`, implements an uncoordinated session path, and permits direct local replacement through `setBearerToken()` (`demos/_kit/client.mjs:775-793`, `demos/_kit/client.mjs:885-918`). Sessions-mode tests exercise this path deliberately (`demos/_kit/tests/auth-handshake.mjs:149-165`).

That also contradicts the sibling contract that the kit keeps no independent current-auth notion and no longer treats `setBearerToken` as a local swap (`llp/0059-session-projection-and-client-barrier.spec.md:1050-1057`, `llp/0059-session-projection-and-client-barrier.spec.md:1560-1564`).

*Resolves with:* Require coordinator custody for browser/session-mode clients. If raw bearer injection remains necessary for headless compatibility, separate it into an explicitly non-browser profile or client type that cannot satisfy the browser-custody or hosted-readiness capability.

3. **MATERIAL — The required resumed-tab exposure gate is not wired.**

LLP 0059 requires a durable custody reload on `pageshow`, transition to visible, focus, and before the first resumed publication, specifically so a suspended context blanks before exposing predecessor state (`llp/0059-session-projection-and-client-barrier.spec.md:1251-1265`, `llp/0059-session-projection-and-client-barrier.spec.md:1813-1816`).

The shipped coordinator constructor wires only a `BroadcastChannel` and storage hint; it accepts no lifecycle source and installs no corresponding gate (`packages/snapback-contract/auth-coordinator.mjs:462-483`). Its missed-wakeup test proves recovery only by manually calling `restoreOffline()` (`packages/snapback-contract/auth-coordinator.test.mjs:480-518`). Online requests synchronize custody (`demos/_kit/client.mjs:1297-1367`), but that does not fence an already-restored render, callback, or live publication before its first request.

*Resolves with:* Wire `pageshow`, visibility, and focus through one fail-closed resume barrier, and make every Contract publication boundary await or compare against that reload. Add a browser test that freezes peer B, transitions in peer A, drops all wakeups, resumes B, and proves blanking precedes every callback, render, reconnect, and app operation.

4. **MATERIAL — Ambiguous logout transport failures retain predecessor custody.**

The document closes the known-2xx/body-read ambiguity (`llp/0060-hosted-auth-security.rfc.md:300-307`), but fetch rejection, response loss before status, and non-2xx responses throw before `compareAndClear()` executes (`demos/_kit/client.mjs:1432-1510`, `demos/_kit/client.mjs:1639-1668`). Existing tests cover known successful-status variants, not a committed server logout whose response disappears before a status is observed (`demos/_kit/tests/auth-coordinator-client.mjs:446-550`).

That permits the UI to retain predecessor state after a user-initiated logout may already have committed, contrary to frozen LLP 0039’s authenticated-to-anonymous barrier before control returns (`llp/0039-auth-vertical-slice.rfc.md:1068-1074`).

*Resolves with:* Pin user-initiated logout as a local compare-clear regardless of remote outcome, while returning a typed “server revocation unconfirmed” result when appropriate. The captured-authority CAS must continue preserving any peer-installed successor.

5. **MATERIAL — The hosted readiness conjunction omits frozen LLP 0039’s must-understand deployment gate.**

Frozen LLP 0039 requires a coordinator-to-handler invocation marker, pre-execution refusal of absent, unknown, or session-unaware markers, handler-first deployment and rollback traces, and sessions preflight before initial metadata DDL (`llp/0039-auth-vertical-slice.rfc.md:1626-1639`, `llp/0039-auth-vertical-slice.rfc.md:1785-1792`). LLP 0058 explicitly delegates that hosted contract to LLP 0060 (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:82-86`).

LLP 0060 claims ownership of hosted readiness, but neither D1–D5 nor the five-axis descriptor contains this prerequisite (`llp/0060-hosted-auth-security.rfc.md:61-82`, `llp/0060-hosted-auth-security.rfc.md:231-269`). The shipped “must-understand” check is only the local deployment request versus target capabilities (`src/auth/deployment.rs:185-195`), not the frozen coordinator/handler skew protocol. A future target could therefore advertise every current axis while retaining the empty-auth mixed-version hole.

*Resolves with:* Add the exact marker/version/refusal/pre-mutation contract and its deploy, activation-delay, rollback, and stale-worker tests, or make a reviewed implementing Spec for that protocol an explicit hard prerequisite to every positive hosted-readiness result.

6. **MATERIAL — D2 does not close direct-origin or first-contact downgrade paths.**

The threat model includes a caller reaching the app server directly and an active intermediary (`llp/0060-hosted-auth-security.rfc.md:88-96`). D2 constrains when forwarding metadata may be trusted, but it never requires the origin itself to be inaccessible or edge-authenticated (`llp/0060-hosted-auth-security.rfc.md:165-179`). A direct caller can omit forwarding headers and submit credentials to the plaintext origin; acceptance proves only that it cannot forge trusted metadata (`llp/0060-hosted-auth-security.rfc.md:454-458`).

D2 also permits an HTTP redirect under an active-intermediary threat (`llp/0060-hosted-auth-security.rfc.md:160-163`). An unauthenticated first redirect can be stripped or replaced, so it cannot establish an enforced browser-to-edge HTTPS posture.

*Resolves with:* Require target-attested origin isolation or an authenticated edge-to-origin binding such as mTLS/provider identity, and reject credential-bearing traffic from every untrusted immediate peer. Pin HTTPS-only application and credential bootstrap plus an explicit HSTS/first-contact position; retain HTTP redirect only as a credential-free convenience endpoint.

7. **MATERIAL — Hosted readiness lacks cross-replica auth-state linearization.**

The threat permits exchange, refresh, and connection-open requests to be distributed across replicas (`llp/0060-hosted-auth-security.rfc.md:92-96`), but D3 governs throttling and D4 governs invalidation; neither requires one serializable provider/session authority (`llp/0060-hosted-auth-security.rfc.md:185-229`).

The governing provider protocol depends on challenge consumption and session issuance sharing one transaction, allowing at most one concurrent exchange success, and on refresh rotation having one commit linearization point (`llp/0057-auth-provider-protocol.spec.md:562-589`, `llp/0057-auth-provider-protocol.spec.md:634-652`). A target with replica-local auth state and later invalidation could satisfy the named axes yet double-consume a challenge or race two refresh successors.

*Resolves with:* Require one authoritative serializable auth state machine, or an equivalent sharding/routing protocol with exclusive key ownership and fail-closed failover. Add cross-replica races for challenge supersession, exchange consumption, refresh, logout, family alarm, session caps, and connection-grant minting.

8. **MATERIAL — D3 and D4’s failure policies are not fleet-wide fail-closed contracts.**

D3 permits a “sharply bounded local emergency budget” when shared limiting fails (`llp/0060-hosted-auth-security.rfc.md:197-202`). A per-replica budget multiplies across autoscaling, restarts, and attacker-directed replica spraying—the exact threat at `llp/0060-hosted-auth-security.rfc.md:92-96`.

D4 refuses only while a replica “knows” it is behind (`llp/0060-hosted-auth-security.rfc.md:220-225`). A consumer partitioned before a logout can continue from an apparently current local head because it never learns that a newer head exists.

Finally, one ordered transport stream cannot replace LLP 0053’s level-triggered semantics: delivery and authorization-event obligations are distinct, revisions compare only within one scope, and discharge requires the current full scope/revision/witness (`llp/0053-authorization-invalidation.rfc.md:211-223`, `llp/0053-authorization-invalidation.rfc.md:720-733`, `llp/0053-authorization-invalidation.rfc.md:820-844`).

*Resolves with:* Use fail-closed limiting or pre-issued, expiring, non-refillable quota leases whose fleet aggregate is bounded. Require an authenticated head/heartbeat serving lease with a maximum age, refusing admission and drains when freshness is unknown. Specify the global log as a cause/watermark transport that preserves LLP 0053’s per-scope obligations rather than replacing them.

9. **MATERIAL — Sender-constrained v2 leaves delegated connection credentials replayable.**

C3 binds access and refresh-family state and asks for proof on protected requests and connection open (`llp/0060-hosted-auth-security.rfc.md:375-389`), then claims copied-token replay prevention (`llp/0060-hosted-auth-security.rfc.md:395-399`). Frozen LLP 0039, however, makes the resulting `connectionToken` a delegated bearer presented alone on later operations (`llp/0039-auth-vertical-slice.rfc.md:909-924`).

The shipped v1 client stores that grant and sends only its token through the HTTP header or WebSocket subprotocol (`demos/_kit/client.mjs:1148-1203`, `demos/_kit/client.mjs:2108-2122`, `demos/_kit/client.mjs:4385-4407`). C3 does not require the grant itself to be thumbprint-bound or prove possession at each use. It also says only “bounded replay storage”; replica-local replay caches permit one replay per replica under the stated attacker.

*Resolves with:* Bind the family atomically at exchange, bind every delegated grant to the same key, and require proof at every grant use and WebSocket upgrade—potentially through a one-time proof-minted upgrade ticket. The implementing Spec must also pin shared replay/nonce state, cache-pressure failure, URI canonicalization behind proxies, algorithms, clock skew, key loss/rotation, and downgrade behavior.

10. **MINOR — The return-value non-exposure claim is broader than the implementation.**

C1 and acceptance say ordinary return values never contain a session bearer (`llp/0060-hosted-auth-security.rfc.md:282-283`, `llp/0060-hosted-auth-security.rfc.md:460-464`). Generic successful application JSON is returned unchanged (`demos/_kit/client.mjs:1432-1510`), and the credential test intentionally returns and observes the request bearer as application query data (`demos/_kit/tests/auth-coordinator-client.mjs:241-266`, `demos/_kit/tests/auth-coordinator-client.mjs:318-321`). That result is omitted from the final auth-result sentinel (`demos/_kit/tests/auth-coordinator-client.mjs:554-577`).

*Resolves with:* Narrow the claim to coordinator views, auth-control responses, diagnostics, URLs, and operator-client projections. Arbitrary application payloads cannot safely be treated as a credential-redaction boundary.

11. **MINOR — D1’s production/dev matrix is internally overlapping and not literally implemented.**

“Settled dev” says loopback is allowed, while “production profile with dev” says loopback is health-only (`llp/0060-hosted-auth-security.rfc.md:123-127`). The transport validator allows every loopback posture (`src/admin.rs:121-130`), and request policy exempts `/`, `/health`, `/auth/session`, and `/app/ensure` from the ordinary production/dev refusal; those routes retain their own later gates (`src/server.rs:4359-4361`, `src/server.rs:4415-4435`).

*Resolves with:* Make the first row explicitly non-production and replace “health only” with “ordinary app data refused,” enumerating the diagnostic, handshake, and provisioning routes that remain subject to their separate gates.

12. **MINOR — Readiness and marketing terminology conflate three different guarantees.**

D5 first calls the four deployment axes “hosted-auth readiness,” then uses `deploymentReady` for four and `hostedAuthReady` for all five (`llp/0060-hosted-auth-security.rfc.md:231-238`, `llp/0060-hosted-auth-security.rfc.md:263-269`). Shipped admission uses the five-axis meaning for `AuthDeploymentTarget::Hosted` (`src/auth/deployment.rs:187-193`, `src/auth/deployment.rs:201-237`).

Separately, the RFC correctly limits v2 to off-device replay resistance, yet prohibits “XSS-resistant” advertising only until v2 lands, implying that v2 might unlock the label (`llp/0060-hosted-auth-security.rfc.md:395-406`).

*Resolves with:* Use stable, separate terms such as `hostedDeploymentReady` and `hostedBrowserSenderConstrained`; define exactly which one `--auth-deployment hosted` requests. Permanently prohibit “XSS-resistant” unless a separately trusted origin/process or user-presence boundary is implemented and reviewed.

## Suggestions

- Split static support from live evidence. Keep the closed capability descriptor for what a target implementation can enforce, but require a deployment-attestation object for what this concrete deployment currently enforces—origin binding, proxy configuration, limiter health/failure mode, invalidation freshness, marker version, and sender-constraint protocol. Positive readiness should require both.

- Treat this RFC as the umbrella and require reviewed implementing Specs for D2–D4 and C3 before their positive enum values can be emitted. That preserves appropriate RFC altitude without allowing an underspecified future implementation to self-attest.

- Build one adversarial conformance harness around the capability gate: unknown bind, direct origin, handler-first skew, replica autoscaling, limiter outage, silent invalidation partition, concurrent exchange/refresh, lost browser wakeup, lost logout response, and copied connection-grant replay.

- Document compatibility semantics for an absent `hostedAuth` block. The current enclosing manifest accepts omission as the all-negative default, while the standalone object requires all five fields (`src/manifest.rs:2537-2544`, `schemas/capability.manifest.schema.json:220-229`, `schemas/auth.hosted-capabilities.schema.json:40-69`).

- Mark `SNAPBACK_AUTH_SOURCE_UNTRUSTED` and `SNAPBACK_AUTH_INVALIDATION_LAGGING` as reserved alongside the sender-proof codes until their HTTP status, retry, and disclosure contracts exist; LLP 0012 currently reserves all five together (`llp/0012-headless-integration-contract.spec.md:659-675`).

## Open questions

- Is coordinator-less bearer injection a supported product surface, or only a test/headless compatibility seam? How is a browser prevented from entering that posture?

- Should every user-initiated logout clear local custody even when server revocation is unconfirmed, and what exact diagnostic represents that ambiguity?

- Which primitive provides hosted auth-state linearization: one shared serializable database, key-owned shards, a coordinator service, or sticky routing with a failover protocol?

- What evidence tells a replica that its invalidation head is fresh, and what maximum uncertainty interval is acceptable before it must refuse?

- Does `--auth-deployment hosted` require four deployment facts or the five-axis sender-constrained posture? If bearer-v1 compatibility remains possible, what distinct name and UI warning prevent it from being confused with secure hosted-browser readiness?

- How will browser WebSockets prove possession for delegated grants, and where will replay/nonce state be shared across replicas?

## Readiness verdict

**NOT READY.** The detached-router and browser-custody defects contradict the document’s implemented-boundary claims, while the missing frozen deployment marker and incomplete hosted/distributed prerequisites permit a future target to advertise readiness despite material authorization gaps. These issues undermine the core claims and require reconciliation before ratification.
## Round 2 — 2026-07-14

**Revision under review:** `llp/0060-hosted-auth-security.rfc.md`, sha256 `a9b4a6b8f8dedd11a15ebf856b95f89702cc59bbd0d391b30040b3ab1bbc50f5` (committed at repo HEAD `b11a6fa`)
**Runtime detail:** OpenAI Codex CLI v0.144.4 (`codex exec`, non-interactive), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, session id 019f637c-0717-7fb0-8795-519bdcd1e6fb; 436,885 tokens used; fresh session, blind to all archived reviews and to the concurrent Fable-family round; orchestrated by /llp-super-refine
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

LLP 0060 has strong security instincts and an unusually honest account of the current local and bearer-v1 boundaries. The local listener fence, proxy-source rules, negative capability reporting, coordinated credential custody, and operator-page CSP work are good ideas.

The complete RFC is not ready, however. Its hosted-readiness model omits a governing mixed-version requirement, conflates static support with live deployment enforcement, and does not yet define a feasible distributed invalidation protocol. Several implemented browser-custody claims are also contradicted by the code, including two paths that can expose newly issued credentials through app-visible errors.

I would preserve the local negative guarantees, but separate them from the future hosted-edge and sender-constraint specifications.

## 2. Strengths

- **The boundary is stated honestly.** §Summary and §Threat model explicitly say the local target is not hosted-ready, loopback proves nothing about a reverse proxy, bearer v1 is readable by app-origin JavaScript, and a non-extractable key is still callable by active same-origin code (`llp/0060-hosted-auth-security.rfc.md:13-54`, `84-113`).

- **D1 is precise and mostly well implemented on the normal CLI path.** The CLI resolves one bind IP, rejects unsupported hosted composition before database creation, evaluates desired and active session posture, and binds that same IP only afterward (`src/cli.rs:1294-1304`, `1496-1502`, `1574-1586`, `1681-1687`). The transport matrix covers dev, production, desired sessions, active sessions, and the reverse-proxy residual (`src/cli.rs:3921-3965`).

- **D2 has the right canonical-source baseline.** Starting with the transport peer, trusting forwarding metadata only behind an authenticated/configured proxy boundary, allowing one strictly parsed header family, and walking from the trusted edge toward the client are sound requirements (§D2, `llp/0060-hosted-auth-security.rfc.md:158-183`).

- **The capability representation is closed and fail-safe at the type level.** The five fields are enums under `deny_unknown_fields`; the standalone schema is closed; tests reject unknown fields and values; and the code enumerates all 32 combinations (`src/auth/deployment.rs:89-139`, `197-237`; `schemas/auth.hosted-capabilities.schema.json:1-70`; `tests/artifact_schemas_v0.rs:873-886`).

- **The coordinated C1 path contains substantial defensive work.** Ordinary `settledView()` omits the bearer while the narrow transport accessor is explicit (`packages/snapback-contract/auth-coordinator.mjs:514-538`). Exchange and refresh use closed projections that inspect values, numeric positions, and property names; logout transports only opaque success facts and compare-clears captured custody before returning a fixed error (`demos/_kit/client.mjs:680-762`, `1479-1519`, `1686-1715`).

- **C2 is concrete rather than aspirational.** Snapback-owned pages receive restrictive CSP and browser headers, response-specific hashes are preserved, Trusted Types is exercised, and router/browser acceptance covers the real documents (`src/server.rs:4081-4163`, `15983-16087`; `src/admin.rs:1849-1903`; `admin-ui/tests/acceptance/csp-browser.mjs:62-190`, `223-270`).

- **The status section does not claim future work has landed.** It correctly limits current evidence to the local enforcement, capability-honesty, CSP, and sentinel boundary (§Status, `llp/0060-hosted-auth-security.rfc.md:525-546`).

## 3. Concerns

1. **MATERIAL — Hosted readiness omits the governing coordinator-to-handler mixed-version boundary.**

   LLP 0039 requires a must-understand invocation marker so a sessions-aware handler refuses an absent, unknown, or session-unaware coordinator before execution (`llp/0039-auth-vertical-slice.rfc.md:102-121`, `1626-1639`). LLP 0058 explicitly delegates that marker, handler-first rollout, and rollback behavior to LLP 0060 (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:82-85`). LLP 0060’s readiness axes and hosted acceptance omit them (`llp/0060-hosted-auth-security.rfc.md:231-269`, `454-466`).

   The current Cloudflare constructor still creates `_snapback_meta` before validating deployment metadata (`cloudflare/src/coordinator.js:164-194`), precisely the pre-mutation ordering that LLP 0039 says a sessions preflight must close. The current Cloudflare target is dev-only, but LLP 0060 does not provide the required future transition.

   **Resolution criterion:** Define the exact invocation marker and receiver refusal, require preflight before any DDL or app effect, cover handler-first activation, coordinator-first rollback, delayed deployment, and third-party stale-worker interleavings, and make this a positive hosted-readiness prerequisite.

2. **MATERIAL — D5 conflates static target support with deployment-specific enforcement and live health.**

   TLS routing, trusted-proxy configuration, limiter binding/health, invalidation catch-up, and negotiated sender constraint are deployment or runtime facts. D5 nevertheless places them in a committed static capability manifest and derives readiness from that object (§D5, `llp/0060-hosted-auth-security.rfc.md:250-269`).

   The code already distinguishes committed target declarations from instance-live facts (`src/manifest.rs:2936-2940`), but `hostedAuth` is embedded in `CapabilityManifest` as a static descriptor (`src/manifest.rs:2761-2810`). Moreover, throttle, invalidation, and browser posture lack `unavailable`/`notApplicable` states (`src/auth/deployment.rs:55-86`). Consequently the dev-only Cloudflare target, which advertises no auth protocol, still publishes `processLocal`, `singleProcess`, and `bearerV1XssExposed` as if those mechanisms existed (`src/manifest.rs:3116-3125`; `cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json:8-25`).

   **Resolution criterion:** Split immutable target support from deployment-bound attestation and live readiness. Bind attestation to deployment identity and configuration hash; give it a freshness/health epoch; make serving admission consume it; withdraw traffic when required health is lost; and add explicit unavailable/not-applicable states for non-auth targets.

3. **MATERIAL — Four-axis deployment readiness, five-axis hosted-browser readiness, and CLI admission disagree.**

   D5 defines `deploymentReady` from four axes and `hostedAuthReady` from five, while C3 permits a possible explicitly accepted hosted bearer-v1 compatibility posture (`llp/0060-hosted-auth-security.rfc.md:263-269`, `409-414`). The open questions leave that policy undecided (`522-523`).

   The implementation nevertheless makes `--auth-deployment hosted` require all five axes; the four-axis predicate has no admission caller (`src/auth/deployment.rs:120-139`, `185-193`, `231-235`). The CLI help likewise defines `hosted` as the complete edge-and-browser contract (`src/cli.rs:388-392`). Thus the compatibility posture described by the RFC cannot be requested, while an operator-managed public bearer deployment silently remains the default `local` posture.

   **Resolution criterion:** Decide bearer-v1 public compatibility before acceptance. Either prohibit it and remove the compatibility language, or introduce separately named deployment and client-security requests with explicit operator acknowledgement. Align names, CLI behavior, diagnostics, manifests, and the exhaustive matrix.

4. **MATERIAL — D4 cannot derive fail-closed partition behavior from an asynchronous stream.**

   “While it knows its projection is behind” is insufficient: a partitioned replica normally cannot know that a newer revocation exists. No fence acknowledgement, freshness lease, authoritative high-water read, or linearizable validation step is specified (§D4, `llp/0060-hosted-auth-security.rfc.md:208-229`). The local implementation’s safety depends on installing a pending leaf fence before the provider transaction begins (`src/auth/coordinator.rs:367-413`); asynchronous post-commit consumption does not reproduce that ordering.

   D4 also risks treating LLP 0053 obligations as messages. LLP 0053 requires level-triggered state with exact scope identity, revision high-water, composite witness, monotone disposition, merge, acknowledgement, and discharge semantics because queue delivery can lose security-negative information (`llp/0053-authorization-invalidation.rfc.md:784-919`).

   Finally, the topology is overconstrained. `multiReplicaConvergent` and the required two-replica acceptance exclude LLP 0040’s deliberate single serialized Durable Object authority (`llp/0040-cloudflare-narrow-proof.rfc.md:116-151`), even though that topology can be safer than replica convergence.

   **Resolution criterion:** Define topology-specific conforming protocols: for example, one serialized linearizable authority, or replicated projections with pre-commit fencing and expiring serving leases. Preserve LLP 0053 obligations as durable or reconstructible state; use any stream only for ordered replication/wakeup. Test partitions before and after mutation begin, commit-before-delivery, ambiguity, duplication, reordering, restart, rebuild, lease expiry, and payload-drain fencing.

5. **MATERIAL — D3’s “combine dimensions” language does not define an anti-spray algorithm.**

   One composite key such as `(source, subject, app)` permits a source to spray many subjects and many sources to attack one subject. D3 does not say which independent buckets every attempt must charge, particularly for malformed or unresolved credentials (`llp/0060-hosted-auth-security.rfc.md:185-206`).

   The local request-code implementation demonstrates the necessary distinction by checking separate global and per-address limits in one transaction (`src/auth/provider.rs:1812-1834`). Connection-open limits likewise distinguish coarse and session buckets, although they remain process-local (`src/server.rs:1590-1657`).

   **Resolution criterion:** Specify the simultaneous bucket set per operation—at minimum app-global, per-source, per-subject/destination, source-by-subject, and per-family/user when resolved—with atomic multi-bucket acquisition, cardinality bounds, privacy-preserving normalization, and explicit treatment of unattributed failures. Test source spray, identity spray, NAT concentration, malformed credentials, cross-replica convergence, and limiter outage.

6. **MATERIAL — D2 does not protect the complete credential-carrying transport path.**

   D2 allows HTTP to be “redirected or refused” (`llp/0060-hosted-auth-security.rfc.md:160-163`). A bearer-bearing request has already crossed plaintext before receiving a redirect. The section also specifies only browser-to-public-edge TLS, while the Summary advertises “end-to-end external TLS” (`35-38`); bearer and proof material may still traverse an unauthenticated edge-to-origin hop.

   **Resolution criterion:** Require HTTPS/WSS-only auth clients and prohibit credentials or secret-bearing bodies on plaintext endpoints. Permit redirects only for credential-free navigation. Require each edge-to-origin hop to be same-host loopback/Unix transport or confidential and mutually authenticated. Add plaintext-auth, WebSocket downgrade, direct-origin, and edge-to-origin acceptance tests.

7. **MATERIAL — The claimed embedded-router transport defense trusts caller-supplied loopback state.**

   §D1 says request middleware repeats the plaintext refusal for embedded composition (`llp/0060-hosted-auth-security.rfc.md:129-150`). But `ServerContext::new()` accepts `host` and `loopback` independently, and `ServerContext::detached()` treats an unknown bind as loopback (`src/admin.rs:435-473`). Public embedding constructors accept that context, while the middleware trusts `runtime.server.loopback` (`src/admin.rs:1208-1228`; `src/server.rs:4531-4581`).

   An embedder can therefore expose a sessions router publicly while the defense believes it is loopback.

   **Resolution criterion:** Derive transport posture from the actual bound socket or an unforgeable listener-construction token. Unknown/detached posture must fail closed for sessions, and detached constructors must either be test-only or explicitly non-network-safe. Add a real non-loopback embedded-listener bypass test.

8. **MATERIAL — The app-origin threat claim ignores persisted operator authority.**

   C1 says app-origin XSS has the logged-in user’s authority (`llp/0060-hosted-auth-security.rfc.md:282-286`), but the shared admin client intentionally stores a derived `sbcc_` credential in origin-wide `localStorage` (`packages/snapback-admin-client/index.mjs:13`, `159-169`). That credential grants ordinary `AdminRead` and `AdminWrite` for ten minutes (`src/admin.rs:288-351`). C2 makes operator-origin separation only a recommendation “when practical” (`llp/0060-hosted-auth-security.rfc.md:344-349`).

   If application and operator pages share an origin, application XSS escalates from user authority to administrative write authority.

   **Resolution criterion:** Add an origin/authority matrix and require a separately trusted operator origin or disable `/_snapback/*` on the application origin for hosted exposure. If hosted administration is deferred, say so explicitly and keep it disabled until its control-plane authorization contract exists.

9. **MATERIAL — C1’s universal custody and sentinel claims are factually false.**

   Acceptance says `localStorage` and auth-control/coordinator return values never contain derived console credentials or session bearers (`llp/0060-hosted-auth-security.rfc.md:470-490`). In fact:

   - the derived console record is intentionally persisted, and its test requires that behavior (`packages/snapback-admin-client/index.mjs:159-169`; `admin-ui/tests/admin-client-credentials.mjs:70-81`);
   - `AuthCoordinator.credentialFor()` intentionally returns the bearer (`packages/snapback-contract/auth-coordinator.mjs:523-538`); and
   - `AuthCoordinator` is not the sole custody authority: `SnapbackClient` accepts a direct `bearerToken`, performs an uncoordinated sessions handshake, and exposes `setBearerToken()` when no coordinator is supplied (`demos/_kit/client.mjs:808-825`, `918-953`).

   **Resolution criterion:** Replace the universal assertion with a carrier-by-carrier matrix naming every permitted and forbidden location. Either enforce coordinator custody whenever a browser client observes sessions mode, with an explicitly separate headless seam, or scope every coordinated-custody claim and ensure no hosted browser capability can cover the bypass path.

10. **MATERIAL — Newly issued credentials can escape through malformed-success errors, and request-code success is not closed.**

   The kit includes a malformed successful response’s body snippet in an app-visible error (`demos/_kit/client.mjs:1479-1555`). Exchange and refresh learn the newly issued bearer only after parsing (`1601-1606`, `1633-1638`), so a non-JSON 2xx containing that successor is not in the redaction set and can escape. Admin console minting has the same flaw: `setToken()` preserves the credential response, while a 2xx parse error includes response text before the new derived credential is known (`packages/snapback-admin-client/index.mjs:34-50`, `85-141`).

   Separately, the server defines request-code success as exact `{challengeId, expiresAt}` (`src/auth/wire.rs:35-40`), but `authRequestCode()` returns arbitrary successful JSON unchanged (`demos/_kit/client.mjs:1571-1585`). A poisoned response can therefore publish an unknown bearer, code, or secret field despite the acceptance claim about auth-control return values.

   **Resolution criterion:** Credential-issuing endpoints must turn parse, body-read, and shape failures into fixed opaque errors containing no response bytes or reader-error payloads. Add an exact request-code projection and poison tests for malformed 2xx text, reader failures, unknown fields, nested fields, property names, and numeric positions across exchange, refresh, console mint, and request-code paths.

11. **MATERIAL — The sender-constrained capability overstates DPoP’s XSS result and lacks the minimum protocol inventory.**

   The Summary calls v2 “XSS-hardened,” and C3 says Snapback must not advertise “XSS-resistant” until v2 lands (`llp/0060-hosted-auth-security.rfc.md:41-45`, `409-414`). That implies the label may become valid afterward, even though the same section correctly says active same-origin code can invoke the key (`403-407`).

   [RFC 9449 §§5, 7, and 11.2–11.4](https://www.rfc-editor.org/rfc/rfc9449.html) distinguishes token-request proofs from protected-resource proofs carrying `ath`, warns that XSS can generate proofs, and describes future-dated proof pre-generation mitigated by server nonce. C3 makes nonce optional while broadly claiming off-device replay resistance. It also leaves exchange/refresh issuance, delegated connection tokens, browser WebSocket proof transport, external URI reconstruction behind proxies, algorithms, replay-key dimensions, and shared replay-store failure behavior unspecified.

   **Resolution criterion:** Rename the claim to copied-token or token-replay constraint and permanently forbid “XSS-resistant” for DPoP alone. Before any positive capability is emitted, accept a versioned wire/storage specification covering issuance and refresh proofs, every protected credential, HTTP and WebSocket transport, external URI authority, JOSE algorithms, time and nonce policy, shared replay enforcement, downgrade refusal, key persistence/deletion, and recovery. Require nonce if claiming resistance to post-XSS pre-generated off-device proofs; otherwise narrow the claim explicitly.

## 4. Suggestions

- Split the document into three independently reviewable artifacts: the implemented local listener/claim-honesty decision, the hosted edge/readiness specification, and the sender-constrained browser protocol.
- Replace static readiness booleans with an evidence-bearing record: target support profile, deployment/configuration attestation, runtime-health epoch or lease, and negotiated client protocol.
- Add a credential inventory table covering session bearers, successors, login codes, connection tokens, console credentials, master credentials, secret-read leases, and DPoP keys, including origin, maximum authority, TTL, intended carriers, and replay properties.
- Model invalidation and mixed-version rollout formally or with a deterministic state-machine harness before implementing the first hosted target.
- Add a threat-to-control table separating application origin, operator origin, browser extension, direct-origin caller, edge intermediary, replica, deployment tool, and control-plane attackers.
- Since no production source creates a Trusted Types policy, consider `trusted-types 'none'` instead of reserving `snapback`, with a browser test proving policy creation is rejected.

## 5. Open questions

- Is revocation intended to be linearizable across serving replicas, or bounded-stale? If bounded, what exact interval and residual authority are acceptable?
- Is the first target a serialized Durable Object authority, a reverse-proxy deployment with shared services, or a genuinely replicated projection?
- What component attests TLS, trusted-proxy configuration, limiter health, invalidation freshness, and deployment identity, and how long is that attestation valid?
- Is public bearer v1 permitted at all? If so, how is explicit acceptance represented rather than hidden under the default `local` posture?
- Must hosted administration use a separate origin, or is it disabled until a distinct control-plane design exists?
- Does sender constraint cover connection grants, WebSocket/outbox operations, console credentials, and secret-read leases, or only the session family?
- What canonical external scheme, authority, and path supply DPoP URI binding behind proxy rewrites?
- Is server nonce mandatory for the stated XSS attacker, and what are the proof-validity and replay-retention windows?
- Who owns the coordinator-to-handler marker schema and its mixed-version deployment conformance suite?
- Which failures make a deployment unready immediately, and which may consume a sharply bounded emergency budget?

## 6. Readiness verdict

Not ready. D1’s normal CLI fence and the negative capability/CSP work are strong enough to preserve or accept separately, but unresolved material correctness, coherence, feasibility, and security-claim issues remain in both the implemented browser boundary and the future hosted contract.

READINESS VERDICT: NOT READY

### Orchestrator disposition (round 2, outside the verbatim body)

Spot-checks: the three implemented-boundary contradictions verified true
against `b11a6fa` — the shared admin client persists the derived `sbcc_`
record in `localStorage` (packages/snapback-admin-client/index.mjs
`#replaceConsoleCredential`); the 2xx parse-failure path embeds a redacted
body snippet before any newly issued credential is known (index.mjs:116-141,
and the kit's equivalent paths); `ServerContext::detached()` hard-codes
`loopback: true` and `new()` accepts host/loopback independently
(src/admin.rs:438-473). LLP 0058's delegation of the mixed-version boundary
to this document confirmed (0058 §scope), and the Cloudflare constructor's
metadata-table-before-validation ordering confirmed with its two-phase
rationale comment (cloudflare/src/coordinator.js:164-176).

Disposition: concern 1 → new D6 (marker, preflight-before-effects with the
bounded app-invisible metadata carve-out, handler-first/coordinator-first/
delayed/stale-worker matrix, readiness prerequisite); concern 2 → D5's three
layers (support profile / deployment-bound attestation with identity+config
hash and freshness / live health withdrawing traffic) plus the
not-applicable-values companion obligation; concern 3 → deployment-readiness
naming, `hosted` = all five (matching the shipped gate), and the distinct
named bearer-v1 compatibility request replacing the open question; concern 4
→ the two conforming topologies with serving leases and the
completion-waits-for-fences bound, obligations as durable level-triggered
state, 0040's single authority explicitly conforming; concern 5 → the
simultaneous bucket set with atomic acquisition and unattributed-failure
charging; concern 6 → refusal-not-redirect, strict transport in the
attestation, confidential mutually authenticated edge-to-origin hops;
concern 7 → unforgeable posture rule + named defect obligation + bypass
acceptance row; concern 8 → C1 custody matrix honesty paragraph + C2
operator-origin hosted requirement; concern 9 → the carrier-by-carrier
matrix naming the localStorage console record and the headless seam, with
the structural split obligation; concern 10 → the issuing-path opaque-failure
rule, exact challenge-request projection, named defect obligation, and
acceptance rows; concern 11 → off-device-replay claim renaming (permanent),
required nonce for the pre-generated-proof claim, and the v2 protocol
inventory. The suggestion to split into three documents is left to the
author. Trusted-types 'none' and the threat/control table are noted,
non-blocking.

## Round 3 — 2026-07-14

**Revision under review:** `llp/0060-hosted-auth-security.rfc.md`, sha256 `7ef6dbcf4ce33a80c0026bf27e6defcf39201eaa5900629e5cfcbc0a556f9731` (round-2 working-tree revision; repo HEAD `b11a6fa`)
**Runtime detail:** OpenAI Codex CLI v0.144.4 (`codex exec`, non-interactive), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, session id (round 3); 304,944 tokens used; fresh session, blind to all archived reviews and to the concurrent Fable-family round; orchestrated by /llp-super-refine
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

The proposal’s core direction is good: hosted authentication should be a fail-closed composition of independently proved deployment, runtime, and client-security facts. LLP 0060 is unusually candid about the local target, bearer-token XSS exposure, reverse-proxy limits, and the difference between sender constraint and XSS resistance.

The plan is not ready for ratification, however. Its central readiness predicate omits requirements that the document itself calls mandatory; the three-layer attestation model collapses to a static capability boolean in both prose and code; D6 conflicts with frozen LLP 0039 and lacks an implementable protocol; D4 does not yet define a bounded distributed invalidation guarantee; and the “exhaustive” credential custody matrix does not match the repository’s real carriers. These are correctness and safety issues, not polish.

## 2. Strengths — with section citations

- The local-versus-hosted claim boundary is excellent. The Summary explicitly refuses to infer hosted readiness from a loopback reverse proxy and correctly lists facts Snapback cannot observe or enforce there ([§Summary](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:33)).

- The transport/source model is substantially stronger than “put TLS in front.” It covers credential-bearing plaintext refusal, edge-to-origin confidentiality and mutual authentication, trusted-proxy admission, bounded header parsing, and consistent canonical source derivation ([§D2](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:201)).

- The proposal correctly rejects a single composite throttle key. Independent global, source, subject, source-by-subject, and resolved-family dimensions are the right conceptual defense against spraying and NAT concentration ([§D3](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:245)).

- D4 identifies the crucial distributed-systems fact: an asynchronously updated replica cannot safely serve merely because it does not know it is stale. Requiring a serialized authority or pre-commit fencing with expiring serving authority is the right foundation ([§D4](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:285)).

- The browser-security language is disciplined. It acknowledges JavaScript-readable bearer custody, distinguishes off-device token replay from active-origin compromise, requires non-extractable keys, and refuses to call DPoP “XSS-resistant” ([§C1](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:459), [§C3](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:635)).

- The acceptance section is adversarial rather than ceremonial: it names direct-origin bypass, mixed-version revival, limiter failure, invalidation partitions, poisoned successful responses, and reader failures ([§Acceptance](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:711)).

- The current CLI does reject an unsupported hosted request before database-path preparation, and the existing five-axis descriptor defaults fail closed ([src/cli.rs:1297](/Users/ccheever/projects/snapback/src/cli.rs:1297), [src/auth/deployment.rs:103](/Users/ccheever/projects/snapback/src/auth/deployment.rs:103)).

## 3. Concerns

### 1. MATERIAL — The readiness predicate omits mandatory prerequisites and conflates capability with readiness

LLP 0060 says D6 is a “positive prerequisite of deployment readiness” and C2 makes operator-origin separation or disablement mandatory for hosted exposure ([§D6](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:419), [§C2](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:590)). Yet D5 defines deployment readiness as exactly four facts and hosted-auth readiness as exactly five, containing neither prerequisite ([§D5](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:339)).

D5 also says actual serving consumes a deployment-bound attestation and live health—not the static support profile—but immediately derives readiness from the immutable five-field descriptor ([§D5](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:371)). Code does the same: `validate_auth_deployment()` accepts only `HostedAuthCapabilities`, while `deployment_ready()` and `hosted_auth_ready()` evaluate four and five static enum values ([src/auth/deployment.rs:95](/Users/ccheever/projects/snapback/src/auth/deployment.rs:95), [src/auth/deployment.rs:120](/Users/ccheever/projects/snapback/src/auth/deployment.rs:120), [src/auth/deployment.rs:187](/Users/ccheever/projects/snapback/src/auth/deployment.rs:187)).

A build with mechanisms compiled in but stale configuration, broken limiter health, an incompatible handler, or same-origin operator pages could therefore satisfy the named gate.

**Resolution criterion:** Define separate machine-readable support, deployment-attestation, and live-health authorities. Add D6 compatibility and operator-surface isolation as closed, fail-closed inputs to actual readiness—or define equally mandatory gates that every hosted admission consumes. Specify attestation issuer, deployment/configuration binding, freshness and revocation, plus health withdrawal for HTTP and existing socket/drain paths. Update schema, blockers, matrix, acceptance, and terminology so static booleans mean `*Capable`, not `*Ready`.

### 2. MATERIAL — D6 contradicts frozen LLP 0039 and is not yet an implementable protocol

D6 permits `_snapback_meta` creation before preflight when considered app-invisible and idempotent ([§D6](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:435)). Frozen LLP 0039 explicitly requires refusal before any durable mutation, calls out that exact table, and requires the preflight to move ahead of its DDL so refusal leaves the target byte-for-byte unchanged ([LLP 0039:205](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:205), [LLP 0039:1626](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:1626)). This directly conflicts with LLP 0060’s statement that it does not reinterpret LLP 0039.

There is also an effect-boundary mismatch. The Cloudflare coordinator performs constructor DDL before any coordinator-to-handler invocation exists ([cloudflare/src/coordinator.js:86](/Users/ccheever/projects/snapback/cloudflare/src/coordinator.js:86), [cloudflare/src/coordinator.js:164](/Users/ccheever/projects/snapback/cloudflare/src/coordinator.js:164)); the later handler request has no version marker ([cloudflare/src/coordinator.js:2365](/Users/ccheever/projects/snapback/cloudflare/src/coordinator.js:2365)). A per-invocation marker cannot preflight constructor effects.

Finally, D6 does not pin an exact carrier, field schema, protocol version semantics, typed failure, authenticated binding, opposite-skew behavior, or rollback floor. LLP 0039 assigns schema ownership to LLP 0051 D4, but that section governs client-visible envelopes and contains no coordinator-handler marker definition ([LLP 0051 D4](/Users/ccheever/projects/snapback/llp/0051-language-neutral-data-tier.rfc.md:600)).

**Resolution criterion:** Either restore preflight-before-all-DDL or formally amend LLP 0039 through its owner. Split deployment/startup preflight from invocation preflight and define both effect domains. Assign an actual schema owner and specify a closed, integrity-protected marker bound to deployment identity, authority/incarnation, and handler protocol. Define old/new pair behavior, stale revival, activation, rollback, and a durable minimum-version ratchet while sessions remain active.

### 3. MATERIAL — D4 does not yet define a finite, linearized invalidation guarantee

The replicated topology allows serving until a lease expires and reports revocation complete once replicas are fenced or their leases expire ([§D4](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:301)). No maximum lease lifetime, clock/skew rule, issuer authority, durable lease epoch, membership definition, or atomic rule preventing a stale renewal after fencing is specified. An arbitrarily long lease technically conforms, and “every live replica” is not enumerable during a partition.

D4 also says LLP 0053’s obligations are durable state without preserving its explicit durability matrix. Accepted LLP 0053 says subscription and connection projections are persistent only while continuity exists and deliberately are not disk-durable; process loss destroys them and forces a fresh subscribe, while client-query tombstones and authorization versions are genuinely durable ([LLP 0053:902](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:902)).

The capability vocabulary is also semantically awkward: a single serialized authority must advertise `multiReplicaConvergent`, despite D4 correctly arguing that it is not a replicated topology ([src/auth/deployment.rs:65](/Users/ccheever/projects/snapback/src/auth/deployment.rs:65)).

**Resolution criterion:** Define a linearizable lease/fence state machine with a normative maximum lease and skew allowance, durable epoch, no-renewal-after-fence rule, new-replica admission, exact-owner rollback, and ambiguous-outcome behavior. Reproduce LLP 0053’s durability matrix accurately. Rename the positive fact to a semantic guarantee such as `globallyFenced`, or give single-authority and replicated-fenced topologies separate positive values.

### 4. MATERIAL — The shared-limiter state transition is ambiguous on denied attempts

D3 says every attempt charges all applicable buckets, admission requires every bucket to admit, and acquisition is atomic with “no partial charge” ([§D3](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:247)). It does not say whether an attributed attempt denied by one exhausted bucket still charges global/source buckets.

An all-or-nothing rollback interpretation lets an attacker hammer an already-exhausted subject without consuming source or global capacity. A charge-on-denial interpretation can be safe but needs exact semantics to avoid partial-update races or excessive collateral denial. Only malformed and unresolved credentials are explicitly said to charge on failure.

**Resolution criterion:** Specify the atomic transition for admitted and rejected requests, including exactly which applicable buckets advance, how retry windows compose, and what happens under contention or limiter failure. Add attributed-denial, exhausted-subject spray, and concurrent multi-bucket acceptance tests.

### 5. MATERIAL — The “exhaustive” custody matrix does not describe actual credential carriers

C1 requires challenge-request success to return `{challengeId, expiresAt}`, while its exhaustive matrix permits “login code / challenge id” only in the exchange request; acceptance also says coordinator return values contain no credential of any class ([§C1 issuing paths](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:506), [§C1 custody matrix](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:529), [§Browser custody acceptance](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:764)). The actual client returns the challenge-request JSON ([demos/_kit/client.mjs:1571](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:1571)).

The matrix permits the admin master only in operator input and the mint request. The headless `AdminClient`, however, deliberately retains it in `this.masterToken` and sends it on ordinary admin requests ([packages/snapback-admin-client/index.mjs:17](/Users/ccheever/projects/snapback/packages/snapback-admin-client/index.mjs:17), [packages/snapback-admin-client/index.mjs:69](/Users/ccheever/projects/snapback/packages/snapback-admin-client/index.mjs:69)); its regression test confirms that behavior ([admin-client-credentials.mjs:127](/Users/ccheever/projects/snapback/admin-ui/tests/admin-client-credentials.mjs:127)).

The acknowledged direct-bearer seam also conflicts with LLP 0059’s universal statement that all contexts use one coordinator and no participant maintains independent auth ([LLP 0059:1095](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1095), [LLP 0059:1619](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1619)).

**Resolution criterion:** Split login code from challenge ID and classify the latter as an opaque, non-authenticating correlation handle with explicit response, transient-memory, and exchange-request carriers. Add headless master memory/header custody and lifetime/clear rules, or eliminate it through one-shot minting. Structurally separate browser and headless client types and reconcile LLP 0059’s universal coordinator language.

### 6. MATERIAL — The issuing-path defect plan omits a concrete unknown-successor exposure seam

C1 correctly explains why request-known-secret redaction cannot sanitize an unknown newly issued credential and demands fixed opaque failures ([§C1](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:506)). Its inventory names the kit and shared admin client but not the embedded setup page.

That page reads the console-mint body with `res.text()`, sanitizes a rejected body-reader error using only request-known secrets, and ultimately writes `error.message` into DOM text ([src/admin/setup.html:254](/Users/ccheever/projects/snapback/src/admin/setup.html:254), [src/admin/setup.html:266](/Users/ccheever/projects/snapback/src/admin/setup.html:266), [src/admin/setup.html:528](/Users/ccheever/projects/snapback/src/admin/setup.html:528)). Under the document’s own hostile-reader-error model, an unknown fresh `sbcc_` successor could cross this seam.

**Resolution criterion:** Enumerate every issuing implementation—kit request/exchange/refresh, shared admin mint, and embedded setup mint—and require fixed opaque behavior for 2xx read, parse, and shape failures. Add poison tests in which the body reader rejects with an unknown fresh credential and prove no response bytes reach errors, DOM, logs, or storage.

### 7. MATERIAL — `externalTls = enforced` can remain positive without closing the claimed first-contact risk

D2 says HSTS or an equivalent closing the first-visit stripping window is part of the fact, but then allows its exclusion to be recorded with a justification ([§D2](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:212)). Ordinary response-header HSTS does not protect the first unauthenticated visit; RFC 6797 explicitly retains that bootstrap vulnerability ([RFC 6797 §14.6](https://www.rfc-editor.org/rfc/rfc6797#section-14.6)). Documentation cannot substitute for a mandatory security mechanism while preserving the same positive claim.

**Resolution criterion:** Require preloaded or otherwise predelivered HSTS, an HTTPS-only provider binding, or another mechanism that genuinely secures first contact. Otherwise keep `externalTls` false or define a narrower fact. Add a clean-profile first-navigation acceptance case; a justification alone must not satisfy the positive value.

### 8. MATERIAL — The document overstates implementation of the local listener boundary

D1 candidly states that the middleware posture is currently forgeable and names the required repair ([§D1](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:161)). Nevertheless, the Summary and Status say ENG-24607 implements the local enforcement boundary.

In code, `ServerContext` exposes independent public `host`, `port`, and `loopback` fields; `new()` trusts the caller’s boolean, while `detached()` claims loopback for an unknown bind ([src/admin.rs:376](/Users/ccheever/projects/snapback/src/admin.rs:376), [src/admin.rs:435](/Users/ccheever/projects/snapback/src/admin.rs:435), [src/admin.rs:456](/Users/ccheever/projects/snapback/src/admin.rs:456)). Request middleware consumes that boolean directly ([src/server.rs:4536](/Users/ccheever/projects/snapback/src/server.rs:4536)). The CLI pre-bind path is implemented; the embedded defense is not.

**Resolution criterion:** Derive posture from the actual bound socket or an unforgeable listener-construction token, make detached posture unknown and fail closed for sessions, and add the real non-loopback embedded-listener test. Until then, narrow Summary and Status to “CLI pre-bind enforcement implemented; embedded defense pending.”

### 9. MATERIAL — The future positive and compatibility postures are not closed security contracts

D5 treats the single value `senderConstrainedV2` as sufficient for hosted-auth readiness, while C3 leaves essential semantics to a future specification: nonce strength, credential-class coverage, HTTP and WebSocket transport, proxy URI reconstruction, algorithms, replay-store failure, and downgrade behavior ([§D5 descriptor](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:386), [§C3 inventory](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:670)). A token-only posture without nonce is explicitly allowed a narrower claim, which means one binary positive does not currently identify a single guarantee.

Similarly, D5 promises a distinct, named must-understand bearer-v1 compatibility request but supplies no name or gate; `AuthDeploymentTarget` contains only `local` and `hosted` ([§D5 compatibility](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:351), [src/auth/deployment.rs:29](/Users/ccheever/projects/snapback/src/auth/deployment.rs:29)).

**Resolution criterion:** Define the exact positive sender-constraint guarantee and all protected surfaces, or split it into narrower closed posture values. Pin the compatibility request’s enum/wire spelling, required deployment facts, operator-acceptance artifact, operator-origin gate, UI disclosure, diagnostics, and legacy refusal behavior. Neither posture should become positive before its reviewed protocol exists.

### 10. MINOR — The descriptor’s claimed final matrix contradicts its own pending enum repair

D5 calls the five binary axes exact and the 32-case matrix exhaustive, then immediately says three axes require a new `unavailable` value because no-auth targets currently advertise mechanisms they do not possess ([§D5 descriptor](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:386), [§D5 honesty rules](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:407)). Adding those states changes both the schema and combination universe, so 32 cases cannot remain the final exhaustive contract.

**Resolution criterion:** Pin and version the corrected enum space now, including migration/default behavior, then regenerate schemas and exhaustive coverage. If the existing binary form remains temporarily, label it explicitly as a legacy support-profile version.

### 11. EDITORIAL — The proposal should follow the LLP large-RFC decomposition rule

The document is 924 lines and combines two independently reviewable implementation timelines: hosted deployment/runtime security and browser credential custody/v2. The LLP process recommends a directory with an umbrella document and sub-RFCs when a proposal exceeds roughly 800 lines and has independently reviewable timelines ([LLP 0005 process:101](/Users/ccheever/projects/snapback/vendor/llp/llp/0005-rfc-process.guide.md:101)).

**Resolution criterion:** Retain LLP 0060 as the umbrella and split at least deployment readiness/D1–D6 from client custody/C1–C3, with explicit ownership and shared terminology. This is non-blocking once the material issues above are resolved.

## 4. Suggestions

- Represent readiness as a proof-carrying object rather than a collection of optimistic enum values: support-profile version, signed or provider-bound deployment attestation, configuration digest, epoch, expiry, and live-health lease.

- Model D4 and D6 as executable state machines before implementation. Property testing or a small TLA+/Stateright model would expose renewal-after-fence, stale revival, rollback, and ambiguous-commit interleavings more reliably than prose matrices alone.

- Persist a minimum accepted coordinator-handler protocol floor while sessions are active. This creates a one-way compatibility ratchet and makes rollback below a marker-aware version require explicit session deactivation and fencing.

- Disable operator routes by construction for hosted targets until a separately origined control plane exists. This is easier to prove than treating correct routing as deployer guidance.

- Use semantic capability names such as `globallyFenced` or explicit topology variants rather than making a single serialized authority claim to be “multi-replica.”

- Clarify that a non-extractable `CryptoKey` handle may be structured-cloned into IndexedDB while raw private-key material is never exported; “platform keystore; never serialized” currently obscures that distinction.

## 5. Open questions

- Who issues and verifies the deployment-bound attestation, what is its trust root, and which configuration or runtime events advance or revoke its epoch?

- Does loss of limiter or invalidation health terminate existing WebSockets and payload drains, or only reject new HTTP admission?

- Which identities compose D6’s incarnation: deployment release, handler build, app-reset generation, authorization-stream incarnation, or a tuple?

- What exact maximum serving-lease duration and clock-skew allowance produce an acceptable revocation bound?

- What is the linearizable authority for issuing, renewing, and fencing replica leases, and how are new replicas handled during an in-flight revocation?

- On a denied attributed authentication attempt, which limiter buckets charge and which retry hint is returned?

- Is `challengeId` explicitly non-secret and non-authenticating? What lifetime and clearing guarantees apply to the headless admin master?

- Does `senderConstrainedV2` require nonce-protected proofs for every credential-bearing HTTP and WebSocket surface, or should multiple posture values express narrower guarantees?

- What is the exact compatibility-request spelling and acceptance artifact, and can it be revoked centrally?

- Which hosted target and D4 topology will supply the first conformance evidence?

## 6. Readiness verdict

The proposal has a strong security philosophy and several excellent design instincts, but its readiness algebra, mixed-version protocol, distributed invalidation bound, and credential custody contract remain materially inconsistent or incomplete.

READINESS VERDICT: NOT READY
### Orchestrator disposition (round 3, outside the verbatim body)

Disposition: #1 (capability vs readiness) → D5 clarifies static enums attest
`*Capable`; D6 compatibility and C2 operator-origin isolation named mandatory
fail-closed admission inputs alongside attestation/health; the shipped
deployment_ready()/hosted_auth_ready() naming reconciliation is a companion
obligation. #2 (D6 vs frozen 0039) → the `_snapback_meta`-before-preflight
carve-out withdrawn; preflight precedes all DDL, split into startup and
per-invocation domains; marker schema owner/wire form named as an
implementation-altitude obligation (not 0051 D4). #3 (D4 lease/durability) →
bounded lease state machine (normative max, skew, durable epoch,
no-renewal-after-fence, admission, rollback), 0053 durability matrix reproduced
exactly (projections continuity-scoped not disk-durable), multiReplicaConvergent
flagged for companion rename to a globally-fenced meaning. #4 (limiter denied-
attempt transition) → folded into the D3 unattributed-failure charging already
pinned; the exact atomic multi-bucket state transition is an implementation
obligation. The push toward full protocol-grade specification is acknowledged as
implementation-altitude, since this RFC does not design the control plane and
its altitude is not yet author-ratified.

## Round 4 — 2026-07-14

**Revision under review:** `llp/0060-hosted-auth-security.rfc.md`, sha256 `b58d362df0c40c15f8c24fbcde8607ac258f30484a48b9e1303e7eaf9d43b7a3` (round-3 revision)
**Runtime detail:** OpenAI Codex CLI v0.144.4 (`codex exec`, non-interactive), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox; 360,036 tokens used; fresh session, blind to all archived reviews and to the concurrent Fable-family round; orchestrated by /llp-super-refine
**Verdict:** NOT READY (9 MATERIAL — all requesting protocol-grade wire/state-machine specification: D4/D5/D6 state and wire contracts, first-contact TLS fact, limiter failure bound, custody classification, operator-origin admission, C3 broker claim)

### Review body (verbatim)

## 1. Overall assessment

LLP 0060 is directionally strong and necessary, but it is not ready for acceptance. Its central idea is good: hosted authentication must be a fail-closed conjunction of transport, source attribution, throttling, invalidation, deployment compatibility, operator-surface isolation, and browser credential posture. The document is unusually honest about the local target’s limits and about what DPoP does not solve.

The blocker is not that hosted authentication remains unimplemented. The blocker is that several security-critical contracts are still underspecified or internally inconsistent: mixed-version refusal, distributed revocation ordering, dynamic admission, first-contact TLS, the bearer-v1 compatibility posture, and parts of browser custody. The Status section calls the missing marker schema, lease constants, and attestation authorities “implementation-altitude obligations” ([LLP 0060 §Status](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:957)); they are actually protocol semantics needed to judge safety and feasibility.

## 2. Strengths — with section citations

- **The claim boundary is excellent.** The Summary, Threat model, C1, C2, C3, and Status consistently distinguish local bearer-v1 safety improvements from hosted readiness and from XSS resistance. In particular, [§C3](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:698) correctly refuses to market DPoP as XSS-resistant.

- **D1 is concrete and evidence-driven.** [§D1](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:175) requires transport posture to derive from the bound socket or an unforgeable construction token, forbids an override, states the reverse-proxy limitation, and names the existing embedded-composition defect. The normal CLI already resolves once and validates before database creation or listener binding ([src/cli.rs:1294](/Users/ccheever/projects/snapback/src/cli.rs:1294), [src/cli.rs:3334](/Users/ccheever/projects/snapback/src/cli.rs:3334)). The identified bypass is real: `ServerContext` accepts a caller-supplied `loopback` bit ([src/admin.rs:376](/Users/ccheever/projects/snapback/src/admin.rs:376)), and middleware trusts it ([src/server.rs:4574](/Users/ccheever/projects/snapback/src/server.rs:4574)).

- **D2 treats transport as an end-to-end property.** [§D2](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:212) correctly refuses credential-bearing plaintext instead of redirecting it, includes edge-to-origin confidentiality and mutual authentication, and defines a strict trusted-proxy walk rather than trusting the leftmost forwarded address.

- **D3 recognizes the multidimensional nature of authentication abuse.** [§D3](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:263) explicitly covers global, source, subject, source-by-subject, and resolved-session buckets and correctly requires malformed or unattributed requests to consume capacity.

- **D4 rejects the most common distributed invalidation fallacy.** [§D4](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:303) correctly says that an asynchronous post-commit stream alone cannot prove fail-closed refusal and recognizes a single serialized authority as a valid, often safer topology.

- **C1 contains the right opaque-failure principle.** [§C1](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:522) correctly observes that redaction cannot remove a freshly issued credential the client does not yet know. Exact success projections and fixed, body-free errors are the right response. The existing coordinator already has meaningful authority fencing and keeps ordinary settled views bearer-free.

- **C2’s operator-origin insight is important.** [§C2](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:646) correctly identifies the persisted `sbcc_` credential as the reason application and operator surfaces cannot share a hosted origin. The current local CSP and Trusted Types evidence is substantive rather than ceremonial ([src/server.rs:4081](/Users/ccheever/projects/snapback/src/server.rs:4081), [admin-ui/tests/acceptance/csp-browser.mjs:210](/Users/ccheever/projects/snapback/admin-ui/tests/acceptance/csp-browser.mjs:210)).

- **The acceptance section is adversarial.** [§Acceptance](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:774) covers mixed versions, direct-origin bypass, limiter failures, partitions, lease expiry, poisoned responses, reader errors, CSP execution, and sender-proof downgrade. That is the right testing posture.

## 3. Concerns

1. **MATERIAL — D6 does not yet provide a backward-safe mixed-version protocol.**

   **Evidence:** [§D6](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:476) promises that absent, unknown, or stale markers are refused, including a revived stale handler instance. But a marker added as another JSON field cannot protect against an old handler: the current handler accepts an open object, ignores unknown fields, and begins invocation using selected known fields ([packages/snapback-harness/workerd/handler-server.mjs:341](/Users/ccheever/projects/snapback/packages/snapback-harness/workerd/handler-server.mjs:341), [packages/snapback-harness/workerd/handler-server.mjs:416](/Users/ccheever/projects/snapback/packages/snapback-harness/workerd/handler-server.mjs:416)). A stale pre-marker handler can therefore execute code and make host calls before a response echo could be checked.

   Frozen LLP 0039 explicitly requires a discriminator legacy receivers already reject and refusal **before handler execution**, not merely before an “app effect” ([LLP 0039:90](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:90), [LLP 0039:112](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:112)). LLP 0060 weakens that language to “before any application effect” in D6 and Acceptance. LLP 0039 also assigns the marker schema to LLP 0051 D4, but [LLP 0051 D4](/Users/ccheever/projects/snapback/llp/0051-language-neutral-data-tier.rfc.md:600) governs client-visible live and HTTP envelopes, not this coordinator-to-handler marker.

   Current deployment mechanics confirm the need for a stronger design: handler deployment is not followed by an exact-version activation proof, and rollback currently restores handlers before the gateway ([cloudflare/deploy.sh:235](/Users/ccheever/projects/snapback/cloudflare/deploy.sh:235), [cloudflare/deploy.sh:342](/Users/ccheever/projects/snapback/cloudflare/deploy.sh:342)).

   **Resolution criterion:** Define a single generated wire authority and an old-receiver-safe discriminator, such as a versioned endpoint or binding that pre-marker handlers reject structurally. Pin compatible version sets, handler incarnation authority, authenticated confirmation, error/status mapping, activation barriers, coordinator-first rollback, and binding of all host calls and terminal results to the confirmed protocol. Restore “before handler execution” consistently and correct the LLP 0039/0051 ownership references. The startup preflight must also precede `_snapback_meta` creation, which currently occurs before validation ([cloudflare/src/coordinator.js:164](/Users/ccheever/projects/snapback/cloudflare/src/coordinator.js:164)).

2. **MATERIAL — D4 does not pin the temporal boundary required by the frozen revocation protocol.**

   **Evidence:** [§D4](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:319) permits lease holders to serve within an unexpired lease and says a revocation operation reports complete only after holders are fenced or their leases expire. It does not unambiguously say whether all earlier leases must be fenced or expired **before the pending marker and durable provider transaction begin**. Delaying the success response is insufficient if an old lease can still validate work after the revocation fence has been published.

   Frozen LLP 0039 requires the pending marker before durable commit and guarantees that no operation validates after marker publication ([LLP 0039:951](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:951), [LLP 0039:1004](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:1004)). LLP 0059 likewise says `Begin` blocks the leaf before commit ([LLP 0059:394](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:394)).

   The durability paragraph also assigns client-query tombstones to replica convergence. Accepted LLP 0053 says those tombstones are persisted by clients; server-side durable authority is the `AuthorizationVersion`, while subscription and connection projections are memory-only and continuity-scoped ([LLP 0053:902](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:902)).

   **Resolution criterion:** Specify the distributed `Plan → Begin → Fence/Drain → Commit → Finalize/Rollback` state machine, including the exact point after which no lease holder may validate or drain payload, whether expiry must precede commit, skew handling, epochs, ambiguous outcomes, and rollback ownership. Reproduce LLP 0053’s durability matrix using separate server-authority, server-projection, and client-retained-state columns rather than saying replicas converge to client tombstones.

3. **MATERIAL — D5 gives two incompatible meanings to readiness.**

   **Evidence:** Early [§D5](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:374) defines `deploymentReady` and `hostedAuthReady` from the static four/five-field descriptor and says this is “exactly as the shipped gate implements.” Later it says those fields mean only `*Capable`, while actual readiness additionally requires deployment-bound attestation, live health, D6 compatibility, and operator-origin isolation.

   The shipped API follows the first definition: `deployment_ready()`, `hosted_auth_ready()`, and `validate_auth_deployment()` consume only `HostedAuthCapabilities`; an all-positive static descriptor passes without any deployment identity, health, D6, or origin input ([src/auth/deployment.rs:120](/Users/ccheever/projects/snapback/src/auth/deployment.rs:120), [src/auth/deployment.rs:185](/Users/ccheever/projects/snapback/src/auth/deployment.rs:185)). There is no current exposure because existing call sites publish the local descriptor, but the API is unsafe for the first hosted target. LLP 0012 still records the old static interpretation ([LLP 0012:685](/Users/ccheever/projects/snapback/llp/0012-headless-integration-contract.spec.md:685)).

   The schema also cannot express a target with no auth surface: `processLocal`, `singleProcess`, and `bearerV1XssExposed` all assert mechanisms that exist. The current no-auth Cloudflare target consequently advertises misleading mechanism values.

   **Resolution criterion:** Separate immutable `HostedAuthSupport` from deployment attestation, live health, and final `HostedAdmission`. Rename or remove static `*_ready()` methods, define the attestation and health authorities and their freshness/configuration binding, and specify serving withdrawal and existing-socket draining. Add `unavailable` to every applicable axis, migrate no-auth targets, and update LLP 0012, schemas, generated manifests, and tests to use the same vocabulary.

4. **MATERIAL — The bearer-v1 compatibility posture is declared supported before its safety contract is decided.**

   **Evidence:** D5 and C3 state that explicitly operator-accepted public bearer v1 exists as a distinct, named must-understand request, but the request is not actually named and its acceptance artifact remains an open question. The current enum has only `local` and `hosted` ([src/auth/deployment.rs:29](/Users/ccheever/projects/snapback/src/auth/deployment.rs:29)); there is no DTO, gate, expiry, audit rule, revocation behavior, or acceptance row for the compatibility posture.

   **Resolution criterion:** Either remove the claim that this is a supported posture, or pin its exact enum/CLI spelling and artifact schema. If retained, specify who produces and verifies the acceptance, its deployment/configuration binding, expiry and revocation, audit/UI representation, and proof that it cannot be obtained through default `local` or `hosted` behavior.

5. **MATERIAL — Ordinary HSTS does not establish the first-contact property D2 assigns to `externalTls = enforced`.**

   **Evidence:** [§D2](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:223) treats “HSTS—or equivalent” as closing the first-visit SSL-stripping window, while Acceptance merely requires HSTS/equivalent. A dynamically learned HSTS policy cannot protect an initial HTTP interaction with a previously unknown host; RFC 6797 explicitly identifies this bootstrap vulnerability and describes preloaded policy as a mitigation ([RFC 6797 §14.6](https://www.rfc-editor.org/rfc/rfc6797.html#section-14.6), [§12.3](https://www.rfc-editor.org/rfc/rfc6797.html#section-12.3)).

   **Resolution criterion:** Distinguish a strict-transport response header from first-contact downgrade protection. If `externalTls = enforced` includes the latter, require a preload-grade or otherwise preconfigured HTTPS-only mechanism for every supported hostname, including custom domains, and test a fresh client with no cached HSTS state attempting HTTP and WebSocket downgrade. Otherwise narrow the claim and expose the bootstrap residual as a separate fact.

6. **MATERIAL — D3’s rejection and limiter-failure semantics are not globally bounded.**

   **Evidence:** [§D3](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:265) says every attempt charges all buckets, but also requires atomic acquisition with “no partial charge.” It is unclear whether an attempt rejected by one bucket charges the remaining abuse dimensions. Either interpretation affects spraying resistance and starvation behavior. The allowed “local emergency budget” is bounded only per replica; autoscaling, process churn, or attacker-induced replica creation can multiply it without a deployment-wide bound.

   The document also leaves subject-key derivation and IPv6 source aggregation at “hashed/normalized,” which does not by itself prevent identity enumeration or cardinality attacks.

   **Resolution criterion:** Define one transactional result model for admitted and rejected attempts, including exactly which buckets a denial consumes. Require fail-closed behavior or centrally leased emergency permits with a deployment-wide maximum independent of replica count. Pin keyed subject derivation, IPv4/IPv6 aggregation, cardinality eviction, clock ownership, retry monotonicity, and target-published rate/burst parameters.

7. **MATERIAL — C1’s “exhaustive” custody matrix contradicts both the RFC and the implementation.**

   **Evidence:** [§C1’s matrix](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:592) says “Login code / challenge id” may occur only in the exchange request and nowhere at rest. The same section requires challenge-request success to return `{challengeId, expiresAt}`, making the challenge ID app-visible before exchange. The server also stores it as the primary key of `_auth_verification_codes` ([src/storage/auth.rs:260](/Users/ccheever/projects/snapback/src/storage/auth.rs:260)), indexes capture-mailbox state by it ([src/auth/mailbox.rs:171](/Users/ccheever/projects/snapback/src/auth/mailbox.rs:171)), and deliberately includes it in `Debug` output ([src/auth/wire.rs:50](/Users/ccheever/projects/snapback/src/auth/wire.rs:50)). The matrix also omits request-header carriers for derived console credentials and secret-read leases.

   **Resolution criterion:** Define whether the matrix covers browser custody or the entire system. Split login codes from challenge IDs. Either classify challenge IDs as non-secret correlation handles and narrow every secrecy/logging assertion accordingly, or treat them as credentials and specify hashing, redaction, storage, response-memory, and mailbox carriers. Enumerate HTTP headers and server-side carriers explicitly, then make sentinel and `Debug` tests match that classification.

8. **MATERIAL — Operator-origin isolation is mandatory admission state without a specified enforcement contract.**

   **Evidence:** [§C2](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:653) requires `/_snapback/*` to be isolated or disabled, and D5 makes this a closed admission input. The RFC does not define the origin authority, canonical host derivation behind proxies, CORS/Origin behavior, direct-origin handling, route-level refusal, or how an origin-routing change withdraws readiness. Current code serves the application and operator routes from the same router, and the admin client uses `location.origin` ([src/admin.rs:1737](/Users/ccheever/projects/snapback/src/admin.rs:1737), [admin-ui/main.ts:27](/Users/ccheever/projects/snapback/admin-ui/main.ts:27)). That is acceptable locally, but there is no reusable hosted gate yet.

   **Resolution criterion:** Define a machine-readable operator-surface mode with at least `disabled` and `isolated`, its attestation authority, accepted public hosts, direct-origin behavior, CORS/Origin policy, and withdrawal/drain semantics. The safest first hosted slice should make every operator page and API route unavailable on the application origin; the isolated mode should remain unavailable until its control-plane authorization contract exists.

9. **MATERIAL — C3 overstates what a separately originated signing broker does against active XSS.**

   **Evidence:** [§C3](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:724) calls a separately originated postMessage broker the same-device boundary that changes the active-XSS story. A broker that accepts arbitrary method/URI/token/nonce signing requests is still a signing oracle for compromised app-origin code: the attacker can send the same messages as legitimate code. RFC 9449 likewise notes that XSS can use the signing key and issue arbitrary requests while the client remains compromised ([RFC 9449 §11.4](https://www.rfc-editor.org/rfc/rfc9449.html#section-11.4)).

   The platform-level statement that non-extractable `CryptoKey` handles can be stored in IndexedDB is sound, but the current custody path is not directly compatible: it JSON-clones records and enforces a bearer-only exact shape ([packages/snapback-contract/auth-coordinator.mjs:20](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:20), [packages/snapback-contract/auth-coordinator.mjs:223](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:223), [packages/snapback-contract/auth-custody-indexeddb.mjs:230](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-custody-indexeddb.mjs:230)).

   **Resolution criterion:** Separate key-exfiltration isolation from action-authorization isolation. Claim an active-XSS improvement only if the broker owns request execution and enforces independent semantic policy, capabilities, or user presence that compromised app code cannot synthesize. Add a v2 storage migration with a dedicated CryptoKey-capable record or object store, atomic session-family binding, and loss/corruption recovery.

10. **MINOR — The issuing-path defect inventory is narrower than the actual code surface.**

    **Evidence:** C1’s normative opaque-error rule and Acceptance cover reader failures, but the named current defects emphasize parse snippets and unprojected challenge success. The generic kit path sanitizes a body-reader exception using only request-known secrets ([demos/_kit/client.mjs:1490](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:1490)); a fresh successor embedded in that exception is unknowable to the sanitizer. The shared admin client has the same issue around `res.text()` ([packages/snapback-admin-client/index.mjs:88](/Users/ccheever/projects/snapback/packages/snapback-admin-client/index.mjs:88)), as does the embedded setup path.

    **Resolution criterion:** Name every affected implementation in the defect ledger and add poisoned reader-rejection tests for exchange, refresh, challenge request, console mint, and logout across the kit, shared admin client, coordinator, and embedded setup UI. All issuing-path reader failures must be replaced at the first boundary with fixed errors, before generic sanitization.

## 4. Suggestions

- Implement the first hosted slice using the single serialized-authority topology and disabled hosted administration. That proves the rest of the contract without simultaneously inventing distributed serving leases and an operator control plane.

- Introduce one deployment-bound `HostedAdmissionEpoch`, signed or conveyed through a provider-authenticated binding, containing the deployment identity, configuration hash, supported auth protocol, handler incarnation, operator-surface mode, limiter epoch, and invalidation authority. Requests and sockets would pin an epoch; rotation would refuse new work and drain old epochs. This could unify much of D4, D5, and D6.

- Replace `ServerContext.loopback: bool` with a sealed listener posture minted only by listener construction. Give non-network tests a separate composition type that cannot be attached to a socket.

- Use centrally leased emergency limiter permits and keyed PRF/HMAC bucket keys. This makes the outage bound auditable while avoiding a directory of attempted identities.

- Treat a future browser broker as a typed network broker, not a raw proof-signing API. It should accept closed operations and return closed projections, with user presence for high-impact actions where practical.

- Move the extensive as-built evidence and current defect inventory into an implementation appendix or companion plan. Keep the normative RFC focused on authorities, state machines, wire contracts, and acceptance invariants.

## 5. Open questions

- Which topology is the first implementation actually committing to: the single Durable Object authority or replicated lease holders?

- In the lease topology, must all old serving leases expire before the pending revocation marker is published, before durable commit, or before only the operation response? What validation point is the formal linearization boundary?

- What discriminator will a pre-marker handler already reject, and what authority supplies the handler incarnation and exact activation proof?

- Who signs or authenticates deployment attestations and live-health facts, how are they rebound after rollback, and what drains existing sockets when a fact is withdrawn?

- What mechanism provides first-contact HTTPS protection for custom domains and clients without cached HSTS state?

- Is public bearer v1 truly a supported product posture? If so, what exact acceptance artifact makes it deliberate, expiring, auditable, and deployment-bound?

- Is a challenge ID a secret, a capability component, or a non-secret correlation handle? What privacy and logging rules follow from that choice?

- What is the deployment-wide emergency throttle allowance, and how is it kept constant under autoscaling and process churn?

- Is hosted operator administration initially disabled, or is a separately authenticated operator origin part of the first hosted target?

- Which credential classes are in v2’s first sender-constrained slice, and does the broker own network execution or merely expose signing?

## 6. Readiness verdict

Not ready. The local hardening and opaque-failure fixes can proceed independently, but the RFC should remain Draft until the D4/D5/D6 state and wire contracts, first-contact TLS fact, limiter failure bound, custody classification, operator-origin admission, and C3 broker claim are resolved.

READINESS VERDICT: NOT READY

## Independent implementation review — 2026-07-15

### Provenance

- Reviewer family: GPT (OpenAI Codex)
- Provider/runtime: Codex CLI 0.144.4
- Model: `gpt-5.6-sol`
- Review mode: read-only, ephemeral, high reasoning effort
- Reviewed commit: `3e52f2b158f70fc2e19b7853e956c823b8f3800e`
- Human authorization: ENG-24996 completion request
- Secrets or redactions: none

### Verbatim review

READINESS VERDICT: READY

- MINOR: The direct-bearer headless seam remains browser-reachable. Record its removal or isolation as an explicit prerequisite before enabling hosted browser-positive admission.
- EDITORIAL: Status history for the former D4 serving-lease and `multiReplica` design can read as current. Label it superseded or move it to a changelog.

## Final implementation review — 2026-07-15

### Provenance

- Reviewer family: GPT (OpenAI Codex)
- Provider/runtime: Codex CLI 0.144.4
- Model: `gpt-5.6-sol`
- Method: read-only, ephemeral CLI; high reasoning effort; blind to `llp/reviews/`
- Reviewed commit: `62a11cedfb1ff7ad0258dc3e6ce667989b88b819`
- Human authorization: ENG-24996 completion request
- Secrets or redactions: none

### Review body (local Markdown links omitted)

## Overall assessment

The RFC is substantially stronger and the implemented local boundary is well supported, but two MATERIAL inconsistencies remain: the exhaustive credential-carrier matrix contradicts current transport code, and D6 conflicts with frozen LLP 0039 over wire-schema ownership.

Review was performed at exact HEAD `62a11cedfb1ff7ad0258dc3e6ce667989b88b819`. No review artifacts or secrets were read. `./ref-check --verbose` passed with 0 errors.

## Strengths

- D1 now has a credible unforgeable transport boundary: posture derives from the consumed listener, unknown posture fails closed, and the real `0.0.0.0` regression covers `/inspect` and `/auth/session`.
- Hosted capability honesty is precise. Closed enums, exact conjunction helpers, all-unavailable no-auth posture, schema closure, and unconditional current-target refusal are implemented and tested.
- D2–D5 make defensible security choices: predelivered first-contact protection, mutually authenticated edge-to-origin transport, canonical effective-source derivation, atomic charge-on-denial limiting, and serialized per-app invalidation authority.
- Issuing-path opacity is correctly implemented for challenge request, exchange, refresh, and console mint; tests cover malformed bodies, reader failures, unknown successors, numeric/property-name reflections, and one-byte collisions.
- The RFC consistently avoids claiming hosted auth, sender constraint, or active-XSS resistance from current local evidence.

## Concerns

- **MATERIAL — The “exhaustive” custody matrix forbids carriers the implementation requires.** C1 says every unnamed location is forbidden, but the admin-master row incorrectly names `Authorization`; code uses `x-snapback-admin-token`. The derived `sbcc_` and `AdminSecretRead` rows omit their required `x-snapback-console-credential` and `x-snapback-secret-read-lease` headers.
  **Resolution:** name each exact request/header carrier in the matrix and acceptance criteria, then make the existing transport tests explicitly trace back to those rows.

- **MATERIAL — D6’s wire-schema ownership contradicts frozen LLP 0039.** LLP 0060 says it owns the hosted envelope. Frozen LLP 0039 assigns the marker’s wire/serde schema and registration to LLP 0051 D4, leaving deployment ordering and proof to the hosted contract. LLP 0060’s own Status still calls the owner/wire form unresolved.
  **Resolution:** preserve LLP 0039’s split—0060 owns semantics, binding, rollout, and proof; 0051 D4 owns generated schema registration—and add LLP 0051 to Related plus a schema/drift-gate acceptance item. Alternatively, explicitly amend the frozen governing assignment.

- **MINOR — Stale serving-lease residue.** D5 lists “lease state” as v1 live health, while D4 explicitly eliminates serving leases and the concrete admission snapshot uses serialized-authority currency.
  **Resolution:** replace “lease state” with serialized-authority currency.

- **MINOR — Unsupported disposal claim.** C1 says the headless admin master is cleared when the client is disposed, but `AdminClient` exposes no disposal operation and retains an explicit token in `masterToken`.
  **Resolution:** implement and test deterministic clearing or remove the assertion.

- **EDITORIAL — “all-unavailable, bearer-v1 local posture” is self-contradictory.** The implemented default is `unavailable`, `unavailable`, `processLocal`, `singleProcess`, `bearerV1XssExposed`. Spell out the exact default tuple.

## Readiness verdict

**NOT READY**

Advisory only; no Status transition is implied.

## Blind final re-review — 2026-07-15 (`c38eabc`)

**Family:** GPT
**Provider/runtime:** OpenAI Codex CLI 0.144.4, `gpt-5.6-sol`, high reasoning, read-only ephemeral sandbox
**Redacted:** No
**Method:** Independent per-document review at exact commit `c38eabc75ae48fb186c3a39c9b9e7feff39145b8`; reviewer was instructed not to read `llp/reviews/` and made no edits or status decision.

### Review body

**Verdict READY**

**MATERIAL —** No material findings. The prior concern classes are resolved: LLP 0060 §C1 names the exact three shipped admin headers, matching `packages/snapback-admin-client/index.mjs` and passing credential tests; §D5’s local default tuple matches `HostedAuthCapabilities::local_target()` and the generated schema; §D4 removes v1 serving leases, while §C1 disclaims deterministic disposal/zeroization. `ref-check --verbose` passes, and §Acceptance accurately limits its claim to validating `@ref` annotations. Resolution criterion: none.

**MINOR —** LLP 0060 §D6 links to nonexistent LLP 0051 anchor `#d4-error-diagnostic-and-effect-envelopes`; the actual heading is “D4. Finish DK-7: the live envelope becomes schema-governed.” LLP 0039 §Observability and contract registration does substantively delegate the hosted marker schema to LLP 0051, so ownership is not materially ambiguous, but LLP 0051 itself does not explicitly enumerate D6’s request/response/host-call schemas. Resolution criterion: correct the anchor and explicitly add those three private hosted envelope schemas to LLP 0051 D4’s generated, registered, drift-gated inventory.

**MINOR —** LLP 0060 §D6 specifies `SNAPBACK_AUTH_HANDLER_INCOMPATIBLE`, but the code is absent from §Diagnostics and observability and LLP 0012’s reserved hosted/v2 diagnostic inventory. Resolution criterion: register its response class and exposure rules in LLP 0012 and list it in LLP 0060, or explicitly designate it as an internal-only control-plane outcome.

**MINOR —** LLP 0060 §Status claims a specific clean Chrome 150 execution, but commit `c38eabc` contains the rerunnable test (`admin-ui/tests/acceptance/csp-browser.mjs`), not a committed receipt recording that run and browser version. Resolution criterion: commit provenance-bearing output or phrase this as rerunnable acceptance rather than repository-verifiable historical evidence.

## Blind final implementation review — 2026-07-15

### Provenance

- Reviewer family: GPT (OpenAI Codex)
- Provider/runtime: Codex CLI 0.144.4
- Model: `gpt-5.6-sol`
- Method: read-only, ephemeral CLI; high reasoning effort; blind to `llp/reviews/`
- Reviewed commit: `8f03e42`
- Human authorization: ENG-24996 completion request
- Secrets or redactions: none

### Verbatim review

VERDICT NOT READY

MATERIAL

- LLP 0059 overstates executable evidence for reentrant resume synchronization. It claims the composed Contract regression proves that a successor-resume durable reload neither recursively replays the barrier nor starves completion (`llp/0059-session-projection-and-client-barrier.spec.md:1998`). The composed test mounts single- and multi-live surfaces, but its client’s `authSession()` is a no-op (`packages/snapback-contract/auth-coordinator-contract.test.mjs:154`), while the real surfaces’ resume handlers only update capture and schedule refresh (`packages/snapback-contract/index.mjs:2393`, `packages/snapback-contract/index.mjs:3900`). Consequently, that test never performs the claimed nested `coordinator.synchronize()` during resume.

  The new coordinator unit tests do exercise exact-match owner and peer reentry (`packages/snapback-contract/auth-coordinator.test.mjs:412`, `packages/snapback-contract/auth-coordinator.test.mjs:450`), but only with synthetic participants. They also omit the security-relevant negative case required by LLP 0059: a different durable revision/epoch/authority encountered during resume must not be treated as the local successor (`llp/0059-session-projection-and-client-barrier.spec.md:1373`).

  Resolution criteria: add a genuinely composed regression using the real single- and multi-live Contract surfaces whose resume-triggered refresh performs a nested synchronization, covering both owner and peer paths, once-only resume, bounded completion, and no premature publication. Add a changed-durable-record negative case proving stale authority remains unpublishable. Alternatively, narrow LLP 0059’s acceptance and evidence claims to exactly what the existing synthetic tests establish.

MINOR

- None. Cross-document ownership is coherent: LLP 0060 owns hosted marker semantics and rollout proof (`llp/0060-hosted-auth-security.rfc.md:525`), while LLP 0051 owns shared wire authorities, schemas, registration, and drift gates (`llp/0051-capability-negotiation.spec.md:628`).

The targeted coordinator, composed Contract, and client suites pass, and `ref-check` reports no errors; the blocker is the material mismatch between claimed and executed acceptance evidence.

## Targeted follow-up review — 2026-07-15 (`5c23b44`)

**Reviewer family:** GPT (OpenAI Codex)
**Provider / runtime:** OpenAI Codex CLI v0.144.4 (`codex exec`, non-interactive), model gpt-5.6-sol, high reasoning effort, read-only sandbox, blind to archived reviews.
**Reviewed:** committed repository state `5c23b44`.

### Review body (verbatim)

## VERDICT READY

### MATERIAL

None.

### MINOR

None.

### Evidence and resolution

- Resume synchronization is exact-or-stale: reentrant reloads compare durable revision, epoch, and authority key without starting a nested barrier; pre-barrier adoption completions are confirmation-only or stale.
- Deterministic owner/peer changed-durable tests prove one resume, closed failure, no obsolete capture, and later clean successor adoption.
- Real single- and multi-live Contract participants await durable synchronization inside resume; the composed test verifies every real Contract participant resumes exactly once.
- Format-2 custody validates the complete transition intent and its authority-key/digest bindings. Recovery selects the proven same-user transition, clears runnable queues, and preserves payloads only as principal-bound `replayable:false` stranded work.
- The 0057 clock-floor boundary, 0058 witness/cache/schema/readiness evidence, and 0059 provenance/deadline/Contract evidence wording are corrected.

Focused tests passed: coordinator, Contract barrier, client-store authority; `ref-check --verbose` passed with 0 errors. Worktree remained unchanged.

### Review body (verbatim)

## VERDICT READY

### MATERIAL

None.

### MINOR

None.

### Evidence and resolution

- Resume synchronization is exact-or-stale: reentrant reloads compare durable revision, epoch, and authority key without starting a nested barrier; pre-barrier adoption completions are confirmation-only or stale. [auth-coordinator.mjs](/Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/auth-coordinator.mjs:686), [auth-coordinator.mjs](/Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/auth-coordinator.mjs:1205)
- Deterministic owner/peer changed-durable tests prove one resume, closed failure, no obsolete capture, and later clean successor adoption. [auth-coordinator.test.mjs](/Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/auth-coordinator.test.mjs:492), [auth-coordinator.test.mjs](/Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/auth-coordinator.test.mjs:547)
- Real single- and multi-live Contract participants await durable synchronization inside resume; the composed test verifies every real Contract participant resumes exactly once. [index.mjs](/Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/index.mjs:2393), [index.mjs](/Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/index.mjs:3907), [auth-coordinator-contract.test.mjs](/Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/auth-coordinator-contract.test.mjs:397)
- Format-2 custody validates the complete transition intent and its authority-key/digest bindings. Recovery selects the proven same-user transition, clears runnable queues, and preserves payloads only as principal-bound `replayable:false` stranded work. [auth-coordinator.mjs](/Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/auth-coordinator.mjs:237), [client-store.mjs](/Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/client-store.mjs:1240), [client-store-authority.test.mjs](/Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/client-store-authority.test.mjs:870)
- The 0057 clock-floor boundary, 0058 witness/cache/schema/readiness evidence, and 0059 provenance/deadline/Contract evidence wording are corrected. [0057](/Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/llp/0057-auth-provider-protocol.spec.md:155), [0058](/Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:796), [0059](/Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/llp/0059-session-projection-and-client-barrier.spec.md:1959)

Focused tests passed: coordinator, Contract barrier, client-store authority; `ref-check --verbose` passed with 0 errors. Worktree remained unchanged.

## Final blind review — 2026-07-15 (`3ac0473`)

### Provenance

- Reviewer family: GPT (OpenAI Codex)
- Provider/runtime: runtime metadata was not included in the received review artifact
- Method: independent blind final review received through the parent ENG-25001 orchestration
- Reviewed commit: `3ac047322d055fad03e8308fdc0905d758eb9f61`
- Source artifact: `/private/tmp/eng25001-final2-codex-0060.md`, sha256 `c6093955d220c3cc9af21da6e5b693abc900f100eec4b4a47d03e87e487df1c0`
- Human authorization: ENG-25001 completion request
- Secrets or redactions: none

### Verbatim review

VERDICT: NOT READY

MATERIAL
- The credential-issuing paths are not fully opaque. LLP 0060’s exhaustive custody matrix forbids every credential class from errors, but C1 limits opaque handling to failures after a 2xx response. On non-2xx responses, the kit, shared admin client, and embedded setup client still expose response-controlled diagnostic text after redacting only credentials already known to the client. A newly issued credential is necessarily unknown, so it escapes. Read-only probes confirmed this for console mint and challenge request. The ENG-25001 claim that issuing-path opacity is closed is therefore false.
- Hosted admission omits a mandatory browser-custody gate. C1 requires structural exclusion or disablement of the direct-bearer seam as a positive prerequisite for hosted-browser admission, yet D5 says there are exactly two non-enum admission gates—D6 compatibility and operator-surface isolation—and `HostedAdmission` carries neither a direct-bearer exclusion fact nor a client-artifact/protocol binding that proves it. The hosted acceptance matrix also omits this prerequisite. Consequently the supposedly closed admission object can declare readiness while the browser artifact retains a bearer downgrade seam, contradicting C1 and the no-public-bearer rule.

MINOR
- LLP 0059’s prose and acceptance inventory have not caught up with commit `3ac0473`’s second delayed-pre-barrier cut. They describe completion during successor resume while an active barrier exists, but do not explicitly record completion after the barrier has completely cleared. The implementation and executable regression do close both cuts, so LLP 0060 no longer depends on the old race; this is governing-document drift rather than a remaining implementation defect.

EVIDENCE
- `llp/0060-hosted-auth-security.rfc.md:645-661` explains why unknown newly issued credentials require opaque failures but scopes the rule to post-2xx read/parse/shape failures; `llp/0060-hosted-auth-security.rfc.md:668-673` simultaneously forbids credentials in all errors.
- `demos/_kit/client.mjs:1641-1654`, `packages/snapback-admin-client/index.mjs:116-127`, and `src/admin/setup.html:275-280` expose non-2xx response-controlled diagnostics after only known-secret redaction.
- Read-only probes returned `{"surface":"admin-console-mint-non2xx","code":"ISSUER_FAILED","unknownCredentialEscaped":true}` and `{"surface":"challenge-request-non2xx","code":"ISSUER_FAILED","unknownIssuedValueEscaped":true}`.
- `llp/0060-hosted-auth-security.rfc.md:602-616` makes structural direct-bearer exclusion mandatory. `llp/0060-hosted-auth-security.rfc.md:479-493` nevertheless identifies only D6 and C2 as extra admission gates; `llp/0060-hosted-auth-security.rfc.md:507-518` defines the closed snapshot without that custody fact; `llp/0060-hosted-auth-security.rfc.md:926-937` omits it from hosted acceptance.
- The remaining ENG-25001 design resolutions are substantively present: serialized per-app authority at `llp/0060-hosted-auth-security.rfc.md:355-395`; no bearer-v1 waiver at `:418-431`; predelivered first-contact transport at `:241-269`; centralized charge-on-denial limiting at `:294-353`; old-receiver-safe D6 binding and both preflight domains at `:520-585`; disabled first hosted operator surface at `:732-750`; and future/local claim separation at `:1009-1048`.
- LLP ownership remains aligned: frozen LLP 0039 assigns marker schemas to LLP 0051 and hosted rollout proof to LLP 0060 at `llp/0039-auth-vertical-slice.rfc.md:1436-1444` and `:1629-1642`; LLP 0051 accepts that inventory at `llp/0051-language-neutral-data-tier.rfc.md:603-637`.
- Static implementation claims are accurate: `src/auth/deployment.rs:112-157` implements `no_auth_target()`, `deployment_capable()`, and `hosted_auth_capable()`; `src/auth/deployment.rs:210-220` refuses every current hosted request without admission authority; `cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json:20-26` reports all no-auth axes as `unavailable`.
- Commit `3ac047322d055fad03e8308fdc0905d758eb9f61` changes only `packages/snapback-contract/auth-coordinator.mjs` and its test. `auth-coordinator.mjs:1218-1277` now compares every delayed ownership result against current authority even after `activeBarrier` is gone. `auth-coordinator.test.mjs:602-660` covers completion during successor resume, and `:662-703` covers completion after the barrier clears.
- Focused command `node packages/snapback-contract/auth-coordinator.test.mjs && node demos/_kit/tests/auth-coordinator-client.mjs && node admin-ui/tests/admin-client-credentials.mjs && node admin-ui/tests/setup-credential-errors.mjs` passed all four suites.

## FINAL3 blind review — 2026-07-15 (`bd7d1da`)

### Provenance

- Reviewer family: GPT (OpenAI Codex)
- Provider/runtime: runtime metadata was not included in the received review artifact
- Method: independent blind final review received through the parent ENG-25001 orchestration
- Reviewed commit: `bd7d1da6d458439081a60c6fe06fe700edc678cf`
- Source artifact: `/private/tmp/eng25001-final3-codex-0060.md`, sha256 `c0e2f27b5e83baca1f5718e89ce9f41b45660359cc4608ef1a0a82b8ac1ca6ee`
- Human authorization: ENG-25001 completion request
- Secrets or redactions: none

### Verbatim review

VERDICT: NOT READY

MATERIAL
- Credential-response opacity breaks deliberate typed recovery. `authRefresh()` converts the specified HTTP 409 `SNAPBACK_AUTH_REFRESH_SUPERSEDED` into `SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID` before its supersession handler can wait/reload, invoke the family alarm, or compare-and-clear. This contradicts LLP 0039/0057/0059’s frozen recovery protocol and can strand a healthy rotated family. Resolution criterion: reconstruct a fixed local error for a closed route/status/code allowlist—at minimum refresh 409—while discarding all response-controlled message/details/header bytes; reconcile other deliberate exceptions such as `CODE_INVALID`/`CODE_LOCKED`; and add an end-to-end 409 test proving successor wait/reload or alarm-before-clear without credential leakage. Arbitrary issuer failures must remain opaque.

MINOR
- None

EVIDENCE
- `demos/_kit/client.mjs:1641-1655` replaces every opaque-path non-2xx response before diagnostics are classified; `:1747-1753` enables that behavior for refresh; `:1790-1797` can recover only if the now-unreachable typed supersession code survives.
- `llp/0059-session-projection-and-client-barrier.spec.md:1551-1566` requires bounded wait/reload and alarm-before-clear for refresh supersession. `llp/0039-auth-vertical-slice.rfc.md:1338-1350` and `llp/0057-auth-provider-protocol.spec.md:748-756,1079-1094` specify the exact 409 recovery outcome and other deliberate typed exceptions.
- `src/server.rs:7935-7944,13989` emits and maps refresh supersession to HTTP 409; test `auth_refresh_and_logout_routes_enforce_exact_carriers_and_statuses` at `src/server.rs:18685-18750` asserts that public status/code.
- Executable `bun -e` refresh-supersession probe produced `{"code":"SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID","paths":["/auth/session","/auth/exchange","/auth/session","/auth/refresh"]}`—no `/auth/family-alarm`. Existing `demos/_kit/tests/auth-coordinator-client.mjs:540-550` tests only generic opaque refresh failures and misses typed 409 recovery.
- Unknown/invalid local credentials share `SNAPBACK_AUTH_REQUIRED`: `src/auth/coordinator.rs:784-850`; matrix test `session_auth_credentials_precede_refresh_and_logout_body_errors`, `src/server.rs:19520-19599`. Deliberate terminal/superseded states remain typed. Shared response controls apply `no-store, private` at `src/server.rs:4544-4604`; family-alarm opacity and minimum delay are tested at `:20887-20964`.
- Hosted serving remains fail-closed. `src/auth/deployment.rs:216-269` defines the closed admission facts including direct-bearer exclusion; `:343-429` covers static and admission negatives. `schemas/auth.hosted-admission.schema.json:87-173` requires the seam fact and rejects unknown fields. Hosted is refused unconditionally at `src/auth/deployment.rs:299-311`, before target creation at `src/cli.rs:1471-1491`, and again for embedded app-data serving at `src/server.rs:4994-5013`; tests are `hosted_auth_request_refuses_before_database_creation` and `hosted_auth_configuration_is_fail_closed_in_embedded_composition`.
- The retained direct-bearer constructor is visibly headless/local at `demos/_kit/client.mjs:872-901,1020-1028`; because hosted admission cannot currently succeed, no alternate hosted direct-bearer path was found.
- `bun admin-ui/tests/admin-client-credentials.mjs && bun admin-ui/tests/setup-credential-errors.mjs && bun demos/_kit/tests/auth-coordinator-client.mjs` passed, demonstrating the regression is absent from the committed matrix rather than caught by a red test.
- `git rev-parse HEAD` returned `bd7d1da6d458439081a60c6fe06fe700edc678cf`; scoped tracked status was clean.
