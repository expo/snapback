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