**Reviewer family:** GPT (OpenAI Codex)
**Provider / runtime:** OpenAI Codex CLI v0.144.4 (`codex exec`, non-interactive), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, workdir = repo root, session id 019f62c9-0711-7e22-ba50-e399c26192ad; 373,291 tokens used. Orchestrated by the ENG-24996 cross-family review gate (LLP 0005 review loop via /llp-review).
**Date:** 2026-07-14
**Redacted:** no redaction applied — no secrets in the reviewed material; reviewer instructed not to read `.agent-local-secrets.md`, credential files, or `llp/reviews/`, and not to quote secret material. Sending repository content to OpenAI was authorized by the human-directed ENG-24996 review-gate assignment.
**Method:** cli-runner — fresh session, blind to all archived reviews. The brief identified the document as a mixed RFC (ENG-24607) — part landed local enforcement/claim-honesty boundary, part deliberately-unbuilt hosted/browser-v2 future — and directed the reviewer at spec-vs-code fidelity for the implemented boundary and soundness of the pinned future contract, with MATERIAL/MINOR/EDITORIAL severities.

# LLP 0060 reviews — GPT family

## Round 1 — 2026-07-14

**Reviewed:** `llp/0060-hosted-auth-security.rfc.md`, sha256 `09eb415d0d95d269bba792f916aca9ee7403d6386f28412a5b9ad57cca80cfef` (committed at repo HEAD `fdfdd94`).
**Verdict:** NOT READY

### Review body (verbatim)

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