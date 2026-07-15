**Reviewer family:** GPT (OpenAI Codex)
**Provider / runtime:** OpenAI Codex CLI v0.144.3 (`codex exec`), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, session id 019f5efa-ad47-71f2-92e6-5ccc34cbc243; orchestrated by /llp-super-refine
**Date:** 2026-07-13
**Redacted:** no redaction applied — no secrets in the reviewed material; reviewer instructed not to read `.agent-local-secrets.md`, credential files, or llp/reviews/. Sent to OpenAI under explicit human invocation of /llp-super-refine.
**Method:** cli-runner

# LLP 0055 reviews — GPT family

## Round 1 — 2026-07-13

**Revision under review:** `llp/0055-agent-principals-and-scoped-grants.rfc.md`, sha256 `104cca0d429f260c5a992fb58ce15f30291ec27fa37e749b48fd4d8c3684fd9b` (untracked working-tree file; repo HEAD `c804284`)
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

The proposal addresses a real and important gap. The actor/effective-principal/grant decomposition is the right conceptual foundation, and representing autonomous agents in the existing application-principal space is substantially cleaner than inventing parallel agent-only membership, profile, and RLS systems. The distinction between declared agent kind and credentialed identity is also unusually honest.

The document is not ready, however. Several security-critical mechanisms remain at sketch altitude, and there are direct contradictions with LLP 0039 and Accepted LLP 0053. Most concretely, the proposed `sbat_` scoped-token prefix is already used by Snapback’s local administrator token. More structurally, the RFC says it separates operator-plane and application-plane agents but then tries to authorize both with an app-local `_auth_users` principal and a scope grammar containing only generated functions. It also misclassifies credential loss as an authorization-version event, misuses `AuthorizedLease` as rationale for token TTL, and does not bind service-principal authority into connection expiry, retained state, replay, or the exact sealed `ctx.auth` contract.

The direction is good, but this needs a substantial revision while remaining Draft. I would separate app-data agent delegation from hosted operator service principals, or at least give them distinct issuer and scope domains while retaining the common actor/effective/grant envelope. The current implementation contains useful route-policy and host-ops scaffolding, but no session resolver, `_auth_*` catalog, `servicePrincipal`, or `mintSession` implementation that resolves these ambiguities implicitly.

## 2. Strengths

- The separation of operator identity, application identity, and attestation is excellent framing. It prevents “agent” from becoming an overloaded security claim. (§Summary)

- Reusing the Snapback user-id space for application-plane agents avoids parallel profile, membership, RLS, and join semantics. (§Principal kinds)

- Making `ctx.auth.userId` the effective principal while separately exposing the actor is the right compatibility choice for delegation. Existing membership and visibility checks remain applicable without pretending the agent is the human. (§Resolved authority: `servicePrincipal`)

- The proposed split between a long-lived credential and short-lived scoped tokens is sound least-privilege structure, as is the rule that an invalid presented credential never falls through to anonymous. (§Credentials and tokens)

- Closed, host-enforced scopes checked before handler execution are preferable to free-form claims interpreted by application code. The “may narrow, never widen” rule is correct. (§Grants)

- The RFC is appropriately candid that `kind: "agent"` is self-declared and not attestation. (§Attestation, honestly)

- Registration defaults to disabled, distinguishes invited from open registration, and acknowledges that loopback throttling is not Sybil resistance. (§Registration)

- Keeping grants and credentials in the protected `_auth_*` catalog and excluding credential material from logical export follows LLP 0039’s identity-core boundary. (§Catalog and lifecycle)

- The sequencing claim is honest: this is post-0039 work, not a hidden prerequisite for the frozen slice. The source corroborates that distinction: `src/server.rs` currently rejects presented session bearers as unavailable rather than pretending resolution exists. (§Non-Goals; §Status; `src/server.rs:2516-2527`)

## 3. Concerns

1. **Severity: MATERIAL — The scoped-token prefix and credential carriers conflict with existing authority.**

   **Evidence:** §Credentials and tokens assigns `sbat_` to scoped agent tokens. Snapback already mints its local administrator capability with exactly that prefix in `src/admin.rs:448-450`. LLP 0039 §Authority resolution also says that under sessions, `Authorization` is reserved for session bearers, while the target says agent tokens use `Authorization` “under the same credential-precedence rules.” The credential carrier for `POST /auth/agents/token` is not specified at all.

   **Resolution criterion:** Select a unique, registered prefix for every credential class and add collision tests against admin tokens, session tokens, secret-read leases, console credentials, and connection tokens. Specify exact headers and route-registry credential-resolution modes for both the long-lived agent credential and scoped token. Define deterministic class dispatch, malformed-token behavior, and cross-class substitution tests; no session, agent, or admin token may fall through into another resolver.

2. **Severity: MATERIAL — The claimed operator-plane/application-plane unification has no authority model for operator operations.**

   **Evidence:** §Summary says an agent can “deploy, inspect, run functions” as an operator, but the only principal store defined is the app-local `_auth_users` catalog and the only v1 scopes are `fn:*`. LLP 0024 §Authority Tuple still requires `AdminRead` or `AdminWrite` for inspection, loading, reset, and mutation/action execution. LLP 0056 §Global roles explicitly says application roles never satisfy operator-plane authorities. LLP 0017 §Security Defaults additionally requires hosted admin requests to be bound to an app/project and actor. Neither operator scopes, project binding, bootstrap issuance, nor a mapping to `AdminRead`/`AdminWrite` is defined.

   **Resolution criterion:** Either narrow this RFC to application-data service principals and unreserve `servicePrincipal` only for generated app-function calls, or define a separate operator issuer and closed operator scope grammar covering each host operation, app/project target, environment, and admin permission. State explicitly that app-issued grants can never satisfy operator-plane policy unless an operator authority deliberately issued them.

3. **Severity: MATERIAL — Registration, credential, token, invitation, and consent state machines are under-specified.**

   **Evidence:** §Grants gives fields only for `_auth_grants`, while the RFC relies on durable credentials, scoped tokens, invitations, credential rotation, credential revocation, and agent deactivation without defining their catalog records or transitions. `_auth_identities.subject = credential id` leaves rotation semantics ambiguous. `POST /auth/agents/token { grantId }` does not explicitly require the credential’s principal to equal `grant.actor_user_id`, allowing a dangerous implementation mistake. The delegated flow is merely “OAuth-consent-shaped,” with no actor-bound request, nonce, expiry, CSRF rule, approval endpoint, or delivery rule. In invited mode, every authenticated human appears able to mint an invitation; no app authorization rule is named. Normative `open` mode is simultaneously questioned in §Open Questions.

   **Resolution criterion:** Pin field-and-invariant shapes comparable in rigor to LLP 0039’s session catalog: credential/token/invitation records, entropy and hashing/signing, generations, rotation, revocation, expiry, deactivation, caps, GC, and atomic transitions. Require token issuance to validate actor equality, effective principal, app/tenant, grant status, credential generation, and scope canonicalization without creating an existence oracle. Define the complete invitation and delegated-consent protocol, including who may invite, request/approval binding, CSRF and replay protection, TTL, and concurrent approval/revocation behavior. Decide whether `open` ships and under which deployment capabilities.

4. **Severity: MATERIAL — The invalidation classification contradicts Accepted LLP 0053.**

   **Evidence:** §Revocation is an authorization event says agent deactivation and grant revocation are permission-backing writes that advance the authorization version “exactly as a session revocation does.” LLP 0053 §The authorization-event universe (closed) states the opposite: session revocation is deliberately not an authorization event; it is an authority transition using client-wide `delete`. Moreover, §Catalog and lifecycle places `_auth_grants` outside the app manifest and journal, so merely calling it `permissionBacking` does not put it through LLP 0053 event 1. Finally, §Grants calls `SNAPBACK_AUTH_GRANT_SCOPE_DENIED` a trusted denial, while LLP 0053 §Dispositions says the only trusted terminal code is `SNAPBACK_AUTH_PERMISSION_DENIED` from its enumerated producers.

   **Resolution criterion:** Classify every transition explicitly. Credential revocation, principal deactivation, and any grant/token revocation that terminates the bound service authority must use the LLP 0039 authority-transition generation fence and `delete` semantics. Any permission change that leaves authority alive must be registered in LLP 0053’s closed event universe and use its transactional version hook, commit-ordered room barriers, quarantine, proof, and ACK rules. Either map grant-scope denial to the existing trusted permission-denial outcome with a typed subtype or formally amend LLP 0053’s trusted-producer enumeration.

5. **Severity: MATERIAL — Clock expiry does not close live authority, and `AuthorizedLease` is used for the wrong purpose.**

   **Evidence:** §Revocation says token TTL and the lease bound grant expiry. LLP 0053 §The lease defines `AuthorizedLease` solely as a bound on an honest offline client reading retained bytes; it is not a server credential or live-connection revocation mechanism. Per-invocation validation also cannot stop a live subscription or protected room that emits without a new app-data invocation. LLP 0039 §Session transport and connection binding therefore requires deadline-indexed session expiry and closes bound connections.

   **Resolution criterion:** Clamp token expiry to the grant and every credential/principal deadline. Bind actor, effective principal, grant id, credential generation, token deadline, and grant deadline into the connection authority. Add deadline-driven suspension/close behavior for durable subscriptions and protected rooms, with typed client handling and the correct authority transition. If retained service-principal data is allowed, extend `AuthorizedLease` with token/grant clamps and exact authority binding; otherwise explicitly prohibit retention. Validate expiry before, during, and after connection establishment.

6. **Severity: MATERIAL — The proposed `ctx.auth` shape conflicts with 0053’s sealed profile and with retained/replay identity.**

   **Evidence:** §Resolved authority adds `kind` and `actor`, but LLP 0053 §The authorization-event universe pins exact mode-specific sealed `ctx.auth` records and says extra keys are impossible. LLP 0039 and LLP 0053 also require retainable results to depend only on `userId`; two delegated agents or grants may share the same effective user while producing different results if code reads `actor`, `provider`, or grant identity. Current replay identity in `src/manifest.rs:1343-1355` contains only `principal`, `session_id`, and `user_id`, so it cannot distinguish a direct user session from delegated authority under the same effective user. There is also a sibling inconsistency: LLP 0056 §Agents says `auth.kind` supports “humans only” rules, but the target defines it as the effective principal’s kind. A delegated agent for a human would therefore appear human unless the rule can inspect the actor.

   **Resolution criterion:** Define a versioned exact service-principal projection and amend the 0039/0053 protected-query profile explicitly. Distinguish `effectiveKind`, `actorKind`, and delegation status in analyzable auth variables; update LLP 0056’s humans-only claim and add a delegated-agent negative test. Specify which dimensions make a function online-only. Bind actor, grant, credential generation, and authority instance into replay, queue, connection, and store fences so work from one grant cannot replay under a direct session or another grant.

7. **Severity: MATERIAL — Scope meaning is unstable across deployment and incomplete across invocation kinds.**

   **Evidence:** `fn:query:*` and `fn:mutation:*` do not say whether they cover functions added after consent. A later deployment can therefore silently expand a grant’s authority. `fn:<functionId>` does not bind function kind, so a query-to-mutation change may preserve authority unexpectedly. Current implementation does not yet guarantee the prerequisite: `FunctionDefinition.id` is optional in `src/manifest.rs:562-568`. Actions are not given an explicit posture, despite being the highest-risk function kind. Nested `ctx.runMutation` scope behavior is also not validation-pinned.

   **Resolution criterion:** Require canonical, non-optional, app-bound stable function ids before grants can land. Specify whether wildcards mean current functions, current-and-future functions, or an expansion captured at consent; for delegated grants, expansion-at-consent or explicit re-consent is the safer v1 choice. Bind kind and an authorization-policy/activation generation where necessary. State whether actions are forbidden or separately scoped, and require scope checks on every nested invocation rather than only the outer handler.

8. **Severity: MATERIAL — Backup restore and logical export can resurrect revoked authority.**

   **Evidence:** §Catalog and lifecycle says declared restore revokes restored agent tokens, but not restored long-lived credentials or grants. Restoring an older backup can therefore resurrect a credential or grant revoked after the backup; the credential can immediately mint a new token. Logical export includes grants while excluding the sessions referenced by `created_by`, leaving both dangling provenance and unclear reactivation semantics. LLP 0039’s analogous restore procedure revokes every restored session, not merely its current bearer.

   **Resolution criterion:** A declared restore must invalidate all restored agent credentials and derived tokens and either revoke all grants or mark them inert pending explicit re-consent/reissuance. Rotate the authorization-stream incarnation in the same boundary. Define whether logical export excludes grants, imports them revoked, or rekeys them into a non-authoritative history form, and use tagged provenance that remains meaningful when sessions do not export. Add backup-before-revocation → revoke → restore adversarial tests for credentials, grants, and tokens.

9. **Severity: MATERIAL — The audit guarantee is asserted without an audit substrate.**

   **Evidence:** §Audit says every invocation envelope records the tuple and §Attestation refers to a truthful “audit trail.” LLP 0019 F8 explicitly states that Snapback has no general mutation-audit substrate. A response envelope is not a durable audit record, and ordinary HTTP app-data calls, nested calls, live reruns, room operations, and pre-handler denials do not all use the host-ops envelope. The RFC specifies neither event schema, persistence, retention, target/app binding, failure records, redaction, nor commit linkage.

   **Resolution criterion:** Either narrow the claim to “authority attribution fields in existing result envelopes” and leave durable audit explicitly out of scope, or define the audit event contract and sink required before hosted mutation authority is enabled. At minimum it must cover actor, effective principal, grant, credential generation, target app/project, function/operation, request id, outcome, dry-run/commit status, commit version, denial subtype, and redaction.

10. **Severity: MATERIAL — The validation requirements would not catch the important failure modes.**

    **Evidence:** §Validation Requirements covers happy-path registration, one scope denial, basic delegation, and one mid-connection revocation. It does not cover prefix or credential-class substitution; wrong-actor token minting; consent/CSRF/replay races; credential rotation/revocation; deactivation; live expiry; connection authority binding; protected rooms; lost delivery or ACK; retained data and lease clamps; stale callbacks; queued replay; activation-driven scope expansion; nested calls; actions; restore resurrection; catalog caps; or concurrency. LLP 0053’s accepted contract is explicitly adversarial and would not be proven by “clears through the machinery.”

    **Resolution criterion:** Replace the current list with a route/credential/authority matrix plus generated concurrency and fault schedules. Reuse LLP 0053’s obligation-loss, room-sink, reconnect, retained-store, callback-fence, and ACK tests under service-principal authority. Add cross-class token substitution, cross-agent grant access, concurrent mint/revoke/rotate, consent replay, activation change, expiry, backup/restore, capacity, and audit-parity fixtures. The tests must demonstrate the exact disposition and authority transition, not merely eventual absence of a row.

## 4. Suggestions

- Split the work into an application-principal/delegation RFC and an operator service-principal RFC. Reuse one tagged authority envelope while keeping issuer domains and privilege vocabularies separate.

- Use a structured canonical scope IR in storage rather than serialized scope strings. Render strings only at API boundaries.

- For headless agents, consider a device-authorization-style consent flow: the agent receives a short code and verification URL, while the user approves from an existing session. This avoids redirect-URI and browser-custody complexity.

- Rename durable authorization grants or connection capability grants so the two different “grant” concepts cannot be confused in code and diagnostics.

- Report agent-auth capabilities in the target capability manifest: supported credential protocol, registration mode, maximum token TTL, retention support, sender-binding support, and hosted/operator support.

- Define `provider` semantics carefully. In delegated authority it currently describes the actor’s authentication method while `userId` and `kind` describe the effective principal; separate fields would be less surprising.

- Keep the default autonomous scope empty. Apps can opt into a non-empty template, but implicit wildcard authority should never be the framework default.

- A later, non-standard enhancement could allow attenuation-only child tokens: an agent may derive a shorter-lived token with a strict subset of its current grant, never widen or change the effective principal. This could improve compartmentalization without enabling delegation chains.

## 5. Open questions

- Is `servicePrincipal` intended to authorize only app-data function invocation, or also hosted deploy, inspect, reset, and schema/function loading?

- Are operator principals app users, project-level identities, deployment-level identities, or a distinct issuer namespace?

- Are scoped tokens opaque database-backed secrets or signed self-contained tokens, and which durable lookups remain mandatory per invocation?

- Does revoking a grant terminate the entire bound authority instance, or can some grant changes leave the authority alive and use query-scoped reauthorization?

- May service-principal clients retain data offline? If so, what exact token, grant, actor, and deadline fields extend `AuthorizedLease`?

- Does a wildcard grant cover functions created after consent? Does `fn:<id>` survive a function-kind change?

- Are actions available to service principals in v1?

- What analyzable rule should an app write for “a human must be the actual actor,” not merely the effective principal?

- Who may create invitations and autonomous grants, and can an app express that authorization using ordinary membership/rule machinery?

- What happens to active grants on credential rotation, agent deactivation, logical import, and declared physical restore?

- Is a durable audit log required before hosted mutations are unreserved, or is envelope attribution the only v1 promise?

- Must `open` registration wait for the hosted deployment-security contract and enforceable principal/credential quotas?

## 6. Readiness verdict

The core idea is strong, but unresolved material issues remain in credential namespace, plane separation, consent and lifecycle state machines, 0053 coherence, live expiry, retained/replay authority, scope stability, restore safety, audit, and validation. The document should remain Draft and be re-reviewed after those contracts are pinned.

VERDICT: NOT READY
### Orchestrator verification notes — round 1 (not part of the received review)

Decisive factual claims spot-checked against the repository by the orchestrating session; the verbatim body above is unaltered:

- `sbat_` prefix collision CONFIRMED: `mint_admin_token()` already formats `"sbat_{uuid}"` (`src/admin.rs:448-450`). The proposed scoped-token prefix collides with the existing local admin token class.
- LLP 0053 deliberately excludes session revocation from the authorization-event universe (`llp/0053:375-376`); authority transitions use client-wide `delete` (`:998`).
- Sealed mode-specific `ctx.auth` ("extra keys … impossible") confirmed (`llp/0053:410-421`).
- Replay identity carries only `principal`/`session_id`/`user_id` (`AuthInput`, `src/manifest.rs:1343-1348`).
- `FunctionDefinition.id` is `Option<String>` (`src/manifest.rs:562-564`).
- LLP 0019 F8 confirms the audit substrate itself is missing (`llp/0019:288-296`).
- The cited `src/server.rs:2516-2527` bearer refusal (`SNAPBACK_AUTH_POLICY_UNAVAILABLE`) is exact.

## Round 2 — 2026-07-13

**Provenance:** OpenAI Codex CLI v0.144.3 (`codex exec`), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, fresh session id 019f5f14-309f-76a1-9ac7-177ce194ea70; method cli-runner; no redaction needed (no secrets in scope); reviewer barred from llp/reviews/.
**Revision under review:** `llp/0055-agent-principals-and-scoped-grants.rfc.md`, sha256 `e5f377b47f96b2fa4eb4a8ce2ccbf61ce722205e85dfff110b7163db4788edae` (post-round-1 revision)
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

The proposal has a strong architectural core. Modeling agents as durable user principals, separating long-lived credentials from short-lived scoped tokens, and representing delegation through explicit actor/effective-user identities is substantially better than treating an agent as a special session or allowing it to impersonate a human implicitly. It directly addresses the F2 gap in LLP 0019 and composes plausibly with LLP 0056’s role and membership model.

The draft is also appropriately conservative about attestation, internal calls, retained results, and self-escalation. Its use of immutable grants and authorization-transition invalidation generally follows LLP 0053’s model. The actual implementation is still well behind this design—the runtime has no `servicePrincipal` resolver, and session bearer resolution itself remains unavailable—but the RFC mostly acknowledges those prerequisites.

However, this is not yet a closed or safe authorization protocol. The recredentialing rules permit an apparent agent-account takeover path; credential and token identities are missing from the authority-fencing tuple; the proposed scope representation cannot enforce its claimed function-kind binding; restore can resurrect spent invitations; the consent/request state machine is incomplete; and the hosted and operation-plane boundaries remain contradictory or underspecified. Several of these problems would survive the current Validation Requirements. The direction is good, but the document is not ready to govern implementation.

## 2. Strengths

- The separation of principal, credential, grant, and scoped token is excellent. It avoids conflating durable identity with possession of a particular bearer secret and gives revocation several useful levels of granularity (§“Principal kinds and identity records,” §“Credentials and token families,” §“Grants”).

- The resolved authority model preserves both the agent actor and an optional effective human user. That is the right foundation for explainable delegation and is coherent with LLP 0056’s rule that memberships are evaluated for the effective principal (§“Resolved authority,” §“Delegation semantics”).

- The proposal consistently rejects agent self-authorization: an agent may request authority but cannot approve its own delegated grant, and production grant creation remains tied to a human or operator decision (§“Consent flow,” §“Grant issuance”).

- Grant immutability and the classification of grant expiry, credential revocation, and principal deactivation as authority transitions align well with LLP 0053’s invalidation model (§“Ending authority and revocation”).

- Requiring explicit action scopes, expanding delegated wildcards at consent time, and refusing silent wildcard growth are sound least-authority choices (§“Scope grammar and matching”).

- The discussion of attestation is admirably honest. The RFC does not pretend that a self-declared agent name or model identifier is a cryptographic property (§“Attestation boundary”).

- The export and restore posture correctly recognizes that grants and bearer credentials are machine-local authority and must not silently survive a declared authority reset (§“Protected catalog and lifecycle”).

- The Validation Requirements include valuable negative tests: wrong-actor grants, cross-token-family rejection, scope widening, credential rotation, grant expiry, and queued replay fencing (§“Validation Requirements”).

- The RFC correctly treats stable function identity as a prerequisite rather than assuming the current manifest is sufficient. The implementation still exposes `FunctionDefinition.id` as optional in `src/manifest.rs`, so this dependency is real (§“Function scope identity”).

## 3. Concerns

1. **Recredentialing lacks an ownership rule and appears to permit agent-account takeover.**

   **Severity:** MATERIAL

   **Concrete evidence:** The registration policy allows invitations to be minted by any authenticated human when user invitations are enabled (§“Registration policy”). The recredentialing design separately permits a new invitation to name an existing `agent_user_id` (§“Recredentialing”). The RFC does not state that such an invitation must be authorized by the current credential, a recorded controller, or an operator. Because existing grants are keyed to the stable agent actor, a newly issued credential for that actor could potentially mint scoped tokens against authority created for the previous controller.

   **Resolution criterion:** Separate creation invitations from recovery/recredential invitations. A user-issued creation invitation must never name an existing principal. Recredentialing must require either the current credential, an explicitly recorded controller/recovery authority, or an operator capability. The RFC must also define whether recredentialing revokes all prior credentials and tokens atomically. Add tests proving that an unrelated authenticated human cannot recredential or inherit grants for an existing agent.

2. **Credential and token lineage is absent from the authority and invalidation keys.**

   **Severity:** MATERIAL

   **Concrete evidence:** `_auth_agent_credentials` has a credential ID and credential-local generation, but `_auth_grant_tokens` stores only the grant ID and `credential_generation`; the resolved `servicePrincipal` authority and connection/replay tuple likewise omit both credential ID and token ID (§“Resolved authority,” §“Protected catalog,” §“Ending authority and revocation”). Recredentialing creates a new credential ID, so two credentials can both have generation 1. The tuple cannot distinguish them. Similarly, the ten-token cap revokes the oldest token, but an already-open live or queued authority carries no token identity through which that revocation can be projected.

   **Resolution criterion:** Either enforce one live credential per agent with an actor-wide monotonic epoch, or include `credentialId` and a stable `tokenId`/token generation in token records, resolved authority, connection state, authorization dependencies, and queued descriptors. Pin exact invalidation behavior for individual-token revocation. Add tests for two credentials with equal local generations, cap-driven token revocation during a live subscription, and queued work after token revocation.

3. **The scope representation cannot enforce the function-kind and activation guarantees claimed by the RFC.**

   **Severity:** MATERIAL

   **Concrete evidence:** The exact-function scope is stored as `fn:<functionId>`, yet the RFC says it binds the pair `(functionId, kind)` and fails closed if the ID is reused with another kind (§“Scope grammar and matching”). No original kind is present in that string or in the grant schema. Current code also has a distinct `LiveQuery` function kind in `src/manifest.rs`, while the wildcard grammar names query and mutation but does not define how `LiveQuery` is classified. The RFC later states that immutable scopes mean a live result can never become scope-denied, even though its own deployment rule says a kind change invalidates the match. That is an activation-time authority change under LLP 0053. Finally, unchecked nested `ctx.runMutation` calls mean a grant authorizes the entry point’s transitive effects, not merely the named function.

   **Resolution criterion:** Store a canonical structured scope containing at least stable function ID and consented function kind, and define `LiveQuery` explicitly. Pin activation behavior: incompatible deployments must close/delete affected live authorities or require re-consent. Define whether the trusted contract is merely the entry-point ID or a separately versioned capability contract covering transitive effects. Add activation tests for kind changes and live subscriptions.

4. **The registration, invitation, and consent protocol is not a complete state machine.**

   **Severity:** MATERIAL

   **Concrete evidence:** Grant requests are described as expiring, single-approval objects and are subject to a pending-request cap, but no request record appears in the protected catalog and their persistence, restart, reset, export, and restore behavior is unspecified (§“Consent flow,” §“Protected catalog and lifecycle”). The route table does not fully pin the routes and authority requirements for user invitation issuance, approval/listing, direct operator grant issuance, credential revocation, and principal deactivation (§“Routes”). Invitation and agent-credential carriers are also less precisely specified than the scoped-token carrier. In addition, “registration creates no grant” conflicts with applying a default autonomous scope template during registration or recredentialing (§“Registration,” §“Autonomous grants”).

   **Resolution criterion:** Add a complete transition table for invitations, registration, credentials, grant requests, approvals, grants, rotations, revocations, expiry, and deactivation. For every transition, specify the authenticated caller, credential carrier, protected record, atomic writes, returned secret or identifier, replay behavior, and lifecycle treatment. Either define grant requests as protected durable records or explicitly make them process-ephemeral. Resolve whether registration can create a grant and how the agent learns any resulting grant ID.

5. **Declared restore can resurrect spent invitation authority.**

   **Severity:** MATERIAL

   **Concrete evidence:** Invitations are durable, bearer-like, and single-use, but declared restore only invalidates grants, credentials, and scoped tokens (§“Protected catalog and lifecycle”). A backup taken before an invitation was consumed can therefore restore it to an unconsumed state. A holder of the old invitation secret could register or recredential again. LLP 0039 explicitly purges or invalidates analogous single-use authentication state during declared restore for this reason. Grant requests would have the same problem if they are durable.

   **Resolution criterion:** Declared restore must purge or terminally invalidate all invitations and pending approvals/requests, or rotate an authority-incarnation value incorporated into their validation. Add a test in which an invitation is consumed after backup and cannot be reused after restoring that backup.

6. **Hosted enablement conflicts with the RFC’s own audit prerequisite and the frozen local-first slice.**

   **Severity:** MATERIAL

   **Concrete evidence:** The Summary, companion amendments, and Validation Requirements contemplate un-reserving `servicePrincipal` for hosted MCP invocation (§“Summary,” §“Required companion amendments,” §“Validation Requirements”). The audit section says durable audit is a precondition for un-reserving hosted mutation authority beyond trusted-local deployments, while durable audit is explicitly a non-goal (§“Non-goals,” §“Audit”). LLP 0039’s frozen target is local Rust, LLP 0042 reserves hosted service-principal mutation authority, and LLP 0017 keeps remotely dangerous administrative capabilities disabled. The RFC does not clearly limit its acceptance criteria to trusted-local use.

   **Resolution criterion:** Choose and state one boundary. Either keep hosted `servicePrincipal` reserved and scope this RFC to local/trusted deployments, or make durable audit and the necessary hosted transport, proxy, throttling, distributed invalidation, and secret-handling controls explicit predecessors. Align the Summary, landing sequence, LLP 0042 amendment, and hosted validation test with that choice.

7. **“Generated-function invocation only” is not mapped to exact operation IDs.**

   **Severity:** MATERIAL

   **Concrete evidence:** The plane-boundary section includes app-data HTTP routes, WebSocket-carried operations, `/connection/open`, and `function.run`/`function.explain` projections (§“Plane boundary”). The current WebSocket registry in `src/server.rs` also contains app-data operations such as ephemeral subscribe, publish, and delete, none of which has a corresponding `fn:*` scope. Meanwhile, the existing `function.run` path in `src/host_ops.rs` is a system/operator-plane operation; `src/server.rs` classifies its host-ops variants under admin capabilities, and `src/admin.rs` currently uses admin bypass semantics. Reusing that route would violate the proposed plane separation.

   **Resolution criterion:** Enumerate the exact route and operation IDs that accept `servicePrincipal`, including the treatment of every WebSocket operation. Unscoped ephemeral and system operations must either be refused or receive a separate, explicit scope vocabulary. Define a distinct app-data projection for generated functions rather than reusing the current host-ops runner. Add matrix tests proving refusal on every control-plane operation and every unscoped app-data operation.

8. **The grant TTL policy is not defined despite being a central security property.**

   **Severity:** MATERIAL

   **Concrete evidence:** The Goals promise scoped, TTL’d, revocable grants, and `_auth_grants` includes `expires_at`, but only scoped-token defaults and maxima are pinned (§“Goals,” §“Credentials and token families,” §“Grants”). There is no grant default, hard maximum, renewal rule, consent-display requirement, or distinction between delegated and operator-created autonomous grants. A very distant grant expiry effectively allows a stolen long-lived agent credential to mint short-lived tokens indefinitely.

   **Resolution criterion:** Pin whether grant expiry is mandatory, the default and maximum duration for each issuance path, who may select it, how it is displayed during consent, and whether renewal creates a new consented grant. Add tests rejecting absent or excessive expiry and exercising grant renewal and expiry during live authority.

9. **The landing sequence omits LLP 0039 item 7 for queued and replayed work.**

   **Severity:** MATERIAL

   **Concrete evidence:** The RFC correctly stages finite invocation after item 5 and auth-scoped live behavior after item 6, but it discusses and validates queued/replayed service-principal authority without an explicit item-7 gate (§“Queued and replayed invocation,” §“Landing relative to LLP 0039,” §“Validation Requirements”). LLP 0039 reserves authority descriptors, queued replay, and first-delivery enforcement to item 7. Item 5 or 6 cannot authorize this feature.

   **Resolution criterion:** Add an explicit stage in which queued/replayed service-principal work remains unavailable until LLP 0039 item 7 is active. Specify the service-principal authority descriptor and capability handshake, and require refusal—not fallback—before that stage.

10. **The implementation-status statement about `sbs_` is inaccurate.**

   **Severity:** NON-BLOCKING

   **Concrete evidence:** The token-prefix section says the repository already mints `sbs_` session tokens (§“Credentials and token families”). LLP 0039 reserves that prefix, but the current implementation does not mint it: `src/admin.rs` contains `sbat_` and `sbcc_`, and `src/admin_secret_read.rs` contains the `sbr*` families; no `sbs_` occurrence exists in the relevant source or test trees. Session bearer resolution currently fails with `SNAPBACK_AUTH_POLICY_UNAVAILABLE` in `src/server.rs`.

   **Resolution criterion:** Change the statement to say that LLP 0039 reserves `sbs_` for the future session implementation, and clearly distinguish implemented, reserved, and newly proposed token families.

## 4. Suggestions

- Introduce a versioned “consent contract” for each generated function. It need not be a code hash; it could be a developer-managed capability version that changes when security-relevant transitive effects change. Grants would bind to that version, allowing harmless deployments without forcing re-consent.

- Record durable consent provenance in the grant itself: approving user ID, approval method, canonical requested-scope digest, displayed expiry, and relevant manifest/consent-contract version. A `session:<id>` string alone becomes weak evidence after session garbage collection.

- Define a central credential-family registry containing prefix, carrier, route classes, storage treatment, redaction rules, and response cache policy. Require the prefixes to be prefix-free, not merely distinct.

- Add scope-count, scope-byte-size, invitations-per-issuer, grants-per-agent, and open-registration quotas. The present caps do not prevent unbounded identity or invitation creation.

- Specify compare-and-swap or transaction requirements for rotation, approval, cap eviction, and default-grant creation. Concurrency tests should prove that caps and single-use properties cannot be exceeded.

- Give scope refusals a stable structured explanation that distinguishes missing scope, expired grant, revoked credential, wrong actor, and activation-incompatible function contract without disclosing secrets.

- Consider an actor-wide credential epoch even if individual credential IDs are retained. It gives recovery and “revoke every credential for this agent” a simple fencing primitive.

- A non-standard but potentially valuable recovery design would allow an agent owner to configure a small recovery trustee set or one-time offline recovery capability. That avoids making every authenticated human a de facto recovery authority while not requiring a still-working agent credential.

## 5. Open questions

- Who owns or controls an agent principal, and who may recover, transfer, deactivate, or recredential it?

- Are multiple simultaneously active credentials for one agent supported? If so, what is the exact lineage and revocation model?

- Does individual scoped-token revocation terminate existing live subscriptions and queued work immediately, or only prevent new invocations?

- What are the mandatory default and maximum grant durations for delegated and autonomous grants?

- Is a function scope consent to a stable entry point and all of its future transitive behavior, or to a versioned security contract?

- How are `LiveQuery` functions classified, and what happens to active authorities when a function changes kind or consent-contract version?

- Are grant requests durable across restart? If so, how are single approval, restore invalidation, and expiry enforced transactionally?

- Which exact HTTP, WebSocket, CLI, and MCP operation IDs accept `servicePrincipal`, and which remain permanently operator-only?

- Is the first accepted version local/trusted-only, or is hosted mutation authority genuinely in scope? What concrete predecessor marks that transition?

- When recredentialing succeeds, do prior grants survive, and if they do, what proves that the new credential is entitled to inherit them?

## 6. Readiness verdict

The underlying principal-and-grant model is promising, but unresolved takeover, credential-lineage, restore-resurrection, scope-enforcement, operation-boundary, and staged-activation defects are material security and correctness issues. The current Validation Requirements would not reliably catch them.

VERDICT: NOT READY
### Orchestrator verification notes — round 2 (not part of the received review)

- `FunctionKind` includes `LiveQuery` (`src/manifest.rs:656-661`) — the unclassified-kind concern is real.
- Ephemeral publish/subscribe/delete WebSocket-adjacent routes exist (`src/server.rs:2135-2155`) — the unscoped-operation concern is real.
- `sbs_` has zero occurrences in `src/` — the already-mints wording error is confirmed.
- The recredentialing-takeover, restore-invitation-resurrection, item-7-gate, and hosted-boundary contradictions were checked against the revised document text and are accurately quoted.

## Round 3 — 2026-07-13

**Provenance:** OpenAI Codex CLI v0.144.3 (`codex exec`), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, fresh session id 019f5f2c-fdd1-77f0-a97e-5e5dab384fef; method cli-runner; no redaction needed; reviewer barred from llp/reviews/.
**Revision under review:** `llp/0055-agent-principals-and-scoped-grants.rfc.md`, sha256 `65db30094a8d8773c7bd6e5fcfdaf5bf6eb069fa95a333bd3e4ca3aa972b2662` (post-round-2 revision)
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

The proposal’s core direction is sound. First-class agent principals, immutable scoped grants, short-lived invocation tokens, explicit actor/effective-principal separation, and a hard operator/app-plane boundary are the right primitives for LLP 0019’s F2 gap. The RFC also composes thoughtfully with LLP 0053 by treating grant and credential revocation as authority termination rather than permission mutation.

The implementation survey supports the RFC’s claim that this is largely future work: `src/server.rs` still refuses session resolution with `SNAPBACK_AUTH_POLICY_UNAVAILABLE`; no service-principal resolver or `_auth_*` catalog exists; and `FunctionDefinition.id` remains optional in `src/manifest.rs`. The landing decomposition is therefore appropriately prerequisite-driven rather than pretending the substrate already exists.

The draft is not ready, however. Several contracts are internally contradictory or incomplete at security-sensitive boundaries: direct-human detection, durable deactivation, production recredentialing, downgrade behavior, live-client fencing, audit attribution, hosted availability, and clock-bounded credentials. These are not implementation details; they determine whether revoked or stale authority can return and whether applications can safely distinguish a person from an agent.

## 2. Strengths

- **§Summary and §Plane boundary:** The separation between application principals and operator authority is unusually crisp. Scoped tokens resolve only at the shared app-data gate; host-ops `function.run`, lifecycle operations, and ephemeral rooms remain outside their authority.

- **§Credentials and tokens:** The two-tier credential/token model limits routine bearer exposure, uses class-specific prefix dispatch, rejects cross-class fallback, and binds tokens to credential generations and grants.

- **§Grants and §Scopes:** Immutable grants, depth-one delegation, concrete expansion of delegated wildcards, and explicit-only action grants form a comprehensible least-authority model.

- **§Consent flow:** Live-session approval by the effective user, non-enumerating foreign-request behavior, transactional single approval, and a digest of the displayed scopes are good consent primitives.

- **§Ending authority:** The distinction between LLP 0053 authorization events and authority-ending grant, token, and credential transitions is well reasoned. Using `delete` disposition instead of advancing the global authorization version avoids conflating two different invalidation problems.

- **§Catalog and lifecycle:** Keeping the new tables protected, unjournaled, and unsynced, bumping the auth catalog version, and purging one-time state on declared restore are appropriate defaults.

- **§Landing decomposition and §Companion obligations:** The RFC honestly gates finite calls, live results, replay, and retained reads on different LLP 0039 milestones and names the corpus amendments it requires.

- **§Validation Requirements:** The cross-class, wrong-actor, consent-race, scope-drift, live-revocation, and production operator-kill cases provide a strong starting matrix.

- **§Attestation, honestly:** Treating agent kind as a declaration while making principal, grant, and effective-user attribution cryptographically credentialed avoids overstating what the design proves.

## 3. Concerns

1. **The handler guidance gives an unsafe direct-human predicate.**

   **Severity:** MATERIAL

   **Concrete evidence:** §Principal kinds correctly states that “only the person themself” requires `auth.kind == "human" && auth.isDelegated == false`. But §Resolved authority says code asking “was this actually the person?” should check `ctx.auth.actor`. The proposed projection omits `actor` for both a direct human session and an autonomous agent, so that check admits autonomous agents.

   **Resolution criterion:** Replace the guidance with an exact handler predicate equivalent to `ctx.auth.kind === "human" && ctx.auth.actor == null`, preferably exposed as a generated helper. Add handler-level validation proving that it accepts a direct human and rejects both autonomous and delegated agents; testing only the rule variables is insufficient.

2. **Agent deactivation has no durable state model.**

   **Severity:** MATERIAL

   **Concrete evidence:** §Principal kinds adds only `kind` to `_auth_users`, while LLP 0039’s existing `_auth_users` record has only `id` and `created_at`. None of the five new records in §Grants stores agent status. Nevertheless, §Ending authority requires validation against “the principal’s status,” and `auth.deactivateAgent` is specified as a distinct permanent-looking operation. A previously minted recovery invitation or pending grant request could otherwise create fresh authority after the one-time cascade. Registration’s display name and operator contact also have no specified storage location.

   **Resolution criterion:** Define the durable principal state—such as immutable `kind` plus `active/deactivated` or `deactivated_at`—and every transition that consults it. Registration, recovery, token minting, grant request/approval, template application, and operator actions must fail closed for a deactivated principal. Specify treatment of pending requests and invitations, reactivation policy, atomicity, export behavior, and storage or removal of display/contact metadata. Add pre-minted-recovery and pending-request resurrection tests.

3. **The production user-invitation path is absent from the closed route surface.**

   **Severity:** MATERIAL

   **Concrete evidence:** §Registration says an authenticated human can mint a creation invitation when `invitedBy: "users"` and calls this the only production invitation path. The §Routes table contains registration and operator `auth.mintAgentInvitation`, but no session-authenticated invitation-mint route. The companion obligation promises LLP 0031 rows only for routes listed there, so the omitted production path would have no route policy, credential resolver, throttle, or response classification. The same table also does not explicitly classify secret-returning responses despite LLP 0031 requiring `CredentialSecret`, `no-store`, and exclusion from logs, diagnostics, and receipts.

   **Resolution criterion:** Add the exact user-facing invitation route and DTO, with session/direct-human authorization, invitation budget, throttle, idempotency, class restrictions, and `CredentialSecret` response handling. Give every credential-, token-, and invitation-returning route a complete LLP 0031 row and add cache/log/diagnostic sentinel tests.

4. **Sessions-to-dev downgrade would resurrect agent authority, contrary to LLP 0039.**

   **Severity:** MATERIAL

   **Concrete evidence:** LLP 0039’s lifecycle matrix requires `--allow-auth-downgrade` to revoke every durable session so re-enabling sessions cannot resurrect credentials from the previous trust model. §Catalog and lifecycle says it follows that matrix, but neither it nor the dated LLP 0039 amendments extends downgrade to agent credentials, grants, invitations, or requests. Those records would become temporarily unreachable in dev and then live again when sessions mode is re-enabled.

   **Resolution criterion:** Define the downgrade transaction for every new authority class. At minimum it must revoke agent credentials and tokens and prevent old grants, invitations, and pending requests from restoring authority without fresh onboarding or consent. Add downgrade→dev→sessions tests proving no prior agent authority returns.

5. **Logical export and production restore cannot recredential the preserved principal.**

   **Severity:** MATERIAL

   **Concrete evidence:** §Catalog and lifecycle exports agent users and identities but excludes all credential material, saying imported agents remain unauthenticatable until recredentialed. Recovery invitations preserve an existing principal but are forbidden on production. The stated production answer is re-registration, which creates a new `_auth_users.id`; it does not recredential the imported principal. Profile and LLP 0056 membership rows remain keyed to the old, permanently unusable user ID. The same identity-churn problem appears in §Grants, where changing production autonomous scopes requires re-registration.

   **Resolution criterion:** Provide a production-safe procedure that can recredential the same principal without restoring old grants, or define an explicit principal-ID remapping transaction that migrates all app data and memberships. Validation must demonstrate a production export/import or restore in which the original principal’s data remains reachable without resurrecting consent or credentials.

6. **The scope identity contract permits ambiguous authority resurrection.**

   **Severity:** MATERIAL

   **Concrete evidence:** §Scopes binds grants to `{fn, kind}` and says removing a function or changing its kind merely makes the entry nonmatching. It does not say the incompatibility is terminal. Reintroducing the same ID and kind therefore makes the old grant match again. This matters because `src/manifest.rs` currently derives default IDs as `fn:{name}`, making name reuse plausible, while the RFC’s prerequisite requires only non-optional “stable” IDs, not never-reused semantic identities.

   **Resolution criterion:** Pin the meaning and reuse rules of function IDs. Acceptable designs include never-reusable capability IDs with tombstones, terminally invalidating a grant entry once its basis disappears, or binding consent to an explicit versioned capability identity. Add remove→reintroduce and rename/name-reuse tests; the validation oracle must prove whether old consent stays dead or intentionally resumes.

7. **`revoke-self` is not a reliable response to known credential theft.**

   **Severity:** MATERIAL

   **Concrete evidence:** §Credentials and tokens says rotation immediately invalidates the old credential and describes `revoke-self` as the no-operator response to known theft. A thief can rotate first, retain the successor, and leave the owner holding a credential that can no longer call `revoke-self`. LLP 0039 identifies the analogous refresh-family takeover and requires an attributable tombstoned-bearer revoke-only alarm.

   **Resolution criterion:** Either add an idempotent revoke-only operation that accepts an attributable superseded credential, grants no authority, and can only destroy that credential family, or explicitly state that the rotate-first case requires the operator production kill path. Add a thief-rotates-first test.

8. **The live agent-client fence is not specified strongly enough to prevent stale repopulation.**

   **Severity:** MATERIAL

   **Concrete evidence:** §Ending authority defines the server connection tuple but delegates the client side to unspecified “agent-SDK work” scoped to grant deletion. LLP 0053 requires every callback and durable write to compare-and-commit against exact query-instance, authority-generation, and query-generation fences. The draft does not define how an agent client namespaces simultaneous grants, distinguishes a new token from a revoked token for the same grant, or prevents an old callback from writing after rotation or cap eviction. The validation matrix checks pending revocation but not delayed completion after a replacement authority is installed.

   **Resolution criterion:** Pin an agent-client authority generation and store namespace incorporating the relevant actor/credential-generation/grant/token identity, plus never-reused query instances and compare-and-commit behavior for all callbacks and writes. Add adversarial tests for stale success after rotation, stale callbacks after token-cap eviction, and concurrent grants addressing the same query key.

9. **The audit goal and validation requirement cannot be satisfied by the stated HTTP design.**

   **Severity:** MATERIAL

   **Concrete evidence:** §Goals requires the F2 tuple to be recorded uniformly across CLI, HTTP, and MCP. §Audit first repeats that claim, then says successful plain HTTP responses have no envelope and v1 provides attribution only in denial diagnostics and dry-run facts; a durable audit log is explicitly a non-goal. §Validation nevertheless requires the tuple to be present identically across all three projections. A successful committed plain HTTP invocation has no specified carrier or sink.

   **Resolution criterion:** Either define a concrete successful-request audit fact carrier or sink for plain HTTP, or narrow §Goals and §Validation to the projections and outcomes that actually expose attribution. Hosted mutation must remain gated until the promised durable audit substrate exists.

10. **The hosted availability boundary is contradictory.**

   **Severity:** MATERIAL

   **Concrete evidence:** §Summary says the RFC un-reserves `servicePrincipal` only for local and trusted-local deployments. It then gates only hosted mutation authority, and §Validation requires hosted projections to reject mutations without saying whether queries, live queries, and actions are accepted. LLP 0039 identifies hosted TLS, trusted-proxy handling, distributed throttling, mixed-version proof, and distributed invalidation as an unowned deployment-security contract applicable to bearer-backed auth generally.

   **Resolution criterion:** Add a profile × function-kind × transport matrix. Either refuse all hosted service-principal invocations in this RFC or name and satisfy the prerequisites for every hosted surface that is allowed. Tests must cover hosted query, live query, mutation, action, connection open, CLI, and MCP—not mutation alone.

11. **The claimed hard expiry bounds lack rollback-safe clock semantics.**

   **Severity:** MATERIAL

   **Concrete evidence:** §Credentials and tokens calls 24 hours a hard token maximum and theft-window bound; invitations and delegated grants also rely on wall-clock expiry. No monotonic or rollback-high-water behavior is specified or tested. A backward server-clock jump can extend all three authorities beyond their claimed bounds. This is especially inconsistent with the comparison to LLP 0053’s `AuthorizedLease`, whose 24-hour maximum is backed by durable clock high-waters and rollback failure behavior.

   **Resolution criterion:** Define checked time arithmetic and a durable rollback-safe authorization clock for invitation, grant, token, and live deadline validation, available at the item-5 landing stage. Add rollback, restart, equality-boundary, and overflow tests, or stop describing these durations as hard bounds.

## 4. Suggestions

- Give explicit function scopes a structured API representation that preserves `kind`; rendering both `{fn, query}` and `{fn, mutation}` as `fn:<id>` discards a consent-relevant fact.

- Make approved grant-request polling idempotent. A lost token response followed by repeated polls should not mint successive tokens and eventually evict a still-live token through the per-grant cap.

- Coalesce or rate-limit `last_used_at` updates. Advancing it on every invocation would turn otherwise read-only agent traffic into persistent write pressure despite the field not affecting authorization.

- Specify the manifest grammar and evolution rules for the autonomous registration template. The current `auth.agents.*` snippet defines only mode and inviter, even though the template is the main production autonomous-authority path.

- Rename `auth.agents.mode` to something like `registrationMode`, or state explicitly that `disabled` stops new registration but does not disable existing agents. Also correct the “defaults (`invited` + `operators`)" wording, since the listed mode default is `disabled`.

- Consider first-class, versioned capability handles distinct from generated function IDs. One named capability could map to one or more entry points, carry a human-readable consent description, and require re-consent only when its declared security contract changes.

- Generate a canonical `isDirectHuman` rule/handler helper once the predicate is corrected; this is exactly the kind of security-sensitive conjunction applications will otherwise get wrong.

## 5. Open questions

- Who controls a production agent principal, and what proof lets that controller recover or rotate it while preserving the same user ID?

- Is an agent’s deactivated state permanent, operator-reversible, or equivalent only to revoking current credentials? What happens to its LLP 0056 membership rows?

- Is a function ID a permanent semantic capability identity, an implementation entry-point identity, or merely a deployment-local name?

- What is the exact client-store namespace when one daemon concurrently uses several grants or several tokens for the same grant?

- Where does successful plain-HTTP attribution live before the durable audit log exists?

- Are any hosted read or live surfaces intended to ship before the hosted deployment-security contract, and if so, why are their bearer and invalidation requirements safe?

- Does production import require a trustee/recovery capability, or should export explicitly omit agent identity rows that cannot be made usable again?

- Which clock source and recovery procedure govern all auth expiries after rollback is detected?

- Who approves autonomous-scope evolution for an existing production agent without forcing principal replacement?

## 6. Readiness verdict

The architecture is promising, but the unresolved issues include authority resurrection, an unsafe person-versus-agent predicate, an incomplete production onboarding route, broken principal continuity, unspecified live fences, and contradictory audit and hosted contracts. Those are material correctness and security gaps.

VERDICT: NOT READY
### Orchestrator verification notes — round 3 (not part of the received review)

- The direct-human-predicate defect is real: the reviewed revision's §Resolved authority prose points 'was this actually the person?' at `ctx.auth.actor`, which is absent for autonomous agents too.
- No deactivation state column exists in the reviewed revision's catalog enumeration — confirmed by inspection.
- LLP 0039's `--allow-auth-downgrade` revokes durable sessions only (`llp/0039:~420`); agent classes were uncovered — confirmed.
- Default function ids derive as `fn:{name}` (`src/manifest.rs:611`) — the id-reuse/resurrection concern is grounded.
- LLP 0053's lease uses rollback-checked time (`llp/0053:82`); the reviewed revision claimed hard bounds with no clock semantics — confirmed gap.
- The hosted read/live/action matrix gap and audit-carrier contradiction were checked against the revision text; both accurately quoted.

## Round 4 — 2026-07-13

**Provenance:** OpenAI Codex CLI v0.144.3 (`codex exec`), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, fresh session id 019f5f46-9db3-7740-b848-4af24b3004f5; method cli-runner; no redaction needed; reviewer barred from llp/reviews/.
**Revision under review:** `llp/0055-agent-principals-and-scoped-grants.rfc.md`, sha256 `83bcc00047cf17488999fee6ac13cabf0101dc7853afb1f569bfdc2d8b1ccc4f` (post-round-3 revision)
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

This is a strong and worthwhile proposal. First-class agent principals, actor/effective-principal separation, immutable scoped grants, and uniform attribution directly address LLP 0019 F2. The trusted-local boundary and wholesale hosted refusal are appropriately conservative. The design also composes thoughtfully with LLP 0011’s principal model, LLP 0039’s invocation gate, and LLP 0053’s distinction between authority transitions and authorization events.

The implementation claims are honest. The current source has route-policy scaffolding for future session resolution, but `src/manifest.rs` still carries client-supplied `AuthInput`; `src/server.rs` deliberately returns `SNAPBACK_AUTH_POLICY_UNAVAILABLE` for uninstalled session resolution; and no `_auth_users`, `mintSession`, agent credential, or `servicePrincipal` implementation exists. The RFC correctly treats these as future landing work.

The proposal is nevertheless not ready. Production recovery is misclassified as authority-destroying even though it establishes a fresh credential, preserves memberships, and reapplies an autonomous grant. The rotation alarm is defeated by two rotations, the non-enumerating consent flow lacks a representable unresolved state, and the scope contract leaves consequential authority expansion unresolved. Several validation claims also conflict with sibling documents or omit existing credential classes. These are fixable without discarding the architecture, but they are security and coherence issues rather than editorial polish.

## 2. Strengths

- The operator/application-plane separation is unusually clear, including the rule that host-ops `function.run` never resolves scoped tokens and that hosted service-principal invocation remains wholly refused. (§Summary; §Plane boundary)

- The actor/effective/grant model is the right abstraction. Using the effective principal as `ctx.auth.userId` preserves ordinary app authorization while retaining an explicit, server-derived actor record. (§Resolved authority: `servicePrincipal`)

- The proposed sealed `ctx.auth` projections, `auth.kind`, `auth.actorKind`, `auth.isDelegated`, and the two-conjunct direct-human predicate are coherent with LLP 0053’s protected-query profile and LLP 0056’s membership semantics. (§Principal kinds; §Resolved authority)

- Scopes are canonical structured records rather than authoritative display strings. Delegated tier expansion, explicit-only action grants, and terminal invalidation after function removal or kind change are good consent-preserving choices. (§Grants)

- The RFC correctly keeps grant and credential termination outside LLP 0053’s closed authorization-event universe while routing effective-user permission churn through ordinary LLP 0053 machinery. (§Ending authority)

- Durable deactivation, downgrade cleanup, restore handling, and import-time principal continuity show serious attention to resurrection and rollback failures. (§Principal kinds; §Catalog and lifecycle)

- The hosted, attestation, retained-read, and durable-audit limitations are stated candidly rather than hidden behind aspirational language. (§Non-Goals; §Attestation, honestly; §Audit)

- The validation inventory is broad and adversarial, especially around credential-class confusion, manifest incompatibility, stale callbacks, expiry rollback, and cross-authority replay. (§Validation Requirements)

## 3. Concerns

1. **Recovery is an impersonation/credential-establishment path but is gated as destruction only.**

   **Severity:** MATERIAL

   **Concrete evidence:** §Registration says recovery preserves the principal, revokes old grants, mints a fresh credential, and reapplies the current autonomous template. Preserved profile and membership rows remain keyed to that principal. LLP 0056 §Agents confirms those memberships authorize the recovered autonomous agent. Nevertheless, §Routes gives `auth.mintAgentRecovery` to ordinary `AdminWrite`, without an impersonation gate, on every profile, because it supposedly “confers no inherited authority.” That premise is false whenever a template exists and the preserved memberships gate any template-covered function. LLP 0039 §Authority resolution explicitly requires a separate, non-browser `ImpersonationCapability` for credential-establishing effects because browser-held `AdminWrite` must not become “is any user.” LLP 0017 §Security Defaults confirms that the browser console credential satisfies ordinary `AdminWrite`.

   **Resolution criterion:** Reclassify recovery as credential-establishing authority. Define a production-capable recovery authority with a carrier unavailable to browser-held admin credentials, or require independent agent/trustee proof in addition to operator approval. Reconsider automatic template reapplication. Acceptance must prove that an ordinary admin token or console credential cannot mint-and-consume recovery to act through preserved memberships or a recovered template.

2. **The recovery-consumption route is missing or contradicts registration mode.**

   **Severity:** MATERIAL

   **Concrete evidence:** Recovery consumption returns a credential, but §Routes contains no recovery endpoint. The only plausible carrier is `POST /auth/agents/register`, whose row says it is “refused under `disabled`” and “public only under `open`.” Elsewhere, `disabled` is said to stop only new principal creation, while recovery must work for existing principals on every profile. The secret-response list also names “register” and “recovery consumption” separately.

   **Resolution criterion:** Add an explicit recovery-consumption route, or specify class-dispatch behavior on `/auth/agents/register`. Its recovery branch must be independent of new-registration mode, have its own registry row, throttle and response-sensitivity classification, and atomically revoke old authority, consume the invitation, mint the credential, and apply any permitted template. Test it under `disabled`, `invited`, and `open`.

3. **The immediate-predecessor revoke alarm does not survive two attacker rotations.**

   **Severity:** MATERIAL

   **Concrete evidence:** §Credentials stores a singular `predecessor_hash` and permits only the immediate predecessor to call `revoke-self`. If a thief rotates stolen secret S to T and immediately rotates T to U, T becomes the immediate predecessor and the legitimate holder of S is locked out. No tombstone lifetime is specified either. LLP 0039’s analogous session family deliberately retains attributable N-2/N-3 tombstones rather than only one predecessor.

   **Resolution criterion:** Specify a bounded credential-family alarm that remains usable across repeated attacker rotations—such as retaining all attributable historical secrets for revoke-only use during a defined window—or prevent a later rotation from erasing the active alarm. Pin GC and denial-of-service tradeoffs, and add concurrent, N-2/N-3, and rotate-twice-before-revoke traces.

4. **The non-enumerating unresolved grant-request state is not representable.**

   **Severity:** MATERIAL

   **Concrete evidence:** Consent step 1 promises the same acknowledgment whether a handle resolves and says unresolved requests remain pending until expiry. The catalog record requires `effective_user_id` and contains no unresolved/decoy state. Polling returns `GRANT_PENDING` for a real pending request but `GRANT_INVALID` for nonexistent requests. Without a durable or cryptographically represented decoy, creation followed by polling becomes an identity oracle.

   **Resolution criterion:** Define how unresolved requests are represented and polled indistinguishably—such as a sealed nullable resolution state or synthetic target—with identical lifetime, cap accounting, codes, and observable timing envelope. Validation must compare the complete create-and-poll transcript for resolved-pending and unresolved handles, not only the initial acknowledgment.

5. **The catalog cannot retain the creation provenance required by consent.**

   **Severity:** MATERIAL

   **Concrete evidence:** `consent_digest` includes the agent’s creation provenance, but §Principal kinds adds no immutable provenance field to `_auth_users`; `_auth_identities` has no such field; and invitation rows are swept after expiry plus slack. After invitation GC, recovery, or export/import, the consent surface has no durable source for the promised provenance.

   **Resolution criterion:** Add an immutable, export-defined registration provenance record to the agent principal or a durable linked record, with explicit recovery/import semantics and redaction rules. Validate consent rendering after invitation GC, recovery, restart, and logical export/import.

6. **Consent is described as manifest-version-bound but survives arbitrary implementation changes.**

   **Severity:** MATERIAL

   **Concrete evidence:** §Grants says consent is to the entry point “as composed by the app at the active manifest version,” but only removal and function-kind change invalidate a scope. `consent_digest` carries no activation hash or capability-contract version. Current codegen in `packages/snapback-codegen/index.mjs` derives IDs from app ID and function name, so changing a function’s implementation or nested `ctx.runMutation` graph preserves the grant.

   **Resolution criterion:** Choose and pin one contract. Either state explicitly that consent is to a stable endpoint whose semantics the app developer may change, removing the active-manifest-version implication, or bind grants to a developer-versioned capability contract and require re-consent on incompatible change. Add an implementation-change validation case.

7. **The scope grammar does not account for durable authority-creating mutations.**

   **Severity:** MATERIAL

   **Concrete evidence:** LLP 0056 §Agents explicitly permits a delegated agent to insert a membership for its own actor principal; that membership survives grant revocation and can later authorize the agent autonomously. LLP 0056 therefore asks whether such writes require an `authority-creating` scope marker. LLP 0055 currently treats them as ordinary function or mutation-tier scopes, while presenting revocation as ending the delegated authority.

   **Resolution criterion:** Decide this composition explicitly. A strong default would mark authority-creating functions in the manifest, exclude them from tier grants, require explicit consented scopes, and require durable provenance. Alternatively, document that explicit function consent includes durable privilege creation and narrow the revocation claims accordingly. Validation must exercise self-seating followed by grant revocation.

8. **Queued settlement validation does not explicitly cover authority ending after enqueue.**

   **Severity:** MATERIAL

   **Concrete evidence:** §Resolved authority specifies tuple equality at settlement and intentionally excludes `tokenId`; validation proves cross-tuple refusal and survival of routine token expiry. It does not explicitly require current grant, credential, principal, scope-entry, and expiry validation when work settles. An implementation that merely compares the recorded tuple could settle after grant revocation, deactivation, credential revocation, recovery, or terminal scope invalidation.

   **Resolution criterion:** Pin the settlement predicate as tuple equality plus current durable-authority validation. Add enqueue-then-end traces for grant revocation/expiry, credential rotation/revocation, deactivation, recovery, downgrade, and manifest scope invalidation. Preserve the intended positive control that routine token expiry or cap eviction alone does not strand work.

9. **The local MCP `devUser` validation contradicts the existing operating-surface contract.**

   **Severity:** MATERIAL

   **Concrete evidence:** LLP 0055 §Validation says local MCP mutation tools accept `servicePrincipal` and “continue rejecting `devUser`.” LLP 0042 §Authority says its first local slice allows `devUser`, and LLP 0055 §Non-Goals says local dev impersonation remains the local-dev path. LLP 0039 additionally permits it under sessions only through host-ops with `ImpersonationCapability`.

   **Resolution criterion:** Publish one explicit MCP matrix distinguishing dev-mode host-ops impersonation from sessions-mode app-data scoped-token invocation. Either preserve guarded local `devUser` as the existing documents require or amend LLP 0024/0042 and the non-goal with a justified replacement. Validation must cover both projections separately.

10. **The allegedly exhaustive prefix sweep omits an existing bearer class.**

    **Severity:** MATERIAL

    **Concrete evidence:** §Validation lists “all registered prefixes” but omits `sct_`. `src/server.rs` currently mints `sct_` connection tokens, which are bearer capabilities used on live/outbox/ephemeral transports. The list nevertheless includes non-authenticating `sbrp_` and `sbrm_`, so it is not intentionally limited to `Authorization` bearers.

    **Resolution criterion:** Include `sct_` in the registered namespace, redaction corpus, and every cross-resolver negative. Clarify that explicitly configured admin tokens may be unprefixed and are classified by their dedicated carrier, not by prefix dispatch.

11. **The rollback-clock ownership citation is stale.**

    **Severity:** NON-BLOCKING

    **Concrete evidence:** §Credentials and §Landing decomposition describe the clock as shared with LLP 0053 item 8. LLP 0053 §The lease says item 6 establishes `auth_clock_high_water_ms` for retry episodes and item 8 reuses it. LLP 0055 also wants finite agent calls after item 5, so its clock prerequisite may have to land before item 6.

    **Resolution criterion:** Cite item 6 as the owning contract and state whether LLP 0055 brings that infrastructure forward as an independent prerequisite or waits for its implementation.

## 4. Suggestions

- Give creation and recovery invitations distinct prefixes. Structural class dispatch would make accidental recovery-through-registration bugs easier to prevent and audit.

- Add compact transition tables for credentials, invitations, requests, grants, and tokens, including transaction boundaries and crash outcomes. The prose contains the states, but not one authoritative transition inventory.

- Prefer the user-minted pairing-code variant for the first delegated-consent implementation. It removes the unresolved-handle oracle and makes unsolicited consent-request spam harder by construction.

- Consider an agent-generated offline recovery public key established at registration, with recovery requiring both operator authorization and agent/trustee proof. This offers production continuity without making ordinary admin authority an impersonation credential.

- Register a target capability that distinguishes `servicePrincipal: local-only` from ordinary profile names, and update the root LLP/capability-report index when this RFC lands.

- Specify exactly where the attribution block appears in success and error envelopes, and limit the “every denial” claim to denials occurring after a valid service-principal authority has been resolved.

## 5. Open questions

- What production-safe authority and carrier can mint recovery invitations without becoming browser-accessible impersonation authority?

- Does recovery automatically reapply the current template, or should template reapplication require a second explicit operator/app-policy decision?

- Is delegated consent to a mutable endpoint name, an exact bundle, or a developer-versioned capability contract?

- Are authority-creating mutations explicit-only scopes, and is durable provenance mandatory for them?

- What exactly is the opaque user handle in grant requests, and how are unresolved, ambiguous, renamed, and deleted handles represented without an oracle?

- Are agent registration, token mint, recovery, and consent routes also refused on hosted targets in v1, or only service-principal invocation?

- Does “local/trusted-local” include a `prod` server profile, and which runtime capability—not profile name—enforces that distinction?

- Which sender-binding, verifiable-attestation, and durable-audit requirements must land before any hosted read cell can open?

## 6. Readiness verdict

The central architecture is promising and largely compatible with the governing corpus, but recovery currently creates a serious privilege-escalation path, repeated rotation defeats the owner alarm, the consent protocol lacks required state, and several scope and validation contracts remain contradictory. These material issues must be resolved before implementation or acceptance.

VERDICT: NOT READY
### Orchestrator verification notes — round 4 (not part of the received review)

- The recovery-gating finding is confirmed against the revision text (template reapplication + preserved memberships contradict the 'confers no inherited authority' premise); the sibling family independently found the same defect.
- `sct_` connection tokens are real and minted (`src/server.rs:1049`) — the prefix-sweep omission is confirmed.
- `auth_clock_high_water_ms` is 0053 item-6 machinery (`llp/0053:1154`) — the stale item-8 citation is confirmed.
- The missing recovery-consumption route, single-predecessor double-rotation lockout, decoy-state gap, provenance-durability gap, and MCP devUser contradiction were all checked against the revision text and are accurately described.

## Round 5 — 2026-07-13

**Provenance:** OpenAI Codex CLI v0.144.3, model gpt-5.6-sol, effort ultra, read-only, fresh session 019f5f5e-eb69-72f1-acf1-8bef45922ac0; method cli-runner; reviewer barred from llp/reviews/.
**Revision under review:** `llp/0055-…rfc.md`, sha256 `6f1a43e5bdb182dd6a705ab01953797aeb660b2b866ceb5308d18375c66ffa50` (post-round-4)
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

This is a strong and worthwhile proposal. Its central choices—agents as ordinary Snapback principals, actor/effective-principal separation, immutable scoped grants, user-initiated delegation, and a strict app-plane/operator-plane boundary—fit the governing corpus well. In particular, the RFC correctly treats recovery as credential-establishing authority, recognizes that LLP 0056 memberships can outlive a grant, and avoids pretending that self-declared agent identity is attestation.

The source audit supports the RFC’s implementation-status claims. `src/server.rs` contains route-policy and `ImpersonationCapability` scaffolding but still returns `SNAPBACK_AUTH_POLICY_UNAVAILABLE` for session resolution and impersonation. There is no implemented `servicePrincipal`, `_auth_users`, `mintSession`, or `sbs_` resolver. The listed existing prefixes are accurate, `src/admin.rs` confirms that `sbcc_` console credentials satisfy ordinary `AdminRead`/`AdminWrite` but not stronger carriers, and `src/manifest.rs` confirms function IDs remain optional with reusable `fn:{name}` defaults. This is therefore a prospective design, not a description of shipped auth behavior, and the RFC is appropriately candid about that.

It is not ready, however. Production recovery directly contradicts LLP 0039’s frozen profile rule, and the proposed recovery lifecycle has no production mechanism for restoring an autonomous grant. Recovery does not close all stale recovery state, the `authorityCreating` model is not closed under explicit scopes, wildcards, and nested calls, and the invalidation text contradicts LLP 0053’s manifest-activation event. Several other security-sensitive choices—hosted management admission, pairing-code classification, carrier-level fencing, and credential-family retention—remain too open for the validation plan to prove the claimed properties.

## 2. Strengths

- The app-plane/operator-plane separation is crisp and conservative. Scoped tokens authorize only generated-function invocation, while lifecycle, provisioning, inspection, reset, and other `Admin*` surfaces refuse `servicePrincipal` (§Plane boundary).

- The actor/effective-principal model composes well with existing RLS and LLP 0056 memberships. Making `ctx.auth.userId` the effective principal while retaining the agent in `ctx.auth.actor` preserves existing user-oriented authorization while keeping delegation attributable (§Resolved authority: `servicePrincipal`).

- The `auth.kind`, `auth.actorKind`, and `auth.isDelegated` distinctions correctly avoid treating either “human effective principal” or “not delegated” as sufficient proof of a direct human. Providing `isDirectHuman(ctx)` is a useful guard against application authors getting that conjunction wrong (§Principal kinds).

- The user-minted pairing-code inversion is substantially better than an agent-supplied user handle. It removes the identity-oracle seam structurally, makes consent user-initiated, and gives the approving user a concrete scope and provenance display (§Grants, “Consent: a user-minted pairing code”).

- The RFC correctly identifies delegated membership writes as durable authority creation rather than ordinary mutations. Requiring explicit consent, provenance, and an `authorityCreating` effect is the right security direction and is coherent with LLP 0056 (§Grants, “`authorityCreating` functions”).

- Recovery is correctly recognized as credential-establishing authority and therefore gated by a non-browser carrier rather than ordinary `AdminWrite`. The recovery invitation’s distinct `sbagr_` class also prevents ambiguous body-flag dispatch (§Recovery is credential-establishing authority).

- The credential namespace work is careful and grounded in the actual repository. The RFC accounts for `sbat_`, `sbcc_`, `sct_`, the secret-read family, and reserved-but-unbuilt `sbs_`, and requires structural wrong-class rejection rather than resolver fall-through (§Credentials and tokens).

- The settlement rule correctly distinguishes short-lived carrier tokens from durable grant authority and requires live-authority validation at settlement, not tuple equality alone (§Resolved authority: `servicePrincipal`).

- The validation section is unusually broad. It includes wrong-actor probes, cross-class negatives, concurrent consent schedules, clock rollback, restart and import behavior, stale callbacks, durable-authority settlement, and self-seating through LLP 0056 (§Validation Requirements).

## 3. Concerns

1. **Production recovery contradicts LLP 0039’s frozen no-production-impersonation rule.**

   - **Severity: MATERIAL**
   - **Evidence:** The RFC makes `auth.mintAgentRecovery` available “on every profile including `prod`” under `AdminWrite + ImpersonationCapability`, expressly because it establishes a credential for an existing principal (§Recovery is credential-establishing authority; §Routes and credential classes). LLP 0039 §Acceptance instead pins: “The correct capability succeeds only in its declared dev/test/demo profiles; every impersonation effect is refused on `prod`.” The RFC’s companion list names several dated LLP 0039 amendments but does not name an amendment to this profile invariant.
   - **Resolution criterion:** Either refuse recovery minting on `prod`, or explicitly amend LLP 0039’s impersonation-effect/profile matrix with a narrowly named recovery exception, its carrier and threat-model rationale, and positive and negative production acceptance cases. The amendment must distinguish this recovery effect from the still-refused `mintSession` and run-as-user effects.

2. **Production recovery cannot restore autonomous authority, contrary to the RFC’s continuity and scope-evolution claims.**

   - **Severity: MATERIAL**
   - **Evidence:** Recovery terminally revokes every grant and returns the principal “genuinely grantless”; the template is not reapplied (§Recovery). The RFC then claims recovery supports “production autonomous-scope evolution” by applying the current template explicitly. But the only specified autonomous grant producers are registration and `auth.mintAgentGrant`, and the latter is dev/test/demo-only and refused on `prod` (§Grants; §Routes). No production app-policy verb is defined. A grantless principal cannot invoke anything merely because its LLP 0056 memberships remain: every `servicePrincipal` invocation also requires a grant. `_auth_grants.created_by` even reserves a `recovery` provenance tag without a corresponding production producer.
   - **Resolution criterion:** Define a complete production-safe autonomous-grant reapplication path, including its caller, carrier, profile matrix, template/version binding, provenance, audit record, and validation. Alternatively, remove the production autonomous-scope-evolution and “act with memberships” claims and state that recovery preserves only dormant identity continuity until a separately specified future mechanism exists.

3. **Recovery does not atomically retire all stale recovery-era authority inputs.**

   - **Severity: MATERIAL**
   - **Evidence:** Consumption revokes prior credentials, tokens, and grants, but does not revoke other unconsumed recovery invitations for the same principal (§Recovery). Multiple such invitations are representable: `_auth_agent_invitations` carries `agent_user_id`, while the only invitation cap is per minting user, not one live recovery invitation per agent (§Credentials and tokens; §Grants). A stale sibling `sbagr_` can therefore recover the principal again immediately after a legitimate recovery and destroy the newly issued credential. Deactivation explicitly voids all pending requests and recovery invitations, demonstrating that this broader closure is understood but not applied to recovery. Pending pairing requests are likewise bound by `actor_user_id`, while recovery preserves that same principal and introduces no recovery generation.
   - **Resolution criterion:** On successful recovery, atomically invalidate every other recovery invitation naming the principal. Also either invalidate all pending requests initiated before recovery or bind them to a principal/credential recovery generation and state explicitly whether post-recovery approval is valid. Add recovery-versus-sibling-consumption, recovery-versus-approval, and restart race tests.

4. **The pairing code is omitted from the RFC’s sensitive-artifact classification and validation inventory.**

   - **Severity: MATERIAL**
   - **Evidence:** `POST /auth/pairing-codes` returns a ten-minute, single-use secret and is marked `[secret]` (§Consent; §Routes). Nevertheless, §Credentials and tokens says redaction acceptance covers “all four new classes”—`sbac_`, `sbagt_`, `sbagi_`, and `sbagr_`—and §Validation repeats redaction sentinels for only those four. Pairing-code storage fields, digest treatment, attempt limits, and class behavior are not pinned; entropy is deferred to a later specification. An implementation could therefore satisfy the stated four-class validation while logging or weakly storing the pairing code.
   - **Resolution criterion:** Register pairing codes as a fifth sensitive response/artifact class, even if they remain unprefixed and are not general-purpose bearers. Require keyed or salted digest storage, either high entropy or a per-code attempt ceiling, single-use CAS, no-store handling, diagnostic/log/receipt redaction, and planted-sentinel tests.

5. **`authorityCreating` is not yet a closed effect system across explicit scopes, wildcards, and nested calls.**

   - **Severity: MATERIAL**
   - **Evidence:** The RFC says adding `authorityCreating` terminally invalidates every prior **tier** scope (§Grants), but an explicit `{fn, kind}` grant approved before the marker was added was also consented without the durable-authority warning and is not expressly invalidated. Delegated tier grants are stored as concrete entries, so their tier origin must remain durable for later marker invalidation. Autonomous tier grants remain live wildcards; permanent non-revival after marker removal requires either revoking the whole wildcard or storing per-function terminal exclusions, neither of which appears in the `_auth_grants.scopes` model. Finally, the RFC acknowledges that developers may change a function’s nested `ctx.runMutation` graph. LLP 0039 says nested calls inherit authority, and the current runtime exposes `ctx.runMutation` (`packages/snapback-harness/ctx-bootstrap.js`), but this RFC does not say whether each nested target must independently satisfy grant scope. Without that rule, an unmarked wrapper can reach an authority-creating mutation; with it, the consent UI must disclose all required nested scopes.
   - **Resolution criterion:** Pin one closed model. It must invalidate every pre-marker consent—explicit or tier-derived—or prove an equivalent transitive effect rule; preserve scope origin and marker state durably; define terminal exclusions or whole-grant revocation for autonomous wildcards; and specify scope enforcement for nested calls. Validation must include an unmarked wrapper, an explicit pre-marker grant, a delegated expansion, an autonomous wildcard, marker removal/re-addition, and activation racing approval.

6. **The authorization-version statement contradicts LLP 0053’s closed event universe.**

   - **Severity: MATERIAL**
   - **Evidence:** The RFC says that because grants are immutable, “nothing here touches the authorization version or 0053’s closed event universe” (§Ending authority). Yet it also requires manifest activation to revalidate scopes, terminally invalidate removed or kind-changed functions, and react to a newly added `authorityCreating` marker (§Grants). LLP 0053 §The authorization-event universe explicitly makes activation of schema, functions, or authorization metadata event 2, which must advance the authorization version transactionally.
   - **Resolution criterion:** State that pure grant, credential, token, and principal transitions do not add new LLP 0053 authorization events, but every relevant manifest activation still fires existing event 2. Define the ordering between the global authorization-version advance, terminal scope invalidation, and grant-scoped connection deletion, and validate that the activation advances the version exactly once.

7. **Carrier termination and durable-authority fencing are not sufficiently separated for multiple tokens on one grant.**

   - **Severity: MATERIAL**
   - **Evidence:** Queue settlement deliberately omits `tokenId`, allowing work to survive routine token expiry and cap eviction (§Resolved authority). In contrast, §Ending authority calls token revocation—including cap eviction—an authority ending that projects `delete`. The agent SDK’s store/callback namespace is keyed only by `(actorUserId, credentialId, credentialGeneration, grantId)`, not by token or connection. With two live tokens for the same grant and query key, evicting token A must both fence A’s stale callback and avoid ambiguously addressing token B’s still-live state. LLP 0053 requires exact `query_instance_id`, `authority_generation`, and `query_generation` comparisons; the RFC’s validation covers two grants sharing a key, but not two tokens sharing one grant.
   - **Resolution criterion:** Define a carrier/connection instance axis separate from the durable queue-authority axis. Specify which generation changes on token expiry, cap eviction, and explicit revocation; which query instances are deleted or recreated; and why stale token-A callbacks cannot address token-B state. Add same-grant multi-token tests covering finite calls, live callbacks, retained state, cap eviction, and queued settlement.

8. **Hosted admission is incomplete because management-route availability remains an open security decision.**

   - **Severity: MATERIAL**
   - **Evidence:** The RFC refuses all hosted `servicePrincipal` invocation but leaves open whether hosted registration, credential minting, recovery, and consent routes are available (§Plane boundary; §Open Questions). Those routes are not harmless merely because invocation is currently refused: they create principals, durable grants, long-lived credentials, pairing state, and abuse load, and they may become live authority if hosted invocation is later unreserved. The RFC simultaneously promises exhaustive profile/transport validation and imported-principal recovery “on any profile,” neither of which can be made executable while hosted management admission is undecided.
   - **Resolution criterion:** Publish a complete hosted management matrix. The conservative v1 answer is to refuse all agent-management routes on hosted targets. If any are admitted, specify the hosted issuer, registration and throttle posture, dormant-authority migration behavior, credential storage assumptions, and acceptance tests before the RFC is ready.

9. **The credential-family tombstone horizon is called pinned but is not actually bounded.**

   - **Severity: MATERIAL**
   - **Evidence:** `revoke-self` accepts any secret in the credential’s tombstoned family, retained to a “pinned horizon,” but no time, count, absolute family lifetime, or maximum retained-hash budget is given (§Credentials and tokens). Agent credentials themselves have no absolute expiry, so the analogy to session-token retention through absolute expiry does not supply a bound. The validation requirement merely says the horizon is enforced and swept. An unlimited horizon permits rotation-driven storage growth; a finite horizon determines when an original owner loses the advertised self-revocation remedy.
   - **Resolution criterion:** Pin an absolute retention policy or require a named implementing specification to do so before acceptance. It must bound both age and family size, define rotation throttling and GC behavior, state what guarantees remain after sweep, and test restart, high-rate rotation, the oldest still-valid family secret, and the first swept secret.

## 4. Suggestions

- Replace the manually maintained `authorityCreating` boolean with a generated authority-effect summary. Generated membership methods could contribute a `durableAuthorityWrites` effect, and codegen could compute a conservative transitive closure over declared nested calls. Consent could bind an effect-summary hash rather than relying solely on developer annotation.

- Introduce a monotone `recovery_generation` on the agent principal. Binding invitations, requests, grants, credentials, and connection authority to that generation would let one atomic increment fence all pre-recovery state and make recovery races easier to reason about.

- Add an explicit manifest/runtime capability such as `agentAuthProtocol: 1`. The catalog-version open check protects persisted databases, but a capability requirement would also prevent older binaries, code generators, or clients from silently ignoring `auth.agents.*`, stable-function-ID requirements, or `authorityCreating`.

- Give recovery a durable, non-secret provenance record separate from initial `registration_provenance`, and surface it in later consent. Users should be able to distinguish the original creator from the authority that most recently recredentialed the principal.

- Consider separating reversible `suspendAgent` from permanent deactivation. Permanent tombstoning may remain useful, but a reversible suspension would better fit operational mistakes; the irreversible verb could require an explicit confirmation or stronger non-browser carrier.

- Add a single normative lifecycle matrix covering every record type, transition, producer, profile, generation change, connection disposition, queue effect, and authorization-version effect. The current information exists across several sections but is difficult to audit as one state machine.

## 5. Open questions

- Is production recovery an explicit exception to LLP 0039’s no-production-impersonation invariant, and if so, what exact parent amendment authorizes it?

- What production-safe operation reapplies an autonomous template or other autonomous grant after recovery or import?

- Does recovery invalidate all pending consent requests, or may a request created under an earlier credential generation be approved after recovery?

- Are scopes checked independently at every nested function invocation, or must an entry point’s grant cover the transitive call graph?

- What durable representation preserves delegated tier origin and autonomous wildcard exclusions across marker changes and function removal/reintroduction?

- Does token-only revocation terminate only a carrier and its live connection, or is it intended to cancel already queued work? What state is shared by multiple tokens for one grant?

- Are all agent-management routes refused on hosted targets in v1?

- What are the age, count, and rate limits for credential-family tombstones?

- Should permanent deactivation remain reachable with ordinary browser-usable `AdminWrite`, given that principal continuity cannot subsequently be recovered?

## 6. Readiness verdict

The architecture is promising and should be continued, but the current revision has unresolved parent-contract, production-lifecycle, recovery-race, scope-composition, invalidation, and fencing issues. Its validation requirements cannot yet prove the intended security properties because several required semantics and profile decisions remain undefined.

VERDICT: NOT READY
### Orchestrator verification notes — round 5 (not part of the received review)

- **Confirmed against the corpus:** LLP 0039:1731 pins "every impersonation effect is refused on `prod`" — the round-4 prod recovery carve-out did contradict a frozen invariant. LLP 0053 event 2 (`llp/0053:367`) makes activation of schema/functions/authorization metadata an authorization event that advances the version — the round-4 claim that "nothing here touches the authorization version" was wrong.
- The prod autonomous-grant contradiction, the sibling-recovery-invitation gap, the unbounded tombstone horizon, and the unclassified pairing code were each verified against the round-4 text.
- Both families independently reached findings 1–2 (prod recovery / prod grant application), as in round 4.

## Round 6 — 2026-07-13

**Provenance:** OpenAI Codex CLI v0.144.3, model gpt-5.6-sol, effort ultra, read-only, fresh session 019f5f73-f038-7873-98ca-b98a9135f471; method cli-runner.
**Revision under review:** `llp/0055-…rfc.md`, sha256 `8ee15b4bcadea7620c1ff6fcd899b404f8d99638450b8a20621649c987061912` (post-round-5)
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

This is a strong proposal with a sound core model: agent identity is distinct from human identity; effective user authority remains explicit; grants are capability-like intersections rather than ambient roles; and the operator plane cannot impersonate users in production. The separation among principals, credentials, grants, and per-call tokens is especially valuable. The RFC also engages seriously with rotation races, live revocation, rollback clocks, delivery fencing, and the production-recovery problem.

The proposal is not ready, however. Several security guarantees are stronger than the specified mechanisms can enforce. Most importantly, the proposed actor variables can make delegated access wider than direct-user access; profile restrictions are pinned primarily at minting rather than every later consumption effect; the justification for browser-accessible permanent deactivation contradicts the existing production operation-profile gate; and terminal scope invalidation has no durable representation compatible with immutable grants. The `authorityCreating` gate also covers only LLP 0056 membership writes, not the broader `permissionBacking` authorization state already defined by LLP 0053.

The implementation inspection supports the RFC’s characterization of this as future work. `servicePrincipal`, `_auth_users`, `mintSession`, and `sbs_` are not implemented. `src/server.rs` contains partial authority and impersonation-policy scaffolding but still rejects session bearer authentication as unavailable, while `src/manifest.rs` still carries client-supplied `AuthInput`. Existing token prefixes and operation-profile enforcement do match the cited baseline. The landing decomposition is therefore credible, but the normative gaps below must be closed before implementation.

## 2. Strengths

- **§Plane boundary:** The operator/app-plane distinction is crisp and preserves LLP 0039’s production prohibition on impersonation while giving the app plane ownership of user consent.

- **§Principal kinds and §Resolved authority:** The explicit actor/effective-user tuple directly addresses LLP 0019’s F2 gap and avoids conflating an agent’s durable identity with the user whose authority it is exercising.

- **§Grant creation and pairing codes:** User-minted, non-enumerating pairing codes invert the usual unsolicited-consent flow. The compare-and-swap redemption model and generic mismatch responses are thoughtful protections against identity probing and races.

- **§Credentials and tokens:** Prefix separation, hash-only storage, closed credential-class dispatch, non-fallthrough mismatch handling, and single-response secret delivery align well with LLP 0039’s credential posture.

- **§Ending authority:** Separating durable authority from its transient carriers is the right model. Live grant and principal validation at settlement, together with token-specific queue fencing, composes well with LLP 0053’s `AuthorizedLease` and witnessed-delivery rules.

- **§`authorityCreating` effect:** Recognizing that some writes create privilege that outlives the invoking grant is an important insight. The proposed static marker plus host-enforced sink check is a useful pattern even though its present coverage is incomplete.

- **§Catalog, lifecycle, and downgrade behavior:** Keeping principal and grant records under protected `_auth_*` state, excluding them from ordinary journal/sync behavior, and treating restore and downgrade as authority transitions are coherent with LLPs 0039 and 0053.

- **§Landing decomposition:** The RFC correctly treats stable function IDs, the frozen session gate, authorization-version invalidation, and rollback-resistant time as prerequisites rather than silently rebuilding them.

- **§Validation Requirements:** Cross-class credential tests, rotation races, rollback tests, self-seating tests, lost-response cases, and the two-token delivery fence are unusually concrete and adversarial for a Draft RFC.

## 3. Concerns

1. **Delegation non-widening is contradicted by the proposed authorization variables.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Resolved authority promises that an agent receives “exactly what the delegating user could see, intersected with grant scopes,” and §Validation Requirements includes `Grant-cannot-widen`. But §Principal kinds exposes `auth.actorKind` and `auth.isDelegated` to authorization rules. A rule such as `row.ownerId == auth.userId || auth.isDelegated` would allow a delegated agent to read a row that the effective user cannot read directly. The same problem arises with negation or an opaque handler branch on `ctx.auth.actor`. Neither LLP 0011 nor LLP 0039 supplies a monotonic rule language that would prevent this.
   - **Resolution criterion:** Specify a host-enforced composition rule that evaluates base authorization against the effective user’s direct projection and then permits delegated context only to narrow that result. Define exactly where actor variables may participate, including handlers and mutations. Add adversarial OR, negation, and actor-only allow tests demonstrating that delegation cannot widen direct-user access.

2. **Production restrictions are not closed over token consumption and profile transitions.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Recovery and §Operator-minted invitation creation restrict minting to dev/test/demo, but the route contracts for consuming `sbagr_` recovery invitations and operator-created `sbagi_` invitations do not independently require a non-production profile. A token can therefore be minted under demo/test, survive a restart under `prod`, and produce a new credential or principal in production unless consumption is separately gated. That would violate LLP 0039’s stronger invariant that every impersonation effect is refused on production, not merely the initial mint request.
   - **Resolution criterion:** Pin the profile check at every consumption write site and define whether invitation provenance is profile-bound. Add tests for “mint in demo, restart in prod, consume” for registration and recovery. Also define the disposition of outstanding invitations, grants, and recovery artifacts when a deployment changes profile.

3. **The justification for browser-accessible permanent deactivation is factually inconsistent with the current production baseline.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Ending authority accepts that app XSS with `sbcc_` can permanently deactivate every agent in production, arguing this is “strictly weaker” than the `app.reset` authority held by the same credential. LLP 0024 and LLP 0031 classify `app.reset` as non-production-only. The implementation enforces that contract in `src/admin.rs`’s `operation_profile_requirement`, and `src/server.rs` checks it before reset. Thus, on production, `sbcc_` cannot reset the app but this RFC would let it permanently destroy all agent authority; recovery is then intentionally unavailable.
   - **Resolution criterion:** Remove the incorrect baseline argument and redesign the production destruction path. Acceptable resolutions include a distinct non-browser destroy-only capability, reversible suspension with a protected recovery path, or another mechanism whose compromise analysis is explicitly compared against actual production powers. Add a production XSS test covering the selected boundary.

4. **Terminal scope invalidation lacks durable state compatible with immutable grants.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Grants says grant rows are immutable. §Scope validity nevertheless requires explicit scopes to become terminally invalid after function removal, kind change, or the later addition of `authorityCreating`, and says they must never revive. The proposed protected catalog has no scope-generation or invalidation record that can represent this fact. Updating grant scopes would violate immutability, while scanning and rewriting every affected grant at metadata activation is unbounded and is not specified as an LLP 0053 authorization event.
   - **Resolution criterion:** Define a persistent, transactional invalidation mechanism. One viable design is a monotonic consent generation per stable function ID and effect contract, captured by every explicit scope or tier expansion; removal or authority-relevant kind/effect changes advance the generation under LLP 0053 event type 2. Preserve tombstones across remove/re-add. Add restart, restore, remove/re-add, and concurrent activation tests proving old grants cannot revive.

5. **`authorityCreating` does not cover the authorization state already recognized by LLP 0053.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §`authorityCreating` claims that ordinary mutation scope must not silently include the ability to mint durable privilege, but derives the marker only from LLP 0056 membership-table declarations and gates only the membership-write host operation. LLP 0053 defines every non-incidental write to a `permissionBacking: true` table as an authorization event. An application can therefore use a separate ACL, role, or grant table marked `permissionBacking`; a tier-scoped delegated mutation could write that table and leave durable privilege behind without crossing the proposed membership-specific gate.
   - **Resolution criterion:** Extend the effect model and write-site enforcement to all system-known permission-backing writes, or explicitly narrow the RFC’s security claim and document unsupported authorization mechanisms. Validation must include a non-membership ACL table, aliases/wrappers around its write path, and a test proving an unmarked mutation cannot persist authority through it.

6. **A declared restore can permanently strand every production agent.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Restore says a declared restore revokes existing agent credentials and grants. §Recovery simultaneously forbids production recovery, leaving re-registration as the only production path. After a legitimate production restore, all restored agent principals therefore become dormant with no way to recover their identity, and any external agent installation must be re-paired from scratch. The RFC identifies lost-credential continuity as an open problem but does not explicitly ratify this system-wide restore consequence.
   - **Resolution criterion:** Make an explicit product decision about production restore continuity. Either provide an agent-held, non-impersonating recovery mechanism before enabling production registration, or explicitly accept the outage and specify operator warnings, capability reporting, runbook behavior, and validation showing the exact post-restore state.

7. **The rotation tombstone guarantee depends on an unspecified throttle invariant.**

   - **Severity:** MATERIAL
   - **Concrete evidence:** §Credential rotation promises that an attacker cannot use rotation to destroy the owner’s ability to revoke a credential family, while retaining only five generations or thirty days, whichever expires sooner. It then relies on rotation being “throttled so the generation budget cannot be burned,” but gives no rate, concurrency rule, or inequality tying the throttle to the five-generation retention limit. A holder of the current credential can otherwise rotate repeatedly and evict an earlier owner-held generation before thirty days.
   - **Resolution criterion:** Pin an exact rotation budget and concurrency rule that mathematically prevents count-based eviction before the promised time horizon, and test it under concurrent rotations and clock rollback. Alternatively, use a separate non-rotating revocation key that is unaffected by credential-family rotation.

8. **The secret-bearing route inventory is internally inconsistent.**

   - **Severity:** NON-BLOCKING
   - **Concrete evidence:** §Credentials and tokens refers to “all four new classes” when describing response secrecy and sentinels, but the RFC defines five new prefixes/classes: `sba_`, `sbagi_`, `sbagp_`, `sbagt_`, and `sbagr_`. The route and validation sections otherwise include pairing codes.
   - **Resolution criterion:** Replace the count with an explicit closed list, or consistently state five classes, and ensure every secret-returning route is covered by the sentinel and logging tests.

## 4. Suggestions

- Consider agent-generated asymmetric credentials with an offline revocation or recovery key. This would reduce bearer-secret exposure and provide cleaner answers for lost registration, recovery, and rotation responses.

- Generalize `authorityCreating` into a small host-enforced effect lattice, such as durable authority, external side effect, destructive effect, and billable effect. That could make future grant review more legible than accumulating unrelated Boolean markers.

- Rename `isDirectHuman`. The RFC explicitly declines attestation, so the helper proves only an undelegated principal declared as human, not that a human is actually operating it.

- State that token expiry is an admission deadline, not necessarily an effect deadline, because already-enqueued work may settle after token expiry. Receipts and audit output should make that distinction visible.

- Broaden the future durable-audit gate from hosted mutations to all side-effecting actions and authority-changing operations.

- Add explicit lost-response transitions for initial registration and recovery, not only grant minting and rotation.

## 5. Open questions

- Is delegation non-widening intended to be a host invariant, or may applications deliberately grant agent-only access through actor-sensitive rules?

- Are invitations and recovery artifacts bound to the profile in which they were created, to the current profile at consumption, or both?

- Is production agent support acceptable before an agent-held recovery design exists, especially across declared restore?

- What persistent identity and generation scheme records a function’s consent contract across removal, re-addition, kind changes, and effect-marker changes?

- Which authorization-bearing writes beyond LLP 0056 memberships must automatically require `authorityCreating`, and how are custom application authorization schemes declared?

- What precise rotation and revocation mechanism guarantees that a compromised current credential cannot erase an owner’s remaining destruction capability?

- What user-visible trust signal, if any, distinguishes a merely self-declared agent principal from an attested installation?

## 6. Readiness verdict

The architecture is promising and much of the threat modeling is strong, but the current Draft leaves multiple material security and lifecycle guarantees either contradicted or unenforceable. Delegation monotonicity, production consumption gates, destruction authority, durable scope invalidation, general permission-backing writes, restore continuity, and rotation revocability all require normative resolution.

VERDICT: NOT READY
### Orchestrator verification notes — round 6 (not part of the received review)

- **Verified, and decisive:** `app.reset` is `OperationProfileRequirement::NonProd` (`src/admin.rs:163-165`), so the round-5 residual argument ("strictly weaker than the `app.reset` the same credential already commands") was **factually false on `prod`** — both families caught it independently. The residual is re-argued in round 6 and `auth.deactivateAgent` (the only identity-terminal verb) is now `NonProd`.
- The consumption-site profile bypass (mint under demo, reboot into prod, consume) is real: `ServerProfile` resolves per boot and invitations are durable 7-day rows.
- The delegation-widening hole via `auth.isDelegated` in a disjunctive rule is real; round 6 pins a host-enforced direct-projection intersection.
- The terminal-invalidation durability gap is real; round 6 adds a per-(functionId,kind) basis generation so no grant row is ever rewritten.

## Round 7 — 2026-07-13

**Provenance:** OpenAI Codex CLI v0.144.3, model gpt-5.6-sol, effort ultra, read-only, fresh session; method cli-runner.
**Revision under review:** `llp/0055-…rfc.md`, sha256 `86176330ec6500337b44d7029d225001d28b8cfdab18bd0b5a1e4bebff748ace` (post-round-6)
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

This is a strong and necessary proposal. The core idea—first-class agent users with stable identities, separately revocable credentials, explicit grants, actor/effective-principal separation, and constrained local service-principal authority—directly addresses the F2 gap identified by LLP 0019. The separation between operator-plane impersonation and application-plane delegation is especially sound. The proposal also takes credential lifecycle, denial explainability, authority invalidation, recovery, and production posture more seriously than most initial capability designs.

The security architecture is directionally excellent, but the current draft is not ready. Several load-bearing properties are asserted more strongly than the specified mechanisms support. In particular, production revocation is effectively terminal despite being classified as recoverable; dual evaluation is not defined safely for arbitrary side-effectful handlers; autonomous grants are described both as fixed and as live wildcards; terminal function-scope invalidation lacks the durable basis state needed to survive ABA cycles; and the composition contract with LLP 0056 is weaker than that sibling RFC requires.

The implementation plan also understates prerequisites. Today, `ImpersonationCapability` is a reserved-but-unavailable effect policy, not an implemented carrier, and the authorization-version machinery needed for manifest activation belongs to the later LLP 0053 slice. These are solvable problems, and the design is worth preserving, but they require normative changes rather than implementation polish.

## 2. Strengths

- **Clear trust boundary and restrained scope (§Scope, §Non-goals).** Refusing hosted agent management wholesale while introducing the model through local trusted surfaces is an appropriate security posture.

- **Good identity model (§Agent principals, §Identity and attribution).** Stable agent `userId`s, `_auth_users.kind`, distinct credential records, and the actor/effective/grant tuple give the system a coherent basis for authorization and explanation.

- **Strong operator/application-plane separation (§Operator-plane impersonation, §Application-plane delegation).** This preserves LLP 0011’s rule model while avoiding the mistake of treating administrative impersonation as an application capability.

- **Excellent credential-class hygiene (§Credentials and secret handling).** Unique prefixes, class-first dispatch, hash-at-rest storage, redaction, `Cache-Control: no-store`, one-live-credential rotation, family-wide revoke-self, and cross-class rejection are all well chosen and consistent with LLP 0039.

- **Consent flow avoids an unsolicited principal oracle (§Pairing-code consent).** Having the human mint the short-lived pairing code is materially safer than allowing an agent to initiate requests against guessed user handles.

- **Thoughtful invalidation composition (§Authorization invalidation and leases).** The distinction between authority transitions and LLP 0053’s permission-backing events is mostly precise, and treating activation as the existing manifest-change event avoids inventing a competing invalidation model.

- **Strong dynamic gate for durable authority (§Authority-creating functions).** The `authorityCreating` classification and host-side transaction inspection are the right shape for catching aliases, wrappers, and future write paths that static route naming cannot reliably cover.

- **Recovery analysis is unusually candid (§Recovery and production posture).** The RFC correctly applies LLP 0039’s production refusal at both mint and consumption sites and explicitly identifies the absence of production recredentialing as a major limitation.

- **Adversarial validation plan (§Validation Requirements).** Cross-class substitution, stolen rotations, reboot behavior, multi-token fencing, lost delivery, negative delegation rules, and production refusal are all valuable tests rather than happy-path demonstrations.

## 3. Concerns

1. **MATERIAL — Production “authority ending” is functionally permanent identity destruction.**

   - **Concrete evidence:** In §Recovery and production posture, the RFC says production cannot recredential an agent that loses its credential, imported agents remain dormant, and autonomous grants cannot be reminted or evolved. Nevertheless, §Ending authority classifies credential and grant revocation as recoverable authority-ending operations and permits a browser console credential to bulk-revoke them. Registering a new principal does not restore the original stable `userId`, profile ownership, memberships, or provenance. This conflicts with the stated production invariant that an operator may end authority but not terminally destroy identity.
   - **Resolution criterion:** Either ship a production-safe proof-by-agent recovery mechanism before allowing these revocations, require a separate non-browser destroy-grade capability for irreversible production agent termination, or explicitly classify the operations as identity-terminal and gate them accordingly. Validation must demonstrate restoration of the same principal and its intended continuity, not merely creation of a replacement principal.

2. **MATERIAL — “Evaluate twice and intersect” is not defined safely for arbitrary functions.**

   - **Concrete evidence:** §Resolved authority requires delegated execution to be evaluated under both direct and delegated projections and to intersect the results. That is plausible for a closed, side-effect-free rule algebra, but the proposal applies to queries, mutations, and actions whose handlers may allocate IDs, write data, perform outbound effects, or return arbitrary values. Neither LLP 0011 nor LLP 0053 defines a pure authorization phase that can safely execute a handler twice. The claim that the compiler knows whether a rule or handler reads the actor variable also conflicts with §Authority-creating functions’ recognition that static scanning cannot soundly capture aliases and wrappers.
   - **Resolution criterion:** Specify a side-effect-free authorization IR or preflight that can be dual-evaluated before handler execution, including precise intersection semantics for every supported result type. Unsupported or dynamically actor-dependent functions must be rejected. A safer initial alternative is to expose the actor only for audit plus monotone denial primitives such as `requireDirectHuman()`, rather than as general handler input.

3. **MATERIAL — Autonomous grants are simultaneously “fixed at registration” and live wildcards.**

   - **Concrete evidence:** §Grant scopes defines autonomous `{tier:"query"|"mutation"}` scopes as live wildcards, so later manifest changes can add newly covered functions and marker removal can bring functions back into scope. §Recovery and production posture says autonomous scopes cannot evolve in production and are fixed at registration. A live wildcard changes effective authority when the application evolves even if the grant row remains unchanged.
   - **Resolution criterion:** Expand autonomous tier scopes into immutable concrete function entries when the grant is created, or explicitly classify manifest changes as production authority changes that can widen existing grants. The chosen model needs validation for function addition, removal, re-addition, kind changes, and delegation-marker changes.

4. **MATERIAL — Terminal scope invalidation lacks the durable state required to prevent ABA revival.**

   - **Concrete evidence:** §Grant scopes says explicit function scopes become terminally invalid after function removal, kind change, or marker change and must never revive after re-addition, restart, or restore. The stored `{fn, kind, basis}` alone cannot distinguish an unchanged function from remove-and-recreate ABA without a durable, monotonic per-function basis or tombstone ledger. No such protected catalog, lifecycle, transaction, restore, or garbage-collection contract is specified. The same section also says tier scopes use live exclusion with no terminal-exclusion list, but later says gaining a marker terminally invalidates every tier scope that covered the function.
   - **Resolution criterion:** Define the durable function-basis/tombstone state, its activation transaction, monotonicity, backup/restore behavior, reset semantics, and garbage collection. Clearly separate terminal invalidation of explicit scope entries from temporary live exclusion under tier wildcards, and remove the contradictory tier-scope statement.

5. **MATERIAL — LLP 0056 composition is weaker than the sibling RFC requires, and generic permission-backing writes lack durable provenance.**

   - **Concrete evidence:** LLP 0056 requires `provenance: "full"` for authority-creating membership writes and an append-only transition history covering inserts, downgrades, and deletes. §Composition with scoped roles and memberships merely requires a `provenance` declaration, and §Validation Requirements tests only that provenance exists. More broadly, §Authority-creating functions applies to every declared `permissionBacking` table, but only the membership design has a normative durable actor/effective/grant attribution contract. A delegated write to a generic ACL table could outlive grant revocation without durable evidence of how that authority was created.
   - **Resolution criterion:** Require exactly `provenance: "full"` for LLP 0056 composition and test the full transition history. For generic permission-backing tables, define a standard durable transition-provenance substrate or limit v1 `authorityCreating` support to table classes that already provide one.

6. **MATERIAL — The claimed depth-one delegation boundary is conventional, not structural.**

   - **Concrete evidence:** §Non-goals says agents cannot delegate because consent requires a live session and agents have no session path. However, the shared `_auth_users`/`_auth_identities`/`_auth_sessions` model does not normatively prohibit sessions for `kind=agent`; the session projection even includes the user’s kind. The pairing and invitation routes require a session bearer but do not consistently state that it must project a direct human. LLP 0039’s frozen session design does not currently enforce an agent-kind exclusion.
   - **Resolution criterion:** Pin and validate host/database invariants that session creation, exchange, identity linking, import, and session minting reject agent users, and require a direct-human projection for every consent or invitation route. If agent sessions are intended eventually, replace the claimed structural guarantee with an explicit delegation-depth mechanism.

7. **MATERIAL — The landing plan depends on security machinery that does not yet exist.**

   - **Concrete evidence:** §Operator-plane impersonation describes `ImpersonationCapability` as an available carrier. In the implementation, it is only an `EffectPolicy` variant: `src/server.rs` routes it to `SNAPBACK_AUTH_POLICY_UNAVAILABLE`, including for `host_ops.function.run.impersonated`. LLP 0039 also leaves the exact carrier as a deferred protocol obligation. Separately, §Landing decomposition permits a finite-scope stage after LLP 0039 item 5, while §Authorization invalidation requires manifest scope-basis activation to advance LLP 0053’s global authorization version as event 2; that transaction machinery belongs to the later item-6 work.
   - **Resolution criterion:** Make the impersonation carrier an explicit prerequisite and pin its transport, derivation, lifetime, and refusal behavior. Either require LLP 0053’s version/event-2 machinery before any LLP 0055 activation or explicitly pull that subset forward and define the safe partial-rollout state.

8. **NON-BLOCKING — Secret-class counting and revision prose have drifted.**

   - **Concrete evidence:** §Credentials and secret handling refers to redaction sentinels for “all four new classes,” but the RFC defines five prefixes: `sbac_`, `sbagt_`, `sbagi_`, `sbagr_`, and `sbpc_`. §Validation Requirements correctly expects five. Some revision/header prose also retains the earlier framing of browser-reachable destruction that the current body qualifies.
   - **Resolution criterion:** Correct the class count and reconcile the metadata/revision summary with the current normative text.

## 4. Suggestions

- Give agents a registration-time public key and use proof of possession both to reduce bearer-token theft and to enable same-principal production recovery. Agents are better suited than browsers to holding such keys.

- Consider a dedicated `AgentKillCapability`: narrower than impersonation, incapable of minting authority, but strong enough to authorize explicit irreversible shutdown when recovery is intentionally impossible.

- Prefer monotone host primitives such as `ctx.permissions.requireDirectHuman()` over exposing a raw `isDirectHuman` boolean to application logic. A deny-only primitive is easier to audit and harder to invert accidentally.

- Model reusable scopes as versioned, named capability bundles with immutable content hashes. This would make manifest evolution and grant review more legible than implicit live tier wildcards.

- Clarify that token TTL limits the submission window, not necessarily the effect window, when queued work survives token expiry or eviction. Consider a separate maximum queued-authority age.

- Split the eventual implementation specification into explicit state-transition tables for credentials, grants, invitations, function bases, and authorization-version changes. The current prose contains enough interacting generations that tables would materially improve reviewability.

## 5. Open questions

- What exact mechanism restores the same production agent principal after credential loss without granting a browser general impersonation power?

- Are autonomous grants intended to authorize a fixed reviewed function set or a moving application-defined tier? Which party is considered to approve later widening?

- What durable object owns each function’s monotonic basis, and how is it preserved across backup, restore, import, reset, and disaster recovery?

- What is the formal authorization language that can be evaluated twice without executing handler side effects?

- Can an agent user ever acquire a session through provider linking, import, administrative repair, or a future authentication mechanism? If not, where is that invariant enforced?

- What exact carrier satisfies `ImpersonationCapability`, and how is it prevented from crossing HTTP, MCP, child-process, or environment boundaries unintentionally?

- Does every durable permission-backing transition need durable actor/effective/grant provenance, or only the membership subsystem?

- When a delegated token submits queued work, what authority state is revalidated at execution time, and what maximum delay is acceptable?

## 6. Readiness verdict

The proposal has a compelling architecture and should continue, but unresolved material issues affect production safety, delegation soundness, scope stability, provenance, and implementation feasibility. These need normative resolution before the document can safely advance.

VERDICT: NOT READY
### Orchestrator verification notes — round 7 (not part of the received review)

- **Both families converged** on the non-widening skip rule: exempting a handler from dual evaluation because "the compiler knows it reads no actor variable" is exactly the static-analysis trust this RFC refuses two sections later for `authorityCreating` (LLP 0053's alias/computed-access posture). Round 7 replaces the inference with a structural fact — the sealed projection carries **no actor keys at all** unless the function declares `readsActor`, so there is nothing to alias or reflect.
- The GPT family additionally showed the round-6 'ending vs identity-terminal' distinction is **illusory on `prod`**: because `prod` forbids operator authority-creation, every operator destruction there is irreversible. Round 7 gates prod destruction behind the non-browser operator carrier, removing the browser-XSS permanent-destruction primitive entirely.
- The ABA hole in the basis generation (a GC'd generation row would restart at 0 and revive stale consent) is real; round 7 makes it a durable tombstone.

## Round 8 — 2026-07-13

**Provenance:** OpenAI Codex CLI v0.144.3, model gpt-5.6-sol, effort ultra, read-only, fresh session; method cli-runner.
**Revision under review:** `llp/0055-…rfc.md`, sha256 `992686230ea011faf6d5aaee8ead7ec06ea68240c5cce5f034756c070d2760e4` (post-round-7)
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

The reviewed file matches the supplied SHA-256. The proposal’s central direction is good: agents should be first-class app principals, autonomous and delegated authority should share one model, grants should be immutable and revocable, and operator authority must remain separate from app authority. The RFC also shows unusually strong threat modeling around credential classes, recovery, live invalidation, durable privilege creation, and hosted refusal.

The production posture is appropriately conservative. In particular, treating recovery of an existing principal as an impersonation effect correctly preserves LLP 0039’s production invariant, while the dormant-import and lost-credential consequences are stated honestly rather than hidden.

However, the proposal is not ready. Its most important security claim—delegation cannot widen the effective user’s authority—is not defined for Snapback’s actual arbitrary-value query and action model. The actor-hiding optimization also conflicts directly with the proposed `isDirectHuman` test. Separately, the production kill-path carrier is neither specified nor implemented, the validation matrix contradicts the normative route matrix, and two required durable mechanisms lack an owned storage/protocol contract. These are correctness and feasibility issues, not editorial polish.

Implementation inspection confirms that this RFC is genuinely future work. The repository currently mints `sbat_`, `sbcc_`, `sct_`, and the `sbr*` family, and it has route-policy scaffolding for sessions. It does not implement `_auth_users`, `sbs_`, `mintSession`, agent grants, or `servicePrincipal`; notably, `src/server.rs::authorize_operation_spec` currently refuses `EffectPolicy::ImpersonationCapability` as unavailable.

## 2. Strengths

- **Clear authority-plane separation (§Summary, §Plane boundary).** Keeping app-data `servicePrincipal` authority categorically unable to satisfy `Admin*` policies is the right boundary, and preserving MCP’s existing dev host-ops path avoids conflating two unrelated transports.

- **Honest hosted scope (§Summary, §Plane boundary, §Routes).** Refusing every hosted service-principal and management cell until deployment security and durable mutation audit exist is coherent with LLP 0024, LLP 0042, and LLP 0019 F8.

- **Correct production recovery conclusion (§Recovery).** The RFC follows LLP 0039’s controlling rule that every impersonation effect is refused on production and names the resulting continuity limitation plainly.

- **Good principal representation (§Principal kinds).** Reusing the Snapback user-id space avoids forking profile, membership, RLS, and audit surfaces. Immutable kind and durable deactivation are sensible invariants.

- **Strong credential-class design (§Credentials and tokens, §Routes).** Distinct prefixes, structural dispatch, no fallback, hashed storage, no-store responses, and cross-class negative tests provide a good foundation.

- **Thoughtful carrier-versus-authority separation (§Resolved authority, §Ending authority).** Excluding `tokenId` from queued settlement while retaining it on the connection axis correctly prevents routine token expiry or cap eviction from stranding durable work.

- **Sound intent for durable privilege creation (§Grants, `authorityCreating`).** Detecting permission-backing writes at the host write boundary, rather than trusting static derivation, is consistent with LLP 0053’s two-gate posture and composes well with LLP 0056.

- **Good invalidation mapping (§Ending authority).** Pure authority termination using scoped `delete`, while manifest activation remains LLP 0053 event 2, respects LLP 0053’s closed event universe.

- **Excellent residual accounting (§Attestation, §Catalog and lifecycle, §Open Questions).** Attestation, undeclared restore, production continuity, offline service-principal reads, and hosted operator principals are identified as unresolved rather than implied solved.

- **Adversarial validation breadth (§Validation Requirements).** The class-confusion, ABA, lost-response, cross-fence, clock-rollback, and dynamic-host-gate fixtures are substantially stronger than happy-path acceptance.

## 3. Concerns

1. **Severity: MATERIAL — The non-widening rule has no defined semantics for arbitrary query results or actions.**

   **Evidence:** §Resolved authority says actor-reading queries and live registrations deliver the “intersection” of delegated and direct-user executions. Snapback queries do not necessarily return row sets: `src/local.rs::FunctionRunResult.result` and `src/runtime.rs::ExecutedIbexMutation.result` carry arbitrary JSON `Value`, including scalars, aggregates, projections, and synthesized objects. There is no general safe intersection for those values. Actions are explicitly grantable in §Grants, while the dual-evaluation rules cover queries, live registrations, and mutations but not actions. Current actions can perform outbound fetches and nested mutations through `packages/snapback-harness/ctx-bootstrap.js`, so evaluating them twice is not generally safe.

   The RFC also does not require both query executions to share one coherent snapshot or combine their captured dependencies. A table read only by the direct-user run must still wake the live query. Likewise, authorization reads from both mutation executions must participate in commit-time validation. LLP 0053 requires complete captured dependence for protected results.

   **Resolution criterion:** Define a closed v1 actor-aware function subset. Either prohibit `readsActor` for actions and arbitrary/opaque query results, or define a safe result algebra for every permitted return shape. Require both evaluations to use one coherent snapshot, union all captured dependencies and commit-validation reads, and specify how direct-only denial and failure compose. Add scalar, aggregate, synthesized-object, direct-only-dependency, concurrent-permission-change, and actor-aware-action negative tests.

2. **Severity: MATERIAL — Actor-key omission makes the documented direct-human check fail open, and the direct-user projection is not enumerated.**

   **Evidence:** §Principal kinds defines the handler test as `ctx.auth.kind === "human" && ctx.auth.actor == null`. §Resolved authority then says a delegated invocation receives no actor keys unless the function declares `readsActor: true`. Therefore an undeclared delegated function observes a human effective kind and no actor, exactly the proposed “direct human” shape. The generated `isDirectHuman(ctx)` helper cannot fix this if it is ordinary code inspecting that projection; the validation requirement asserts the desired result but does not specify a mechanism.

   The sealed projection enumeration also contains autonomous agent, delegated agent, and human-session shapes, but no exact “direct-user baseline” used by dual evaluation. It is unclear what `sessionId` and `provider` mean when the effective user has zero or several sessions. This matters because LLP 0039 permits online handlers to inspect those fields.

   **Resolution criterion:** Make `isDirectHuman` a host-derived predicate over resolved authority, or specify that using it necessarily installs `readsActor` and is refused otherwise. Enumerate the exact internal direct-baseline projection, including `sessionId`, `provider`, roles, and kind, and define whether session/provider-dependent functions are ineligible for delegation. Add an undeclared-helper regression test and exact-key tests for both delegated and baseline projections.

3. **Severity: MATERIAL — The production non-browser kill carrier is not an existing or specified capability.**

   **Evidence:** §Recovery and §Routes require production kill verbs to prove a “non-browser operator carrier,” expressly distinguishing the carrier from the `ImpersonationCapability` effect. LLP 0039 §Protocol obligations has not yet selected the impersonation carrier; it names alternatives. Current `src/server.rs` has no corresponding `CredentialResolution` variant and treats `EffectPolicy::ImpersonationCapability` as unavailable. The `AdminSecretRead` root cannot substitute: LLP 0039 explicitly requires credential non-substitutability between secret-read and impersonation authorities.

   Reusing the impersonation *effect* would also be wrong because LLP 0039 requires every such effect to be refused on production. The RFC needs a distinct proof even if it eventually shares key material.

   **Resolution criterion:** Define and assign ownership for a separate operator-presence/non-browser carrier: exact CLI or wire presentation, derivation, replay protection, lifetime, custody, profile policy, route-registry classification, and audit facts. Alternatively, declare production kill verbs CLI-only and define direct keyring authorization. Record the prerequisite explicitly in the landing order.

4. **Severity: MATERIAL — The normative production kill matrix and validation requirements contradict one another.**

   **Evidence:** §Recovery, the main route table, and the profile-invariant validation require the non-browser carrier for production revocation and make `auth.deactivateAgent` `NonProd`. The route table separately lists `auth.revokeAgentInvitation` as `AdminWrite` on all profiles, then lists it again in the production-carrier group. Finally, Validation Requirements §Ending authority says “each operator kill verb works on `prod` with `AdminWrite` alone” immediately after grouping credential revocation and deactivation together.

   The rationale that “every destruction is irreversible” is also overbroad: a user can mint a replacement user invitation, and a delegated grant can be re-consented. Credential and autonomous-grant revocation are the genuinely continuity-critical cases.

   **Resolution criterion:** Publish one authoritative verb × profile × carrier matrix covering grant, credential, invitation, token, and identity termination. Remove duplicate route rows, derive validation from that matrix, and state object-specific irreversibility rather than a universal claim.

5. **Severity: MATERIAL — The basis-generation tombstone has no owned durable representation or lifecycle.**

   **Evidence:** §Grants says marker lifecycle is closed “with no new storage,” but later requires a durable basis-generation row that survives removal, restart, restore, and ABA re-addition. §Catalog and lifecycle says five new tables join the catalog, yet neither the table inventory nor protocol transition inventory identifies where function-basis generations and terminal scope invalidations live. This state must also commit atomically with LLP 0053 event 2 and grant-scoped connection deletion.

   **Resolution criterion:** Name the durable catalog or metadata record, its key and monotonic-generation rules, and its reset/import/backup/restore/downgrade/GC behavior. Include it in the transition inventory and require crash tests around activation, version advance, tombstone persistence, and re-addition.

6. **Severity: MATERIAL — Generic `permissionBacking` provenance is required but not designed or owned.**

   **Evidence:** §Grants intentionally extends `authorityCreating` beyond LLP 0056 memberships to every `permissionBacking` table and requires “equivalent host-filled provenance.” LLP 0053 defines `permissionBacking` invalidation semantics but no provenance schema. LLP 0056 defines `provenance: "creation" | "full"` and an append-only transition log specifically for membership declarations. The companion obligations mention only the LLP 0056 membership composition, while validation requires a non-membership permission-backing table to work identically.

   **Resolution criterion:** Either restrict v1 service-principal permission-backing writes to LLP 0056 declarations with `provenance: "full"`, or define a generic provenance declaration, host-filled fields/log, update/delete semantics, redaction, retention, export/import behavior, schema owner, and companion amendments.

7. **Severity: MATERIAL — The claimed credential-family storage bound depends on an unpinned persistent throttle.**

   **Evidence:** §Credentials and tokens promises a 30-day time-only revoke-self horizon without a count cap, arguing that one rotation per hour bounds storage to roughly 720 hashes. That bound holds only if rotation admission is durable, rollback-safe, and atomic across concurrent requests and restart. Neither the transition obligations nor validation explicitly requires those properties; the “thief-rotates-N” validation does not include concurrent rotation or restart.

   **Resolution criterion:** Pin a durable per-family rotation high-water or token bucket, checked atomically with rotation using the rollback-protected clock. Validate concurrent attempts, crash/restart, clock rollback, and GC. If the throttle is not durable, add a hard bound whose eviction rule cannot remove any hash still inside the promised revoke-self horizon.

8. **Severity: NON-BLOCKING — Secret-class accounting is inconsistent.**

   **Evidence:** §Credentials and tokens calls for planted sentinels for “all four new classes,” while the revision header and Validation Requirements correctly identify five registered classes: agent credential, scoped token, creation invitation, recovery invitation, and pairing code.

   **Resolution criterion:** Use one five-class inventory consistently in prose, route metadata, and redaction tests.

## 4. Suggestions

- Add an implementation-status banner like LLP 0024’s. It should distinguish existing prefix/carrier infrastructure from unbuilt session and agent-auth machinery.

- Split implementation follow-ons into at least identity/credential lifecycle, grant/consent protocol, and invocation/fencing specs. The current transition inventory spans too many independently failure-prone state machines for one implementing document.

- Consider keeping actor/effective/grant facts entirely in immutable audit metadata and exposing only host-derived predicates such as `isDelegated()` and `isDirectHuman()` to authorization code. That would substantially reduce the need for arbitrary-output dual evaluation.

- Add argument- or resource-bound scopes early. A function-only scope such as `manageMembers` may cover every resource the user administers. This is especially consequential for `authorityCreating` consent.

- Make authority-creating consent explicitly state that created authority survives grant revocation. Self-seating, target role ceilings, and resource bounds deserve separate display facts rather than one Boolean warning.

- Preserve `credentialId`, `credentialGeneration`, and `tokenId` for the future durable audit substrate even if the public attribution block remains limited to actor/effective/grant.

- Give dormant imported agents and unavailable production recovery a stable capability/diagnostic surface before enabling production registration. Otherwise operators may discover the continuity policy only during an incident.

## 5. Open questions

- What exact value is the direct-user baseline projection, and may delegated authority invoke functions whose behavior depends on `sessionId` or `provider`?

- Are actor-aware actions prohibited in v1? If not, how are external side effects and nested mutations evaluated without duplicate effects?

- Is the production kill proof a new operator-presence capability, a CLI-only keyring operation, or a derivative of a future impersonation carrier?

- Will generic permission-backing tables receive a real provenance primitive, or should v1 support only LLP 0056 membership tables?

- Where does the durable function-basis generation live, and how does logical import treat it when grants themselves are excluded?

- Is production credential continuity intentionally acceptable as an unsolved prerequisite, or should agent-held recovery keys land before production registration is presented as a supported path?

- Should high-risk scopes bind canonical resource arguments or app-declared capability contracts rather than only stable function ids?

- How much autonomous wildcard widening across deployments is acceptable before app-declared scope bundles or capability-version re-consent become necessary?

## 6. Readiness verdict

The proposal is directionally strong and contains substantial security work, but its central non-widening mechanism, production kill authorization, validation matrix, and durable state ownership are not yet coherent enough to implement safely. Multiple unresolved MATERIAL concerns remain.

VERDICT: NOT READY
### Orchestrator verification notes — round 8 (not part of the received review)

- **The decisive catch, and it is correct:** round 7's structural fix (omit actor keys unless `readsActor` is declared) made the documented `isDirectHuman` check **fail open** — an undeclared function reads `ctx.auth.actor` as `undefined`, concludes `actor == null`, and treats a *delegated agent* as a direct human. The round-8 revision removes the data property entirely: delegation is observable only through host operations that refuse, typed, when `readsActor` was not declared. Fail-closed.
- Also correct: the round-7 'non-browser operator carrier' was an invented capability with no owner. It is now the named `AgentDestroyCapability`, registered in the dated LLP 0039 amendment.
- `authorityCreating` over *generic* `permissionBacking` tables had no provenance design; v1 now scopes the consentable surface to LLP 0056 membership tables (the only ones that carry the mechanism) and refuses the rest outright.
- **This is where the loop stopped.** The remaining GPT-family findings are predominantly executable-protocol obligations (own the tombstone table's lifecycle, the throttle's persistence, the carrier's registration) — the same methodological split LLP 0039 §Protocol obligations records and that Charlie ratified for the parent umbrella on 2026-07-12. That call belongs to the author, not to this loop.

## Round 9 — 2026-07-13 (RFC altitude)

**Provenance:** OpenAI Codex CLI v0.144.3, model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, fresh session; method cli-runner. Brief carried the author's ratified altitude ruling.
**Revision under review:** `llp/0055-…rfc.md`, sha256 `f0ceff6d14d1a55ace973727dcdf32e9f7127ac4e3f8da9b8e4bd8caf99ad150`
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

This is a strong and unusually security-conscious proposal. First-class agent principals, user-authorized delegation, immutable scoped grants, and explicit actor/effective-principal attribution are the right foundations. The separation between application and operator authority is especially valuable, and the owner re-credentialing path is a credible way to reconcile production continuity with LLP 0039’s prohibition on operator impersonation in `prod`.

The RFC also handles several difficult details well: credential-family theft recovery, scope ABA, durable authority creation through memberships, carrier-versus-authority fencing, and hosted refusal. Its protocol deferrals are appropriately identified; under the author’s ruling, those are not blockers.

However, the current revision is not ready. Its central non-widening guarantee has mutually incompatible projection and evaluation rules, its query-result intersection is not defined for the actual query-result surface, and its production and recovery validation matrices contradict the normative design. These are RFC-level semantic and security defects, not requests for implementation-spec detail.

## 2. Strengths

- **§Summary and §Plane boundary:** The operator/application-plane separation is crisp. Refusing every hosted service-principal and management cell avoids accidentally treating local scoped tokens as hosted security.

- **§Principal kinds and §Re-credentialing:** Reusing `_auth_users` preserves profile and membership continuity without forking every `userId`-based surface. Owner-authorized re-credentialing is a coherent production path, while terminally revoking third-party grants prevents consent from silently crossing credential recovery.

- **§Credentials and tokens:** The credential hierarchy, class dispatch, rotation fencing, family-wide `revoke-self`, and bounded tombstone window are well reasoned. The existing-prefix claims are grounded in the implementation: `sbat_`, `sbcc_`, `sct_`, and the `sbr*` family are present in `src/admin.rs`, `src/server.rs`, and `src/admin_secret_read.rs`.

- **§Grants:** Stable function identities, durable scope bases, delegated wildcard expansion, and terminal invalidation form a strong consent model. Treating `authorityCreating` as a host-enforced write-site effect—not merely a static marker—is the right composition with LLP 0053 and LLP 0056.

- **§Ending authority:** Separating the durable authority axis from the token/connection carrier axis correctly handles multiple live tokens on one grant and avoids cross-fencing surviving connections.

- **§Protocol obligations deferred to implementation:** The deferred transition, settlement, consent, fence, and hosted-admission work is explicitly inventoried. That is appropriate RFC altitude and should not delay readiness once the design contradictions below are resolved.

- **§Validation Requirements:** The class-confusion, mint-under-demo/consume-under-prod, thief-rotates-N, scope-ABA, dynamic-wrapper, and multi-carrier tests are excellent adversarial cases.

## 3. Concerns

1. **Severity: MATERIAL — The non-widening contract simultaneously specifies incompatible auth projections and evaluation rules.**

   **Evidence:** §Principal kinds says handlers inspect `ctx.auth.actor`; the delegated sealed projection in §Resolved authority contains an `actor` data property. The same section then says there is “no `actor` data property” and actor information exists only through host operations. The design permits single evaluation for undeclared functions, while §Validation Requirements says “There is no skip: every delegated invocation is dual-evaluated,” correctly noting that `sessionId` alone distinguishes delegation. Validation also simultaneously requires `ctx.auth.actor` to be the agent and reflection to prove that no actor property exists.

   The exact “direct projection” is also absent. Delegated authority has `sessionId: null` and `provider: "agent-credential"`, while an actual direct human session has a concrete session and identity provider. Grants survive logout, so there may be no live human session whose projection can serve as the comparison baseline. LLP 0053 requires exact sealed mode-specific projections, making this a semantic decision rather than an implementation detail.

   **Resolution criterion:** Choose and state one exact contract: the sealed autonomous, delegated, and direct-baseline projections; whether `actor` is a property or only a host operation; whether every delegated invocation is dual-evaluated; and how `sessionId`/`provider`-dependent functions behave. Reconcile every example, validation row, and the planned LLP 0053 amendment with that single answer. Also state whether action non-widening covers only authorization gates or actor-dependent action behavior.

2. **Severity: MATERIAL — Primary-key row intersection does not cover the actual query result surface.**

   **Evidence:** §Resolved authority defines query non-widening as intersection “by primary key.” The current `src/runtime.rs::run_ibex_query_with_reads` requires an array but accepts arbitrary JSON array elements; it does not require each result to retain a primary key. LLP 0053 likewise explicitly recognizes projected, aggregated, and synthesized logical output. A query returning counts, projections without ids, or synthesized records has no defined safe intersection. The validation suite covers only keyed row sets.

   **Resolution criterion:** Either restrict delegated actor-observing queries/live queries to manifest-proven, identity-preserving row-set outputs, or define a conservative meet for every supported output shape—such as equality-or-deny when no safe structural intersection exists. Add aggregate, projection-without-id, duplicate-id, and synthesized-output validation cases.

3. **Severity: MATERIAL — The production authorization matrix would certify mutually exclusive and potentially unsafe behavior.**

   **Evidence:** §Routes and §Ending authority require `AdminWrite + AgentDestroyCapability` for operator destruction on `prod`, and the earlier identity validation repeats that rule. The later “Ending authority” validation instead requires every operator kill verb to work with `AdminWrite` alone. Separately, the profile validation says every authority-creating verb is refused on `prod`, then in the same paragraph requires a user-minted invitation to consume there; owner re-credentialing is also explicitly an authority-creating production path.

   **Resolution criterion:** Publish one RFC-level route/caller/profile matrix and derive the prose and tests from it. The validation must require `AgentDestroyCapability` on every production operator kill path and must qualify the production creation prohibition as applying to operator-plane effects, not user-authorized owner paths.

4. **Severity: MATERIAL — Import, restore, and lost-rotation behavior contradict the owner-based production-continuity decision.**

   **Evidence:** §Re-credentialing says an owned imported agent is re-credentialable on `prod` and that declared restore leaves owned agents recoverable. §Catalog and lifecycle instead says every imported production agent is dormant until a future recovery mechanism, while omitting `owner_user_id` from the explicitly exported fields. Later validation says production import makes authentication impossible and declared restore leaves every agent dormant. The lost-rotate-response validation similarly says “the owner” must re-register on `prod`, despite the owner credential route being the RFC’s production recovery path.

   **Resolution criterion:** Explicitly include `owner_user_id` in logical export/import and state one lifecycle matrix distinguishing owned from unowned agents. Clarify “immediately dormant after restore” versus “recoverable by the owner,” then align catalog prose, lost-response behavior, capability reporting, and all validation rows.

5. **Severity: NON-BLOCKING — Current implementation status and secret-class accounting are overstated.**

   **Evidence:** §Summary says the operator plane already has an `ImpersonationCapability` carrier that agents use. In the current implementation, `src/server.rs` rejects `EffectPolicy::ImpersonationCapability` as unavailable, and LLP 0039 still defers selecting its carrier. The RFC correctly labels `sbs_` unbuilt elsewhere, so the same precision should apply here. §Credentials and tokens also asks for redaction acceptance for “all four” new classes after defining five, including `sbpc_`.

   **Resolution criterion:** Add a short implementation-status note distinguishing built policy scaffolding and `AdminSecretRead` from unbuilt sessions, impersonation, `_auth_*` agent tables, and `servicePrincipal`; change the stale four-class reference to five.

6. **Severity: NON-BLOCKING — Registration is rate-limited but not durably bounded.**

   **Evidence:** §Registration calls `open` a bounded-abuse posture, but supplies only a route throttle. §Caps has no total agent-principal cap per owner/app, and repeated re-credentialing creates new credential and `_auth_identities` rows. Hosted refusal limits exposure, but long-running trusted-local production can still accumulate unbounded protected-catalog state.

   **Resolution criterion:** Add per-owner/app principal and credential-history bounds with explicit refusal or GC behavior, or narrow the claim to “rate-bounded” rather than storage-bounded abuse.

## 4. Suggestions

- Prefer a terminal `ctx.permissions.requireDirectHuman()` guard for authorization-sensitive use. A boolean `isDirectHuman()` invites branching and accidental inversion even if its host gate is correct.

- Consider making query-result non-widening a generated “meet” operation attached to the output schema. Keyed row sets use set intersection; scalar or non-lattice outputs can conservatively require equality.

- Make the owner/controller identity prominent wherever another user grants an agent durable membership or delegation. Re-credentialing allows the owner to assume the agent’s autonomous identity and surviving memberships, so that control relationship should be explicit to grantors.

- Report trusted-local versus hosted admission as an explicit runtime capability, not something inferred from `ServerProfile` or bind address.

## 5. Open questions

- What exact sealed value is the effective user’s direct-baseline projection when no live user session exists?

- Are `sessionId`- or provider-dependent functions categorically delegation-ineligible, or do grants bind an additional authority dimension?

- Is actor information a data property, a host operation, or both—and is dual evaluation unconditional?

- Which query output shapes support a safe non-widening meet in v1?

- Does granting authority to an owned agent explicitly mean trusting its owner to assume every autonomous membership that survives re-credentialing?

- Is `owner_user_id` immutable and always preserved across export, import, restore, and future ownership transfer?

- What durable population limits apply to `open` registration and repeated owner re-credentialing?

## 6. Readiness verdict

The proposal’s direction is good, and its deferred protocol obligations are appropriately non-blocking at RFC altitude. The unresolved issues above concern the meaning and feasibility of the core non-widening guarantee and two load-bearing production security/lifecycle matrices. Those must be reconciled before implementing specs can faithfully realize the design.

VERDICT: NOT READY

### Orchestrator verification notes — round 9 (not part of the received review)

Round 9 ran with the author's ratified altitude in the brief (design defects are MATERIAL; deferred protocol rigor is not). Findings dropped sharply and became precise. The decisive one — found by the Claude family — was a **stolen-session escalation in the new ownership design**: a thief holding a stolen bearer could walk the owner routes and convert a *revocable* session into a **durable agent credential that survives its revocation**, the same defect class the operator path closed in round 4. Fixed with **step-up authentication** on credential-minting owner routes plus a **compromise-response cascade**, and the property is now pinned: *a stolen session must not be convertible into authority that outlives its revocation.* Also fixed: two contradictory evaluation rules and two incompatible `ctx.auth` shapes (resolved by making the check unconditional, which let `actor` stay an ordinary sealed property so `isDirectHuman` cannot fail open); and **primary-key result intersection**, which does not cover aggregates, projections, joins, or opaque returns — replaced by intersecting at the **data layer**.

## Round 10 — 2026-07-13 (RFC altitude)

**Provenance:** OpenAI Codex CLI v0.144.3, model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, fresh session; method cli-runner. Brief carried the author's ratified altitude ruling.
**Revision under review:** `llp/0055-…rfc.md`, sha256 `de7427ec369487cc86a477e581ed80d8e58c0f8980210bcf5c3012a85f520954`
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

This is a strong and worthwhile proposal. First-class agent principals, opaque scoped tokens, explicit actor/effective/grant attribution, and a hard operator/app-plane boundary are substantially safer than representing agents as fake humans or giving them ordinary user bearers. The RFC generally composes thoughtfully with LLP 0011, LLP 0039, Accepted LLP 0053, and sibling LLP 0056.

The implementation inspection supports the RFC’s staged framing: `servicePrincipal`, `_auth_users`, `sbs_`, and `auth.mintSession` remain unbuilt or reserved, while the existing `sbat_`, `sbcc_`, `sct_`, and `sbr*` carriers and the admin/secret-read policy separation match the document’s inventory. I am not treating the deferred transition tables, serializations, or linearization proofs as blockers.

There are, however, four material design problems. The synthetic “direct user” projection does not actually prove non-widening against a real user session; bearer-only consent can turn a stolen session into durable and even irrevocable authority; delegated actions lack a feasible dual-evaluation model for irreversible effects; and the import/restore recovery contract contradicts itself. These are semantic and security defects at RFC altitude, not missing protocol detail.

## 2. Strengths

- **Clear plane separation (§Summary; §Plane boundary).** `servicePrincipal` is restricted to app-data invocation and cannot satisfy lifecycle, provisioning, reset, inspection, or other operator authorities. The wholesale hosted refusal is explicit and correctly travels into the proposed LLP 0024/0042 amendments.

- **Strong authority attribution (§Resolved authority; §Audit).** The actor/effective/grant distinction answers LLP 0019 F2 directly, and the server-derived attribution block avoids granting evidentiary value to wrapper-synthesized envelopes.

- **Thoughtful authorization-invalidation composition (§Ending authority).** Separating the durable-authority axis from the token/connection carrier axis is correct. The RFC also correctly recognizes manifest activation as LLP 0053 event 2 while treating pure grant, credential, and token endings as authority transitions.

- **Good scope and durable-privilege design (§Grants, “`authorityCreating` is an effect”).** The dynamic write-site gate closes aliasing and wrapper laundering, tier scopes exclude marked functions, pre-marker consent is invalidated, and LLP 0056 `provenance: "full"` preserves attribution after downgrade or deletion.

- **Credential hygiene is unusually complete (§Credentials and tokens).** Distinct prefixes, typed class mismatch, no fall-through, hashed storage, token caps, rollback-checked expiry, family-wide `revoke-self`, and a time-bounded tombstone family address realistic theft and lost-response cases.

- **Excellent validation ambition (§Validation Requirements).** The matrix covers profiles, wrong-class credentials, replay, terminal scope invalidation, multiple live carriers, settlement after authority loss, and host-gate bypass attempts. The deferred-protocol inventory is also appropriately explicit for an RFC.

## 3. Concerns

1. **MATERIAL — The synthetic direct projection does not establish the claimed non-widening property.**

   - **Evidence:** §Resolved authority promises that a delegated invocation is allowed only where “the same invocation under the effective user’s direct projection” is allowed, and says the agent sees exactly what the user could see. But the comparator is `{ userId: U, sessionId: null, provider: null, ... }`, while LLP 0039 §`ctx.auth` and LLP 0053 §Protected-query admission define a real authenticated session with a real `sessionId` and provider. A handler such as `if (ctx.auth.sessionId === null) return privateRows` allows both the delegated projection and the synthetic comparator, while denying every real direct session. Dual evaluation therefore passes an invocation the user cannot perform directly. The RFC’s own validation notices that handlers can read `sessionId`, but does not test this allow-on-null counterexample.
   - **Resolution criterion:** Define a comparator that is demonstrably no more permissive than a reachable direct authority, or make functions whose authorization depends on `sessionId`, `provider`, or another non-stable direct-session dimension ineligible for delegated grants. Add an opaque-handler fixture proving that `sessionId === null`, provider branching, and equivalent negated predicates cannot make delegation more permissive than a real direct user invocation.

2. **MATERIAL — A stolen session can create durable delegated authority without step-up, and the compromise cascade cannot undo `authorityCreating` effects.**

   - **Evidence:** §Re-credentialing states the security property: “A stolen session must not be convertible into authority that outlives its revocation.” It exempts ordinary consent from step-up because consent “mints no secret.” But the consent flow permits this trace: use the stolen session to mint a pairing code; bind it using an attacker-controlled agent credential; approve the request using the stolen session; then poll for the scoped token. Ordinary session revocation leaves the resulting grant alive. Worse, an approved `authorityCreating` grant can seat the attacker’s agent into an LLP 0056 membership. §Ending authority explicitly says that membership persists after grant revocation, so even the “revoke all sessions” cascade cannot make the RFC’s claim that nothing the attacker minted remains authoritative true.
   - **Resolution criterion:** Require fresh operation-bound authentication at the actual consent boundary—at least for every `authorityCreating` grant, and for all delegated grants if the stated session-revocation property remains universal. Alternatively, bind grants to the issuing session and revoke them on that session’s loss, though that changes the durable-consent goal. Add the complete stolen-bearer → pairing → approval → self-seat → revoke-all trace to Validation Requirements.

3. **MATERIAL — Delegated actions have no safe or buildable dual-evaluation/effect-intersection design.**

   - **Evidence:** §Resolved authority says every delegated invocation is dual-evaluated and that an action’s egress is authorized under both projections. Yet actions perform irreversible effects rather than buffered row reads. The current runtime permits action-only outbound `fetch` and `ctx.runMutation` (`src/runtime.rs` and `packages/snapback-harness/ctx-bootstrap.js`); LLP 0009 also states that actions are not transactions and already-committed nested mutations stand. Running the action twice can duplicate network or mutation effects, while running it once cannot establish what the direct-projection execution would have done. §Protocol obligations deferred to implementation records mechanics only for delegated mutations, not actions.
   - **Resolution criterion:** Either exclude actions from v1 grant scopes, or pin a design in which every action effect is host-mediated and staged into a deterministic effect plan, both projections authorize the same plan without performing it, and effects execute exactly once afterward. The action path must then join the deferred-protocol and adversarial validation obligations.

4. **MATERIAL — Import, restore, and lost-rotation recovery have contradictory production semantics.**

   - **Evidence:** §Re-credentialing says imported agents are re-credentialable on `prod` when owned and dormant only when unowned. §Catalog and lifecycle instead says imported agents on `prod` cannot authenticate until a future recovery mechanism exists. Validation first says an owned imported agent and an owned restored agent are recoverable by the owner, then later says imported principals cannot authenticate on `prod` and a declared restore leaves “every agent dormant.” The lost-rotate-response row similarly prescribes re-registration on `prod`, omitting owner re-credentialing. Finally, the logical-export field list does not name `owner_user_id`, even though ownership is the fact that determines which branch applies.
   - **Resolution criterion:** Publish one lifecycle matrix for owned versus unowned agents across logical import, declared restore, and lost rotation; export/import `owner_user_id` with its integrity rules; and make every narrative and validation row agree. The apparent intended result is: owned agents are credentialless but owner-recoverable on every profile, while unowned agents are operator-recoverable only off `prod`.

5. **NON-BLOCKING — The RFC overstates the current existence of an `ImpersonationCapability` carrier.**

   - **Evidence:** §Summary says the operator plane “already has carriers” including `ImpersonationCapability`. LLP 0039 §Protocol obligations deferred to implementation item 7 still requires that carrier to be selected, and current `src/server.rs` rejects `EffectPolicy::ImpersonationCapability` with `SNAPBACK_AUTH_POLICY_UNAVAILABLE`. The policy slot exists; the carrier does not.
   - **Resolution criterion:** Change the current-state language to distinguish implemented admin/console/secret-read carriers from the pinned-but-unimplemented impersonation effect and make its implementation an explicit landing prerequisite.

## 4. Suggestions

- Introduce a manifest-level `delegationCompatible` profile analogous to LLP 0053’s protected-query profile. Functions depending only on stable user authority (`userId`, immutable `kind`, captured permission data) could qualify automatically; opaque or session/provider-dependent handlers would require a stronger mechanism or remain nongrantable.

- Treat consent as OAuth-style durable authorization rather than as “not minting a secret.” The consent UI and risk model should explicitly distinguish ordinary scoped access, external-effecting actions, and durable `authorityCreating` access.

- Display `owner_user_id` or an appropriate owner identity summary in consent and audit surfaces. Ownership implies the ability to replace the agent’s credential and assume its autonomous memberships, which is relevant trust information for third-party delegators.

- Correct the marker-lifecycle wording in §Grants: one passage says autonomous tier wildcards are evaluated live with no terminal exclusion, while another says gaining the marker terminally invalidates every tier scope. The intended distinction appears to be live exclusion for tier scopes and terminal invalidation only for explicit pre-marker scopes.

- Add the step-up challenge, binding, expiry, replay, and failure behavior to §Protocol obligations deferred to implementation. It is currently security-critical but absent from that inventory.

- Add an implementation-status banner like LLP 0024’s so readers can immediately distinguish shipped carriers and route-policy scaffolding from the unbuilt session and agent-auth catalog.

- Correct the stale Revised-header statement about browser-reachable destruction being weaker than `app.reset`; the operative body and `src/admin.rs` correctly recognize that `app.reset` is `NonProd`.

- Consider sender-bound agent credentials from the start of pairing—an agent public key or DPoP-style proof would make credential theft and out-of-band delivery less dependent on bearer secrecy without changing the grant model.

## 5. Open questions

- What durable authority should define “what the user could do directly” after the consenting session ends: only user-level facts, a consent-time assurance profile, or a session-bound authority that expires with that session?

- Is fresh authentication required for every delegated grant, only at pairing-code creation, at final approval, or only for `authorityCreating` scopes? Which placement actually blocks every stolen-session trace?

- Are delegated actions truly part of v1? If so, what mechanism stages network egress and nested mutations so dual evaluation performs external effects exactly once?

- Does ownership intentionally mean the owner may assume every autonomous membership the agent later acquires from third parties? If so, how is that disclosed to those third parties?

- Should `open` registration and unowned-agent import be allowed on `prod` before agent-held recovery keys exist, given that credential loss otherwise permanently orphans the principal?

- Which runtime capability, rather than `ServerProfile`, establishes “trusted-local,” and what exact deployment transition unblocks hosted query and mutation authority?

- Should recovery notify every former delegator and expose a machine-readable re-consent reason, especially after owner re-credentialing revokes all third-party grants?

## 6. Readiness verdict

The core direction is good, and the RFC is impressively thorough at the intended altitude. The unresolved issues are nevertheless central security and feasibility defects, not deferred protocol polish: the non-widening proof has a concrete counterexample, the stolen-session defense fails against its own durable-authority mechanism, actions lack a safe execution model, and production recovery semantics conflict.

VERDICT: NOT READY

### Orchestrator verification notes — round 10 (not part of the received review)

**Both families converged on the same two material findings.** (1) **Step-up authentication and the revoke-all-sessions cascade existed nowhere and were obligated nowhere** — LLP 0039 has neither, so the document's load-bearing security property rested on two surfaces it invented. Both are now owned as dated LLP 0039 amendments with routes. (2) **Owner deactivation was browser-reachable permanent destruction on `prod`** — the operator twin is `NonProd` precisely because it is irreversible, yet `DELETE /auth/agents/{id}` was reachable with a bare bearer. Step-up now gates it. The GPT family additionally showed that **"dual evaluation" was a misnomer and unbuildable for actions** (egress would fire twice): with the intersection at the data layer, the handler runs **once**. It also caught that the synthetic direct projection could **widen** (a rule keyed on `sessionId == null` would admit a delegated agent where the user's real session is denied) — fixed by excluding `sessionId`/`provider` from the authorization projection entirely.

## Round 12 — 2026-07-13 (RFC altitude, final)

**Provenance:** OpenAI Codex CLI v0.144.3, model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, fresh session; method cli-runner. Brief carried the author's ratified altitude ruling.
**Revision under review:** sha256 `c04a1e6b7a6778c26aab97ce17f8216e5257919818c754e8fba76d2ea89b4ce3`
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

This is a strong, security-conscious proposal addressing a real gap. Treating agents as first-class users preserves the existing `userId`-based data model, while the actor/effective-principal distinction provides attribution without forcing applications to build a parallel authorization system. The owner-mediated production lifecycle, explicit scope grants, effect-site `authorityCreating` gate, and refusal to smuggle operator authority through browser credentials are all good decisions.

At RFC altitude, most deferred work is appropriately deferred. Exact token serialization, transactional state machines, failure carriers, fence mechanics, and linearization details belong in implementing specifications. The document also accurately describes the current implementation as partial: `servicePrincipal` remains effectively reserved, `src/manifest.rs::AuthInput` still has the older single-auth shape, and the existing route/effect policies are scaffolding rather than an implemented agent flow.

Two design-level issues remain. First, the central non-widening guarantee cannot be achieved under the simultaneously required single execution of an opaque, actor-aware handler. Second, permanent production deactivation composes unsafely with LLP 0056’s protected memberships and can irreversibly strand resources. These are policy and semantic problems, not missing protocol detail.

## 2. Strengths

- **The unified principal model is the right default.** §“Principal kinds” avoids a second identity universe and preserves joins, profiles, memberships, RLS variables, and attribution keyed by `userId`.

- **Production ownership is carefully separated from operator impersonation.** §“Principal kinds,” §“Re-credentialing,” and §“Routes and credential classes” provide a credible production lifecycle without letting an operator or browser console credential assume an agent.

- **The actor/effective/grant tuple is expressive and well aligned with LLP 0024.** §“Resolved authority: `servicePrincipal`” gives applications both compatibility with human-oriented rules and durable attribution for delegated calls.

- **Credential and grant hygiene is unusually thorough for an RFC.** §“Registration, recovery, and invitations,” §“Credentials and tokens,” and §“Ending authority” cover hashed secrets, distinct prefixes, generation-based rotation, one-live-credential behavior, typed refusal, revocation cascades, bounded tombstones, and timing-envelope concerns.

- **The scope model makes several sound one-way choices.** §“Grants” keeps actions explicit, makes scope records immutable, terminally invalidates reused function identities, distinguishes delegated snapshots from autonomous live tiers, and excludes `authorityCreating` functions from tier wildcards.

- **`authorityCreating` is correctly treated as an effect, not merely an entry-point label.** §“Grants” composes LLP 0053’s static and dynamic gates with LLP 0056’s `permissionBacking` declarations and full provenance. This closes wrapper and nested-call bypasses that an entry-only check would miss.

- **The LLP 0053 integration is disciplined.** §“Ending authority,” §“Live results,” and §“Companion obligations” distinguish authority transitions from authorization-version events instead of inventing new global events for every credential or grant mutation.

- **The hosted boundary is honest.** §“Summary,” §“Plane boundary,” and §“Routes and credential classes” do not quietly enable hosted invocation merely because the principal model exists.

- **The validation plan is broad and adversarial.** §“Validation Requirements” covers profile transitions, restore, invitation classes, stolen-session escalation, scope invalidation, dynamic writes, live settlement, transport matrices, and client fencing.

## 3. Concerns

1. **Severity: MATERIAL — The strong non-widening contract is incompatible with one execution of an opaque, actor-aware handler.**

   **Concrete evidence.** §“Resolved authority: `servicePrincipal`” promises that a delegated invocation is allowed only if “the same invocation” under the direct projection would be authorized. It includes `requireRole` and trusted denial in the authorization projection, while also requiring that the handler execute once under the delegated projection. A legal handler can therefore do this:

   ```ts
   if (!ctx.auth.actor) {
     ctx.permissions.deny("direct invocation refused");
   }
   return await ctx.db.query("publicData").collect();
   ```

   The delegated execution skips the denial. Every row read can pass under both projections because the table is public, so the proposed per-read intersection admits the result. But an actual direct invocation would take the other branch and deny. The same counterexample applies to a conditionally attempted action effect.

   This is not resolved by double-checking authorization at host operations: the host cannot evaluate an authorization operation that the delegated control flow never attempts. The current runtime makes the premise concrete: `packages/snapback-harness/ctx-bootstrap.js::snapbackInvoke` passes one parsed `ctx.auth` object to arbitrary JavaScript, and `src/runtime.rs::invocation_iife_source` invokes that opaque handler once.

   Protocol obligation 5 acknowledges divergent `requireRole` outcomes, but no implementing serialization or linearization rule can satisfy both semantic claims without an additional execution phase or a restriction on handler expressiveness.

   **Resolution criterion.** Choose and state a realizable semantic model. Viable options include:

   - Narrow the guarantee to intersection of host operations actually attempted during the delegated execution, and withdraw the stronger claim that the direct invocation itself would authorize.
   - Introduce a mandatory, side-effect-free authorization preflight evaluated under both projections before the handler runs once.
   - Constrain authorization-relevant actor branching to a closed declarative form the host can evaluate under both projections.

   Then add validation fixtures where the direct-only denial is on an untaken delegated branch, covering a query result, mutation or nested mutation, and action egress.

2. **Severity: MATERIAL — Permanent deactivation can irreversibly strand LLP 0056-protected resources.**

   **Concrete evidence.** §“Principal kinds” makes deactivation permanent, retains memberships, and describes LLP 0056’s roster-hygiene question as covering “display treatment.” The owner `DELETE /auth/agents/{id}` route is available on every profile, including `prod`.

   LLP 0056 states a stronger consequence: its `lastHolder` invariant only preserves a membership row, not a reachable holder. A deactivated sole holder leaves the resource with nobody able to act, and LLP 0056 explicitly assigns this gap to “principal-side roster hygiene.” Its transition invariant can then prevent removing or demoting that dead final row, while production deliberately has no agent reactivation or operator impersonation path. The target’s validation checks that deactivation closes authority, but not whether it irreversibly locks protected resources.

   **Resolution criterion.** Pin the principal-side policy before readiness. For declared LLP 0056 memberships, terminal deactivation should either:

   - refuse while the agent is the final reachable protected holder;
   - require or perform an atomic replacement/transfer; or
   - provide an explicitly authorized teardown or recovery operation that does not resurrect the agent’s authority.

   Add a validation case for a sole protected holder, including a concurrent replacement-versus-deactivation schedule. Custom undeclared authorization tables may remain an application responsibility, but that boundary should be explicit.

3. **Severity: NON-BLOCKING — The route matrix omits a required step-up credential.**

   **Concrete evidence.** §“Re-credentialing” says `POST /auth/agent-invitations` requires a fresh, operation-bound proof because it mints a durable secret. §“Validation Requirements” explicitly refuses a valid session bearer without step-up at that route. Yet §“Routes and credential classes” lists its credential as only “session bearer,” even though the table claims to define the full registry rows.

   **Resolution criterion.** Change the route row to “owner’s session bearer + step-up auth,” and ensure the LLP 0031 registry amendment and validation fixture carry the same requirement.

4. **Severity: NON-BLOCKING — The restore validation conflates immediate dormancy with recoverability.**

   **Concrete evidence.** §“Re-credentialing” and the export/import validation state that owners can reissue credentials on every profile, including `prod`. The later restore validation says a declared restore leaves “every agent dormant” on `prod` and reports `agentRecovery: "unavailable-on-prod"`. This is coherent only if “dormant” means immediately after restore and `agentRecovery` refers solely to operator recovery.

   **Resolution criterion.** State explicitly that all agents are initially dormant after restore, owned agents can subsequently recover through owner re-credentialing, and only unowned/operator recovery remains unavailable on `prod`. Name those capabilities separately in the capability report.

## 4. Suggestions

- Make `owner_user_id` explicitly immutable in v1, require it to identify the creating human principal, and state that ownership transfer is unsupported until separately designed.

- Make the claimed structural delegation depth enforceable: session mint and identity-linking paths should refuse `kind: "agent"`, with a validation case demonstrating that an agent can never acquire a session-bearing identity.

- Consider versioned capability contracts or consent-time change warnings for high-risk explicit action scopes. A stable function ID currently authorizes future implementations of the same endpoint name, which places substantial trust in later code changes.

- Extend the eventual non-widening protocol obligation to every function kind. Its current wording names delegated mutations even though the RFC claims the property for queries, live queries, mutations, nested calls, and actions.

- Correct §“Catalog records and indexes,” where “All five sweep” appears inconsistent with the six new catalog tables used elsewhere.

- Add a validation fixture proving that an autonomous agent’s own memberships remain effective while a delegated invocation consults only the effective user’s memberships, including a denial explanation that identifies both failed axes.

## 5. Open questions

- Which realizable non-widening model is intended: observed-host-operation intersection, a pure dual-projection preflight, or a restricted declarative authorization language?

- May handler code use `ctx.auth.actor` to choose behavior, or is actor information intended only for narrowing rules, attribution, diagnostics, and provenance?

- What exact lifecycle policy prevents terminal agent deactivation from stranding resources whose only protected holder is that agent?

- Should explicit grant scopes bind only a stable function identity, or also a capability/version digest when the function’s externally meaningful effects change?

- Is owner transfer deliberately out of v1, and what happens when the owning human account is later deleted, disabled, or transferred between organizations?

- Should an agent-held recovery key be added later for unowned production agents, or is permanent dormancy after credential loss an intentional invariant?

## 6. Readiness verdict

The proposal is directionally excellent and most of its deferred protocol work is properly deferred. It is not ready while its central non-widening promise is semantically unrealizable as written and its permanent deactivation path has no policy for LLP 0056’s known unreachable-holder state.

VERDICT: NOT READY

### Orchestrator verification notes — round 12 (not part of the received review)

Two material findings, both real and both fixed. (1) **Permanent deactivation could irreversibly strand a resource** — a sharp cross-document interaction: an agent's memberships survive deactivation, and LLP 0056's `lastHolder` refuses removing the final holder of a protected role, so deactivating an agent that is the **sole host** of a resource would leave it held forever by a principal that can never act, with the protecting invariant itself forbidding the fix. Deactivation is now **refused, typed**, in exactly that case — the same fail-closed shape as 0056's refusal to delete a resource while memberships remain: the system declines to enter a state it has no exit from. (2) The non-widening rule's prose implied *re-running* the invocation under the direct projection, which is not what happens. Restated precisely: the handler executes **once**, and it is each **host-mediated authorization decision** (row admission, write admission, the trusted checks) that is evaluated under both projections. Handler-internal branching on `actor` is not an authorization decision and is not trusted to be one — consistent with LLP 0053, where only the host's terminal operation is proof.

---

## Note on the loop's shape

The `/llp-super-refine` loop ran **twelve** dual-family rounds (fresh Claude
Fable 5 Max and GPT gpt-5.6-sol ultra reviewers each round, none with memory of
prior rounds). It paused after round 8 short of convergence, because the two
families had reached a disagreement about **altitude** rather than correctness —
one holding the document to executable-protocol standards, the other to
RFC-altitude design pins — and because the production-agent question was a
product decision no reviewer could make.

The author (Charlie) settled both on 2026-07-13:

1. **Altitude ratified** — RFC, not protocol spec; protocol rigor is deferred to
   implementation time, per the same call already ratified for the parent
   umbrella (LLP 0039 §Protocol obligations, 2026-07-12).
2. **Agents on `prod` — yes.** The orchestrating session's framing of the question
   was wrong: it had assumed the *operator* was the only party who could ever
   re-credential an agent, when in fact **agents have owners**, and an owner
   re-issuing their own agent's credential is app policy — no more privileged than
   rotating an API key they already hold.

The loop then resumed with the ratified standard in the reviewers' briefs, and
findings dropped sharply and became precise. `/llp-super-refine` authorizes only
the Draft→Review transition, and only on convergence; no reviewer accepts on the
author's behalf.
