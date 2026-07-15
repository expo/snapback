**Reviewer family:** GPT (OpenAI Codex)
**Provider / runtime:** OpenAI Codex CLI v0.144.4 (`codex exec`, non-interactive), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, workdir = repo root, session id 019f62c8-f72e-7fe0-8699-9b3f8151c69e; 501,381 tokens used. Orchestrated by the ENG-24996 cross-family review gate (LLP 0005 review loop via /llp-review).
**Date:** 2026-07-14
**Redacted:** no redaction applied — no secrets in the reviewed material; reviewer instructed not to read `.agent-local-secrets.md`, credential files, or `llp/reviews/`, and not to quote secret material. Sending repository content to OpenAI was authorized by the human-directed ENG-24996 review-gate assignment.
**Method:** cli-runner — fresh session, blind to all archived reviews. The brief identified the document as an implementation-derived Spec for landed code (LLP 0039 item 4 / ENG-24597) and directed the reviewer at spec-vs-code fidelity, internal consistency, cross-LLP consistency, security soundness, and reimplementability, with MATERIAL/MINOR/EDITORIAL severities.

# LLP 0058 reviews — GPT family

## Round 1 — 2026-07-14

**Reviewed:** `llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md`, sha256 `9cb837fff1c0a9fc37b71711560ba69587067e39227fc1a6e384ac76ef2ae46c` (committed at repo HEAD `fdfdd94`).
**Verdict:** NOT READY

### Review body (verbatim)

## Overall assessment

The design direction is sound: paired artifacts, restart-gated mode transitions, permanent legacy poison, and server-derived invocation authority are appropriate defenses for this boundary. The durable state implementation is particularly strong.

The document is not yet a faithful implementation-derived Spec, however. Several of its load-bearing claims are false in shipped code, including the live-owner grant predicate, pre-commit handler compilation, universal shared-gate coverage, session acknowledgement DTO, and frozen host-operation impersonation behavior. The “exact” handshake also cannot independently interoperate with the current server and kit.

## Strengths

- The closed durable records enforce mode, generation, deployment, quarantine, and monotonic activation invariants coherently (`src/auth/mode.rs:140-287`).

- Four-key and poison consistency are checked before WAL configuration or additive infrastructure writes (`src/storage/auth_mode.rs:1142-1237`; `src/storage.rs:679-704`).

- Staging correctly keeps DDL, optional seed, staged deployment, and pending mode state in one transaction (`src/storage/auth_mode.rs:463-574`). Sessions consume atomically activates the catalog, relocates the manifest, writes poison, removes staging, advances authorization, and settles the state (`src/storage/auth_mode.rs:650-722`).

- Handler projection hardening is substantive: Rust constructs a closed server-side projection (`src/auth/invocation.rs:405-452`), and the JS runtime copies only known own properties onto a null-prototype object and freezes it and its roles array (`packages/snapback-harness/ctx-bootstrap.js:479-502`).

- Same-mode sessions provisioning correctly treats deployment replacement as an authorization activation, carrying the exact witness and refreshing or invalidating retained work before reopening (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:695-742`; `src/local.rs:2941-2999`). That aligns with LLP 0053’s activation-event model (`llp/0053-authorization-invalidation.rfc.md:359-370`).

## Concerns

1. **MATERIAL — Live ownership omits the required connection-grant identity.**

   The Spec requires ownership to be the conjunction of `resolvedAuthorityKey` and `connectionGrantId`, explicitly rejecting the same authority under a different grant (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1005-1033`, `:1462-1468`).

   Shipped `RetainedLiveAuthority` stores only mode, profile, and resolved authority; its comparison tests only those fields (`src/auth/invocation.rs:617-625`, `:751-756`). `LiveSubscription` has a connection ID and optional effect fence but no retained grant ID (`src/local.rs:2130-2140`). Resume therefore accepts matching authority and replaces the connection/fence (`src/local.rs:5072-5090`), while unsubscribe checks matching authority but not the retained connection or grant (`src/local.rs:4734-4769`). The server possesses the current `grant_id` (`src/server.rs:1222-1247`) but does not pass it into unsubscribe ownership (`src/server.rs:10026-10040`). Existing tests even permit the same user to resume onto a different connection (`tests/local_v0.rs:3136-3147`).

   Consequently, a same-session different grant—or any second anonymous grant—can resume or unsubscribe another grant’s subscription if it learns the subscription ID.

   *Resolves with:* Retain the exact grant ID in `LiveOwnerV1`, pass the caller grant through every act, and atomically compare grant plus resolved authority before resume, unsubscribe, and supersession. Add authenticated-same-authority/different-grant and anonymous-different-grant negatives on both transports.

2. **MATERIAL — Handler generations are not compiled before the durable activation cut.**

   Consume ordering requires the complete function generation to be prepared or compiled before commit, followed only by an infallible pointer swap (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:617-635`).

   Actual preflight validates manifests, references, capabilities, and cron declarations, then caches raw manifests (`src/local.rs:2294-2356`). `FunctionManifest` accepts every `IbexModule` without parsing or compiling its source (`src/manifest.rs:562-575`). “Publication” performs debug assertions and assigns the manifest directly (`src/local.rs:2527-2581`). Ibex evaluation first occurs during an application invocation (`src/runtime.rs:1366-1400`, `:1419-1454`), after the CLI has durably consumed sessions and written poison (`src/cli.rs:248-270`).

   A syntactically invalid module can therefore become the settled, poisoned deployment and fail only on its first request. This contradicts the central crash-safety claim that every fallible executable-artifact operation precedes the durable cut.

   *Resolves with:* Compile every executable module into a typed prepared generation before staging consume or same-mode commit, with the post-commit operation reduced to an infallible generation swap. Add malformed-module and setup-evaluation negatives proving no durable state change.

3. **MATERIAL — The promised single production gate and decision type do not exist as specified.**

   The Spec says `PreparedAuthority` contains the registered route/operation identity, effective policy, and operation-level decision, and that `InvocationGate::prepare_authority` resolves policy, credentials, protocol fences, and projection (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:866-927`).

   The actual type contains none of the route or effective-policy facts (`src/auth/invocation.rs:600-615`). The production entry point accepts an already-resolved `ResolvedAppAuthority` and performs only admission/mode validation, known wire-field rejection, source-class validation, audit selection, and projection (`src/auth/invocation.rs:866-952`). Route policy, protocol checks, and credential resolution occur in separate server middleware before that call (`src/server.rs:4668-4807`).

   There are also concrete exceptions to “every entry path”: a closed-admission handshake receives no `PreparedAuthority` and resolves credentials and projection directly (`src/server.rs:4902-4908`, `:5951-6000`), while WebSocket frames retain only connection authority and fresh admission leases before calling the ephemeral backend directly (`src/server.rs:10047-10085`, `:10510-10585`).

   *Resolves with:* Either implement one production gate returning the complete normative decision bundle, or precisely specify the composed middleware architecture and formal diagnostic/socket exceptions, with equivalence tests. Because frozen LLP 0039 requires a shared authority boundary, any relaxation must first be checked against its pinned outcome.

4. **MATERIAL — Standalone mutation acknowledgement has no valid sessions-mode request shape.**

   The Spec includes standalone acknowledgement in complete gate coverage while requiring sessions acknowledgements to reject any `auth` field (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:945-956`, `:984-990`).

   The only request DTO makes `auth` mandatory and rejects unknown fields (`src/manifest.rs:2041-2055`); its generated schema likewise requires `auth` (`schemas/client-mutation.ack.input.schema.json:31-51`). Sessions middleware rejects a present `auth` before handler decoding (`src/server.rs:5488-5497`), while omitting it causes the handler’s serde extraction to fail (`src/server.rs:9654-9665`). The kit sends legacy `auth` and then strips it from all sessions bodies (`demos/_kit/client.mjs:334-352`, `:1764-1768`).

   Thus one branch is rejected by policy and the other by DTO shape; sessions cannot reclaim final durable replay results through this route.

   *Resolves with:* Introduce a closed sessions acknowledgement DTO containing only `clientMutationIds`, or a mode-discriminated wire enum, while retaining the dev compatibility shape. Exercise successful session acknowledgement end to end, not merely forbidden-field precedence.

5. **MATERIAL — Frozen session-mode host-operation impersonation is not implemented.**

   LLP 0058 specifies host-op `function.run --as-user/--as-role` as `DevImpersonation` after `AdminWrite` plus `ImpersonationCapability` (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:820-827`, `:952-960`). Frozen LLP 0039 explicitly requires this path under sessions (`llp/0039-auth-vertical-slice.rfc.md:448-464`).

   Shipped CLI and DTO support only a user, not roles (`src/cli.rs:456-466`; `src/host_ops.rs:266-289`), and the host projection always supplies empty roles (`src/host_ops.rs:463-473`). More importantly, sessions middleware clears `request.user_id` before execution (`src/server.rs:9122-9165`), while sessions authority preparation maps host-operation runs to `AdminBypass`, not `DevImpersonation` (`src/server.rs:4734-4751`). The capability can therefore be charged while the requested impersonation is discarded.

   *Resolves with:* Implement the frozen user and role impersonation outcome through one capability-gated resolved-authority path, including exact CLI/DTO spellings and audit facts, or track the missing implementation explicitly and remove the completion claim until it lands.

6. **MATERIAL — Legacy `/app/ensure` bypasses complete candidate-pair preflight.**

   Both LLP 0058 and frozen LLP 0039 require every provisioning ingress to construct and validate a complete coherent pair before hashes or effects (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:321-368`; `llp/0039-auth-vertical-slice.rfc.md:162-176`).

   The legacy route instead calls `ensure_app` directly (`src/server.rs:9820-9837`). That path validates only whichever individual artifacts were posted (`src/local.rs:1067-1075`), then independently applies the schema and function halves (`src/local.rs:3046-3111`). It neither requires a sibling nor verifies pair-wide `appId` and `inputsHash`. The route is limited to settled dev (`src/server.rs:4245-4269`), which narrows exposure but does not satisfy the claimed v0-dev pair invariant.

   *Resolves with:* Route legacy ensure through the same complete-pair resolver using a same-boot attested sibling, or remove its provisioning capability. An exception in LLP 0058 alone is insufficient where frozen LLP 0039 already pins the universal ingress rule.

7. **MATERIAL — Session-mode DTO and ephemeral closure are not implemented at the documented boundary.**

   The Spec says closed DTOs reject unknown fields, HTTP and WebSocket twins share one operation-owned schema, and `KeyMode::Custom` is rejected during sessions manifest load (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:88-92`, `:984-1003`).

   `HandlerInput`, `LiveResumeInput`, and `LiveUnsubscribeInput` lack `deny_unknown_fields` (`src/manifest.rs:1939-1968`; `src/local.rs:627-677`). HTTP ephemeral wire structs also accept unknown fields (`src/server.rs:11966-12000`), whereas WebSocket uses separate, genuinely closed session structs and converts them to legacy requests (`src/server.rs:11024-11080`, `:11273-11334`). The known identity-name scanner is useful and fail-closed for the names it recognizes (`src/server.rs:4149-4183`), but it is not the promised closed-schema contract.

   Sessions artifact preflight calls validators that never reject `KeyMode::Custom` (`src/local.rs:2294-2313`; `src/ephemeral.rs:6840-7054`), and the runtime still implements that mode (`src/ephemeral.rs:7227-7297`). The result is an accepted deployment whose session transport later discards the required custom key.

   *Resolves with:* Generate mode-specific HTTP and WebSocket DTOs from one schema authority, reject unknown and duplicate fields consistently, and reject `KeyMode::Custom` during sessions pair preflight with a stable diagnostic and no-effects test.

8. **MATERIAL — The bootstrap wire protocol is neither current nor complete.**

   The “Exact response DTO” omits `authorizationStreamIncarnation`, `authorityDescriptor`, and `authorizedLease` while calling the response closed (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1082-1139`). Current Rust requires those fields under protocol version 1 (`src/auth/handshake.rs:194-217`), LLP 0059 explicitly requires the incarnation (`llp/0059-session-projection-and-client-barrier.spec.md:1583-1599`), and the kit rejects any response outside the current exact key set (`demos/_kit/client.mjs:534-605`). An implementation built from LLP 0058 alone therefore cannot interoperate with either side.

   The request-carrier rule is also false: offers are not carried “only” in four custom headers (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1060-1073`). Browser WebSockets use four `Sec-WebSocket-Protocol` token namespaces with explicit header precedence and duplicate handling (`src/auth/handshake.rs:21-29`, `:81-116`; `demos/_kit/client.mjs:4385-4407`).

   *Resolves with:* Publish one composed current-v1 request/response contract, including all required and nullable fields, both carrier grammars, precedence, duplicate handling, and golden compatibility vectors—or increment the protocol version. Clearly distinguish a historical item-4 base shape from the current composed shape.

9. **MATERIAL — Post-commit containment can be misreported as available by the handshake.**

   LLP 0058 requires any post-commit function/publication/projection failure to leave admission closed with `SNAPBACK_AUTH_MODE_PENDING` (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:730-742`). The code correctly demonstrates a durable successor coexisting with a stale predecessor runtime snapshot and a nonaccepting controller (`src/server.rs:14869-14925`).

   In that posture, however, `/auth/session` deliberately obtains no admission (`src/server.rs:4902-4908`), reads only the runtime mode/readiness state (`src/server.rs:5951-6039`), and computes availability from settled mode plus readiness and offers (`src/auth/handshake.rs:273-357`). It can consequently advertise online work and provider availability while every ordinary request is rejected by the closed controller.

   *Resolves with:* Add a process-local containment/admission fact to handshake computation, forcing all app-data axes and provider availability false—or return a typed handshake failure—whenever the controller is closed after a cut. Add the post-commit-failure handshake case to acceptance.

10. **MATERIAL — “Fresh-only” seed permits an existing empty legacy application.**

   The carrier contract permits non-null seed only for a truly empty database and rejects it for a transition over an existing app (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:592-595`).

   Legacy adoption retains the existing manifest but initializes mode state with `activeDeployment: null` (`src/storage/auth_mode.rs:1240-1282`). Seed eligibility then checks only that deployment is null and that existing user tables contain zero rows (`src/storage/auth_mode.rs:1350-1366`). An already-provisioned legacy app with empty tables therefore qualifies as “fresh.”

   *Resolves with:* Persist or derive explicit fresh-versus-adopted provenance, or require absence of any adopted active manifest/user schema before transition seeding. Add an empty-but-existing legacy application negative.

11. **MATERIAL — V1 identity hashing is underspecified for an independent producer.**

   The Spec provides domains and four leading items, but leaves the remainder as unspecified “canonical” item sequences (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:282-310`). LLP 0012 repeats that abstraction rather than enumerating it (`llp/0012-headless-integration-contract.spec.md:157-173`).

   Shipped code binds substantially more detail: sorted graph path/byte pairs, isolated canonical evaluations, optional seed/demo sources, capability sources, and handler paths and bytes (`packages/snapback-codegen/index.mjs:1000-1048`). The framing also includes a framing-version item, domain, and item count before content (`packages/snapback-codegen/index.mjs:2955-2966`). Independent implementations can follow the prose and compute different hashes.

   *Resolves with:* Enumerate every item, ordering rule, path normalization, optional-item rule, JSON canonicalization rule, framing prefix, count encoding, and UTF-8 length definition. Include at least one complete source-to-three-hashes vector.

12. **MATERIAL — The claimed executable evidence is not present at the documented breadth.**

   Acceptance and status assert actual unmodified predecessor runs, byte-for-byte database/WAL invariance, every crash boundary, every four-key corruption class, and executable matrices already landed (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1324-1355`, `:1388-1420`, `:1553-1559`). Frozen LLP 0039 specifically requires the actual-predecessor proof (`llp/0039-auth-vertical-slice.rfc.md:1583-1606`).

   I could not locate a pinned predecessor binary or harness in the repository. The closest artifact-version test uses the current in-process `LocalSnapback` and a synthetic `snapback.v999` value (`tests/ensure_auth_v1.rs:496-553`). The located consume injection exercises one transaction step (`src/storage/auth_mode.rs:1907-1957`), and the located corruption test checks one malformed format and compares metadata values, not database/WAL bytes (`src/storage/auth_mode.rs:2022-2045`).

   *Resolves with:* Land or link immutable, reproducible evidence for the actual predecessor and the stated exhaustive matrices. Otherwise narrow the acceptance/status claims to evidence that exists and track the frozen-0039 proof as incomplete.

13. **MATERIAL — The hosted must-understand marker obligation has no actual owning Spec.**

   LLP 0058 assigns the hosted coordinator-to-handler marker and handler-first deployment interleavings to LLP 0060 (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:82-86`). Frozen LLP 0039 requires a hosted protocol Spec to define exactly those mechanics (`llp/0039-auth-vertical-slice.rfc.md:1626-1639`).

   LLP 0060’s ownership is instead edge facts, proxy source, throttling, invalidation, browser custody, and capability honesty; it does not define that marker or deployment protocol (`llp/0060-hosted-auth-security.rfc.md:59-82`). Current local hosted refusal prevents an immediate exploit, but the frozen obligation is unassigned.

   *Resolves with:* Extend LLP 0060 with the marker and deployment-interleaving protocol, or name a separate implementing Spec and tracked delivery issue.

14. **MINOR — The cold-carrier contract omits hard-link refusal.**

   LLP 0058 lists ownership, permission, ACL, size, and inode requirements but not link count (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:598-605`). Code requires exactly one hard link (`src/secure_file.rs:362-395`).

   *Resolves with:* Add the single-link requirement and the non-Unix unsupported behavior to the normative carrier contract.

15. **MINOR — The “only schema and function artifacts move to v1” statement is false.**

   The Spec says every other non-schema/function artifact retains its prior version (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:275-280`). Codegen deliberately emits the contract-data manifest as `snapback.v1` alongside the pair (`packages/snapback-codegen/auth-artifacts.test.mjs:104-144`).

   *Resolves with:* Name contract-data as an explicit identity-bound exception, or restore its prior version if that was unintended.

16. **EDITORIAL — Related metadata omits LLP 0059.**

   The metadata omits LLP 0059 (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:9`) even though the ownership and status sections explicitly consume it (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:79-80`, `:1555-1559`).

   *Resolves with:* Add LLP 0059 to `Related`.

## Suggestions

- Split historical item-4 facts from the current composed protocol. A small normative extension table keyed by owning LLP would prevent “exact v1” shapes from silently becoming historical examples.

- Generate the wire DTO, protocol-carrier grammar, and conformance vectors from one machine-readable protocol description. The current Rust, schemas, kit validator, and prose are already demonstrating four-way drift.

- Add a claim-to-evidence ledger: each normative acceptance sentence should identify the exact test or external immutable artifact that proves it. This would make ratification review substantially more reliable.

- Model the durable mode protocol and process-local admission controller as one small state machine, including ambiguous commits and containment. Property tests could then assert that every observable handshake and request decision agrees with the combined state.

- Treat grant identity as a capability throughout retained live state rather than reconstructing ownership from user/session equality. This is simpler and safer for anonymous and reconnect cases.

## Open questions

- Should pending/containment handshake authority be a formal non-effect-capable variant of the shared gate, or an explicitly specified exception?

- Is session-mode host-operation impersonation intended to ship exactly as frozen LLP 0039 requires, including role impersonation?

- Is bootstrap protocol 1 a historical item-4 shape or the current composed shape? If historical, what versioning rule permits closed same-version DTO additions?

- What exact event makes a database “fresh” for seed purposes: no app manifest, no user tables, no rows, or an explicit provenance bit?

- Is receiver-side compilation of Ibex modules required before the durable cut, and what executable setup behavior may safely be deferred until invocation?

- Where will the hosted coordinator-to-handler must-understand marker and handler-first deployment protocol be specified and tested?

## Readiness verdict

**NOT READY.** The durable state machine is promising, but material defects undermine the document’s core claims: live grant ownership is insecure, compilation occurs after activation, the single-gate theorem is not implemented, and several closed wire/provisioning protocols disagree with shipped code. These require implementation or author-level design decisions before ratification.
## Round 2 — 2026-07-14

**Revision under review:** `llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md`, sha256 `250005ca03eedf10d343035745023d3ba6bbbc017653099db91cb2fc7bd05dfa` (committed at repo HEAD `b11a6fa`)
**Runtime detail:** OpenAI Codex CLI v0.144.4 (`codex exec`, non-interactive), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, session id 019f637b-f680-7c03-bc00-bdff0d3b6757; 470,818 tokens used; fresh session, blind to all archived reviews and to the concurrent Fable-family round; orchestrated by /llp-super-refine
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

The proposal’s core architecture is a good idea: closed artifact/auth tuples, durable staged transitions, permanent rollback poison, generation-fenced invocation authority, and independently negotiated client capabilities form a strong security model.

The plan is not ready for acceptance, however. Several load-bearing guarantees are either contradicted by production code or supported only by narrower tests than the document claims. Most seriously, live subscriptions are not bound to their exact connection grant, raw loaders bypass the closed artifact tuple, function generations are not prepared before durable activation, readiness is asserted before its implementations exist, and the “single shared gate” is not the authority boundary described by the Spec.

The document should remain Draft until the normative design and actual implementation agree.

## 2. Strengths — with section citations

- LLP 0058 §The two admissible tuples, §Disjoint v1 identity strings, and §Complete candidate-pair preflight establish an admirably closed compatibility model. Codegen and the capability manifest implement the two intended pairs and the closed capability registry (`packages/snapback-codegen/index.mjs:301`, `src/manifest.rs:2614-2664`, `src/manifest.rs:2944-2960`).

- §The four keys, §Corrupt-state boundary, and §Crash and publication traces are unusually precise. The four keys and poison bytes are explicit, open-time inspection precedes WAL or infrastructure writes, and consume is one atomic catalog/mode/poison transaction (`src/storage/auth_mode.rs:25-28`, `src/auth/mode.rs:18-23`, `src/storage.rs:679-704`, `src/storage/auth_mode.rs:657-726`).

- §Admitted body ingestion and the mode-transition fencing model are well designed. The implementation enforces the 20-second body deadline below the 30-second quiescence deadline, watches epoch closure, and releases admission roots deterministically (`src/server.rs:4239-4249`, `src/server.rs:4311-4376`, `src/auth/admission.rs:511-702`).

- §Five distinct internal types makes the right conceptual distinction between wire data, resolved authority, handler projection, and prepared invocation. The actual handler projection is also strong: Rust emits the closed fields, while the harness constructs null-prototype, data-only, frozen objects with separately frozen roles (`src/auth/invocation.rs:405-451`, `packages/snapback-harness/ctx-bootstrap.js:479-502`).

- §Exact response DTO correctly treats the four client capabilities as independent axes. Offer/echo closure and availability derivation are substantially implemented (`src/auth/handshake.rs:67-73`, `src/auth/handshake.rs:344-459`).

- §Acceptance is commendably adversarial. It names crash cuts, transport parity, explicit-null cases, predecessor work, carrier substitution, and negative authority cases rather than relying on broad “works end to end” assertions.

## 3. Concerns

### 1. MATERIAL — Live ownership does not include the exact connection grant

LLP 0058 §Live owner and replacement predicate requires equality over both `resolvedAuthorityKey` and `connectionGrantId`; §Live owner negatives specifically requires anonymous and same-authority/different-grant callers to fail.

The implementation stores an optional connection effect fence on each subscription (`src/local.rs:2130-2140`, `src/local.rs:4645-4656`), but `RetainedLiveAuthority::matches` compares only mode, profile, and resolved authority (`src/auth/invocation.rs:751-756`). Unsubscribe performs that authority-only comparison and removes the subscription without comparing the stored connection or fence (`src/local.rs:4753-4788`). Resume likewise checks only authority, then replaces the stored connection id and effect fence with the caller’s (`src/local.rs:5064-5108`). The existing test explicitly allows the same principal on a different connection to resume (`tests/local_v0.rs:3138-3149`).

Although `PreparedConnectionAct` proves that the caller owns some current grant, the destructive local operation never compares that grant with the subscription’s stored grant. Consequently, another anonymous grant or same-session grant that learns the subscription id can resume or unsubscribe it.

**Resolution criterion:** Persist an exact owner key containing resolved authority and grant id/effect fence, and compare both atomically with the destructive resume, unsubscribe, or supersede operation. Add production-path negatives for anonymous B, authenticated B, and same-authority/different-grant B, plus exact-grant positives. If reconnect is intended to transfer ownership, specify a separate authenticated handoff protocol.

### 2. MATERIAL — Settled-dev raw loaders bypass the closed tuple

LLP 0058 §The two admissible tuples explicitly rejects v1-dev and mixed deployments. §Complete candidate-pair preflight requires every provisioning ingress to enforce the pair before effects.

`load_functions_in_settled_dev` checks only that durable mode is settled dev and then calls the generic loader (`src/local.rs:2500-2524`). `FunctionManifest::validate_artifact` accepts either v0 or v1 (`src/manifest.rs:764-774`, `src/manifest.rs:3278-3299`). Both direct and host-op loaders reach this path (`src/server.rs:8732-8755`, `src/server.rs:9172-9235`).

The schema path has the same gap. `apply_schema_mode_aware` requires active durable mode to be dev, but checks the candidate against `activeDeployment` only when that identity is non-null (`src/storage/auth_mode.rs:1086-1120`). A fresh or adopted database has a null deployment, so it can accept a valid v1-sessions schema while durable mode remains dev.

**Resolution criterion:** Every raw dev ingress must require a v0-dev candidate before DDL or function replacement. Add fresh, adopted, and established-database tests proving v1 schemas, v1 functions, and mixed halves leave schema, functions, WAL/database bytes, and mode keys unchanged.

### 3. MATERIAL — “Prepared” function generations are not compiled before activation

LLP 0058 §Cold startup artifact carrier and §Consume ordering: dev to sessions require all handler preparation and compilation before the durable commit. §Same-mode provisioning makes the same guarantee and describes publication as an infallible swap.

`preflight_auth_artifacts` validates manifests, references, capabilities, cron, and catalog shape but does not compile Ibex modules (`src/local.rs:2294-2356`). Manifest validation explicitly accepts every `IbexModule` without checking source or export existence (`src/manifest.rs:818-844`). Source evaluation and export resolution happen lazily on first invocation (`src/runtime.rs:1316-1400`). `publish_preflighted_functions` assigns the manifest but still performs no compilation (`src/local.rs:2527-2581`).

A syntax error or missing export can therefore survive durable sessions consume, permanent poison installation, and listener bind, only to fail on first invocation.

**Resolution criterion:** Introduce a non-callable prepared-generation object that compiles every module and validates required exports before consume or same-mode commit. Publication must consume that object without additional artifact failure. Test malformed source and missing exports at both activation paths.

### 4. MATERIAL — Readiness is asserted before the named implementations and probes exist

LLP 0058 §Activation-readiness and later-item fences says every readiness fact is positive server-owned evidence. LLP 0059 §Readiness facts further requires completed projection rebuild and a running terminal worker.

`AuthProgramReadiness::new` hardcodes the first seven facts true (`src/auth/mode.rs:381-395`). Production additionally hardcodes connection binding, two-phase revocation, coordinator, and authority descriptor readiness (`src/cli.rs:322-340`). Startup consumes the durable transition with those assertions (`src/cli.rs:1565-1580`) before the fallible coordinator rebuild (`src/cli.rs:1598-1602`), invalidation installation (`src/cli.rs:1603-1624`), and expiry-worker startup (`src/cli.rs:1669-1680`).

Thus a fallible prerequisite can fail after the database has already settled into sessions, contrary to the specified consume-time proof.

**Resolution criterion:** Probe or construct every mandatory prerequisite before durable consume, or explicitly design a safe durable intermediate state that cannot claim settled sessions. Failure injection must independently negate coordinator rebuild, invalidation installation, connection binding, and worker startup and prove that sessions never settles prematurely.

### 5. MATERIAL — The normative shared gate is not the implemented authority boundary

LLP 0058 §Gate algorithm assigns route-policy resolution, credential resolution, protocol fences, and function-specific availability to `InvocationGate`; §Complete gate coverage says every authority-bearing entry uses it.

In production, `prepare_admitted_authority` receives an already-selected mode, profile, admission lease, and already-resolved authority (`src/auth/invocation.rs:869-951`). Route policy, queued-replay negotiation, body-authority selection, and bearer resolution happen in server middleware before that call (`src/server.rs:4836-4975`). `PreparedInvocation` has no availability decision, and `prepare_function` checks only source kind and `AuthRequirement` (`src/auth/invocation.rs:779-787`, `src/auth/invocation.rs:987-1023`). `authorityIndependent` and live protocol decisions remain separate (`src/server.rs:4663-4720`).

WebSocket frames bypass `PreparedAuthority` entirely: the loop combines `AdmissionLease` with `PreparedConnectionAct`, then passes raw `ResolvedAppAuthority` into the frame handler (`src/server.rs:10695-10776`, `src/server.rs:11624-11739`). Several registry labels, including `ConnectionClose`, `EphemeralUnsubscribe`, and `LiveSupersede`, have no production call sites. The purported drift test merely iterates enum values and calls `target()` (`src/auth/invocation.rs:1314-1319`); it cannot detect an unregistered ingress.

**Resolution criterion:** Either implement one production gate that owns the documented decisions and is consumed by every HTTP, WebSocket, local, nested, and system entry, or revise the Spec to normatively describe the composed middleware/connection-act architecture. In either case, generate an exhaustive operation-to-gate registry test that fails when an ingress or frame variant lacks a real classification.

### 6. MATERIAL — HTTP session-mode ephemeral DTOs are open and differ from WebSocket DTOs

LLP 0058 §Session mode body closure requires closed session variants and states that HTTP and WebSocket twins use the same operation-owned schema.

WebSocket uses dedicated `deny_unknown_fields` session DTOs (`src/server.rs:11219-11275`). HTTP instead deserializes legacy `WirePublishRequest`, `WireDeleteRequest`, and `WireSubscribeRequest` without `deny_unknown_fields` (`src/server.rs:12161-12195`). `EnsureEphemeralCollectionsInput` is open as well (`src/server.rs:12139-12149`). The outer scanner catches current known identity fields, but arbitrary siblings and future aliases are silently ignored.

**Resolution criterion:** Define shared closed session DTOs for both transports, retaining a separate explicit legacy decoder for dev. Paired transport tests must inject arbitrary unknown siblings, every registered alias, and explicit null at every nesting position and require identical rejection.

### 7. MATERIAL — A cached handshake can cross to a replacement server process

LLP 0058 §Kit ordering permits caching only for one startup nonce, transition generation, and connection attempt and forbids reusing a handshake after reconnecting to another process. §Handshake and later-item fences requires a two-process sentinel.

The kit returns its cached handshake indefinitely unless `force` is requested (`demos/_kit/client.mjs:886-915`). Only a short allowlist of paths forces freshness (`demos/_kit/client.mjs:321-334`, `demos/_kit/client.mjs:1357-1365`), so an ordinary query or mutation can be sent to a replacement process using the predecessor handshake. Transport-unavailable handling deliberately preserves that cache (`demos/_kit/client.mjs:336-345`, `demos/_kit/client.mjs:933-940`).

**Resolution criterion:** Define an observable connection-attempt boundary and invalidate/freshen the handshake after transport failure or retry, or perform a fresh handshake before every top-level online operation. Add a same-URL, two-process test proving that no predecessor nonce or generation is reused.

### 8. MATERIAL — Handshake “exactness” has two known counterexamples

LLP 0058 §Exact response DTO says the schema and executable kit validator have identical verdicts, then immediately acknowledges that `AuthorityDescriptor` remains looser. The divergence is real: the kit requires `descriptorVersion === 1` and a canonical UUIDv7 (`demos/_kit/client.mjs:149-162`), while the schema accepts any unsigned version and only length-checks the id (`schemas/auth.session.output.schema.json:154-180`). The shared corpus omits both cases (`tests/conformance/auth-session-parity.corpus.json:171-176`).

Separately, LLP 0059 §Bootstrap response revision requires `authorizationStreamIncarnation` to be a canonical UUIDv7 and treats malformed values as handshake errors. Rust, the schema, and initial kit validation require only a nonempty string (`src/auth/handshake.rs:262-265`, `schemas/auth.session.output.schema.json:419-422`, `demos/_kit/client.mjs:594-599`). UUID validation occurs only later in `currentAuthorizationScope` (`demos/_kit/client.mjs:1058-1069`), after handshake projection.

**Resolution criterion:** Introduce handshake-specific exact descriptor and incarnation newtypes, validate canonical UUIDv7 and version 1 before custody changes, and add wrong-version, wrong-variant, uppercase, noncanonical, and malformed cases to the shared corpus.

### 9. MATERIAL — “Truly empty” seed eligibility misclassifies adopted applications

LLP 0058 §Cold startup artifact carrier and §Fresh sessions provisioning allow a non-null seed only for a truly empty database, never an existing application.

The implementation checks only that `activeDeployment` is null and physical user tables contain zero rows (`src/storage/auth_mode.rs:1362-1378`). Legacy adoption intentionally writes `activeDeployment: null` even when a legacy active manifest exists (`src/storage/auth_mode.rs:1252-1294`; confirmed by `src/storage/auth_mode.rs:1635-1665`). An adopted application with empty tables therefore passes the seed gate.

**Resolution criterion:** Define freshness to exclude any legacy or capability-aware active manifest/application identity and decide whether existing user-schema objects also disqualify it. Add a negative adopted-legacy/empty-table case and a positive truly fresh crash-retry case.

### 10. MATERIAL — Deployment identities are not verified against artifact content

LLP 0058 §Disjoint v1 identity strings defines each identity as SHA-256 over canonical content, and §Complete candidate-pair preflight treats those identities as the deployment pin.

The receiver instead copies declared hash fields into `DeploymentIdentity` (`src/auth/mode.rs:51-89`). Header validation checks kind/version but does not recompute canonical digests (`src/manifest.rs:3252-3299`), and carrier matching compares the same declarations (`src/auth/mode.rs:321-328`). Different function bytes can therefore retain a claimed `bundleHash` and pass identity matching.

**Resolution criterion:** Either state and justify a trusted/authenticated artifact-producer premise, or recompute all canonical content identities in the receiver. The safer design is a content-addressed carrier whose verified digest covers both manifests and seed. Add mutation-with-unchanged-header tests.

### 11. MATERIAL — Operator recovery and diagnostic obligations are incomplete

Three explicit contracts are missing:

- §Cold startup artifact carrier promises the exact expected deployment identity on missing, unreadable, or mismatched carriers. Current errors are generic (`src/cli.rs:30-50`, `src/cli.rs:138-159`, `src/cli.rs:206-233`, `src/auth/mode.rs:321-328`).

- §Sessions-to-dev downgrade and LLP 0039 require an audit fact before bind. Storage returns `sessions_revoked`, but startup discards it through `Ok(result) => result.state` (`src/storage/auth_mode.rs:729-803`, `src/cli.rs:272-297`).

- §Diagnostics and failure semantics says LLP 0012 must register every new code before shipment. `SNAPBACK_REQUEST_BODY_TIMEOUT` is emitted and mapped to 408 (`src/server.rs:4277-4285`, `src/server.rs:12588-12590`) but is absent from LLP 0012’s item-4 registry (`llp/0012-headless-integration-contract.spec.md:613-632`).

**Resolution criterion:** Emit safe expected/observed deployment details on every carrier failure; durably record or reconcile a redacted downgrade audit before bind; and register the body-timeout code/status in LLP 0012 and adapter schemas. Tests must prove ordering and absence of paths, bodies, seeds, credentials, and secrets.

### 12. MATERIAL — The claimed exhaustive acceptance evidence is not present

LLP 0058 §Stage, consume, poison, and downgrade requires every four-key corruption class with database and WAL bytes unchanged. The direct test exercises one malformed mode record and compares selected metadata rows, not full database/WAL bytes or the parse/version/enum/generation/presence/identity/poison matrix (`src/storage/auth_mode.rs:2043-2067`).

The same section requires the complete settled-sessions carrier matrix. Existing tests separately cover carrier shape (`src/cli.rs:3684-3722`), some secure-file properties (`src/secure_file.rs:728-780`), and selected fresh/pending cases (`src/cli.rs:3768-3918`), but not the stated correct/missing/swapped/mutable/oversized/mismatched settled-restart matrix.

**Resolution criterion:** Add a table-driven corruption corpus with database and WAL hashes before and after every refusal, plus the full settled-carrier process matrix. Every acceptance claim should map to a named executable test.

### 13. MINOR — The bootstrap accepts an undocumented offer carrier

LLP 0058 §Request and protocol offer specifies four named decimal headers. `AuthClientProtocolOffers` also accepts `Sec-WebSocket-Protocol` tokens when the named header is absent (`src/auth/handshake.rs:90-117`), and ordinary `GET /auth/session` uses that parser.

**Resolution criterion:** Either reject the alternate carrier on ordinary HTTP bootstrap requests or document it explicitly and restrict it to genuine WebSocket upgrades.

## 4. Suggestions

- Split the document into a current normative protocol and a historical landing appendix. The interleaving of item-4 history with composed item-5-through-item-8 behavior makes it difficult to tell which statements are current requirements.

- Generate route classification, `InvocationSource`, transport DTOs, protocol requirements, and diagnostic/status registration from one closed operation registry. That would turn several prose parity claims into construction-time invariants.

- Use typestate-like internal objects such as `VerifiedV1SessionsPair`, `CompiledGeneration`, `BoundLiveOwner`, and `CanonicalHandshake`. Each should be constructible only after its owning validation succeeds.

- Add a state-machine/property test for durable keys, admission epochs, crash boundaries, and ambiguous commits. The Spec is precise enough to serve as an executable transition model.

- Make the startup carrier self-authenticating and content-addressed. A single verified root digest over schema, functions, and seed would simplify identity matching and recovery diagnostics.

- Maintain a machine-readable acceptance manifest mapping every normative assertion to one or more test names. Status should not advance while any required row lacks evidence.

## 5. Open questions

1. Is reconnect supposed to preserve a live subscription across a new connection grant? The Spec says no; current code and tests permit same-principal transfer. Which behavior is intended?

2. What is the normative shared authority boundary: `InvocationGate`, the full HTTP middleware composition, or separate HTTP and connection-act gates?

3. Can all coordinator and worker prerequisites be constructed before durable consume? If not, what durable intermediate state safely represents “catalog committed but runtime not ready”?

4. Are artifact producers trusted principals, or must the receiver verify canonical hashes? How is that trust authenticated for HTTP provisioning and startup files?

5. What exact conditions define a “truly empty database”: no rows, no user tables, no active manifest, no application identity, or all of these?

6. What observable event defines a new HTTP connection attempt for handshake-cache invalidation?

7. Should handshake descriptors use a dedicated schema instead of sharing mutation-input definitions, so exact response validation does not alter mutation error classes?

8. What delivery guarantee is required for the downgrade audit across a crash after the downgrade commit but before listener bind?

## 6. Readiness verdict

The architecture is promising, but unresolved material authorization, activation, artifact-integrity, handshake, conformance, and evidence gaps remain. The Spec is not ready for acceptance.

READINESS VERDICT: NOT READY
### Orchestrator disposition (round 2, outside the verbatim body)

The 12 GPT-family MATERIALs are spec-vs-code fidelity gaps (the shipped code does
not yet enforce a guarantee the Spec pins). Disposition: each is recorded as a
named defect obligation in §Review triage with an acceptance obligation — exact
connection-grant live ownership (#1), settled-dev raw-loader tuple enforcement
(#2), prepared-generation compilation before consume (#3), readiness-before-
prerequisites (#4), composed-gate boundary normative description or unification
(#5), HTTP session DTO closure (#6), cross-process handshake-cache invalidation
(#7), handshake UUIDv7/version exactness (#8), truly-empty seed classification
(#9), content-verified deployment identities (#10), operator-recovery diagnostics
(#11), the acceptance evidence harness (#12), and the alternate offer carrier
(#13, minor). The normative design is unchanged; the Spec cannot advance past
Draft until they close. Split-document suggestion left to the author.

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

READINESS VERDICT: NOT READY

- MATERIAL: The actual pinned pre-auth predecessor harness and byte-for-byte corruption database/WAL harness are not committed and rerunnable. The document says they are not committed while its Status and acceptance prose claim implementation as fact. Commit a repeatable pinned-predecessor harness covering fresh and provisioned state and a byte-level corrupt-state comparison, or narrow the implementation-complete claim until that evidence exists.
- MINOR: The diagnostics text says the request-body timeout is absent from LLP 0012, but LLP 0012 now registers it.

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

At committed HEAD `62a11ce`, LLP 0058 presents a strong, security-conscious staged-auth protocol with unusually good executable evidence. The durable transition boundary appears faithfully implemented. However, two normative surfaces declared “exact” no longer describe committed code, so material specification drift remains.

## Strengths

- The staged-mode state machine, pair validation, poison boundary, and fail-closed startup behavior are precise and internally coherent.
- Preflight evaluates every Ibex module before staging.
- Corrupt-state coverage verifies both database and uncheckpointed WAL bytes remain unchanged.
- The predecessor harness pins both predecessor commits, exercises real HTTP/SQLite boundaries, and compares database/WAL bytes directly.
- Related LLPs provide clear ownership boundaries for route policy, session projection, invalidation, and later-item activation.

## Concerns

### MATERIAL — The “exact” authority enumeration and handler projection are stale

LLP 0058 normatively defines five internal authority variants and says `HandlerAuthProjection` is exactly the five-field shape shown.

Committed code additionally implements `ResolvedAppAuthority::ServicePrincipal` and handler-visible `kind` and `actor` fields. These are intentional LLP 0055 semantics, but LLP 0055 is absent from LLP 0058’s Related metadata and normative enumeration.

The statement that handshake `authority` uses the same handler projection constructor is also inaccurate: the handshake uses a distinct three-field `AuthSessionAuthority`.

Resolution criterion: revise LLP 0058 to incorporate the service-principal variants and sealed projections, or explicitly scope its enumeration as an item-4 historical baseline superseded by a named normative amendment. Clarify the distinct handshake projection and add LLP 0055 to Related.

### MATERIAL — The exact handshake DTO omits a required field

The example and exactness rule say every displayed member is required, but omit `deploymentIdentity`. LLP 0059 explicitly revises this response with required `deploymentIdentity`, and committed Rust requires it.

Resolution criterion: add `deploymentIdentity` to the canonical DTO and exactness semantics, including its dev/sessions nullability rules, or explicitly identify LLP 0059’s revised DTO as the sole current closed shape.

## Readiness verdict

**NOT READY**

## Blind final re-review — 2026-07-15 (`c38eabc`)

**Family:** GPT
**Provider/runtime:** OpenAI Codex CLI 0.144.4, `gpt-5.6-sol`, high reasoning, read-only ephemeral sandbox
**Redacted:** No
**Method:** Independent per-document review at exact commit `c38eabc75ae48fb186c3a39c9b9e7feff39145b8`; reviewer was instructed not to read `llp/reviews/` and made no edits or status decision.

### Review body

**Verdict NOT READY**

**MATERIAL —** The handler-authority reconciliation is sound: `ServicePrincipal`, `kind`, and delegated `actor` match LLP 0055 and `src/auth/invocation.rs`, while the handshake correctly retains a separate three-field authority. However, `deploymentIdentity` is not exact. The accepted parity fixture uses invalid values (`schemaVersion: "v1-sessions"` and `sha256:*` hashes) in `tests/conformance/auth-session-parity.corpus.json`, contrary to LLP 0058 §§Exact deployment identity/Disjoint v1 identity strings. The kit checks only nonempty strings in `demos/_kit/client.mjs`, and the schema likewise lacks version/prefix/digest constraints in `schemas/auth.session.output.schema.json`. The parity test passes only because both sides accept the same invalid corpus. Resolution criterion: enforce the mode/version relationship and exact lowercase 64-hex identity namespaces in the schema and kit; replace the positive fixture with a valid identity and add negative corpus cases for every field and cross-field mismatch.

**MATERIAL —** LLP 0012’s diagnostic registry is not faithfully implemented. LLP 0012 §Diagnostic Schema registers `SNAPBACK_CAPABILITY_UNSUPPORTED` and `SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED` as HTTP 503 top-level refusals, but `src/server.rs` maps both to HTTP 400 and its mapping tests encode that result. This changes retry/recovery semantics at the integration boundary. Resolution criterion: make the server and tests return the LLP 0012 statuses, or revise the owning LLP through the author-controlled process if 400 is intentional; add served-response tests for both codes.

**MATERIAL —** The predecessor harness overstates its pre-bind evidence. In `tests/acceptance/auth-mode-predecessor-v1.mjs`, the poison case runs synchronously, checks only process failure and absence of the ready file, then records `listenerBound: false`; it never observes whether the reserved port transiently accepted connections. LLP 0058 §§Artifact and predecessor matrix/Status claim committed proof of no listener publication. Resolution criterion: run the predecessor asynchronously with a concurrent connection sentinel or equivalent bind instrumentation, and derive `listenerBound` from that observation.

**MINOR —** LLP 0058 now specifies monthly/event/release cadence, but the receipt contains no run timestamp, runner provenance, or cadence gate. Resolution criterion: record dated successful executions and make ratification/release check that evidence is current.

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

# VERDICT: NOT READY

## MATERIAL

LLP 0059 overclaims its composed Contract regression. It says the test proves that a durable-authority reload initiated during successor resume cannot recursively replay or starve the barrier ([LLP 0059:1998](</Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/llp/0059-session-projection-and-client-barrier.spec.md:1998>)). However:

- The test client’s `authSession()` is a no-op ([auth-coordinator-contract.test.mjs:154](</Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/auth-coordinator-contract.test.mjs:154>)).
- Both single- and multi-live tests transition the coordinator directly ([test:263](</Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/auth-coordinator-contract.test.mjs:263>), [test:387](</Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/auth-coordinator-contract.test.mjs:387>)).
- Contract resume defers refresh through `setTimeout(0)`, after the active resume participant returns ([index.mjs:2210](</Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/index.mjs:2210>), [index.mjs:2393](</Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/index.mjs:2393>), [index.mjs:3756](</Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/index.mjs:3756>)).

Therefore the composed test never calls `synchronize()` reentrantly during the active resume barrier and cannot establish the claimed security/liveness property.

The coordinator implementation itself appears coherent: it accepts reentrant resume only after exact durable phase/revision/epoch/authority-key confirmation ([auth-coordinator.mjs:685](</Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/auth-coordinator.mjs:685>)). Direct owner and peer-adoption regressions exercise this path ([auth-coordinator.test.mjs:412](</Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/auth-coordinator.test.mjs:412>), [auth-coordinator.test.mjs:450](</Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/packages/snapback-contract/auth-coordinator.test.mjs:450>)). That unit evidence does not satisfy the explicitly claimed composed acceptance.

## MINOR

LLP 0058’s “known residual looseness” is stale: it says the auth-session schema does not pin descriptor version or UUIDv7 grammar ([LLP 0058:1315](</Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1315>)), but the dedicated schema pins both ([schema:113](</Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/schemas/auth.session.output.schema.json:113>)) and the corpus tests them ([corpus:184](</Users/ccheever/projects/snapback-eng-25001-auth-review-resolution/tests/conformance/auth-session-parity.corpus.json:184>)).

## Resolution criteria

Add a composed single- and multi-live regression whose successor resume actually awaits coordinated durable synchronization during the active resume phase, covering both owner and peer adoption. Assert bounded completion, exactly-once resume, blank-until-ready behavior, and no stale publication. Then correct LLP 0058’s residual-looseness text. Coordinator, Contract, kit tests and `ref-check --verbose` currently pass.
