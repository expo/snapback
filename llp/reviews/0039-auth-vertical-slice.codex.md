# Review: LLP 0039 — Auth vertical slice (Codex / GPT family)

Artifact for the `/llp-super-refine` dual-model refine loop (LLP 0005 review
norms). One dated, numbered section per round; review bodies are preserved
verbatim as received. Orchestrator verification and disposition notes sit
outside the verbatim bodies. Earlier reviews of this document by other
runtimes live in `0039-auth-vertical-slice.claude.md`.

## Round 1 — 2026-07-12

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md`, working tree at git HEAD
`91828cb` (file clean; sha256
`1a1bf8611220ee5399fe99e2dab4c0eebd34040c37c62af071f5176e0509e68b`).
**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1 (`codex exec`,
non-interactive), model `gpt-5.6-sol`, reasoning effort `ultra`, sandbox
`read-only`, approval `never`, workdir = repo root. Session id
`019f5592-bc11-7452-b40f-5a5c56da984d`; 272,664 tokens used.
**Date:** 2026-07-12
**Redacted:** No secrets in the brief; the reviewer read the repository
through the CLI's read-only sandbox and was instructed not to read
`.agent-local-secrets.md` and not to quote secret material into the review.
Sending the document and repository content to an external provider for this
review was explicitly authorized by the human invocation of
`/llp-super-refine` (LLP 0005 honesty rules).
**Method:** cli-runner — fresh non-interactive session
(`codex exec … --output-last-message`), given the same round-1 brief as the
concurrent Claude-family reviewer and run blind to it: instructed not to read
anything under `llp/reviews/`, launched concurrently with (and without access
to) the other family's round-1 review. Brief carried the LLP 0005 standard
review questions and required severities, resolution criteria, and an
explicit READY / NOT READY verdict with "ready" defined as no unresolved
material correctness, coherence, feasibility, safety, or decision-quality
concern.

> **Independence (LLP 0005).** Fresh session; not the orchestrating session
> that revises the document. The draft's original author line is
> "Charlie Cheever / Codex", and the document has since been substantially
> revised by Claude sessions; the paired fresh Claude-family review
> (`0039-auth-vertical-slice.fable.md`) and this GPT-family review together
> give both-family coverage each round.

### Review body (verbatim)

## Overall assessment

This is the right vertical slice and a strong architectural direction, but it is not yet an implementation-ready RFC. The protected/app-visible data split, one built-in provider, server-derived `ctx.auth`, principal-bound connections, and reuse of authorization epochs are all good choices.

The cited implementation footholds are mostly accurate: `ConnectionAuth` and server-minted connection tokens exist; `ValueExpr::AuthUserId`, `PermissionScopeExpr::AuthUser`, and `SNAPBACK_AUTH_USER_MISSING` exist; `src/ephemeral.rs` already has a conflicting `AuthContext`; and server-side epoch/`resync_required` machinery exists. However, that machinery is narrower than the proposal implies, and the shipped client does not yet perform the required fail-closed clearing.

Several questions left open here—session refresh, WebSocket authentication, and permission declaration syntax—are load-bearing contracts rather than follow-up polish. The document itself says the WebSocket question blocks a builder on day one. I would keep the proposal, but revise it substantially before implementation.

## Strengths

- The distinction in §Protected identity core between protected `_auth_*` state and ordinary profile/membership tables is exactly the correction LLP 0011 §Authentication Model makes to LLP 0000’s broad “auth next to data” language. Explicitly documenting the `_auth_accounts` narrowing is preferable to silently drifting from the parent RFC.

- §Built-in first provider chooses a small but real provider and correctly preserves LLP 0011’s two important constraints: transactional first-login provisioning and expensive credential verification outside the single-writer lock.

- §Session transport accurately recognizes that the transport-level connection hole reported by LLP 0038 Part 4 #6 has since been closed. The route registry classifies the relevant routes as `ConnectionAuth`, and the handlers enforce the server-minted token (`src/server.rs:299-401`, `629-663`, `2026-2105`, `2461-2475`).

- §Permission dependencies sensibly reuses existing machinery. `ValueExpr::AuthUserId` fails closed with `SNAPBACK_AUTH_USER_MISSING` (`src/value_expr.rs:117-126`), mutation permission scopes resolve before any write (`src/local.rs:3999-4051`), and matching epoch changes emit subscription-scoped `resync_required` (`src/local.rs:3631-3681`).

- The two-client differential-visibility test in §Acceptance is the right sharp proof for authorized partial sync. The session-revocation, connection-binding, user-switch, dev-impersonation, and route-registry tests are also appropriately cross-layer.

- The non-goals are disciplined. Deferring external providers, organizations, declarative write-side RLS, service principals, and universal incremental revocation keeps the slice focused.

## Concerns

1. **HIGH — The session/connection transport is not yet a coherent protocol.**

   §Session transport promises bearer and cookie sessions, principal-bound connection grants, immediate revocation, and cross-principal rejection. Yet §Open Questions leaves both refresh semantics and WebSocket session transport unresolved, while §Built-in first provider says the slice will prove refresh.

   Today a connection grant is only `connection_id → connectionToken`; the token is checked once before WebSocket upgrade, and the running socket never consults the registry again (`src/server.rs:299-401`, `2082-2204`). “A token minted under one principal is rejected when presented under another” is not evaluable if the connection token is the only credential presented: either the token itself selects the stored principal, making possession sufficient, or every use must also present session authority for comparison.

   LLP 0031 §The invariant also defines `AppAuth` as client-supplied, non-transport auth, mirrored at `src/server.rs:594-610`. LLP 0039 reverses that premise without explicitly amending 0031. Cookie support is similarly incomplete: loopback CORS reflects any localhost origin but emits no `Access-Control-Allow-Credentials`, and the client omits `credentials: "include"` (`src/server.rs:1553-1596`; `demos/_kit/client.mjs:244-254`). Simply enabling credentialed reflection would let an arbitrary localhost origin read cookie-authenticated data.

   *Resolves with:* an exact route/method/policy table; an explicit amendment to LLP 0031; bearer-versus-cookie precedence and invalid-credential fail-closed rules; a decision on whether grants bind to session id, user id, or an authority generation; settled refresh and WebSocket transports; cookie attributes and an origin allowlist covering HTTP and WebSocket upgrades; event-driven invalidation of active sockets; and tests across every `ConnectionAuth` operation, including revoke/logout races and already-open sockets.

2. **HIGH — “Server-derived auth” does not yet cover all current client-controlled authority surfaces.**

   §Session transport says clients cannot provide `userId`, but “every request … records the resolved auth context” is too weak and could be implemented as observability rather than replacement of untrusted fields.

   Direct handler calls currently deserialize and trust `HandlerInput.auth` (`src/manifest.rs:913-925`; `src/server.rs:1927-2004`). More seriously, `ephemeral::AuthContext` contains caller-supplied `permissions`, and publish/delete requests also contain separate owner `session_id` and `user_id` fields (`src/ephemeral.rs:213-243`, `321-350`). HTTP and WebSocket handlers verify only the connection token and then pass those claims through unchanged (`src/server.rs:2284-2397`, `2516-2564`); the client constructs room permissions itself (`demos/_kit/client.mjs:236-242`, `412-435`).

   LLP 0013 §Authorization and privacy requires permission-loss removal/resubscribe, while LLP 0026 §Auth and revocation explicitly records that durable permission revocation is not integrated. Thus the proposal’s private-room motivation is not met merely by binding the connection handle to a principal.

   *Resolves with:* a normative rule that ordinary requests cannot supply trusted principal, user, session, role, room-permission, or owner claims; one server-only resolved authority projected into durable handlers and ephemeral authorization; forged-claim tests over HTTP and WebSocket; and either implementation of ephemeral membership/session revocation or an explicit capability gap that disables auth-dependent ephemeral collections and narrows the private-room claim.

3. **HIGH — The proposed permission-change path is not fail-closed on the client.**

   §Permission dependencies says affected subscriptions resubscribe, and §Acceptance tests only that resubscription occurs. LLP 0011 §Local-First and Realtime Implications is stronger: clients must immediately mark results stale and clear sensitive retained slices before resubscribing (`llp/0011-auth-and-permissions.rfc.md:232-249`). LLP 0008 imposes the same rule.

   The server already sends `clear_retained: true`, but the code notes that no shipped client reads it (`src/ephemeral.rs:773-783`). The kit starts an asynchronous resubscribe without clearing `handle.rows` (`demos/_kit/client.mjs:773-815`), and retained Contract data remains stored until a later successful snapshot replaces it (`packages/snapback-contract/index.mjs:418-477`; `packages/snapback-contract/client-store.mjs:140-150`). A slow or failed resubscribe therefore leaves formerly authorized data visible and on disk.

   *Resolves with:* acceptance that delays or fails resubscription and proves synchronous stale marking, immediate in-memory clearing, deletion/quarantine of the durable retained slice, no stale-row render callback, bounded retry behavior, and correct behavior across process restart. Session expiry and sign-out must exercise the same wipe contract, including pending mutations and active durable/ephemeral subscriptions.

4. **HIGH — The email-code and session security state machine is underspecified.**

   §Protected identity core names tables but not their schemas or invariants. §Built-in first provider says “hashed,” “single-use,” and “attempt-limited,” but does not define atomic consumption, concurrent exchange behavior, address normalization, uniqueness, replacement of older codes, enumeration posture, token entropy, or the hashing primitive. A normal salted hash is insufficient protection for a low-entropy numeric code after database disclosure; the design needs a keyed digest/pepper or an explicitly justified slow-verification construction and key-rotation story.

   Running expensive verification outside the write lock is correct, but it creates a compare-and-consume race unless the subsequent transaction conditionally consumes the exact record/version that was verified. The local capture mailbox also has no specified authority boundary in LLP 0039 or LLP 0045.

   The `_auth_*` namespace is not currently reserved: validation rejects `_snapback*` but permits `_auth_*` (`src/storage.rs:2737-2745`; `packages/snapback-codegen/index.mjs:286-293`). Existing applications could therefore collide with the proposed system tables.

   *Resolves with:* minimal table schemas and indexes; immutable user/session identities; canonical email and identity uniqueness rules; a concrete token/code cryptographic design; atomic attempt increment and single-use exchange under concurrency; transactional code-consume + identity/user/session creation; rate limits beyond address alone; non-enumerating responses; secure dev-only/admin-gated capture access; reserved-prefix and collision migration behavior; an explicit export allowlist; and adversarial concurrent-exchange tests.

5. **HIGH — Permission dependency declaration and invalidation are not authorable or safely conservative yet.**

   §Permission dependencies relies on declared scopes, while §Open Questions leaves the syntax unresolved. The current foothold automatically attaches only `user:<current-user>` to authenticated queries (`src/local.rs:3931-3959`). Mutation bumps are raw manifest metadata using `AuthUser`, `Arg`, or `Literal`; `AuthUser` means the mutation actor, which is wrong when an administrator changes another user’s membership (`src/manifest.rs:327-332`; `src/local.rs:4014-4051`).

   The TypeScript mutation authoring helpers do not expose `permissionEpochBumps`, and function decoration does not emit it (`packages/snapback-codegen/define.mjs:376-420`; `packages/snapback-codegen/index.mjs:1534-1553`). Omitted metadata therefore silently bumps nothing rather than taking LLP 0020’s conservative unknown-impact fallback. Ordinary JS query builders also lower `ctx.auth.userId` to a literal value; they do not preserve the IR provenance that `authUserId()` retains (`packages/snapback-harness/ctx-bootstrap.js:187-213`).

   Existing provider coverage proves reason plumbing and an eventual fresh snapshot, not an actual authorization loss; it deliberately inserts a still-visible row (`demos/_kit/tests/provider-live-conformance.mjs:441-519`).

   *Resolves with:* one typed, generated dependency/impact language for every authoring tier; canonical scope constructors rather than raw strings; an explicit conservative behavior for missing/unknown metadata; subject-versus-actor semantics; codegen and manifest validation; and an acceptance test where an administrator revokes another user, a previously visible secret row is cleared immediately, the fresh snapshot excludes it, and unrelated users do not resync.

6. **HIGH — The slice has no negative proof for write authorization.**

   §Non-goals reasonably defers declarative write-side RLS and substitutes handler rejects, but §Acceptance never tests an unauthorized write. Merely passing `ctx.auth` to a mutation does not make it safe. The current todo path illustrates the risk: update and delete read a caller-selected row and mutate it without checking ownership (`demos/todo/snapback/handlers.mjs:27-39`).

   There is also no stable handler-facing denial mechanism for the promised `SNAPBACK_AUTH_PERMISSION_DENIED`: arbitrary handler error codes are normalized to `SNAPBACK_HANDLER_FAILED` unless explicitly allowlisted (`src/runtime.rs:1854-1872`). LLP 0011 §Validation Requirements calls for insert, update, and delete rejection; LLP 0039’s explicit narrowing can defer generic RLS, but it still needs to prove its handler-level substitute.

   *Resolves with:* an enforced `public | optional | authenticated` function requirement, a typed handler-facing authorization-denial helper, and cross-user insert/update/delete tests proving no write, no commit version, no leaked row, and the promised structured diagnostic. If only a smaller operation subset is supported, state that cutline explicitly.

7. **MEDIUM — The proposed `ctx.auth` shape is not reconciled with replay, roles, or authority provenance.**

   §Protected identity core adds `isAuthenticated`, `provider`, and `roles`, while current `AuthInput` contains only `principal`, `session_id`, and `user_id`; the JS bootstrap adds only a `userId` alias (`src/manifest.rs:913-925`; `packages/snapback-harness/ctx-bootstrap.js:267-294`). Existing replay/idempotency fingerprints cover exactly the old three-field tuple (`src/manifest.rs:1034-1057`; `packages/snapback-contract/client-store.mjs:25-45`).

   Even though role-based permission checks are a non-goal, arbitrary handlers can branch on any exposed `roles` value. A role/provider change would therefore change behavior without changing the existing fingerprint. `isAuthenticated` is also redundant mutable state unless derived from a closed authority variant, and the document does not define its value for local impersonation or admin bypass. Meanwhile, `authRequirement` exists in manifests but currently has no runtime consumer.

   *Resolves with:* a server-only authority enum distinguishing anonymous, session, dev impersonation, admin bypass, and later service principal; an immutable public projection derived from it; explicit `principal`/`userId`/`sessionId` invariants; a versioned canonical authorization digest or session/authz generation covering every handler-visible authority fact; and parity tests across server execution, optimistic execution, queued replay, refresh, and impersonation. Alternatively, omit or always empty `roles` in this slice.

8. **MEDIUM — The route and diagnostic contracts are incomplete and partly stale.**

   §Diagnostics omits the throttle and lockout codes required by §Built-in first provider and §Acceptance. It also describes the listed codes as new, but `SNAPBACK_AUTH_STALE_RESULT` already ships in replay/idempotency paths (`src/storage.rs:302-309`, `2817-2825`; `src/runtime.rs:358-410`). `SNAPBACK_AUTH_USER_MISSING` is not only a scope-evaluation code; it also covers general `AuthUserId` expression failure.

   New auth codes currently fall through to HTTP 400 because the status mapper knows none of them (`src/server.rs:2624-2648`). No live-frame, WebSocket close, retryability, or redaction semantics are pinned. “New `/auth/*` routes” likewise gives no concrete request-code, exchange, refresh, logout, or session-inspection shapes.

   *Resolves with:* a complete diagnostic table covering code, HTTP status, live representation, retryability, safe details, and redaction; named throttle/lockout/invalid-or-revoked outcomes; exact auth route request/response schemas and policies; and schema/black-box tests on every projection.

## Suggestions

- Split the internal model into `SessionCredential` (untrusted transport input), `ResolvedAuthority` (server-only), `HandlerAuthContext` (immutable public projection), and `EphemeralAuthorization` (server-derived room decision). This would also eliminate the existing `AuthContext` name collision.

- Bind connections to a stable session id plus a monotonic session generation. Bearer refresh can then rotate credentials without destroying healthy connections, while logout increments/revokes the generation and invalidates every grant atomically.

- Prefer an opaque `challengeId + code` exchange rather than using the email address as the challenge key. It simplifies replacement, attempt accounting, redaction, and concurrent-consumption rules.

- Consider deriving permission invalidation from the authorization evaluator’s actual `Row`/`MissingRow`/`Query` reads and committed changes, using the existing shared dependency vocabulary. Keep coarse typed epochs only for opaque/external claims. This would remove much of the hand-authored `permissionEpochBumps` footgun.

- Add a deterministic auth clock and a model-based state-machine test covering request, resend, failed exchange, concurrent exchange, login, refresh, token reuse, logout, expiry, reconnect, and user switch.

- Report auth capabilities explicitly: provider, bearer/cookie support, refresh mode, impersonation availability, retained-data behavior, ephemeral authorization, and whether revocation is immediate or reconnect-bound.

- Add LLP 0013, LLP 0026, LLP 0036, and LLP 0046 to the relevant relationship/dependency discussion; 0046 is referenced in the body but absent from `Related`. Update LLP 0031 in the same change that replaces client-supplied `AppAuth`.

## Open questions

- Is a connection grant an attenuated bearer that selects its stored authority, or must every operation present both session and connection credentials?

- Does a connection bind to one session, one user across sessions, or a versioned full authority context? What happens on anonymous-to-authenticated transition or same-user refresh?

- Does refresh rotate only the bearer while retaining a stable session id? Is refresh-token reuse detected, and what happens to queued mutations and open sockets?

- What is the exact linearization rule between logout/revocation and an already-started query, queued mutation, detached action’s later `ctx.runMutation`, subscription, or outbox delivery?

- What are the `_auth_*` schemas, email canonicalization rule, identity uniqueness constraint, session/token lifetime defaults, and deletion/retention policy?

- What cryptographic construction protects low-entropy verification codes, where does its server secret live, and how is that secret rotated?

- Which origins may use cookie auth, how are bearer/cookie conflicts handled, and what `Origin` policy applies to WebSocket upgrades?

- What is the first typed permission dependency/impact syntax, and how does an administrator name the affected subject without manually constructing raw scope strings?

- Are `roles` authoritative session claims, dynamically loaded app data, or dev-impersonation-only metadata in this slice?

- Does the slice include permission-change revocation for ephemeral rooms? If not, which ephemeral capabilities are disabled under real sessions?

- How is the local capture mailbox accessed without turning it into an unauthenticated session-issuance oracle?

- Is this slice explicitly limited to the trusted local target, or intended to support a self-hosted non-loopback deployment? The security and rate-limit acceptance bar differs materially.

## Readiness verdict

Verdict: NOT READY

The proposal’s direction is sound, and its cited server footholds are largely real, but unresolved session/WebSocket semantics, client-controlled ephemeral authority, missing fail-closed retained-data clearing, an underspecified credential state machine, unauthorable permission dependencies, and absent write-denial proof are material correctness and security gaps. Settling those contracts and strengthening acceptance would make this a strong implementation plan.
### Orchestrator verification notes — round 1 (outside the verbatim body)

Spot-checked by the orchestrating session before revising. Every decisive
factual claim checked verifies against the repository:

- `_auth_*` is not a reserved prefix today: codegen rejects only identifiers
  starting `_snapback` (`packages/snapback-codegen/index.mjs:290`); no
  storage-side `_auth` reservation.
- `ephemeral::AuthContext.permissions` is caller-supplied
  (`src/ephemeral.rs:214-218`), publish/delete requests carry separate owner
  `session_id`/`user_id` fields (`src/ephemeral.rs:322-343`), and
  `AccessPolicy::allows` consults those client-supplied permissions.
- Direct handler calls deserialize `HandlerInput.auth: AuthInput`
  (`src/manifest.rs:912-925`); live-subscription ownership compares that
  client-supplied auth (`src/local.rs:1705-1710`, `1779-1784`).
- `auth_fingerprint` covers exactly the `(principal, session_id, user_id)`
  tuple (`src/manifest.rs:1039-1057`).
- The HTTP status mapper knows no `SNAPBACK_AUTH_*` code (falls through to
  400, `src/server.rs:2630-2648`), and handler error normalization allowlists
  no auth-denial code (`SNAPBACK_HANDLER_FAILED` fallback,
  `src/runtime.rs:1854-1872`).
- The overflow `resync_required` envelope carries `clear_retained: true` with
  an in-code note that no shipped client read the pre-typed field
  (`src/ephemeral.rs:773-785`); the kit's `RESYNC_REQUIRED` handler
  resubscribes without clearing `handle.rows` first
  (`demos/_kit/client.mjs:808-815`).
- Todo `setCompleted`/`deleteTodo` mutate a caller-selected row with no
  ownership check (`demos/todo/snapback/handlers.mjs:27-39`).
- The only auto-attached permission dependency is `user:<current-user>`
  (`add_permission_dependencies_with`, `src/local.rs:3931-3959`);
  `permission_epoch_bumps` exists in the manifest layer only — no authoring
  exposure in `packages/snapback-codegen/define.mjs` / `index.mjs`.
- `SNAPBACK_AUTH_STALE_RESULT` already ships in replay/idempotency paths
  (`src/runtime.rs:405`, `src/storage.rs:304`, `src/storage.rs:2821`) and is
  consumed by the contract kit (`packages/snapback-contract/index.mjs:563`).
- `AppAuth` is pinned as handler-enforced, app-supplied `ctx.auth` — not
  transport authentication (`src/server.rs:594-599`; LLP 0031 §The
  invariant).
- LLP 0013 §Authorization and privacy and LLP 0026's "durable
  permission-change revocation is not integrated / deliberately deferred
  (§Auth and revocation)" read as cited.
- `authRequirement` is emitted by codegen and parsed by the manifest but has
  no runtime consumer.
- The JS query builder lowers values via `literal(...)`, so raw
  `ctx.auth.userId` loses `AuthUserId` provenance
  (`packages/snapback-harness/ctx-bootstrap.js:187-213`).
- LLP 0046 is cited in the document body but absent from its Related header.

**Disposition (2026-07-12 revision):** all eight concerns accepted as
material and addressed in the same-day revision of the document — authority
resolution/precedence and the legacy `AuthInput` migration, connection↔
principal binding at `POST /connection/open` with session generations,
fail-closed client clearing, the challenge/code state machine with a keyed
digest and transactional consume, `_auth_*` prefix reservation, typed
permission-scope authoring with subject-vs-actor semantics, `authRequirement`
runtime enforcement plus a typed denial path and negative write acceptance,
and a full diagnostics table acknowledging the shipped `AUTH_STALE_RESULT`
semantics. Where the review asked for full schemas/DDL, the revision pins
field lists and invariants rather than DDL (implementation detail). Ephemeral
room authority is scoped as a declared capability gap (the review's offered
alternative) rather than implemented in-slice.

## Round 2 — 2026-07-12

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md`, working-tree revision of
2026-07-12 round 1 (sha256
`e4ab3e17b8cf80cade21fafbe18459295f4ed301cfd42fb434bb5ebb45396655`;
deliberately newer than git HEAD — the working tree is the revision under
review).
**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1 (`codex exec`,
non-interactive), model `gpt-5.6-sol`, reasoning effort `ultra`, sandbox
`read-only`, approval `never`, workdir = repo root. Session id
`019f55ae-d7f5-7f41-913d-a3e4da1e8211`; 287,043 tokens used. Fresh session —
not resumed from round 1.
**Date:** 2026-07-12
**Redacted:** Same as round 1 (no secrets in the brief; read-only sandbox;
instructed to avoid `.agent-local-secrets.md` and `llp/reviews/`; external
send authorized by the human `/llp-super-refine` invocation).
**Method:** Same as round 1 — shared round-2 brief, blind to the concurrent
Claude-family round-2 review and to all archived reviews.

### Review body (verbatim)

## Overall assessment

This is the right next vertical slice and its architecture is directionally strong: server-resolved authority, protected identity state, principal-bound connection capabilities, authorization epochs, and explicit capability gaps fit Snapback well.

The current revision is not ready to implement, however. Several load-bearing contracts are either unsafe under shipped semantics or cannot produce the acceptance behavior described. The most serious are the tokenless-loopback `AdminRead` mailbox, an unrepresentable cross-user permission scope, fail-open omitted epoch declarations, incomplete refresh/reuse semantics, unwired replay fingerprints, and the lack of durable fail-closed clearing on permission revocation. These are fixable without abandoning the design, but they require decisions in the RFC rather than implementation discretion.

## Strengths

- `§Authority resolution` correctly makes authority server-derived, separates internal authority from handler-visible `ctx.auth`, defines credential precedence, and refuses invalid credentials rather than falling back to anonymous.

- `§Legacy dev auth and migration` acknowledges the real compatibility boundary around `HandlerInput.auth` instead of pretending existing demos can change atomically.

- `§Protected identity core` draws the right line between protected identity/session state and ordinary app-visible profile or membership rows. This coheres with LLP 0011 §Authentication Model and preserves “auth next to data” without syncing credentials.

- `§Built-in first provider` is unusually concrete for a first-provider proposal: keyed digests for low-entropy codes, explicit attempt limits, transactional first-login provisioning, and compare-and-consume are all sound directions.

- `§Session transport and connection binding` builds on the actual server-minted `connectionToken` guard rather than redesigning transport from scratch. The Origin analysis for localhost cookies is particularly good.

- `§Ephemeral rooms` is honest about the current client-supplied permission surface and fails closed instead of claiming private ephemeral rooms prematurely.

- `§Permission dependencies` correctly distinguishes actor from subject. The administrator-revokes-another-user acceptance case is exactly the case most likely to expose a mistaken `AuthUser` bump.

- `§Diagnostics and route registry` adopts the existing `SNAPBACK_AUTH_USER_MISSING` and `SNAPBACK_AUTH_STALE_RESULT` codes rather than changing their meanings casually.

- `§Acceptance` is broad and adversarial: concurrency, cross-user writes, token reuse, user switching, redaction, origin checks, and two-client visibility are the right categories.

## Concerns

1. **HIGH — The capture mailbox is not token-gated under the proposed route policy.** `§Built-in first provider` says mailbox reads require the admin token, but `§Route table` classifies `GET /_snapback/api/auth/mailbox` as `AdminRead`. Shipped `AdminRead` deliberately permits tokenless loopback reads: `evaluate_access(..., write=false)` returns `Allowed` whenever `loopback` is true (`src/admin.rs:523`, `src/admin.rs:558`). The global CORS layer reflects any valid localhost/127.0.0.1/[::1] origin (`src/server.rs:1553`). Implemented literally, any local web page could read codes—the exact attack the RFC says it prevents. The same issue applies if protected `_auth_*` inspection uses the ordinary loopback-open data explorer.

   *Resolves with:* Introduce a credential-required secret-read policy such as `AdminSecretRead`, or enforce the existing stronger token-required policy despite the GET method. Require no-token, wrong-token, hostile-local-origin, and valid-token tests for the mailbox and protected auth inspection.

2. **HIGH — The auth-mode and legacy-ingress migration boundary is not executable or securely configured.** `§Authority resolution` alternates between a “per-profile auth mode” and “per-app opt-in” but does not say where `auth: dev | sessions` lives, how precedence works, or what production defaults to. Current `ServerProfile` only models `dev | demo | test | prod` (`src/admin.rs:71`), and `ServerContext` has no auth-mode field (`src/admin.rs:131`). Current `HandlerInput.auth` is defaulted into a non-optional value, making omitted auth indistinguishable from explicit `{auth:{}}` after deserialization (`src/manifest.rs:912`). The kit also sends body auth on every query, action, mutation, and live request (`demos/_kit/client.mjs:236`, `demos/_kit/client.mjs:341`) and has no bearer-session manager. Finally, a merely “marked” dev-impersonation envelope is not a credential; leaving it available on ordinary app routes would make the mailbox protection moot because a hostile local page could impersonate directly.

   *Resolves with:* Pin the auth-mode configuration source, precedence, typo behavior, and secure defaults—especially mandatory session auth or explicit refusal for production profiles. Define separate raw wire, internal resolved-authority, and immutable handler-context types; preserve legacy-auth presence at ingress; enumerate every authority-bearing route shape; specify the client login/token/refresh/logout API; and require an admin/dev capability—not just a marker—for impersonation on session profiles.

3. **HIGH — The permission-scope design cannot implement its headline acceptance case and fails open when declarations are omitted.** `§Typed authoring surface` proposes `permissionScope.user(arg("memberId"))` lowering to the existing `PermissionScopeExpr::Arg`. Today `AuthUser` becomes `user:<id>`, but `Arg` returns the raw argument (`src/local.rs:4014`; prefixing occurs only at `src/local.rs:3759`). Subscriptions depend on `user:<id>` (`src/local.rs:3931`), so an argument `"u1"` bumps `"u1"` and does not invalidate `"user:u1"`. More fundamentally, `§Declared, not inferred` says an omitted declaration bumps nothing. That is a stale-authorization leak, not a safe sharp edge, and conflicts with LLP 0020 §Remaining Phase 4 design’s requirement that unknown permission impact be conservative.

   The statement that raw `ctx.auth.userId` necessarily makes a JS live query non-syncable is also stale: the canonical todo live query uses it with `authScopeField` and is marked `syncable-live` (`demos/todo/snapback/handlers.mjs:8`; `demos/todo/snapback/functions.mjs:23`).

   *Resolves with:* Add a representable typed scope such as `User(AuthUser | Arg(path) | Literal(id))`. Declare permission-backing tables or dependencies at schema/query level, and make missing precise bumps fall back to a coarse table/global authorization epoch or fail manifest loading. Distinguish the closed IR path from supported JS-handler authoring and either preserve or explicitly migrate `authScopeField`.

4. **HIGH — The verification-code and refresh-token state machines remain underspecified at their race boundaries.** `§Request` supersedes prior challenges, and `_auth_verification_codes` records `superseded_by`, but `§Exchange` enumerates only unconsumed, unexpired, and atomic-attempt predicates. A superseded but unconsumed challenge therefore remains exchangeable unless `superseded_by IS NULL` is explicitly part of the compare-and-consume.

   Refresh is less complete. The listed session state stores one `token_hash`, while the behavior requires recognizing a superseded token, distinguishing grace-window use from reuse, and atomically rotating under concurrent refreshes. It does not say what a second refresh with the old token inside the tolerance window returns, how successor history is retained, or how a `SessionAuth` gate accepts a rotated token for the refresh-specific grace path without accepting it generally.

   *Resolves with:* Add normative transition tables and complete compare-and-swap predicates for challenge request/exchange and session refresh/logout/reuse. Pin successor/history storage, grace-window behavior, concurrent-refresh idempotency, ordinary-request behavior for old tokens, and exact revocation transitions. Acceptance should generate concurrent refresh, old/new-token interleavings, superseded-challenge exchange, logout races, and reuse both inside and outside grace.

5. **HIGH — The claimed queued-replay auth guard is not shipped end to end, and its tuple is insufficient for this RFC’s own authorities.** `§Replay parity and the auth fingerprint` says the retained three-field fingerprint already refuses replay. Rust can check a supplied fingerprint, but production ledger record paths emit `auth_fingerprint: None` (`src/runtime.rs:514`, `src/storage.rs:1074`), and the Contract replay path sends that unchanged ledger (`packages/snapback-contract/index.mjs:850`). The existing duplicate-settlement check only catches a `clientMutationId` that was already recorded under another authority; it does not protect a queued mutation’s first delivery.

   The tuple also omits handler-visible dev-impersonation roles even though `§ctx.auth` permits roleful dev authority. The current Contract store derives its scope from `userId` alone (`packages/snapback-contract/index.mjs:314`), contradicting the RFC’s claimed session-scoped behavior.

   *Resolves with:* Wire a required, versioned authority fingerprint from optimistic recording through first server replay. Include every replay-relevant handler-visible fact—authority kind, user/session, provider, and canonically normalized roles—or explicitly disable replay for roleful impersonation. Add first-delivery tests for logout, same-user/new-session login, different-user login, provider change, and dev-role change.

6. **HIGH — Permission revocation does not yet clear retained data safely across failures and restart.** `§Fail-closed client contract` correctly requires clearing before asynchronous resubscribe, but the shipped kit ignores `clear_retained`, starts resubscription while retaining rows, and replaces them only after success (`demos/_kit/client.mjs:773`, `demos/_kit/client.mjs:808`). The retained Contract record does not store permission epochs (`packages/snapback-contract/index.mjs:418`), and the store lacks a query-scoped quarantine/delete primitive (`packages/snapback-contract/client-store.mjs:140`). Deferring durable cleanup to LLP 0043 without making it a landing dependency leaves revoked data able to reappear after process restart or failed resubscribe.

   *Resolves with:* Make durable, query-scoped quarantine/deletion and stored permission epochs a prerequisite of session-profile auth, with restart-during-failed-resubscribe acceptance. Alternatively, disable retained/offline reads on session profiles until that contract lands. In-memory clearing alone is insufficient.

7. **HIGH — Principal-bound connections lack a complete authority, hot-path, and live-error model.** The proposed grant snapshot `{sessionId,userId,generation}` cannot represent anonymous authority or roleful dev impersonation while preserving identical `ctx.auth`. `ConnectionAuth` HTTP routes currently verify the connection token and then pass body auth unchanged (`src/server.rs:2026`, `src/server.rs:2516`), so the RFC must say whether those routes use grant authority, independently require a session credential, or compare both. With token-only authority, “presented under another principal” has no independent principal to compare.

   Rechecking durable `_auth_sessions` on every cursor publish, WebSocket frame, or outbox drain would regress the deliberately lock-free ephemeral lane; the current guard is a small in-memory lookup (`src/server.rs:327`). Time-based expiry also needs a scheduler: the existing connection reaper is activity-based, and responsive WebSocket heartbeats can keep a socket alive indefinitely (`src/server.rs:1477`). Finally, the schema-governed `LiveSocketServerFrame` has no general auth error variant (`src/live_wire.rs:95`), while the kit treats close as generic loss and reconnects (`demos/_kit/client.mjs:1373`).

   *Resolves with:* Use a bound-authority enum, define authority resolution for every `ConnectionAuth` transport, maintain an in-memory session-generation/expiry projection plus deadline index, define coalesced `last_used_at` updates, and add a typed auth-error frame with send/close ordering and client retry suppression. Session expiry must actively invalidate grants and clear protected client state.

8. **HIGH — The write-authorization cutline conflicts with LLP 0011’s governing safety contract.** LLP 0011 §Authorization Model requires two-sided write enforcement: insert checks the new row, update checks both old and merged rows, and delete checks the old row. Its validation requirements explicitly call for those cases. LLP 0039 §Non-goals instead substitutes `authRequirement` plus voluntary handler checks, and acceptance proves only one cross-user update/delete denial. It omits forged-owner inserts and updates that move rows into or out of an unauthorized scope.

   A handler-only system can be a deliberate product choice, but it is not the parent RFC’s first auth acceptance and is not fail-closed when an app author forgets a check.

   *Resolves with:* Either include one enforceable two-sided user-scoped write policy in this slice, or revise/ratify LLP 0011 to permit a handler-only interim capability. In the latter case, report that capability explicitly, narrow the “real multi-user application” claim, and test insert, pre-update, post-update, and delete denial separately.

9. **HIGH — Protected-table collision and lifecycle behavior are not safely specified for existing databases.** `§Reserved prefix` correctly notices that `_auth_users` can already be an app table, but new codegen/storage validation only protects newly applied manifests. Current database open loads the stored manifest without revalidating it (`src/storage.rs:227`), schema changes are additive (`src/storage.rs:463`), and removing a table from the app manifest does not drop its physical table. A stale physical `_auth_users` can therefore survive opt-in and collide with auth DDL unless startup inspects the actual storage catalog.

   The surrounding lifecycle is also inconsistent: identity subjects are email addresses, exports include identity facts, and the console inspects protected tables, yet `§Redaction` says addresses appear only in the mailbox. “Backup excludes sessions” is impossible for an ordinary physical copy of a SQLite database containing session tables. `app.reset` semantics for users, sessions, codes, and grants are unspecified.

   *Resolves with:* Require a pre-DDL physical catalog check with a stable collision diagnostic and documented rename/export recovery. Keep auth tables outside the app manifest behind a separate system-table catalog and redacted DTO. Add an explicit matrix for reset, logical export, physical backup, restore, admin inspection, identity subjects, session hashes, codes, and active connection invalidation.

10. **MEDIUM — Route and function policy metadata are not yet enforceable from their declarations.** `§Diagnostics and route registry` says existing tests prove registry consistency, but routes and `route_registry()` are separate literal lists (`src/server.rs:515`, `src/server.rs:621`; admin routes are in `src/admin.rs:650`). The test checks invariants only for entries already in the registry (`src/server.rs:2766`); it cannot detect an actual unregistered route or a policy label with no runtime enforcement. Adding `SessionAuth` to that enum alone would provide no boundary.

   Similarly, codegen hard-codes every function’s `authRequirement` to `optional-user` (`packages/snapback-codegen/index.mjs:1534`), Rust stores it as an unrestricted optional string (`src/manifest.rs:259`), and no authoring syntax selects `authenticated`. The proposed acceptance cannot be generated through the paved path.

   *Resolves with:* Build routes from one policy-bearing declaration or add exhaustive router/registry parity plus centralized policy middleware. Define typed `authRequirement` authoring, use a closed enum or fail-closed manifest validation, and distinguish `public` from `optional-user` operationally.

11. **HIGH — The transport boundary becomes unsafe outside loopback, and its claimed owner does not exist.** `§Transports` retains `?connection_token=` after the token becomes a real-principal capability. Query strings are routinely exposed to intermediary URL logs; headers and the existing WebSocket subprotocol already provide safer transports. The cookie contract also omits `Secure` outside loopback.

   More importantly, `§Summary` and `§Non-goals` defer TLS and distributed auth hardening to LLP 0009/0047, but LLP 0047 governs runtime execution limits, not TLS, session transport, or distributed rate limiting. “Same-origin” is not encrypted transport, so the proposed bearer system is not safe on a plaintext non-loopback bind.

   *Resolves with:* Refuse `auth:sessions` on non-loopback plaintext transports until a named deployment-security contract lands; require `Secure` cookies outside loopback; disable query-string connection tokens on session profiles or replace them with one-time, short-lived attach tickets; and assign TLS, proxy trust, distributed throttling, and tenant/session isolation to an actual owning LLP.

## Suggestions

- Model challenge, session, refresh, grant, and revocation behavior as executable state machines and run generated transition traces. Property-based or model-checked interleavings will find more than example-based refresh tests.

- Consider separating a rotating refresh credential from a shorter-lived request credential. This makes reuse detection less likely to revoke a healthy session because of an ordinary in-flight API request.

- Store the authenticating `identity_id` on each session rather than inferring provider provenance from the user. That preserves auditability when multiple identities or providers arrive.

- Treat each connection grant as an in-memory authority lease with an `authorityRevision` and deadline. Durable auth transactions advance the revision; hot paths perform only a clock/revision check.

- Split capability reporting into supported versus enabled facts. For example, bearer and cookie may be supported, while cookie is enabled only when a concrete origin allowlist is active.

- Deep-freeze `ctx.auth`, including `roles`, and acceptance-test mutation/reassignment attempts. Pin anonymous serialization explicitly (`null` versus absent).

- Add cross-language test vectors for reserved prefixes, authority fingerprints, scope construction, and diagnostic/status mappings.

- Define email validation and canonicalization more precisely, including length, Unicode/IDNA policy, and whether lowercasing the local part is an intentional account-identity rule.

## Open questions

- Where exactly does `auth: dev | sessions` live, and what is the default for loopback dev, same-origin production, and non-loopback binds?

- What capability authenticates dev impersonation on session profiles without exposing the general admin token to browser app code?

- What does the client own: bearer persistence, refresh scheduling, multi-tab coordination, session restoration, and token custody?

- Which operations extend sliding expiry, and how are `last_used_at` writes coalesced without putting high-rate connection traffic on the SQLite write lane?

- Is a refresh request using the immediately previous bearer idempotent, a second rotation, or a rejection? What exact grace interval and successor state support that answer?

- Are queued mutations scoped to a session incarnation, a stable user, or two layers—user ownership plus authority-version validity?

- Will this slice implement LLP 0011’s two-sided write policy, or is the parent RFC being revised to ratify handler-only authorization temporarily?

- What are the reset, export, physical-backup, restore, and deletion semantics for users, identities, sessions, verification challenges, and connection grants?

- Is cookie-mode Origin enforcement triggered by deployment configuration, by the presence of an auth cookie, or by transport provenance stored on the grant?

- Which LLP owns production TLS, trusted-proxy/source-address handling, distributed throttling, and multi-replica session invalidation?

## Readiness verdict

Verdict: NOT READY

The proposal has a strong core direction, but unresolved safety and correctness issues remain in mailbox gating, authority ingress, permission-scope invalidation, session rotation, replay fingerprints, retained-data clearing, connection expiry, write authorization, protected-table migration, and non-loopback transport. Addressing these contracts should make the RFC implementable without changing its central architecture.
### Orchestrator verification notes — round 2 (outside the verbatim body)

Spot-checked before revising; the decisive claims verify, including five
defects in the round-1 revision itself:

- `AdminRead` permits tokenless loopback reads (`evaluate_access`:
  `loopback || token_ok → Allowed`, `src/admin.rs:553-562`; LLP 0017
  §Security Defaults pins loopback reads open) — so the round-1 route table's
  `AdminRead` mailbox classification is fail-open exactly as claimed.
- `PermissionScopeExpr::Arg` evaluates to the raw argument string
  (`src/local.rs:4029-4037`); only `AuthUser` gets the `user:` prefix
  (`user_permission_scope`, `src/local.rs:3759`), and subscriptions depend on
  `user:<id>` — the round-1 text's `permissionScope.user(arg(...))` lowering
  "to the existing `PermissionScopeExpr`" is unimplementable as written.
- The todo demo's live query uses raw `ctx.auth.userId` with
  `authScopeField: 'userId'` and is marked syncable-live
  (`demos/todo/snapback/handlers.mjs:8-14`,
  `demos/todo/snapback/functions.mjs:23-29`) — the round-1 sentence claiming
  raw usage is necessarily non-analyzable was stale.
- Ledger record paths deliberately leave `auth_fingerprint` unset
  (`take_ctx_ledger`, `src/runtime.rs:508-520`), and the contract store
  fingerprints from `userId` alone
  (`packages/snapback-contract/index.mjs:314`) — the round-1 "shipped guard"
  wording overstated end-to-end coverage.
- LLP 0047 is "Hosted execution limits" — it does not own TLS/transport
  security; the round-1 non-loopback deferral was mis-scoped.
- Also verified: `ServerProfile` is `dev|demo|test|prod` with no auth axis
  (`src/admin.rs:68-75`, `128-135`); `HandlerInput.auth` is
  `#[serde(default)]` non-optional (omitted ≡ empty, `src/manifest.rs:912`);
  the kit sends body auth on every request (`demos/_kit/client.mjs:236-238`,
  `341-360`); the connection reaper is idle-based (`src/server.rs:1474-1480`);
  `LiveSocketServerFrame` has no auth-error variant (`src/live_wire.rs`);
  `open()` does not revalidate the stored manifest and schema changes are
  additive (`src/storage.rs:227`, `463`); router and registry are separate
  declarations with a registry-only consistency test (`src/server.rs:515`,
  `621`, `2764+`); codegen hardcodes `authRequirement: 'optional-user'`
  (`packages/snapback-codegen/index.mjs:1545`); LLP 0020 records the
  conservative posture for unknown permission impact.
- LLP 0011 §Validation Requirements does call for two-sided write-RLS proof;
  0039's handler-substitute deferral is the explicitly named divergence
  ratified 2026-07-07 (see `0039-auth-vertical-slice.claude.md`). The paired
  Claude round-2 review treats the same deferral as correctly scoped; the
  reconciliation keeps the ratified deferral but makes it capability-reported
  (`writeAuthorization: "handler"`), separately tested per write class, and
  adds a landing task recording the interim in 0011.

**Disposition (2026-07-12 revision 2):** all eleven concerns addressed —
token-required `AdminSecretRead` mailbox policy with a four-case access test
matrix; auth-mode home pinned (app manifest, closed enum, profile combination
table, capability discovery) with ingress presence-preservation and the
three-type wire/authority/projection split; a new `PermissionScopeExpr::User`
variant plus the coarse global-auth-epoch conservative fallback for
undeclared writes on permission-backing tables; challenge consume predicate
gains `superseded_by IS NULL` and the refresh machine gains one-deep
successor state, a grace window, `SNAPBACK_AUTH_REFRESH_SUPERSEDED`, and
reuse-revocation transitions; fingerprint v1 wired end-to-end from resolved
authority (never body auth) with roleful-impersonation replay refused;
durable quarantine made a session-profile prerequisite (retained/offline
reads disabled until 0043's primitive lands, capability-reported);
connection grants become a bound-authority value with a memory-only lease
(generation + deadline) check, deadline-driven expiry closes, coalesced
sliding-expiry writes, and a typed live auth-error frame with client retry
suppression; write-authorization posture stated as the ratified 0011
narrowing with per-class negative tests; pre-DDL catalog collision check with
a stable diagnostic plus an explicit reset/export/backup/console matrix and
journal bypass; router↔registry parity and typed `authRequirement` authoring
made 0031-revision requirements; query-string connection tokens scoped to dev
profiles, `Secure` cookies outside loopback, and session profiles refusing
plaintext non-loopback binds, with the deployment-security contract named as
unowned and prerequisite. The stale non-syncable sentence was corrected to
describe `authScopeField`.

## Round 3 — 2026-07-12

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md`, working-tree revision of
2026-07-12 round 2 (sha256
`60ff321e70b747ad5744d84fa14f35d03eb913213afa63a9cbca278494fde416`).
**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1 (`codex exec`,
non-interactive), model `gpt-5.6-sol`, reasoning effort `ultra`, sandbox
`read-only`, approval `never`, workdir = repo root. Session id
`019f55cd-505b-7191-b782-b6537f287d5e`; 359,144 tokens used. Fresh session.
**Date:** 2026-07-12
**Redacted:** Same as earlier rounds.
**Method:** Same as earlier rounds — shared round-3 brief, blind to the
concurrent Claude-family round-3 review and to all archived reviews.

### Review body (verbatim)

## Overall assessment

This is a strong direction and an unusually thoughtful integration plan. Server-resolved authority, protected identity tables, session-bound connection capabilities, authorization epochs, fail-closed resubscription, and explicit capability gaps are the right architecture.

It is not ready yet. Several unresolved contracts can fail open or cannot be implemented as written: production dev-auth behind loopback proxies, incomplete permission declarations, logout clearing, one-deep refresh reuse detection, replay-fingerprint provenance, and authority enforcement across non-HTTP paths. The RFC also calls itself a small vertical slice, but it is really a coordinated program spanning manifests, routing, storage, replay, live transport, client persistence, permissions, and operations. That breadth is defensible, but its activation order and security barriers must be pinned more tightly.

## Strengths

- `§Authority resolution` correctly separates untrusted wire input, server-only resolved authority, and immutable handler projection. This directly addresses today’s defaulted `HandlerInput.auth` (`src/manifest.rs:912-941`) and avoids colliding with the unrelated ephemeral `AuthContext` (`src/ephemeral.rs:213-243`).

- `§Protected identity core` draws the right boundary between secret-bearing `_auth_*` state and app-visible profile/membership data. Keeping auth writes out of `_snapback_changes`, generated client types, and app commit versions is safer than pretending credentials are ordinary syncable rows.

- `§Session transport and connection binding` builds on the actual shipped connection guard instead of redesigning it from stale premises. The server already mints and constant-time-checks `connectionToken` grants (`src/server.rs:313-400`); binding those grants to session authority is the natural next step.

- `§Permission dependencies` accurately describes the shipped `ValueExpr::AuthUserId`, `SNAPBACK_AUTH_USER_MISSING`, raw `Arg` scope behavior, and the existing permission-epoch machinery (`src/value_expr.rs:117-126`, `src/local.rs:3981-4050`). The actor-versus-subject explanation is especially valuable.

- The fail-closed client requirement is correct and candid about current behavior: the server emits `clear_retained: true` (`src/local.rs:3652-3659`), while the kit currently resubscribes without first clearing rows (`demos/_kit/client.mjs:773-815`).

- `§Diagnostics and route registry` correctly identifies that the router and registry are separate literals and that current tests validate only registry consistency (`src/server.rs:515-576`, `629-723`, `2771-2831`). Requiring centralized policy enforcement and router parity is a substantial improvement.

- Introducing `AdminSecretRead` is the right correction. Current `AdminRead` intentionally permits tokenless loopback reads (`src/admin.rs:534-563`), which is unsuitable for a mailbox containing login codes.

- The acceptance plan is strong: concurrent challenge exchange, concurrent first-login provisioning, generated interleavings, two-client visibility differences, negative write cases, restart-during-quarantine, redaction sentinels, and deadline-driven session expiry are the right proofs.

## Concerns

1. **HIGH — The auth-mode matrix permits production dev-auth through an ordinary reverse proxy, and mode activation is not defined.**

   `§Authority resolution` defaults absent `auth.mode` to `dev` and permits `prod + dev` when Snapback itself binds loopback. A self-hosted deployment commonly binds the backend to `127.0.0.1` behind a public TLS-terminating proxy; that topology would expose the client-asserted body-auth behavior the RFC retains. This conflicts with LLP 0009’s self-hosted threat model. Current profile resolution explicitly allows `SNAPBACK_PROFILE=prod` on loopback (`src/admin.rs:103-119`).

   “App manifest” is also not an existing server-loaded artifact. The persisted artifact is `SchemaManifest` (`src/manifest.rs:63-106`), and schema application can occur live (`src/storage.rs:463-490`). The RFC does not say how a dev→sessions transition handles existing unbound grants, subscriptions, outboxes, or in-flight body-auth operations. Its dynamic `authMode` and retained-read facts also need reconciliation with the currently static target capability manifest (`src/manifest.rs:1094-1192`, `1235-1333`).

   *Resolves with:* Make `prod + dev auth` refuse all app-data traffic regardless of bind address, absent an explicitly named unsafe local override. Name the exact artifact containing `auth.mode`, its hashing and persistence rules, and either make mode startup-immutable or define an atomic transition barrier that invalidates legacy authority state before session traffic resumes. Pin where effective, app-specific capability facts live.

2. **HIGH — The “conservative fallback” remains fail-open for the most likely declaration mistakes.**

   `§Permission dependencies` globally bumps only when a table is marked `permissionBacking: true` and the mutation declares no precise bumps. Omitting the table marker, declaring only some affected subjects, using `AuthUser` instead of the subject argument, or supplying a wrong non-empty scope disables the fallback while leaving stale authorized rows visible. The RFC itself demonstrates that actor/subject mistake immediately before claiming the fallback is conservative.

   This contradicts LLP 0020’s requirement that unknown permission impact be conservative (`llp/0020-core-authoring-surface.plan.md:408-433`). Current implementation trusts exactly the declared scopes (`src/local.rs:1380-1423`, `4003-4050`).

   *Resolves with:* In v1, coarse-bump on actual committed writes by default and treat precise scopes as an additional optimization, not an opt-out, until completeness can be machine-proven. Alternatively derive affected permission dependencies from captured reads/rules and old/new rows. Add negative acceptance for a missing table marker, a wrong non-empty scope, and a partial multi-subject declaration.

3. **HIGH — Logout, expiry, and authenticated→anonymous transitions do not explicitly clear client data.**

   The fail-closed rule is phrased around `resync_required`, while session expiry and logout use an auth-error frame followed by socket close. The lifecycle matrix covers anonymous→authenticated and authenticated→different-user, but omits authenticated→anonymous. Suppressing reconnect does not itself remove rendered rows or durable queued mutations.

   LLP 0011 explicitly connects the full local-data wipe to sign-out and session cleanup (`llp/0011-auth-and-permissions.rfc.md:257-264`, `322-323`). Today the kit keeps `handle.rows` until a fresh snapshot lands and treats socket loss as reconnect/resubscribe demand (`demos/_kit/client.mjs:808-815`, `900-951`).

   *Resolves with:* Add an explicit authority-transition matrix. Logout, expiry, revocation, and boot with an invalid persisted session must synchronously blank auth-scoped in-memory results, stop polling/reconnect loops, invalidate cached grants, and wipe or quarantine retained rows and pending mutations before control returns to the UI. Test lost auth-error frames and process restart during cleanup.

4. **HIGH — One-deep refresh state cannot implement the promised reuse revocation.**

   `_auth_sessions` retains only the current hash and one `prev_token_hash`, but `§Built-in first provider` promises that any superseded bearer used outside the grace window revokes the session. After A→B→C, A’s hash has been overwritten; presenting A cannot identify which current session should be revoked.

   The `REFRESH_SUPERSEDED` recovery also assumes the racing tab already has the successor. That is false after a lost winner response and may be false before cross-tab coordination completes.

   *Resolves with:* Retain bounded token-family tombstones for every issued token until absolute expiry, or use a family-identifying selector/verifier construction that can attribute old-token reuse. Specify lost-response recovery—either safely reissue the successor, deterministically derive it, or require reauthentication—and test N-2/N-3 token reuse plus a lost successful refresh response.

5. **HIGH — The replay-fingerprint contract conflicts with authority resolution and LLP 0051’s wire split.**

   Fingerprint v1 is required from optimistic recording through first server delivery, yet an offline client cannot compute something literally derived from the contemporaneous server-resolved authority unless the server previously issued a stable descriptor. LLP 0051 D1 explicitly says auth context and fingerprint do not cross the replay wire (`llp/0051-language-neutral-data-tier.rfc.md:280-290`). Current record outputs leave it unset, while the Contract store derives it from client `userId` (`src/manifest.rs:1034-1057`, `packages/snapback-contract/index.mjs:314-324`).

   Diagnostic precedence also conflicts: a revoked bearer should fail authority resolution with `SESSION_EXPIRED`, while the acceptance section expects `STALE_RESULT` on first delivery after logout. The proposed fingerprint tuple excludes session generation, so logout itself does not change that tuple. The session-scoped versus user-scoped decision is still open despite defining wire behavior.

   *Resolves with:* Define a concrete server-issued authority-incarnation/fingerprint channel and amend LLP 0051 as well as LLP 0012. State that it is a consistency input, never authentication. Pin diagnostic precedence: invalid old credential → `SESSION_EXPIRED`; delivery under a different valid authority → `STALE_RESULT`. Settle session-scoped versus user-scoped replay before freezing v1.

6. **HIGH — There is not yet one complete authority-enforcement boundary across all invocation paths and wire carriers.**

   The RFC says body auth is rejected rather than ignored, but later says ephemeral identity is overwritten and client permissions are ignored. Existing ConnectionAuth bodies carry nested `HandlerInput.auth`, separate resume/unsubscribe auth, ephemeral `AuthContext.permissions`, and outer `session_id`/`user_id` fields (`src/local.rs:300-356`, `src/ephemeral.rs:321-351`). The proposed registry sweep covers only `AppAuth`, not ConnectionAuth or WebSocket operations.

   `authRequirement` also needs to apply at the shared invocation layer, not merely HTTP middleware: functions run through read-lane calls, host operations, cron, actions, and nested `ctx.runMutation`. The current direct admin function runner still dynamically treats queries as `AdminRead`, permitting tokenless loopback query execution with body auth (`src/admin.rs:854-883`). Finally, the proposed bound grant and memory projection omit `provider`, although ConnectionAuth handlers must receive the same `ctx.auth` projection as ordinary handlers.

   *Resolves with:* Introduce one shared invocation-authority gate used by every entry path. Define session-mode request types that contain no client-auth fields, or explicitly reject every such field before constructing internal requests. Make direct admin aliases obey registry policy or retire them. Expand acceptance across every AppAuth/ConnectionAuth HTTP route, all socket operations, host ops, cron, and nested mutation calls. Store enough immutable projection data—including provider—in the grant or session projection.

7. **MEDIUM — Permission epochs lack durable, crash-safe incarnation semantics.**

   The current epoch map is process memory, is advanced after the app-data commit, and is cleared on reset (`src/local.rs:819-836`, `991-1004`, `3607-3623`). Resume compares numeric equality (`src/local.rs:3700-3719`). A permission-changing write followed by a crash before the bump, or a 0→1→restart→0 ABA sequence, can make a retained epoch appear current unless another mechanism always forces a snapshot.

   This is incompatible with the RFC’s eventual durable retained-read contract and LLP 0043’s requirement to retain authorization epochs.

   *Resolves with:* Persist permission/global epochs transactionally with the permission-affecting write, or pair every epoch with a durable/random authorization-stream incarnation that changes on restart and forces resnapshot. Add crash-between-write-and-bump and revoke→restart-before-reconnect acceptance cases.

8. **MEDIUM — Cookie mode and Public credential behavior are incomplete and internally inconsistent.**

   Origin enforcement is triggered only when an incoming credential arrived via cookie, but `/auth/exchange` is where the cookie is initially issued. That leaves login/session-overwrite CSRF uncovered. Cookie name, transport selection, `Path=/`, host-only/Domain posture, expiry, deletion, and missing-Origin behavior are unpinned.

   Separately, global precedence says any invalid presented credential errors, while function-level `public` skips resolution and `GET /auth/session` is described as “Public, optional-user.” Current `RouteSpec` has only one policy axis (`src/server.rs:612-619`). A stale automatic cookie could therefore either block re-login or be silently ignored, depending on implementation.

   *Resolves with:* Prefer removing cookie mode from the bearer-only first slice. Otherwise define separate access and credential-resolution axes such as `ignore | optional | required | refresh`, and fully specify cookie issuance/clearing and Origin enforcement on every cookie-creating or cookie-mutating endpoint.

9. **MEDIUM — Public connection grants need bounds, and their security guarantee is overstated.**

   LLP 0031 accepted process-lifetime, unreaped grants only under trusted-local posture (`llp/0031-server-route-taxonomy.spec.md:508-515`). This RFC retains Public `/connection/open`; anonymous grants have no session deadline and can grow memory indefinitely from any allowed localhost origin.

   The statement that a token “presented under another authority” is rejected is also not meaningful for token-only outbox/WebSocket operations. Possession is deliberately sufficient; there is no second caller authority to compare. A stolen connection token acts with its bound attenuated authority.

   *Resolves with:* Add idle expiry, global/per-session/per-source caps, throttling, and typed overload refusal, especially for anonymous grants. Describe the token honestly as a delegated bearer. Rewrite acceptance to prove token A cannot address connection B, unless a second proof-of-authority is deliberately added.

10. **MEDIUM — System-catalog and keyring lifecycle is not complete enough for protected auth state.**

   The collision diagnosis is good, but its recovery is inoperable as written: the RFC correctly notes schema application is additive and dropped tables remain, then recommends renaming the schema declaration and reapplying. Reapplication cannot remove the old physical `_auth_*` table (`src/storage.rs:463-490`).

   The catalog also needs a durable ownership/version marker, migrations, validation, GC for expired sessions/challenges, and logical-import conflict semantics. The external pepper keyring needs atomic rotation, missing/corrupt behavior, in-memory-instance placement, restore rules, and coordination with physical database backups; copying only SQLite does not copy that keyring.

   *Resolves with:* Specify export→fresh-database→apply→import, or a privileged physical rename migration. Add a versioned auth-catalog marker and migration/GC policy. Define an internal system-keyring contract with atomic replacement, fail-closed recovery, key-before-challenge rotation ordering, and explicit instance-directory backup/restore semantics.

11. **MEDIUM — The “full v1 request-path table” is not complete and overloads existing diagnostics.**

   There is no stable result for wrong, unknown, expired, consumed, or superseded verification codes, nor cookie-Origin denial. `AUTH_REQUIRED` is also used for forbidden body auth even when a valid bearer may be present, contradicting its stated meaning and “after login” retry advice. `STALE_RESULT` says retry after refresh even though refresh preserves the session-scoped fingerprint.

   App actions currently return handler failures inside HTTP-200 `FunctionRunResult` envelopes (`src/server.rs:1988-2004`), so a handler-generated `AUTH_PERMISSION_DENIED` cannot automatically obey the proposed 403 table.

   *Resolves with:* Add a uniform non-enumerating `SNAPBACK_AUTH_CODE_INVALID` outcome, a distinct body-auth compatibility error, and an Origin/CSRF code. Pin malformed-credential outcomes and action-envelope behavior. Mark fixed fingerprint mismatches as discard/re-record or explicit-user-decision cases, not automatic refresh retries.

12. **MEDIUM — `PermissionScopeExpr::User(inner)` has ambiguous backward-compatible semantics.**

   Existing `AuthUser` already evaluates to `user:<id>`, while `Arg` and `Literal` return raw strings (`src/manifest.rs:327-332`, `src/local.rs:4014-4050`). A literal implementation of `User(AuthUser)` would produce `user:user:<id>`.

   *Resolves with:* Introduce an unprefixed `PermissionSubjectExpr` such as `AuthUserId | Arg | Literal`, nested under `User`, while preserving legacy bare `AuthUser` serialization and meaning. Add manifest round-trip and evaluation tests for every old and new form.

13. **LOW — Several descriptions of current code remain stale or too broad.**

   “Every app-data route” does not carry `HandlerInput.auth`; public health, inspect, ensure, and connection-open routes do not. Live ownership compares client-supplied `principal` and `user_id`, but not `session_id` (`src/local.rs:1604-1608`, `1706-1709`, `1780-1783`). Codegen reserves `_snapback` only for table names, while storage applies its check to table/field/index names (`packages/snapback-codegen/index.mjs:289-307`, `src/storage.rs:1627-1668`). The existing host-ops request carries only `userId`; the claimed `--as-role` implementation is not present (`src/host_ops.rs:203-224`, `510-522`).

   *Resolves with:* Correct the baseline prose and list unbuilt role support, full authority tuples, and broader codegen validation as explicit deliverables rather than shipped facts.

## Suggestions

- Make session mode startup-only for v1. Requiring a restart to change auth mode would eliminate a large class of transition races while the rest of the system matures.

- Model retained authorization as an atomically switched namespace or lease. On logout/revocation, persist a new active-authority pointer first; old rows become immediately unreachable and can be garbage-collected asynchronously instead of requiring synchronous physical deletion.

- Reuse captured read dependencies to derive conservative permission invalidation. An auth-dependent subscription that read a membership table can be indexed against that table automatically, reducing reliance on `permissionBacking` annotations.

- Narrow the first implementation by deferring cookie mode and roleful impersonation. Bearer sessions, local capture, handler authorization, and two-user partial sync already form a substantial proof.

- Either add one real email-delivery adapter or narrow the Summary’s claim to a local multi-user auth proof. An admin-only capture mailbox does not yet let ordinary deployed users receive login codes.

- Replace FNV-1a in fingerprint v1 with a versioned, length-delimited SHA-256 or BLAKE3 encoding and commit cross-language test vectors.

## Open questions

- Is `prod + auth.mode: "dev"` ever legitimate, or should it be categorically refused?

- Which exact artifact owns `auth.mode`, and are mode changes restart-only or hot-applied?

- What constitutes a machine-checkable proof that precise permission bumps cover every affected subject?

- Are queued mutations session-incarnation-scoped or user-scoped after reauthentication? This must be settled before fingerprint v1 is frozen.

- What is the required behavior after a successful refresh response is lost and no client retains the successor bearer?

- Does cookie mode remain in v1, and if so, what complete cookie and Origin/CSRF contract applies to issuance, rotation, use, and deletion?

- Which authority satisfies `authRequirement` for cron, nested `ctx.runMutation`, host-ops impersonation, and admin bypass?

- Are permission epochs durable counters or `(incarnation, counter)` pairs?

- What is the supported logical-import posture: empty target only, stable user-id preservation, identity-collision rejection, and no imported sessions?

- Is local capture deliberately the only delivery path for this slice, or is a real email adapter required before claiming same-origin deployment support?

## Readiness verdict

Verdict: NOT READY

The proposal has the right architecture and unusually good acceptance instincts, but unresolved high-severity issues remain in production mode safety, permission invalidation, client clearing, refresh reuse detection, replay authority, and enforcement coverage. Resolving those contracts would make this a strong implementation RFC; accepting the current text would leave security-critical behavior to implementation inference.
### Orchestrator verification notes — round 3 (outside the verbatim body)

Spot-checked before revising; the decisive claims verify:

- The direct admin function runner classifies queries as reads and
  authorizes them under loopback-open `AdminRead` semantics while accepting a
  body `HandlerInput` (`admin_run_function`, `src/admin.rs:854-884`) — a real
  session-mode bypass unless it obeys the same gate.
- LLP 0051 D1 pins the ledger wire split as settled ("auth context +
  fingerprint — crosses the wire: no; server-retained: yes, checked at
  replay"), confirming both that the round-2 sentence was wrong and that a
  server-issued descriptor channel needs an explicit 0051 amendment.
- LLP 0020's shape is verbatim "declared by function metadata or table
  permission metadata; unknown permission impact is conservative" — the
  `permissionBacking` concept matches 0020's own vocabulary, and the
  fail-open-one-level-up critique stands.
- Host-ops requests carry only `userId` (`src/host_ops.rs:203-224`,
  `510-522`) — `--as-role` is 0024-specified, not implemented; the round-2
  prose implied otherwise.
- LLP 0031 accepts process-lifetime unreaped grants explicitly "under the
  trusted-local posture … revisit if grants ever carry more than two small
  strings" (`llp/0031:508-515`) — this slice's authority-carrying grants
  trigger that revisit condition, supporting the bounds concern.
- `resume_requires_resnapshot` compares captured vs current epochs
  numerically (`src/local.rs:3700-3719`), epochs live in process memory and
  clear on reset — the ABA/crash concern is real for durable retained reads.
- Actions return `FunctionRunResult` inside HTTP-200 envelopes
  (`src/server.rs:1988-2004`); live ownership compares `principal`/`user_id`
  but not `session_id` (`src/local.rs:1705-1710`); codegen's reservation
  covers table names while storage covers table/field/index names.

**Disposition (2026-07-12 revision 3):** concerns 1–13 addressed, largely by
narrowing v1 (per this review's own suggestions, convergent with the paired
Claude review): cookie mode removed from the slice; `auth.mode` homed in the
persisted schema manifest, startup-immutable, with `prod + dev` refusing
app-data traffic categorically and a fail-closed downgrade guard plus
transition table; the conservative fallback rebuilt to coarse-bump on
committed writes to auth-relevant tables (declared `permissionBacking` or
mechanically derived from auth-scoped read sets), with precise declarations
additive rather than opt-out in v1 and the omission lint a landing
requirement; the authority-transition matrix pins logout/expiry/revocation/
boot-invalid clearing; token-family tombstones (retained to absolute expiry,
then GC'd) replace one-deep rotation history, reuse response is tiered by
surface, and lost-refresh-response recovery is pinned as re-authentication;
the fingerprint section is rewritten around a server-issued, versioned
SHA-256 authority descriptor (a consistency input, never authentication)
with pinned `SESSION_EXPIRED`-before-`STALE_RESULT` precedence, the
session-scoped decision settled for v1, and named 0051/0012 amendments; one
shared invocation-authority gate is pinned across HTTP, WS operations,
host-ops (including the direct admin runner), cron (system authority;
`authenticated` functions cannot be cron entries), actions, and nested
calls, with the registry sweep extended to ConnectionAuth and socket
operations and `provider` added to the bound-authority snapshot; permission
epochs become durable-in-transaction with a reset-scoped incarnation;
connection grants gain idle expiry, caps, and typed overload refusal, and
the token is described as a delegated bearer with the acceptance rewritten
to what it proves; catalog recovery is corrected to export→fresh-database→
import, with a versioned auth-catalog marker, GC policy, and a keyring
contract (atomic replace, fail-closed missing/corrupt behavior,
key-before-challenge rotation, instance-dir backup semantics);
`SNAPBACK_AUTH_CODE_INVALID` and `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED` are
added with malformed-credential and action-envelope behavior pinned and the
`STALE_RESULT` retry column corrected; `PermissionScopeExpr::User` is
re-specified over an unprefixed `PermissionSubjectExpr` with legacy
`AuthUser` preserved and round-trip tests; stale/broad baseline prose is
corrected (function routes vs all routes, no `session_id` in live ownership,
codegen-vs-storage reservation scopes, `--as-role` unbuilt). Suggestions
adopted: startup-only mode, bearer-only v1, SHA-256 fingerprint with
cross-language vectors, capture-only claim narrowed in Summary; the
lease-namespace retained-auth model and read-dependency-derived invalidation
are folded into the fallback/lease designs.

## Round 4 — 2026-07-12

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md`, working-tree revision of
2026-07-12 round 3 (sha256
`7d48ddc1b991b95ed89a125afec15602d660747ea308da5114c7d683bb77206a`).
**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1 (`codex exec`,
non-interactive), model `gpt-5.6-sol`, reasoning effort `ultra`, sandbox
`read-only`, approval `never`, workdir = repo root. Session id
`019f55e6-d27e-7d22-95bf-fa95687eb8cb`; 349,297 tokens used. Fresh session.
**Date:** 2026-07-12
**Redacted:** Same as earlier rounds.
**Method:** Same as earlier rounds — shared round-4 brief, blind to the
concurrent Claude-family round-4 review and to all archived reviews.

### Review body (verbatim)

## Overall assessment

The proposal has the right architectural center: server-resolved authority, one handler projection, protected identity state, bearer-only transport, and authorization-aware sync. It is a good idea and substantially better specified than most first-auth designs.

It is not ready to implement as a stable RFC. The current text knowingly permits an authorization false negative, lacks an executable auth-mode transition, and treats a superseded credential as an expired session even when the session remains valid. Several wire, persistence, and administrative boundaries are also not closed enough to support the proposal’s safety claims.

## Strengths

- The separation among untrusted wire input, server-only resolved authority, and immutable `ctx.auth` is excellent. The “one gate, every path” inventory correctly recognizes that HTTP middleware alone cannot cover read-lane queries, actions, cron, host-ops, and nested calls ([LLP 0039 §Authority resolution](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:125)).

- The current-code baseline is unusually accurate. `ConnectionAuth` and the server-minted `connectionToken` guard do exist ([src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:299)); `ValueExpr::AuthUserId` and `SNAPBACK_AUTH_USER_MISSING` behave as described ([src/value_expr.rs](/Users/ccheever/projects/snapback/src/value_expr.rs:117)); and the existing `PermissionScopeExpr::AuthUser` versus raw `Arg`/`Literal` asymmetry is real ([src/local.rs](/Users/ccheever/projects/snapback/src/local.rs:4014)).

- The protected identity-core boundary is well chosen: `_auth_*` is server-owned, excluded from ordinary generated types and sync, and paired with app-owned profile/membership rows. The journal, logical-export, physical-backup, and redaction distinctions align well with LLP 0011 and LLP 0036 ([LLP 0039 §Protected identity core](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:316)).

- Bearer-only transport is disciplined scope control. Deferring cookies together with their Origin, login-CSRF, issuance, and deletion contract is the correct decision ([LLP 0039 §Session transport and connection binding](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:533)).

- The provider state machines contain several strong decisions: keyed low-entropy code digests, transactional first-login provisioning, compare-and-consume, token-family tombstones, explicit lost-refresh-response behavior, and generated interleaving tests ([LLP 0039 §Built-in first provider](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:419)).

- Durable transactional authorization epochs, reset/import incarnation changes, and synchronous clearing before resubscription are the correct target. The RFC also accurately identifies that the shipped kit currently ignores `clear_retained` and keeps old rows until resubscription completes ([LLP 0039 §Permission dependencies](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:742); [demos/_kit/client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:773)).

- The acceptance section is exceptionally valuable. It covers negative authorization, concurrency, token reuse, redaction, crash boundaries, route parity, and cross-user visibility rather than stopping at a happy-path login demo.

## Concerns

1. **HIGH — Permission invalidation is knowingly fail-open.**

   A subject-bearing declaration suppresses the coarse global epoch even though the RFC explicitly admits that a wrong or partial subject can then miss revocation ([LLP 0039 §Conservative fallback](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:726)). That contradicts LLP 0008’s rule that false positives are acceptable but false negatives are correctness bugs ([LLP 0008 §Reactivity and Read Sets](/Users/ccheever/projects/snapback/llp/0008-local-first-sync-and-realtime.rfc.md:161)) and LLP 0011’s ratified fail-closed resubscription contract ([LLP 0011 §Local-First and Realtime Implications](/Users/ccheever/projects/snapback/llp/0011-auth-and-permissions.rfc.md:232)).

   A second false-negative path exists unless specified otherwise: auth-relevant tables may be learned from captured subscription reads, but the RFC does not persist that derived catalog. A restart followed by a membership write before subscriptions are reconstructed can miss the coarse bump. Current captured subscriptions and epochs are process memory ([src/local.rs](/Users/ccheever/projects/snapback/src/local.rs:835)).

   *Resolves with:* Do not suppress the durable coarse epoch until complete affected-subject coverage is mechanically proved. Initially, targeted scopes should be additive hints beside a coarse bump. Persist and version any runtime-derived auth-relevance facts, or regenerate the authorization incarnation whenever those facts may have been lost. Add tests for partial declarations and restart → write-before-resubscribe.

2. **HIGH — The auth-mode transition is not executable through the current lifecycle, and the mode matrix still permits exposed client-asserted auth.**

   The RFC makes `auth.mode` startup-immutable and stores it in the persisted schema manifest ([LLP 0039 §Auth mode](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:174)). Current startup only opens the database and reloads the already-persisted manifest; it accepts no source manifest ([src/cli.rs](/Users/ccheever/projects/snapback/src/cli.rs:456); [src/storage.rs](/Users/ccheever/projects/snapback/src/storage.rs:227)). The only update path hot-applies and immediately persists a manifest ([src/storage.rs](/Users/ccheever/projects/snapback/src/storage.rs:463)). Rejecting a hot mode change therefore leaves restart loading the old mode; accepting it violates startup immutability. Fresh and `--memory` session apps have no defined activation path.

   Separately, the matrix leaves client-asserted dev auth unchanged in `dev`, `test`, and `demo`, despite calling it `localDevOnly`. Profiles are not bind boundaries: an explicitly selected `demo` profile is accepted on non-loopback binds ([src/admin.rs](/Users/ccheever/projects/snapback/src/admin.rs:68)). The plaintext non-loopback refusal applies only to session mode.

   *Resolves with:* Define a pre-bind startup manifest or an offline/staged transition consumed before readiness, with active-versus-desired runtime facts and live mode changes rejected or staged. Require loopback for all client-asserted auth regardless of profile, absent a separately named dangerous override. Also pin whether misconfigured `prod + dev` fails startup or preserves public health/readiness while refusing actual app operations.

3. **HIGH — A superseded ordinary bearer is classified as session expiry even though the session remains healthy.**

   The RFC says ordinary requests legitimately race rotation well beyond the grace window, but then maps an old bearer outside ten seconds to `SESSION_EXPIRED` without revoking the session ([LLP 0039 §Sessions, refresh, and reuse](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:486)). That diagnostic fires destructive authority-loss clearing ([LLP 0039 §Authority-transition matrix](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:628)). A sleeping tab can therefore wipe valid state and demand reauthentication while another tab holds the successor and the bound connections remain valid.

   The matrix also omits authenticated session A → authenticated session B for the same user. Because the replay descriptor is session-scoped, this transition still strands queues and requires a fresh connection. Finally, `/connection/open` should not let a grace-period N-1 bearer mint a delegated grant that outlives the bearer’s grace window.

   *Resolves with:* Add a distinct superseded-credential outcome for ordinary requests. The client should atomically reload shared custody and retry once when a successor belongs to the same session/generation; only the absence or invalidity of that successor becomes true expiry and clearing. Require the current bearer for connection capability issuance, and add an explicit same-user/new-session transition. Test a tab waking after the grace window.

4. **MEDIUM — The authority descriptor is an intention, not yet an enforceable wire contract.**

   The RFC does not specify the descriptor’s request field, whether it is mandatory, or how omission, legacy values, and unknown versions fail ([LLP 0039 §Replay parity](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:289)). Current `MutationRequest` contains only flattened `HandlerInput` and `clientMutationId` ([src/manifest.rs](/Users/ccheever/projects/snapback/src/manifest.rs:943)); the client store is version 1 and keeps a userId-derived FNV scope ([client-store.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/client-store.mjs:25)).

   The statement that the wire ledger “never carries” an auth fingerprint is also too strong. Server-produced ledgers leave it unset, but `CtxAnswerLedger.auth_fingerprint` is publicly deserializable and consumed by both replay paths ([src/manifest.rs](/Users/ccheever/projects/snapback/src/manifest.rs:994); [src/storage.rs](/Users/ccheever/projects/snapback/src/storage.rs:2817)). Conversely, “nothing guards” first delivery overlooks the client store’s local userId-scoping; what is absent is a server-authoritative first-delivery guard.

   *Resolves with:* Pin a dedicated `MutationRequest` field outside the client ledger, mandatory rules for session-mode queued/idempotent delivery, exact omission/version diagnostics, and a store-version migration that quarantines legacy rows and queues. Split internal retained-ledger state from the public wire type or reject the legacy fingerprint member at public ingress.

5. **MEDIUM — The shared invocation gate lacks a coherent authority-policy matrix and an enforceable inventory.**

   Several rules conflict or remain unstated:

   - A presented invalid bearer always errors, but `public` skips credential resolution ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:212), [LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:821)).
   - `/connection/open` needs optional session resolution, yet the current route is `Public` and the proposed route table omits it ([src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:648)).
   - `SessionAuth` must let refresh distinguish current and superseded family tokens before generic rejection.
   - `adminBypass` is mapped to LLP 0024’s local/dev-only `devAdminBypass`, but the direct runner is assigned it without a prod rule; it also carries no user, so its interaction with `authenticated` and handler-level checks is unclear ([LLP 0024 §Authority Tuple](/Users/ccheever/projects/snapback/llp/0024-agent-operating-surface.spec.md:230)).
   - The acceptance sweep over `AppAuth` and `ConnectionAuth` cannot include the direct runner, which is registered `AdminWrite` and separately deserializes `HandlerInput` ([src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:685); [src/admin.rs](/Users/ccheever/projects/snapback/src/admin.rs:854)).

   *Resolves with:* Add a normative matrix over every invocation entry point and every credential state, including `None`/legacy `authRequirement` semantics. Give registry entries independent path-policy, credential-resolution, invocation-authority, and legacy-body-input metadata. Define whether prod direct execution is refused or uses a distinct scoped operator authority, and test the shared gate through every actual call path.

6. **MEDIUM — Epoch incarnation and durable clearing lack complete wire, migration, and ownership contracts.**

   The RFC changes resume comparison from numeric epochs to `(incarnation, epoch)`, but current subscribe/resume schemas carry numeric maps only ([src/local.rs](/Users/ccheever/projects/snapback/src/local.rs:313)). The LLP 0012 registration list does not mention this migration.

   The document also calls query-scoped quarantine/delete “0043’s contract,” but LLP 0043 specifies stored authorization epochs and whole-auth-context wiping, not that primitive ([LLP 0043 §Client store](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:55); [LLP 0043 §Auth posture](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:133)). “Landing prerequisite” conflicts with the fallback statement that session mode can land with retained reads disabled.

   Finally, a remote revocation cannot erase a genuinely offline copy until the client reconnects. Query-scoped deletion only closes restart-after-observed-invalidation, not unobserved offline revocation.

   *Resolves with:* Pin the subscribe/resume/store schema, make missing incarnation force resnapshot, and define legacy-store migration. Amend LLP 0043 or own the query-scoped primitive here, and state whether it gates the whole slice or only retained reads. Explicitly distinguish observed from unobserved revocation and, if bounded offline revocation is required, define an authorization lease such as `authorizedUntil`.

7. **MEDIUM — The only `_auth_*` collision recovery is not executable as specified.**

   Recovery is “logical export → fresh database → renamed schema → import” ([LLP 0039 §Existing databases](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:358)), but logical export/import is not implemented in the current server, host-ops, or admin client. LLP 0007 calls atomic logical import an unsolved first-class problem ([LLP 0007 §Export and Engine Graduation](/Users/ccheever/projects/snapback/llp/0007-storage-portability.spec.md:413)), and LLP 0046 remains a design.

   The mapping is also missing: an export containing a foreign app table named `_auth_users` cannot simply import into a fresh database whose app schema renamed that table.

   *Resolves with:* Either make a concrete, atomic logical export/import tool an explicit dependency/deliverable or gate this slice on its prior landing. Specify ownership-aware handling of foreign `_auth_*` tables and an explicit old-table → new-table mapping, then test the exact collision recovery end to end.

8. **MEDIUM — Sensitive auth inspection and capture-mailbox plaintext are not safely bounded.**

   The protected DTO excludes token hashes and code digests but does not state whether canonical email subjects or session metadata require `AdminSecretRead` ([LLP 0039 §Enforcement points](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:384)). Today admin data reads are tokenless on loopback, and localhost CORS accepts hostile local origins ([src/admin.rs](/Users/ccheever/projects/snapback/src/admin.rs:837); [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:1553)). Only the mailbox is explicitly assigned the stronger policy.

   The plaintext mailbox itself has no storage or lifecycle contract. LLP 0045 claims ownership but supplies only a bullet saying that local capture exists ([LLP 0045 §Channels](/Users/ccheever/projects/snapback/llp/0045-notifications-outbox.rfc.md:80)). Expiry, consumption, supersession, reset, backup, and capacity behavior are unspecified.

   *Resolves with:* Make identity inspection containing subjects or session metadata `AdminSecretRead`, or restrict tokenless inspection to aggregates. Prefer a bounded in-memory mailbox keyed to challenge, with TTL and consume/supersede/reset erasure and explicit exclusion from journals, exports, and backups. Add hostile-origin and plaintext-leak tests for both surfaces.

9. **MEDIUM — The in-memory session projection has no transaction linearization rule.**

   The proposal says session writes synchronously maintain the projection used by grant checks ([LLP 0039 §The validity check is memory-only](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:592)). If the projection changes after the durable revocation commits, a concurrent connection operation can pass between commit and projection update. If it changes before commit, rollback can invalidate or extend a session incorrectly. “Synchronous” does not identify the linearization point or lock ordering.

   *Resolves with:* Pin a protocol that makes session mutation and projection visibility one ordered boundary—for example, block projection readers across the short durable transition and publish the new projection before acknowledging the operation. Specify rollback/crash behavior and add races for logout/revoke/expiry versus outbox, live, and ephemeral operations.

10. **MEDIUM — Session-mode ephemeral input cannot currently represent the required omission.**

    The RFC rejects any client-supplied ephemeral `auth`, `session_id`, or `user_id` and derives identity from the connection ([LLP 0039 §Ephemeral rooms](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:644)). Current `PublishRequest`, `DeleteRequest`, and `SubscribeRequest` require `auth: AuthContext`, and those types are embedded directly in the schema-governed WebSocket input family ([src/ephemeral.rs](/Users/ccheever/projects/snapback/src/ephemeral.rs:321); [src/live_wire.rs](/Users/ccheever/projects/snapback/src/live_wire.rs:146)). Omitting the field therefore fails deserialization before authority can be injected.

    *Resolves with:* Define presence-aware, mode-dependent wire DTOs: dev mode accepts/requires the legacy shape; session mode permits omission and rejects presence, including explicit `null` if that is the rule. Register and version both HTTP and WebSocket client-input schema changes under LLP 0012 and test every legacy field in both modes.

11. **MEDIUM — `auth.mintSession` has no coherent identity provenance.**

    The verb may mint for a “named-or-created user” ([LLP 0039 §Dev impersonation](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:223)), but `_auth_sessions.identity_id` is required provenance and the handler projection’s provider comes from the identity. A newly created user has no email-code identity, so the required fields and projected provider are undefined.

    *Resolves with:* Require an existing identity/email, define a synthetic dev-only identity/provider, or make identity provenance explicitly nullable with an `issuedBy: admin` fact. Pin the verb’s input, output, audit record, and resulting `ctx.auth`.

## Suggestions

- Split this 1,111-line document into an umbrella RFC plus independently reviewable auth-core/provider, invocation/transport, permission-invalidation, and client-retention RFCs. These components have different dependencies and landing timelines; the LLP process guide explicitly recommends splitting large RFCs when that is true.

- Replace the cross-language SHA-256 tuple with an opaque random `authorityInstanceId` stored on the session and stable across refresh. It is only a consistency scope, not authentication; an opaque identifier makes that semantic clearer and removes canonicalization/versioning complexity.

- Run targeted epoch inference in shadow mode: always emit the safe coarse bump, compute the targeted subjects, and compare them with old/new-row-derived subjects in tests and diagnostics. Promote suppression only after evidence shows the proof is complete.

- Consider separate access and refresh bearers. A stable short-lived access token plus rotating refresh family removes much of the tiered “ordinary request versus refresh” ambiguity, though it adds custody surface.

- Domain-separate verification-code HMACs over at least the digest version, challenge id, canonical address, and code rather than `HMAC(code)` alone.

- Use a small state-machine model or exhaustive property harness for challenge, token-family, session-projection, and connection-grant transitions. The proposed generated interleaving tests are already close to this and should be retained.

## Open questions

- What exact mechanism installs or stages a new auth mode before the server binds and reports readiness?

- Is client-asserted dev auth categorically loopback-only, or is public demo impersonation intentionally supported as a non-security mode?

- What mechanical proof is sufficient before a targeted subject declaration may suppress the coarse authorization epoch?

- What is the recovery contract for an ordinary request using a superseded bearer when another tab possesses the current bearer?

- What is the precise wire carrier and client-store migration for the authority descriptor, and can it be simplified to an opaque session-scoped id?

- How do `public`, `optional-user`, `authenticated`, `system`, `adminBypass`, and invalid presented credentials compose on every invocation path?

- What does authenticated session A → authenticated session B for the same user do to connections, retained rows, and queued mutations?

- Are retained auth-scoped results allowed indefinitely while offline, or should high-sensitivity applications receive bounded authorization leases?

- Which deliverable owns atomic logical export/import and foreign `_auth_*` table renaming?

- Which auth-catalog fields may be inspected without an admin token, and where does plaintext capture-mailbox state live?

- What is the transaction/projection linearization point for logout, revoke, refresh, and expiry?

- What identity/provider does `auth.mintSession` create or reference?

## Readiness verdict

Verdict: NOT READY

The core direction is strong, but unresolved HIGH concerns permit missed permission revocation, leave auth-mode activation unsafe or impossible through the current lifecycle, and can destructively clear a still-valid session after ordinary token rotation. The descriptor, authority-policy, persistence, migration, and protected-inspection contracts also need concrete resolution before the proposal meets the stated correctness and safety bar.
### Orchestrator verification notes — round 4 (outside the verbatim body)

Spot-checked before revising; the decisive claims verify:

- Startup accepts no source manifest (`src/cli.rs:456+` opens/loads only);
  the sole schema-update path hot-applies and persists
  (`src/storage.rs:463`) — the round-3 "startup-immutable manifest mode" had
  no executable installation path as written.
- `MutationRequest` is flattened `HandlerInput` + `clientMutationId` +
  optional `ctx_ledger` (`src/manifest.rs:940-956`); the ledger's
  `auth_fingerprint` member is publicly deserializable and "checked at
  replay when present" (`src/manifest.rs:990-998`) — "the wire never carries
  it" was too strong, and the correct pin is session-mode ingress rejection.
- LLP 0008 pins "false positives are acceptable early; false negatives are
  correctness bugs" verbatim (`llp/0008:161-164`) — the round-3
  suppression-on-declaration trade violated it as argued.
- `/connection/open` is registered `Public` (`src/server.rs:648`) and was
  missing from the round-3 route table; the direct function runner is
  registered under the stronger write policy with dynamic read gating
  (`src/server.rs:685-688`), so an `AppAuth`/`ConnectionAuth`-scoped sweep
  would not cover it.
- Ephemeral `SubscribeRequest`/`PublishRequest`/`DeleteRequest` require
  `auth: AuthContext` and are embedded in the schema-governed WebSocket
  input family (`src/ephemeral.rs:321-351`, `src/live_wire.rs:144-150`) —
  "omit the field" cannot deserialize today; mode-dependent DTOs are needed.
- LLP 0007 records atomic logical import as unsolved first-class work; LLP
  0043 specifies stored epochs and whole-context wiping, not a query-scoped
  quarantine primitive; LLP 0045's capture-mailbox ownership is a design
  bullet — the round-3 attributions needed the corrections applied.
- `demo` profile selection is honored on non-loopback binds
  (`src/admin.rs:68-119`), so profile alone is not a bind boundary for
  client-asserted auth.

**Disposition (2026-07-12 revision 4):** all three HIGHs addressed — the
coarse global epoch is never suppressed in v1 (declared subject scopes are
additive targeted invalidation; suppression is the named machine-proof
graduation, with `permissionSubjectField` as the middle rung and shadow-mode
comparison adopted from this review's suggestion; the "unrelated users do
not resync" acceptance row is replaced accordingly, and restart windows are
covered by incarnation regeneration plus a load-time derivation floor); the
auth-mode lifecycle becomes executable (hot mode changes are rejected and
recorded as *desired*, consumed desired→active at next startup pre-bind;
active-vs-desired runtime facts; first-apply on an empty database may enable
sessions; client-asserted dev auth becomes loopback-only on every profile
absent an explicit dangerous override; `prod`+dev serves health/identity and
refuses app-data operations); superseded-ordinary-bearer handling gains the
distinct `SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED` outcome with
reload-custody-and-retry-once client obligation (only a missing/invalid
successor becomes expiry and clearing), `/connection/open` requires the
current bearer, and the same-user session A→B transition row is added.
MEDIUMs: the descriptor becomes an opaque per-session `authorityInstanceId`
(this review's suggestion — no canonicalization, no cross-language vectors)
carried in a dedicated versioned `MutationRequest` field with pinned
omission/legacy/unknown-version outcomes and a store-version migration that
quarantines legacy queues; session-mode ingress rejects the public ledger
fingerprint member; the invocation-policy matrix is added (per-entry-point ×
credential state, `public` validates presented credentials and skips only
the requirement, refresh family-token handling, `adminBypass` refused on
prod and projecting anonymous with an envelope audit fact, registry rows
gain independent axes plus a session-mode overlay so the sweep is
mechanical and includes the direct runner); epoch incarnation joins the
subscribe/resume/store schemas with missing-incarnation-forces-resnapshot
and 0012 registration, the quarantine primitive is owned here as a
deliverable 0043 adopts, and unobserved-offline revocation physics plus a
bounded-lease open question are stated; the collision recovery is restated
as an executable dev-mode procedure with an explicit destructive orphan-drop
flag (logical export/import demoted to a pinned future contract);
identity/session inspection with subjects requires `AdminSecretRead` with
tokenless loopback limited to aggregates, and the mailbox becomes a bounded
in-memory TTL store erased on consume/supersede/reset; the session
projection gains a pinned linearization (revocation-class writes hold the
grant lock across durable commit → projection swap; extensions
publish-then-flush; rebuild is under-extension-only, acceptance-tested);
ephemeral wire DTOs become mode-dependent and 0012-registered;
`auth.mintSession` takes an email and runs the normal provisioning path
(identity created/found, `verified_at` = mint time, `issuedBy: admin` audit
fact). Suggestions adopted: opaque descriptor, shadow-mode inference,
domain-separated code HMAC (version ‖ challenge id ‖ address ‖ code),
state-machine harness retained. Declined with reasons: splitting the
document mid-loop (the slice lands as one unit; the author may split at
acceptance — a Landing order section addresses sequencing); separate
access/refresh bearers (the tiered contract plus `CREDENTIAL_SUPERSEDED`
resolves the ambiguity without doubling custody surface).

## Round 5 — 2026-07-12

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md`, working-tree revision of
2026-07-12 round 4 (sha256
`8f9f1b588ebb7e1ba5441176f1aab9e13b00f351fdbc0654ed0553d74bb5e7ce`).
**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1 (`codex exec`,
non-interactive), model `gpt-5.6-sol`, reasoning effort `ultra`, sandbox
`read-only`, workdir = repo root. Session id
`019f5606-9b74-7243-9192-845cb8b64399`; 348,380 tokens used. Fresh session.
**Date:** 2026-07-12
**Redacted:** Same as earlier rounds.
**Method:** Same as earlier rounds — shared round-5 brief, blind to the
concurrent paired review and to all archived reviews under `llp/reviews/`.

### Review body (verbatim)

## Overall assessment

This is a strong direction and an unusually thoughtful security design. Server-derived authority, bearer-only transport, protected auth catalogs, connection binding, durable authorization epochs, and fail-closed retained-data handling are the right foundations. Most claims about current code are accurate.

It is not ready, however. Existing tokenless/public routes bypass the proposed session boundary; the must-understand and staged-mode mechanisms can still fail open or create mixed-mode execution; revocation linearization overclaims what the algorithm guarantees; and the authority-descriptor, client-clearing, and ephemeral-key contracts remain materially incomplete.

## Strengths

- The scope is candid and disciplined. §Summary and §Non-goals correctly limit v1 to the local Rust target, defer cookies with their CSRF/Origin contract, refuse plaintext non-loopback sessions, and name hosted deployment and XSS posture as unowned rather than implying safety.

- §Authority resolution correctly separates untrusted wire auth, internal resolved authority, and immutable `ctx.auth`, and places enforcement at the shared invocation layer. Rejecting legacy auth-bearing fields instead of silently ignoring them is the right migration posture.

- §Protected identity core draws the right boundary between protected `_auth_*` state and app-visible profile/membership data, consistent with LLP 0011 §Authentication Model. Excluding token hashes and code digests from `_snapback_changes`, generated types, sync, and ordinary inspection is well reasoned.

- §Built-in first provider contains several excellent decisions: keyed code digests, token-family tombstones, a distinct recoverable superseded-credential state, current-token-only connection delegation, explicit lost-refresh-response semantics, session caps, and capture-mailbox token gating.

- §Permission dependencies follows the ratified direction in LLP 0011 §Local-First and Realtime Implications and LLP 0008 §Authorization-Aware Sync: false negatives are unacceptable, authorization changes trigger server-directed resubscription, and retained data clears before recovery. The diagnosis of today’s process-memory epochs and ignored `clear_retained` field is accurate (`src/local.rs:835,1380-1423,3607-3719`; `demos/_kit/client.mjs:773-815`).

- The factual code inventory is generally strong. `ValueExpr::AuthUserId`, `PermissionScopeExpr::AuthUser`, `SNAPBACK_AUTH_USER_MISSING`, `SNAPBACK_AUTH_STALE_RESULT`, the room-shaped `ephemeral::AuthContext`, client-supplied ephemeral identity, and the server-minted connection-token guard all exist as described.

- §Landing order and §Acceptance are valuable. The document names companion amendments, negative tests, races, recovery behavior, and capability gaps rather than treating a successful login as sufficient proof.

## Concerns

1. **HIGH** — Existing routes bypass the proposed session boundary.

   §Authority resolution and §Diagnostics and route registry harden function entry, the direct runner, auth inspection, and client-auth-bearing fields, but omit two existing routes that defeat private data locally. `GET /_snapback/api/data/{table}` is `AdminRead` (`src/server.rs:681-691`), calls `authorize(..., false)`, then returns raw rows (`src/admin.rs:837-851`). Loopback reads are tokenless even when an admin token exists (`src/admin.rs:534-563`), and CORS reflects arbitrary loopback web origins (`src/server.rs:1553-1597`). Thus the hostile local page considered in §Built-in first provider can dump every private app table without a session.

   Separately, public `/app/ensure` (`src/server.rs:640-650`) can apply schemas and load executable function bundles under dev/demo/test profiles (`src/local.rs:1062-1112`). A hostile page can install a public function that reads the data session auth was meant to protect. This supersedes LLP 0017 §Security Defaults and is more serious than the RFC’s open question about “secret-adjacent” inspect/config reads.

   *Resolves with:* A complete existing-route × auth-mode matrix. In sessions mode, all raw app-data inspection must require the 0600-file admin capability, and unprivileged `/app/ensure` must be match/attestation-only; schema, function, and seed provisioning must require `AdminWrite` or pre-bind startup authority. Amend LLP 0017/0034 and add hostile-origin tests proving no raw-row read or provisioning occurs without the capability.

2. **HIGH** — The must-understand `auth.mode` rule is policy, not yet a fail-closed protocol.

   §Summary calls `auth.mode` a carve-out from LLP 0012’s evolution rule, but LLP 0012 §V0 Artifact Schema Pin explicitly requires old consumers to ignore additive fields. Current `SchemaManifest` deserialization accepts unknown fields (`src/manifest.rs:63-106`), and database open deserializes the stored manifest without even re-running artifact-version validation (`src/storage.rs:1368-1389`). The Cloudflare coordinator consumes schema tables while knowing nothing about auth mode (`cloudflare/src/coordinator.js:51-64`).

   Updated codegen/deploy tooling can protect its own paved path, but it cannot make an older loader, direct loader, or rolled-back binary understand a new same-version field. That leaves the precise fail-open path the RFC says it closes.

   *Resolves with:* A precursor compatibility mechanism understood and enforced by every target loader—such as a mandatory `requiredCapabilities` envelope or a new artifact/storage version—before any sessions manifest can be emitted. Runtime load, database reopen, Cloudflare build/deploy, direct host-ops load, and binary rollback must all reject unsupported session state. Tests must bypass normal deploy tooling deliberately.

3. **HIGH** — Staged activation creates a mixed-mode application, and the empty-database exception conflicts with pre-bind immutability.

   §Auth mode says the rest of the schema applies immediately while only the mode waits for restart. Function bundles are separately hot-loadable, so session-oriented schema/functions and clients can run while active mode remains `dev`. Conversely, a dev bundle can run while active mode remains `sessions`. The only active/desired facts are on the gated runtime-state surface.

   This also affects DTO selection and retained data. The current adapter enables offline behavior from static capabilities and can present retained rows without an active-mode handshake (`packages/snapback-contract/index.mjs:308-327,480-505`). Moreover, the server currently opens the database and binds before ordinary schema application (`src/cli.rs:456-513`), so “first apply to an empty database may activate sessions directly” occurs after the listener exists, contrary to the stated pre-bind rule.

   *Resolves with:* Either stage the entire coherent app artifact and refuse app-data while `desired != active`, or always require a managed restart for mode activation. Put active auth mode, client protocol/DTO version, and effective retained-read availability in an ordinary bootstrap response such as `GET /auth/session`, and require that handshake before stores render, connections open, or auth-bearing requests are constructed. If direct first activation remains, it must be AdminWrite-only and prove transport safety atomically.

4. **HIGH** — The revocation/rotation linearization algorithm does not establish its acceptance guarantee.

   §Session transport pins checking the projection under a small lock and holding that lock across durable revocation commit plus projection swap. That prevents checks inside the commit→swap gap, but it does not prevent:

   1. an operation checking and releasing the lock;
   2. revocation committing;
   3. the already-checked operation acting afterward.

   Current HTTP ephemeral paths have exactly this check-then-act shape (`src/server.rs:2516-2564`), while WebSocket frames validate only at upgrade and then operate directly (`src/server.rs:2082-2105,2284-2397`). Therefore §Acceptance’s “no connection-scoped operation can act … after revocation commits” is not achieved.

   The “existing small lock” is also one process-global synchronous mutex (`src/server.rs:313-400`). Holding it across SQLite commit would block unrelated async handlers waiting to verify connections. Refresh rotation needs the same atomic treatment: after its durable commit, the old token must cease being “current” before `/connection/open` can delegate authority.

   *Resolves with:* Pin the actual linearization point and semantics for pre-revocation in-flight work. Either weaken the guarantee and drain/clean such work, or use a nonblocking per-session read/exclusive lease held through the operation’s effect. Cover session creation, refresh/tombstoning, cap eviction, logout, revoke, and expiry with one atomic projection/token-index protocol. Test stalled commits, rollback, check→revoke→act, refresh→open, WebSocket frames, and unrelated-session responsiveness.

5. **HIGH** — The authority descriptor and client-store lifecycle are not closed contracts.

   §Replay parity does not define which exact request is “queued/replayable.” Current `MutationRequest` independently permits optional `clientMutationId` and `ctx_ledger` (`src/manifest.rs:919-963`). Nor does the RFC settle anonymous descriptor issuance, anonymous→login queues, whether `sessionGeneration` participates in comparison, or how dev-mode per-boot IDs interact with shipped replay across restart.

   The current store has one global auth fingerprint and wipes retained rows, pending mutations, and failures together on change (`packages/snapback-contract/client-store.mjs:53-103`). One axis cannot simultaneously implement:

   - same-user re-login preserving eligible user data;
   - old-session queued mutations becoming non-executable but still visible for discard/re-record;
   - different-user full wipe;
   - anonymous→authenticated preservation of public data but not silent replay of anonymous writes.

   The companion-document account is also stale: §Replay parity says LLP 0043 will adopt the rule “when it lands,” but LLP 0043 §Status says M1/M2 have already shipped. LLP 0051 D1 also still contains prose saying resolved auth is replayed from the ledger, conflicting with its landed server-retained fingerprint split.

   *Resolves with:* Define separate principal/data scope and authority-instance/queue scope; the exact descriptor-required request predicate; anonymous and dev descriptor lifetimes; every transition’s retained and queued-state outcome; compared descriptor fields; and duplicate-settlement behavior based only on server-derived authority. Add explicit LLP 0043 and 0051 amendments to §Companion obligations.

6. **HIGH** — Destructive client clearing lacks an atomic, causality-fenced coordinator.

   §Fail-closed client contract correctly demands clearing before resubscription, but it does not prevent a late terminal error from session A clearing a newer healthy session B. Every request and connection needs to remember the authority generation under which it started, and destructive handling must compare that value with current custody.

   Clearing retained rows is also insufficient by itself. The current Contract surface reapplies in-flight optimistic reducers whenever authoritative rows are written (`packages/snapback-contract/index.mjs:352-443`), so revoked or optimistic data can reappear after a nominal clear. Pending queues and live/ephemeral handles are separate state.

   *Resolves with:* A single client `AuthCoordinator` owning an atomic custody record and local monotonic epoch. Terminal handling must be `compareAndClear(expectedAuthority)`, becoming harmless against newer authority. Its clear barrier must blank live boundaries, disable callbacks/reconnect, remove or quarantine optimistic overlays and queues, commit durable quarantine, and only then expose state or resubscribe. Test delayed A errors after A→B, crashes during clearing, in-flight optimistic writes, failed resubscription, and multi-tab transitions.

7. **HIGH** — `AllowAll` plus custom ephemeral keys violates LLP 0013 and permits cross-user overwrite/delete.

   §Ephemeral rooms says all `AllowAll` collections work under session-bound identity and only `RequireRoomPermission` collections fail closed. LLP 0013 §Scope and keys, however, permits a custom key only when generated auth proves the publisher may write that key.

   Current key mode is independent of `AccessPolicy`; publish/delete accept an arbitrary `custom_key`, and delete checks only the room-level publish policy (`src/ephemeral.rs:321-351,1366-1387,2283-2363`). Under sessions, an authenticated or anonymous caller could therefore overwrite or delete another caller’s custom key in an `AllowAll` collection.

   *Resolves with:* Reject `KeyMode::Custom` at manifest load for session-enabled apps until key-level authorization exists, or specify and implement that authorization now. Add cross-user overwrite/delete negatives and narrow “AllowAll collections work” to the safe connection/session/user key modes.

8. **MEDIUM** — Coarse invalidation conflates ordinary result data with permission-policy data.

   §Conservative fallback makes every table read by an auth-scoped function auth-relevant and globally bumps on every write. The todo query is auth-scoped and reads `todos` (`demos/todo/snapback/functions.mjs:23-32`), so ordinary todo CRUD would clear/resubscribe every authenticated client. That contradicts the claim that permission-affecting writes are rare and creates an easy resync-DoS lever.

   Relatedly, `authScopeField` is not a generic “uses auth” declaration. Today it enables a semantic disjointness proof that the named row field equals the current user (`src/live_matcher.rs:126-151`). Reusing it for arbitrary raw `ctx.auth` usage can create incorrect skip decisions.

   *Resolves with:* Separate result-data dependencies from ACL/authorization-decision dependencies. Keep `authScopeField` narrowly defined and validated, and add an explicit `authDependencies`/`permissionDependencies` vocabulary. Unknown opaque authorization may conservatively lose retained/auth-resyncable capability, but routine writes to an auth-filtered result table should not automatically become global permission changes. Add race tests for runtime-discovered dependencies and prove every auth-scoped subscription captures the intended coarse epoch.

9. **MEDIUM** — Cross-tab refresh coordination is left open even though it is required for the pinned state machine.

   §Client custody assigns coordination to storage events, while §Open Questions asks whether something stronger is needed. Two tabs can refresh the same current token; the loser can receive `REFRESH_SUPERSEDED` before the winner has persisted the successor. A sleeping tab can likewise attempt refresh with a long-superseded token and revoke an otherwise healthy session.

   *Resolves with:* Pin an atomic custody record and mutual exclusion protocol—such as Web Locks plus BroadcastChannel with a bounded-lease fallback. Before every refresh, reload custody; after a superseded response, wait/reload for a bounded interval rather than reading once. Test delayed winner persistence, winner crash, lost response, sleeping tabs, and three-way concurrency.

## Suggestions

- Split implementation detail into subordinate RFCs/specs for provider/session storage, invocation/mode enforcement, client custody, and permission invalidation, while retaining LLP 0039 as the umbrella decision.

- Pin the request-code response shape. `exchange` requires `challengeId`, but §Request only says the first endpoint returns a non-enumerating response. Return an opaque challenge id for every accepted request and define expiry/retry fields.

- Specify unambiguous length-prefixed HMAC input encoding, token issuance/rotation timestamps, keyring format version, and atomic-write/fsync expectations.

- In sessions mode, reserve `Authorization` for session bearers and require `x-snapback-admin-token` for admin authority. Current admin authorization accepts either header (`src/admin.rs:628-647`), making precedence unnecessarily subtle.

- Split per-source rate limiting from global capacity exhaustion rather than mapping both to `SNAPBACK_OVERLOADED`.

- Make collision recovery executable under the new reserved-prefix enforcement: either state the required pre-upgrade/old-binary sequence or provide a privileged one-shot migration operation. New code cannot both forbid `_auth_*` access and expect an ordinary handler to copy from such a table.

- State whether physical restore invalidates all sessions. Restoring an older SQLite file can otherwise resurrect sessions revoked after the backup.

- Correct the diagnostics table’s live entry for `SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED`: a bound socket presents only its connection token, so no ordinary live-socket path currently encounters a superseded session bearer.

## Open questions

- What is the complete route-policy matrix in sessions mode, including raw data exploration, receipts, inspect, config status, `/app/ensure`, host-ops, and every WebSocket operation?

- What concrete artifact/storage mechanism makes `auth.mode` fail closed for older or alternate target loaders and binary rollback?

- Is an operation authorized at its validation point, or must all of its effects precede a completed revocation?

- Which auth facts scope retained query data, and which scope queued mutations? What happens to anonymous queues at login?

- Are session-sensitive retained queries prohibited, quarantined on every new session, or machine-proved to depend only on `userId`?

- What declaration or proof distinguishes ACL backing tables from ordinary auth-filtered result tables?

- Are custom-key ephemeral collections prohibited in session mode until key-level authorization exists?

- What exact cross-tab locking and custody protocol is the v1 requirement?

- Does restoring a physical backup preserve or invalidate sessions, authority instance ids, and token families?

- What response gives an ordinary client the `challengeId` needed by `/auth/exchange` without creating an enumeration channel?

## Readiness verdict

Verdict: NOT READY

The architecture is promising and much of the proposal should be preserved, but unresolved issues currently permit direct session-boundary bypass, unsupported-target fail-open behavior, mixed-mode execution, post-revocation effects, destructive client races, and cross-user custom-key mutation. Those are material correctness and safety concerns, not implementation polish.
### Orchestrator verification notes — round 5 (outside the verbatim body)

Both families independently made the **same #1 finding**: the round-4
conservative-fallback derivation was a defect introduced by the orchestrating
session, not a pre-existing flaw. Verified:

- The todo demo's `listTodos` is auth-scoped via `authScopeField: 'userId'`
  (`demos/todo/snapback/functions.mjs:29`) and its read summary is `todos`
  itself, so round 4's "tables derived from the read summaries of every
  auth-scoped function" would make **every ordinary todo write** advance the
  coarse global epoch and synchronously clear every client — contradicting
  the section's own "permission-affecting writes are rare" premise and
  regressing the shipped matcher, which today proves other-user writes
  disjoint (`field_scope_change_is_disjoint`, `src/live_matcher.rs:126-151`)
  and the DK-3 delta path.
- `authScopeField` is a *disjointness-proof* field, not a generic
  "uses auth" flag — reusing it as one is semantically wrong.
- Session-boundary bypasses confirmed: `GET /_snapback/api/data/{table}` is
  `AdminRead` and returns raw rows after `authorize(ctx, headers, false)`
  (`src/admin.rs:837-851`), which is tokenless on loopback
  (`src/admin.rs:534-563`) and reachable from any localhost origin under the
  CORS echo; `POST /app/ensure` is `Public` (`src/server.rs:646`) and applies
  schema/function bundles (`LocalSnapback::ensure_app`, `src/local.rs:1068`).
- `clear_retained: true` is emitted on **every** resync today, including
  `reset` and `outbox_overflow` (`src/local.rs:1046`, `3600`, `3658`).
- The Cloudflare coordinator does **not** honor client-asserted auth — it
  hardcodes `authJson: '{}'` (`cloudflare/src/coordinator.js:1228`) — so a
  sessions bundle there would run **empty-auth/unscoped**, not impersonated.
  Round 4's motivating sentence was wrong in the reviewer's favor; the hole
  is real and arguably worse.
- `KeyMode::Custom` is independent of `AccessPolicy`
  (`src/ephemeral.rs:198-300`, `2283-2363`), so `AllowAll` + custom key
  permits cross-user overwrite/delete.
- The server binds its listener before app-data schema application arrives
  (`src/cli.rs`), so round 4's "first apply on an empty database activates
  pre-bind" was not achievable as written.
- `MutationRequest` permits `clientMutationId` and `ctx_ledger`
  independently (`src/manifest.rs:940-963`) — the descriptor-required
  predicate needed pinning.
- LLP 0043 §Status records M1/M2 as **shipped** (ENG-23965), so round 4's
  "0043 adopts it when it lands" was stale.
- `ConnectionRegistry` lives in server `AppState`, unreachable from
  `LocalSnapback::reset` — round 4's `app.reset` grant-wipe claim is correct
  as a *pin* but is new wiring, not description.
- One round-5 suggestion premise checked and **not** adopted: the admin-token
  compare is already constant-time (`token_eq`, `src/admin.rs:540,565`).

**Disposition (2026-07-12 revision 5):** the shared #1 concern is fixed by
adopting the Claude-family suggestion — a **load-bearing manifest lint**
replaces coarse-always: manifest load fails when an auth-scoped function's
static read summary contains a table covered by neither a declared,
matcher-analyzable row scope nor a `permissionBacking` declaration, so every
auth-relevant table is classified at load time; the coarse floor applies only
to `permissionBacking` tables, non-analyzable functions, and runtime
captured-read discoveries beyond the static summary; ordinary result tables
mediated by an analyzable scope keep the shipped matcher/DK-3 path (no
regression), `authScopeField` keeps its narrow disjointness meaning, a
separate `permissionDependencies` vocabulary carries ACL dependence
(the GPT-family's separation), the doctor lint no longer flags ordinary
result-table writes, and coarse-bump fan-out is defined. Everything else in
both reviews is pinned in revision 5: server-side `clear_retained` emission
semantics (authorization-affecting only); the existing-route × mode matrix
closing `/_snapback/api/data/{table}` and `/app/ensure` under sessions (with
LLP 0017/0034 amendments added to the companion obligations and
hostile-origin acceptance); receiver-side must-understand enforcement at
manifest load on every target (coordinator `startupError` seam) with the
coordinator's failure mode corrected to empty-auth/unscoped; app-data refused
while `desired != active` plus a bootstrap handshake before stores render;
the fail-closed two-phase revocation protocol (pending-revoked marker before
commit, finalize after, un-mark on rollback — never the small lock across a
commit) extended to rotation, with the L9 interaction and lock order named;
the two-axis client store (principal/data scope vs authority-instance/queue
scope) with the descriptor-required predicate and anonymous/dev lifetimes;
a client `AuthCoordinator` with `compareAndClear(expectedAuthority)` that
also removes optimistic overlays; `KeyMode::Custom` rejected under sessions
with cross-user negatives; "refresh always reads current custody immediately
before sending" plus Web Locks/BroadcastChannel custody; auth-code payloads
barred from durable 0045 intents; `app.reset` → connection-registry wiring
owned in landing item 4; sliding-expiry "use" defined; the citation batch
fixed (0031 split cite, `SNAPBACK_CONFIG_NON_SECRET_UNIMPLEMENTED`, the
upstream-corpus qualifier on 0005's large-RFC rule, 0024 "emit or retain",
0026/0032 L9 dual cite); `/auth/*` on dev-mode apps defined; the instance
lock cited as the projection's soundness precondition; the request-code
response shape pinned; rate-limit and capacity refusals split; physical
restore's session posture stated; subject-rename and user-deletion added to
non-goals; and the revision history moved to a Changelog section (the header
had grown to ~50 lines — LLP 0038 recommendation 9).

## Round 6 — 2026-07-12

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md`, working-tree revision of
2026-07-12 round 5 (sha256
`bbc1773ec605eedc52a27b0c0734f413e998425e33d28168e2427396f8f54335`).
**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1 (`codex exec`,
non-interactive), model `gpt-5.6-sol`, reasoning effort `ultra`, sandbox
`read-only`, workdir = repo root. Session id
`019f5625-29c1-7d13-85f3-8c02e00b5a7e`; 442,283 tokens used. Fresh session.
**Date:** 2026-07-12
**Redacted:** Same as earlier rounds.
**Method:** Same as earlier rounds — shared round-6 brief, blind to the
concurrent paired review and to all archived reviews under `llp/reviews/`.

### Review body (verbatim)

## Overall assessment

The proposal’s central direction is sound: LLP 0039 turns LLP 0011’s server-derived identity model into a real end-to-end authority boundary, closes alternate access paths, binds transport capabilities to sessions, and treats retained data and replay as authorization concerns rather than client conveniences.

The document is unusually thoughtful, but it is not yet a safe executable plan. Several contracts contradict one another, and important activation, refresh, invalidation, revocation, reset, restore, and client-transition races remain unresolved. These are design issues, not implementation polish.

## Strengths

- The separation of untrusted wire auth, server-only resolved authority, and immutable `ctx.auth` is exactly right (§Authority resolution, `llp/0039-auth-vertical-slice.rfc.md:101-163`). It directly addresses the shipped `#[serde(default)] HandlerInput.auth` surface (`src/manifest.rs:912-925`), client-owned live-resume identity, and required ephemeral auth DTOs.

- The “one gate, every path” composition matrix is a strong implementation invariant. It accounts for HTTP, WebSockets, actions, cron, nested calls, host operations, and the direct runner rather than treating bearer validation as route-local middleware (`0039:122-148`). This builds coherently on LLP 0011 §§Authentication Model–Authorization Model.

- The document accurately recognizes that sessions would remain decorative while raw row inspection and executable provisioning stay tokenless (§Existing surfaces under sessions, `0039:252-280`). Current code confirms that `/app/ensure` is Public and applies function manifests (`src/server.rs:646-649,2007-2023`; `src/local.rs:1068-1111`), while raw data inspection is presently `AdminRead` (`src/server.rs:681-684`).

- The provider core is security-conscious. Keyed digests for six-digit codes, conditional transactional consume, uniform invalid-code outcomes, token-family tombstones, explicit secret redaction, and keeping auth material out of `_snapback_changes` are all good decisions (§Built-in first provider, `0039:379-481`; LLP 0009 §Security Considerations).

- The connection-token discussion is admirably precise about what is and is not proven (§Session transport and connection binding, `0039:499-557`). The existing server already verifies server-minted connection tokens (`src/server.rs:374-419,2026-2104,2461-2475`); binding those grants to resolved authority is the appropriate next step.

- The proposal correctly adopts existing vocabulary rather than inventing parallel mechanisms: `ValueExpr::AuthUserId`, `PermissionScopeExpr::AuthUser`, `SNAPBACK_AUTH_USER_MISSING`, and `SNAPBACK_AUTH_STALE_RESULT` all exist (`src/value_expr.rs:117-126`; `src/local.rs:4014-4028`; `src/storage.rs:270-309`). The typed `User(subject)` vocabulary also avoids the real double-prefix trap.

- The acceptance section is unusually adversarial and specific. Generated interleavings, hostile-origin tests, two-user authorization proofs, restart behavior, redaction sentinels, and an explicit landing DAG are all valuable (§Acceptance, `0039:957-1065`; §Landing order, `0039:883-924`).

## Concerns

1. **HIGH — First activation is neither privilege-safe nor operationally complete.**

   Mode-changing apply records `desired` while applying the rest of the schema (§Authority resolution, `0039:165-190`), but `/app/ensure` becomes match-only only once the app is session-enabled (`0039:265-271`). While active mode is still `dev`, today’s Public ensure can stage sessions and persist attacker-chosen schema before the restart (`src/server.rs:2007-2023`; `src/local.rs:1068-1111`). Conversely, executable function manifests are process memory, reset to defaults on reopen (`src/local.rs:935-939,2979-2996`); after sessions activate, the ordinary browser mount path cannot reload them without an unspecified AdminWrite or “pre-bind startup authority” mechanism. This creates both an unprivileged staging/DoS surface and a cold-start bundle-loading gap.

   *Resolves with:* Evaluate requested mode, active mode, and desired mode before applying any schema/function/seed half. Any payload requesting sessions, and every ensure while `desired == sessions`, must require AdminWrite or a concrete pre-bind authority. Define how the executable bundle is supplied or persisted across the restart, then test fresh database → sessions deployment → restart → authenticated function execution.

2. **HIGH — The permission-classification model cannot yet make false negatives “structurally impossible.”**

   Section §Permission dependencies requires every table read by an undefined “auth-scoped function” to be either row-scoped or `permissionBacking` (`0039:631-650`). It has no authority-independent/public class, although an authenticated query may legitimately join public reference data with private rows. Today every generated function is hardcoded `optional-user` (`packages/snapback-codegen/index.mjs:1534-1551`), while the manifest exposes only a table vector and one function-wide `authScopeField` (`src/manifest.rs:342-350`). The summaries are author assertions, and the proposed `permissionDependencies` shape and cross-validation rules are not specified. That is insufficient to uphold LLP 0008’s “no false negatives” rule or LLP 0020’s conservative-unknown rule.

   *Resolves with:* Define a normative per-`(function, table)` certificate such as `authorityIndependent | rowScoped(field, subject) | permissionBacking(scope)`. Define “auth-scoped,” derive or exactly cross-check `permissionDependencies`, and state which facts are mechanically proven versus trusted declarations.

3. **HIGH — Subject-specific permission invalidation contradicts itself and can strand the actual subject.**

   The main design says a subject-bearing declaration avoids the coarse global bump (`0039:666-675`), and acceptance expects only the revoked user to resync (`0039:1016-1020`). The Open Question says suppression still requires a machine-checkable proof (`0039:1076-1079`), while the changelog says declarations never suppress coarse epochs (`0039:1135`). More seriously, §Subject versus actor claims that declaring the actor instead of the subject costs only precision (`0039:685-689`); under the main rule, that wrong but subject-bearing declaration suppresses the global bump and invalidates the wrong user, which is a correctness failure.

   *Resolves with:* Keep the coarse bump until subject completeness is mechanically derived from touched rows’ old and new values. Explicit `Arg` or actor declarations may add precise invalidations but must not suppress the coarse one unless an analyzable proof establishes exhaustive coverage.

4. **HIGH — Unconditionally non-clearing `outbox_overflow` can erase a queued authorization revocation.**

   LLP 0039 changes `outbox_overflow` to `clear_retained: false` (`0039:715-726`). The shipped overflow implementation clears the durable queue and replaces it with one overflow sentinel (`src/ephemeral.rs:753-785`). That queue may already contain a permission-epoch or reset message requiring `clear_retained: true` (`src/local.rs:1041-1047,3653-3659`). Replacing the stronger event with a non-clearing sentinel can leave revoked rows visible while recovery is pending.

   *Resolves with:* Make clearing disposition monotone across queue collapse: the overflow sentinel must sticky-OR the strongest disposition of every dropped durable message, or authorization/reset sentinels must be preserved separately. Add permission-resync→overflow and reset→overflow interleavings.

5. **HIGH — Refresh rotation admits both durable takeover and benign multi-tab revocation.**

   Under §Built-in first provider, an attacker holding bearer N can refresh first and retain N+1. The victim later presents N on an ordinary request, cannot find N+1 in local custody, and transitions to anonymous—without revoking the attacker’s healthy family (`0039:433-467,593-599`). Reuse detection never triggers because the prescribed victim recovery avoids refreshing N. Conversely, a legitimate tab can read N, be suspended while another tab rotates, then deliver its refresh after the ten-second window and revoke the healthy session. The bounded-lease fallback has no fencing rule preventing a late former lease holder from overwriting custody.

   *Resolves with:* Define a formally fenced custody/refresh protocol covering suspension after custody read and through response settlement. An unreconciled supersession must revoke the family server-side before local clearing, or the family should use stronger device/attempt evidence before treating N−1 as theft. Add attacker-rotates-first, delayed-request, expired-lease, and late-storage-commit traces.

6. **HIGH — Revocation and reset lack operation-level fencing at their actual effect boundaries.**

   A bare `pending-revoked` marker is insufficient when concurrent operations can mark the same session: operation A’s rollback can unmark operation B’s still-pending revocation unless markers carry fencing identities (`0039:525-554`). Existing WebSockets validate the connection token at upgrade and then process frames without revalidation (`src/server.rs:2082-2104,2141-2180`); a revoked stream may therefore send operations or receive newly queued sensitive deltas until an unbounded sweep closes it. Reset has the same check-then-act problem: `ConnectionRegistry` is outside `LocalSnapback`, while ephemeral operations verify a grant and then act lock-free (`src/admin.rs:343-372`; `src/server.rs:1887-1907,2516-2564`).

   *Resolves with:* Use per-operation fencing generations and compare-and-finalize/unmark semantics. Check session/reset incarnation before every connection-scoped act and outbound send, make revoked state dominate liveness extension, notify and close streams within a pinned bound, and add rollback-vs-revoke, logout-vs-refresh, reset-vs-publish, and revocation-vs-outbound-delta tests.

7. **HIGH — Physical-restore invalidation is not implementable from the specified state.**

   The proposal says physical backup includes both SQLite and the adjacent keyring, yet restore must regenerate the incarnation and revoke every restored session (`0039:355-370,1002-1003`). Ordinary restart must preserve sessions and rebuild the projection (`0039:555-557`). Restoring the complete instance directory also restores any in-directory marker, so startup cannot distinguish restore from normal reopen. LLP 0036 explicitly says instance backups carry adjacent live keys (§The store and target seam). Rolled-back challenges can likewise become unconsumed again while their known codes remain within TTL. The downgrade override also “deletes nothing,” leaving it unclear whether old sessions revive after sessions are later re-enabled (`0039:199-205`).

   *Resolves with:* Define an explicit restore command/protocol or a monotonic host marker outside the snapshot boundary. Detected restore must revoke sessions and purge rollback-sensitive challenges. Also pin whether downgrade revokes durable sessions; the safe default is that re-enabling sessions requires fresh login.

8. **HIGH — The client authority barrier is under-scoped and only explicitly guards terminal errors.**

   Retained data is scoped solely by `userId`, so same-user re-login preserves it (`0039:593-599,764-770`). But `ctx.auth` exposes `sessionId` and `provider`, and LLP 0011 permits handlers to authorize from that context (`0039:231-249`; LLP 0011 §§ctx.auth–Authorization Model). A result dependent on provider or session can therefore survive into a non-equivalent authority. Separately, `compareAndClear` is specified for delayed terminal failures, but delayed successful responses, subscription callbacks, optimistic reconciliation, or fire-and-forget retained writes can repopulate user A’s state after an A→B wipe (`0039:577-591,1042-1044`; `packages/snapback-contract/index.mjs:365-443`).

   *Resolves with:* Either scope retained results by every result-affecting auth dimension or formally restrict retainable functions to a declared `userId`-only subset. Require authority-epoch compare-and-commit on every success, failure, callback, queue mutation, optimistic reconciliation, and durable-store write; test delayed successful A work crossing A→B.

9. **HIGH — The bootstrap contract is internally contradictory and conflicts with offline retention.**

   `GET /auth/session` must return active mode and an anonymous HTTP-200 projection before the client selects DTOs (`0039:182-187,851-858,1054-1057`), but every `/auth/*` route in dev mode is also required to return `SNAPBACK_AUTH_MODE_DEV` (`0039:864-865,1058-1060`). During `desired != active`, the handshake is described as diagnosable but returns only active mode, not desired mode. Finally, requiring a live handshake before any retained render makes cold offline boot impossible, contradicting LLP 0043 §Milestone 1 and §Auth posture.

   *Resolves with:* Exempt the bootstrap endpoint from dev-mode refusal or place it outside the provider route family; return `{activeMode, desiredMode, modeState}`. For retained session-mode data, define a persisted integrity-scoped handshake/authority record with a bounded `authorizedUntil`, or explicitly amend LLP 0043 to remove cold offline retained reads.

10. **MEDIUM — Durable replay and epoch semantics are incomplete outside a real session.**

   The proposal defines per-session and per-boot authority instance IDs but does not define whether an anonymous descriptor is global, per client, durable, or recognized across restart (`0039:759-792`). A per-boot dev ID also strands queues despite shipped exactly-once settlements surviving reopen. Current settlement rows store only the legacy auth fingerprint, and permission epochs advance after the data transaction (`src/storage.rs:1353-1362`; `src/local.rs:1387-1418`).

   *Resolves with:* Specify anonymous/dev descriptor minting, custody, server recognition, restart/reset lifetime, and scope. Pin the settlement migration and legacy-row behavior, and require data changes, idempotency settlement, authority descriptor, and all permission bumps to commit atomically in both HostPlan and Ibex paths.

11. **MEDIUM — Several factual baseline claims are stale.**

   The mode table calls loopback-only dev binding “today’s behavior” (`0039:192-197`), but the CLI accepts arbitrary hosts and binds them directly (`src/cli.rs:20-40,456-484,723-749`); loopback refusal is new work. The todo acceptance says affected subscriptions receive DK-3 deltas “exactly as they do today” (`0039:661-665,1007-1013`), but the current todo uses an Ibex query, and todo-v2 is ordered; ordered/limited queries fall back to `live_replace` (`demos/todo/snapback/functions.mjs:24-33`; `demos/todo-v2/snapback/functions.mjs:27-33`; `src/live_matcher.rs:565-579`; LLP 0008 §Decision DK-3). The “two shipped surfaces” inventory also omits the tokenless direct query runner, although later sections correctly close it.

   *Resolves with:* Describe loopback enforcement as a new requirement, change the todo claim to matcher disjointness plus current `live_replace`, or name an actually unordered HostPlan delta fixture, and make the bypass inventory complete.

12. **MEDIUM — Credential-dependent auth responses have no cache contract.**

   `GET /auth/session` returns a caller projection and authority descriptor, and login/refresh routes return credential material (§Diagnostics and route registry, `0039:800-881`). No browser, service-worker, reverse-proxy, or shared-cache behavior is pinned. A stale or cross-user cached projection is an authority transition bug, not merely stale UI.

   *Resolves with:* Require `Cache-Control: no-store` on session, code, exchange, refresh, logout, and mailbox responses, with appropriate `Vary: Authorization` behavior, and test the headers through LLP 0030’s same-origin proxy.

13. **MEDIUM — Unsupported-target refusal must occur before Cloudflare mutates persistent state.**

   LLP 0039 requires both deploy tooling and the target to reject unsupported `auth.mode` at manifest load (`0039:992-998`). Cloudflare currently hardcodes empty auth metadata (`cloudflare/src/coordinator.js:1222-1229`), but its deployment-metadata validation happens after system-table migration, subscription rebuilding, and app-table creation (`cloudflare/src/coordinator.js:137-225`). Its later `startupError` gate prevents serving but does not prevent unsupported DDL.

   *Resolves with:* Parse and reject must-understand auth metadata before any DDL or durable state mutation, with acceptance proving that a refused sessions bundle leaves the target unchanged.

## Suggestions

- Split the accepted design into subordinate protocol specs for authority/session state, permission invalidation, and client custody/retention. Keep this RFC as the decision and landing umbrella; the current breadth makes contradictions difficult to detect.

- Model-check the challenge, token-family, projection, reset, and custody state machines with Stateright, TLA+, or an equivalent executable model. The highest-risk bugs here are interleavings, not ordinary unit cases.

- Replace `clear_retained: bool` with a monotone disposition such as `retain < quarantine < delete`. Queue coalescing can then preserve the strongest security consequence by construction.

- Consider binding refresh to a non-exportable WebCrypto device key, or at least a device/attempt identifier, so server reuse detection can distinguish shared-custody races from an unrelated stolen bearer. This need not replace bearer access tokens.

- Make the route registry the source of router construction rather than maintaining a router plus parity tests. The proposed independent axes are exactly the kind of metadata that drifts when duplicated.

- Define the tokenless `AdminRead` metadata projection precisely. “Aggregates/metadata” is too open-ended because counts, existence, and schema details can themselves disclose sensitive facts.

- Rename `adminBypass` to something like `adminInvocation`; the proposal correctly says it bypasses no handler authorization check, so the current name invites future misuse.

- Generalize the `auth.mode` must-understand exception into a manifest-level `criticalCapabilities` mechanism rather than adding a one-off compatibility rule.

## Open questions

- What exact privileged, atomic mechanism installs the first sessions schema and executable bundle before bind, and how is it recovered after a partial failure?

- What proof is sufficient to suppress a coarse permission epoch, and which declaration forms remain hints rather than proofs?

- What is the formal refresh-family behavior for attacker-first rotation, delayed legitimate refreshes, lease expiry, and lost successor custody?

- What is the linearization point for logout, expiry, reset, and revocation relative to inbound frames and outbound sensitive deltas?

- Which auth dimensions are allowed to influence retainable results, and what bounded offline authorization lease is acceptable?

- How is a physical restore distinguished from an ordinary restart, and what happens to restored sessions, challenges, and downgrade-preserved credentials?

- What are anonymous and dev authority-instance IDs scoped to, and which queued-write guarantees survive restart?

- Which exact tokenless admin metadata is safe, and who owns the production TLS, trusted-proxy, distributed-throttling, multi-replica invalidation, and client-XSS contracts before session mode is advertised beyond local development?

## Readiness verdict

Verdict: NOT READY

The architecture is promising and substantially stronger than the current client-asserted model, but unresolved HIGH concerns permit unprivileged activation, stale authorization retention, refresh-family takeover, lost invalidations, post-revocation stream activity, and non-implementable restore semantics. The proposal should remain in review until those contracts are made coherent and their adversarial interleavings are added to acceptance.
### Orchestrator verification notes — round 6 (outside the verbatim body)

For the **third consecutive round**, both families independently named the
same top issue, and for the **second consecutive round** it was a defect the
orchestrating session had introduced in its own prior revision — this time in
the round-5 classification lint. Verified:

- **The lint cannot classify membership-gated shared tables.** The card-game
  proving demo's shared tables (visible to all players of a game) fit neither
  class: an `authScopeField` declaration would make the shipped matcher skip
  *other players'* writes (`field_scope_change_is_disjoint`,
  `src/live_matcher.rs:139-150`) — a staleness false negative, exactly what
  LLP 0008 forbids — while a `permissionBacking` declaration would make every
  move epoch-advancing, contradicting the document's own no-regression
  acceptance. As written, the proving demo either fails manifest load or
  contradicts its acceptance criteria.
- **The "exactly 0008's sanctioned analyzable subset" appositive is false.**
  `authScopeField`/`authUserId()` appear nowhere in LLP 0008; 0008's
  analyzable subset is structured single-table filter expressions generally.
  They are code/authoring vocabulary (`src/manifest.rs:349-350`,
  `packages/snapback-codegen/define.mjs:171`).
- **Suppression self-contradiction (round-5 text):** the main text said a
  subject-bearing declaration avoids the coarse bump, while the changelog and
  the open question said declarations never suppress. Under the main reading,
  a *wrong but subject-bearing* declaration (actor instead of subject) would
  suppress the global bump and invalidate the wrong user — a correctness
  failure, not the "costs precision, never correctness" the same section
  claimed.
- **The round-5 `clear_retained` pin can erase a revocation.** The shipped
  overflow path clears the durable queue and replaces it with one sentinel
  (`src/ephemeral.rs:753-785`); that queue may already hold a permission-epoch
  or reset message carrying `clear_retained: true` (`src/local.rs:1041-1047`,
  `3653-3659`). Pinning the overflow sentinel to `false` therefore drops the
  stronger disposition.
- **Bootstrap contradiction:** the round-5 text required `GET /auth/session`
  as the handshake *and* required every `/auth/*` route to refuse on dev-mode
  apps; and mandating a live handshake before any retained render is
  unsatisfiable offline, contradicting LLP 0043's **already shipped** M1/M2
  retained stale boot (0043 §Status).
- **Restore detection is undefined:** the pinned backup unit is the whole
  instance directory (SQLite + keyring), so a restored pair is internally
  consistent and no in-directory anchor can distinguish restore from restart.
- **Refresh-family takeover (new):** an attacker holding bearer N can rotate
  first and keep N+1; the victim presents N, finds no successor in custody,
  and transitions to anonymous — while the attacker's family stays healthy and
  reuse detection never fires, because the victim's prescribed recovery avoids
  refreshing.
- **Stale baselines in the round-5 text:** loopback-only dev binding is *new
  work*, not "today's behavior" (the CLI binds any `--host`,
  `src/cli.rs:723-733`); the todo demos' queries are Ibex/ordered and fall
  back to `live_replace`, so the "DK-3 deltas exactly as today" acceptance
  claim is wrong (`demos/todo/snapback/functions.mjs:24-33`,
  `demos/todo-v2/snapback/functions.mjs:27-33`,
  `src/live_matcher.rs:565-579`); the two-surface bypass inventory omits the
  tokenless direct query runner (closed elsewhere in the document).
- **Legacy receivers cannot be bound by a new field:** an already-deployed
  Cloudflare coordinator predating the carve-out ignores `auth.mode` per
  0012's ignore-unknown-fields rule and would run a sessions bundle
  empty-auth/unscoped; and its `validateDeploymentMetadata` runs *after*
  system-table migration and app-table creation
  (`cloudflare/src/coordinator.js:137-225`), so even a knowing receiver would
  mutate durable state before refusing.

**Disposition (2026-07-12, revision 6 — terminal for this loop).** The
orchestrating session applied every verified defect fix (see the document's
Changelog), including a **four-class dependency model** that answers both
families' resolution criteria for the classification mechanism
(row-scoped / permission-backing / membership-gated-with-declared-
`permissionDependencies` / authority-independent), the monotone
`retain < quarantine < delete` disposition with sticky-OR on queue collapse,
the online-scoped bootstrap handshake preserving 0043's offline cold boot, an
operator-declared restore verb with its residual named, non-destructive
unstage plus a stage-time collision pre-check, a deployment-metadata version
bump that legacy receivers already reject, and the baseline/citation
corrections.

**The loop stops here, and the document stays `Draft` — it did not converge.**
Both families have now independently recommended, across multiple rounds, that
the document be split under the upstream large-RFC rule (>800 lines *and*
sub-topics with independent timelines — both conditions hold; the document's
own §Landing order defines eight dependency-ordered items). The
authorization-invalidation mechanism has failed three successive design
attempts under review while the authority/provider/transport core has been
rated implementable-as-written, which is precisely the case the split exists
to serve: the least-settled contract becomes independently revisable without
reopening the settled core. Splitting mints new LLP numbers, which is a
corpus-structure decision reserved to the author (LLP 0005; the skill's scope
boundary), so it is referred to Charlie rather than taken here. The four-class
model in revision 6 is the orchestrator's proposed resolution and has **not
been reviewed** — it is the natural first agenda item for whichever document
ends up owning it.

## Round 7 — 2026-07-12 (post-split)

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md`, the post-split umbrella
(sha256 `0991f6c02eab3f5cf79b3ab83e6db94e610333573be31d3bea7c13a879c250c0`).
**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1 (`codex exec`,
non-interactive), model `gpt-5.6-sol`, reasoning effort `ultra`, sandbox
`read-only`, workdir = repo root. Session id
`019f5786-8e15-7fc3-af4d-a4a2f348ea46`; 402,134 tokens used. Fresh session.
**Date:** 2026-07-12
**Redacted:** Same as earlier rounds.
**Method:** Same as earlier rounds — shared round-7 brief, blind to the
concurrent paired review and to all archived reviews. The brief scoped
authorization invalidation OUT (LLP 0053 owns it, reviewed separately and
independently) while keeping the 0039/0053 **seam** in scope, and directed the
reviewer at the contracts written in rounds 5–6 that had never faced a reviewer.

### Review body (verbatim)

## Overall assessment

The proposal’s core architecture is strong: server-derived authority, one invocation gate, explicit auth-mode staging, protected identity state, authority-bound connections, and a single client coordinator form the right shape for a real auth vertical slice. Splitting authorization invalidation into LLP 0053 also improved both documents; the four dependency invariants in §Permission dependencies broadly match what 0053 promises.

The working-tree revision is not ready, however. Several in-scope contracts still permit concrete fail-open or cross-authority outcomes: the claimed legacy-receiver fence does not exist, staged mode changes do not stage a coherent deployment generation, revocation lacks a sound linearization model, tokenless surfaces can still expose app-derived values, client preservation is weaker than the authority model, and “compare-and-commit” lacks an atomic storage primitive. These require contract changes, not implementation polish.

## Strengths

- §Authority resolution and §One gate, every path establish an excellent separation between untrusted wire auth, server-resolved authority, and immutable handler projection. The composition matrix covers public, authenticated, cron, nested, action, and admin execution instead of treating HTTP handlers as the whole system. This directly addresses current gaps such as defaulted `HandlerInput.auth` (`src/manifest.rs:912`) and the unconsumed, hardcoded `authRequirement` (`packages/snapback-codegen/index.mjs:1534-1553`).

- §Existing surfaces under sessions correctly identifies the two largest current bypasses. The code confirms that `/app/ensure` is Public, raw data is AdminRead (`src/server.rs:629-684`), loopback AdminRead is tokenless (`src/admin.rs:534-563`), and localhost CORS origins are reflected (`src/server.rs:1553-1597`). Evaluating deployment privilege against `(requested, active, desired)` is the right principle.

- §Protected identity core draws a strong boundary around `_auth_*`: no app manifest exposure, journal rows, live wakes, token hashes, or ordinary export. The catalog marker, physical-collision check, transactional first-login provisioning, and explicit reset/export/restore lifecycle are all valuable.

- §Built-in first provider is unusually careful about low-entropy code storage, compare-and-consume exchange, challenge supersession, non-enumerating responses, refresh tombstones, and lost-response recovery. Naming the refresh-family takeover hole instead of overstating bearer security is especially good.

- §Session transport and connection binding correctly treats connection tokens as delegated bearers and narrows the guarantee accordingly. It also revisits LLP 0031’s process-lifetime grants when those grants begin carrying real authority, as LLP 0031 required.

- §Authority transitions correctly recognizes that delayed success is as dangerous as delayed failure. A single `AuthCoordinator`, `compareAndClear`, optimistic-overlay removal, queue handling, and an epoch guard over every client-state sink are the right conceptual ingredients.

- §Permission dependencies draws a sensible seam: ordinary writes do not spuriously resync; permission-affecting events advance durable state transactionally; dispositions are monotone and executed by the coordinator; retained reads remain disabled until the 0053 primitive exists. Those dependencies align with `llp/0053-authorization-invalidation.rfc.md:211-327` without requiring this review to revisit 0053’s classification model.

- The diagnostics, route-registry plan, companion-document ledger, and adversarial acceptance style are much stronger than a feature checklist. The proposal consistently distinguishes current facts from new work and names significant residuals.

## Concerns

1. **HIGH** — The structural must-understand guarantee is factually unsupported for both legacy Cloudflare and legacy local receivers.

   §Summary claims that a bumped deployment format is already rejected by deployed validators (`llp/0039-auth-vertical-slice.rfc.md:68-90`). LLP 0012 instead requires receivers to ignore added fields (`llp/0012-headless-integration-contract.spec.md:96-104`). Cloudflare’s `validateDeploymentMetadata` checks only schema and bundle hashes (`cloudflare/src/coordinator.js:249-300`), performs constructor migration first (`cloudflare/src/coordinator.js:137-225`), and still invokes handlers with `auth: {}` (`cloudflare/src/coordinator.js:1225-1229`). A fresh legacy object therefore has no unknown-version rejection to trigger.

   Local rollback is also unprotected. Database open deserializes the stored manifest without artifact validation (`src/storage.rs:227-242,1368-1390`); exact version validation occurs only on incoming application (`src/local.rs:942-949`, `src/manifest.rs:1482-1498`). An older binary can ignore the new `auth` field, reopen a pending or active sessions database, and serve it using legacy body authority.

   *Resolves with:* Specify a concrete physical discriminator that every supported legacy receiver already rejects before any mutation or bind. Test the immediately preceding local binary against both pending and active sessions databases, and the old Cloudflare coordinator against fresh and populated objects. If no Cloudflare discriminator exists, prohibit sessions artifacts for that target until a structurally incompatible receiver/module boundary lands, and name the residual explicitly.

2. **HIGH** — Staging only the mode does not preserve the promised no-mixed-mode invariant.

   §Auth mode says the rest of the schema applies immediately while only the mode becomes desired, then permits a non-destructive unstage after consume failure (`llp/0039-auth-vertical-slice.rfc.md:185-250`). Current provisioning applies schema, functions, and seed sequentially (`src/local.rs:1068-1139`), while functions are process memory and disappear on reopen. This creates partially applied and mixed-generation states.

   After `--clear-desired-auth-mode`, either the sessions-oriented schema/functions become usable under active dev authority, contradicting “no window,” or the requested-versus-active gate continues refusing them, in which case unstage has not restored service. The text also does not define whether “boots in the still-active mode with desired quarantined” continues refusing app data or serves it.

   *Resolves with:* Define a durable transition state table covering active mode, desired mode, requested deployment identity, active deployment identity, `modeState`, and app-data availability. Stage and preflight a complete immutable deployment generation, then atomically switch its active pointer pre-bind; unstage should discard the pending generation. An alternative must prove equivalent rollback and compatibility for schema, functions, and seed. Add crash and failure traces for every boundary, including consume failure followed by unstage.

3. **HIGH** — The documented `_auth_*` collision recovery cannot be executed under the proposed reservation rules.

   §Existing databases and the auth catalog requires an app-level migration to read a colliding `_auth_*` table, copy its rows under a new name, and then drop the orphan (`llp/0039-auth-vertical-slice.rfc.md:369-406`). The same document makes `_auth_*` a codegen and storage load error and says `ctx.db` must refuse it. Current schema application validates identifiers before acting (`src/storage.rs:463-491`), and schema-aware reads require the table to remain declared (`src/storage.rs:623-650`). Reopening also loses in-memory functions.

   “Before the reservation gate applies to this database” hints at grandfathering but does not define how codegen, manifest load, or `ctx.db` enters that state.

   *Resolves with:* Pin an executable recovery mechanism: a bounded dev-only grandfather mode, an operator rename/copy verb, or explicit use of a preceding binary. Acceptance must perform the complete recovery without raw SQL and specify exactly when the reservation begins applying.

4. **HIGH** — The two-phase revocation protocol lacks a safe concurrency and effect-boundary model.

   §Session transport and connection binding introduces fencing identities and compare-and-unmark (`llp/0039-auth-vertical-slice.rfc.md:612-659`) but does not define unique operation-ticket allocation or a representation for overlapping markers. With a single strongest marker, A can remain pending, B can supersede A, and B’s rollback can erase the only marker while A is still unresolved. If A and B derive the same prospective session generation, ownership is ambiguous from the start.

   “Re-check immediately before taking effect” is still check-then-act unless check and publication are atomic. LLP 0034 documents precisely this failure and requires the generation check to share the relevant lock with the action (`llp/0034-contract-source-seam-provider-side.rfc.md:479-507`). Current WebSocket frames act after upgrade-time validation (`src/server.rs:2082-2105,2284-2397`), drains remove messages before awaited sends (`src/server.rs:2243-2257`), and ephemeral effects use separate room locks (`src/ephemeral.rs:1245-1349`). The RFC also simultaneously claims effect-boundary fencing and permits pre-authorized work to complete, without defining which effects belong to which side of the marker.

   Separately, LLP 0031 and current code allow `previousToken` reopen on token possession alone (`llp/0031-server-route-taxonomy.spec.md:482-487`, `src/server.rs:336-355`), while only Acceptance—not the normative design—requires authority equality.

   *Resolves with:* Define a linearizable per-session state machine using either serialized revocation-class operations or unique monotonic operation tickets plus a set/stack of pending markers. Specify rollback and ambiguous-commit behavior. For each sink, define an atomic check-and-effect rule or generation-stamped enqueue/commit rule, including outbox, room mutation, response publication, refresh, reset, and queued writes. State an exact close bound and normatively amend connection reopen to compare the freshly resolved authority with the stored binding.

5. **HIGH** — Existing-surface closure misses tokenless and public app-derived value channels.

   §Existing surfaces claims the future route matrix leaves no surface implicitly open, but §Open Questions still defers receipts, inspect, and other secret-adjacent reads (`llp/0039-auth-vertical-slice.rfc.md:297-340,1128-1130`). Today, inspect and receipts are AdminRead (`src/server.rs:681-684`) and therefore tokenless on loopback. Receipts contain arbitrary `correlation` and subscription `scope` values (`src/live_wire.rs:179-250`). The public inspection projection includes `recentDiagnostics` (`src/local.rs:184-223`), while handler rejection messages and live fan-out failures enter diagnostic details (`src/runtime.rs:1280-1289,1318-1328`; `src/local.rs:3573-3594`).

   A row value echoed into an error, query scope, or receipt can therefore escape even after raw table scanning closes. LLP 0031 explicitly warns that route policy cannot enforce field-level projection safety (`llp/0031-server-route-taxonomy.spec.md:181-193`), and LLP 0009 requires diagnostics not to leak unauthorized data (`llp/0009-code-execution-security.rfc.md:52-62`).

   *Resolves with:* Complete a response-sensitivity audit before sessions are enableable. Require `AdminSecretRead` for app-derived diagnostic, receipt, identity, and inspection details, or introduce typed public projections that cannot carry them. Add hostile-origin sentinel tests covering rows, handler errors, query arguments, receipt correlation/scope, identity subjects, and configuration secrets across every public or tokenless response.

6. **HIGH** — The authority-transition matrix preserves data across authority changes that may alter visibility.

   §Authority transitions preserves data for anonymous→authenticated and same-user/new-session transitions (`llp/0039-auth-vertical-slice.rfc.md:679-723`). The caveat about `sessionId` and `provider` is applied only to retained data, yet those fields are available to every handler, and LLP 0011 requires visibility under the current auth context (`llp/0011-auth-and-permissions.rfc.md:103-119,144-146`).

   A result visible to session A because of its session ID or provider can remain in memory while session B for the same user becomes current. A fresh connection eventually replacing it does not prevent transient display, and the epoch barrier prevents only later writes—it does not remove state already present. Optimistic and live state have the same issue.

   *Resolves with:* Default every auth-dependent result to full authority-instance equivalence and blank or quarantine it before exposing a new authority. Preserve state across reauthentication only where the function is declared and validated as authority-independent or `userId`-only. Test session- and provider-dependent results across same-user reauthentication, plus anonymous-only results across login.

7. **HIGH** — “Compare-and-commit every write” lacks an atomic client-store boundary.

   The rule in §Authority transitions is necessary but does not explain how an asynchronous durable write becomes conditional (`llp/0039-auth-vertical-slice.rfc.md:695-703`). Current retained writes are fire-and-forget (`packages/snapback-contract/index.mjs:418-433`), and retained/queue operations are unlocked read-modify-write sequences (`packages/snapback-contract/client-store.mjs:83-203`). A transaction begun under A can therefore commit after A→B clearing. BroadcastChannel delivery, Web Locks around bearer custody, and a lease token do not make unrelated IndexedDB, SQLite, or localStorage writes conditional.

   LLP 0008 already treats serialized local-store access as a correctness requirement and allows multiple physical backends (`llp/0008-local-first-sync-and-realtime.rfc.md:374-414`).

   *Resolves with:* Specify one coordinator serialization/fencing contract shared by authority changes and every state sink. Persist the expected authority generation in the same IndexedDB/SQLite transaction as each write, and make reads suppress mismatched records. For stores without conditional transactions, use generation-segmented namespaces plus an atomic active-generation pointer or refuse sessions capability. Test delayed transactions, cross-tab lease takeover, lost broadcasts, and every callback/queue/optimistic/retained sink.

8. **HIGH** — The refresh-family takeover mitigation has no executable protocol.

   §Built-in first provider promises to revoke the family server-side when a superseded ordinary credential cannot be reconciled with custody (`llp/0039-auth-vertical-slice.rfc.md:530-546`). The server cannot infer custody failure from the original request, and the route table exposes only refresh and logout. `SessionAuth` logout cannot ordinarily authorize a past-grace superseded token, so the client has no defined operation with which to raise the alarm.

   The same hole exists when refresh is the victim’s first signal. The outside-grace refresh response after family revocation is not named. In addition, `_auth_sessions.generation` refers to admin revocation, but no AdminWrite session/user revocation operation is specified.

   *Resolves with:* Define an idempotent revoke-only family-alarm operation that accepts an attributable tombstoned bearer, grants no session authority, leaks no family state, and can only destroy that family. Invoke it after bounded custody reconciliation from both ordinary and refresh supersession paths. Pin retry/lost-response/offline behavior, the outside-grace diagnostic, and an audited AdminWrite revoke-session/revoke-user surface. Acceptance must cover thief-first rotation and eventual invalidation of the thief’s successor.

9. **MEDIUM** — The authority descriptor is not connected to durable settlement or a safe migration.

   §Replay parity requires authority-instance comparison on first delivery and duplicates (`llp/0039-auth-vertical-slice.rfc.md:788-844`), but current settlements store only function, FNV-1a auth fingerprint, input fingerprint, and output (`src/storage.rs:79-103,270-319,1353-1362`). The RFC never says that `authorityInstanceId` is persisted atomically with the settled result or how pre-session rows are treated.

   The existing client store is also a single v1 namespace. Merely obtaining a new descriptor must not bless a legacy queue. Finally, a single per-boot dev descriptor is too coarse if two dev impersonations in that boot carry different users or roles.

   *Resolves with:* Persist descriptor version and authority-instance ID with every new settlement and compare stored identity before returning duplicates. Treat legacy/null settlements and legacy queues as non-replayable under sessions unless a stronger migration proof exists. Define dev descriptors per `(boot, resolved authority)` and define anonymous descriptor issuance and lifetime. Test pre-activation settlements, dev user switches, anonymous→authenticated, same-user new sessions, and refresh.

10. **MEDIUM** — The physical-restore procedure does not yet define a safe snapshot or exposure boundary.

   §Protected identity core correctly names the undeclared-restore residual (`llp/0039-auth-vertical-slice.rfc.md:414-440`), but “copy the whole instance directory” is not a consistency protocol for a live SQLite database using WAL (`src/storage.rs:203-247,1309-1318`). A copied database, WAL, and keyring can represent different instants.

   A post-bind host-ops verb is also not equivalent to a startup declaration: restored sessions and challenges can operate between bind and invocation. The CLI already opens storage before listener bind (`src/cli.rs:456-484`), making a pre-bind fence feasible. Acceptance currently says physical restore invalidates sessions without qualifying it as declared.

   *Resolves with:* Require a stopped/quiesced copy, SQLite online backup, or atomic filesystem snapshot spanning database, WAL, and keyring. Make restore declaration a one-shot pre-bind transaction that revokes sessions, purges challenges, and regenerates the incarnation before any app-data route serves; alternatively enter a durable restore-pending refusal state. Qualify Acceptance as “declared physical restore” and test a restored bearer racing startup.

11. **HIGH** — The landing DAG permits unsafe intermediate states and misstates the 0039/0053 dependency edges.

   Landing item 4 makes sessions activation possible, while item 5 later adds authority-bound grants, revocation, typed live closure, and client clearing (`llp/0039-auth-vertical-slice.rfc.md:944-950`). Unless an unstated feature gate exists, sessions can be enabled with unbound process-lifetime grants and no complete client barrier. Reset→grant wiring is also assigned to item 4 in §Protected identity core but item 5 in the landing list.

   Item 6 says it requires only item 3 even though its disposition wire is executed by item 5’s coordinator and “rides” item 5. Item 8 likewise needs the coordinator, item 6, the authority-aware store, and the item 7 migration. Physical-restore incarnation semantics are owned by 0053 (`llp/0053-authorization-invalidation.rfc.md:211-230`), so that acceptance proof cannot precede it.

   The ownership ledger also registers `PermissionScopeExpr`, `PermissionSubjectExpr`, and `permissionDependencies` under 0039 (`llp/0039-auth-vertical-slice.rfc.md:920-926`) and later says 0053 registers its own vocabulary. Finally, 0039 says session loss may “wipe or quarantine” retained rows, while 0053 requires deletion for affected retained slices (`llp/0053-authorization-invalidation.rfc.md:270-287`).

   *Resolves with:* Publish an explicit DAG and activation gate: sessions remain unavailable until items 1–5 are present; item 6 depends on item 5; item 8 depends on 5, 6, and 7. Give each wire/manifest registration one owner, assign reset wiring once, gate restore-incarnation acceptance on 0053, and separate the required deletion of retained data from any quarantining/stranding policy for queued mutations.

12. **MEDIUM** — The cryptographic and key-custody contract is not fully portable or reproducible.

   §Built-in first provider specifies generic `HMAC` and a `digestVersion`, but the `_auth_verification_codes` field list has no digest-version field, and the document does not pin an algorithm, byte ordering, length encoding, or constant-time comparison. This prevents stable test vectors and safe future verification of challenges created before an upgrade.

   The proposed “0600 keyring” also inherits a Unix-only assumption. Current owner-only helpers enforce permissions only on Unix and fall back to ordinary writes elsewhere (`src/admin.rs:304-316`, `src/config.rs:396-413`), while the repository contains explicit Windows support. Several supposedly pinned constants remain valueless: throttle budgets/windows, per-user session cap, mailbox capacity, grant caps/idle expiry, close bound, and address-length cap.

   *Resolves with:* Pin the exact HMAC algorithm, encoding, digest version storage/derivation, constant-time comparison, and interoperable vectors. Treat insecure permissions as keyring corruption. Either implement and verify Windows owner-only ACLs or refuse sessions capability on unsupported hosts. Assign normative values—or explicitly target-reported bounded values—to every safety-relevant constant.

13. **MEDIUM** — Acceptance contradicts the normative offline and discovery behavior.

   §Auth mode correctly says the handshake precedes online interaction but not offline cold boot (`llp/0039-auth-vertical-slice.rfc.md:202-215`), consistent with LLP 0043’s shipped stale retained render (`llp/0043-offline-replay-retention.rfc.md:74-91,153-170`). Acceptance instead requires the handshake before “any retained render.” It also says every `/auth/*` route refuses dev mode despite the design’s explicit `GET /auth/session` exception.

   `SNAPBACK_AUTH_MODE_PENDING` is described as a request refusal but appears only in the startup/load-time list, and `SNAPBACK_AUTH_MODE_DEV` has no HTTP or retry mapping.

   *Resolves with:* Require the handshake before online promotion, connection, resubscribe, or auth-bearing requests while preserving marked-stale offline boot. Exempt `/auth/session` consistently. Add complete request-path diagnostics and tests for offline boot followed by mode mismatch, consume failure plus unstage, and legacy receiver refusal.

## Suggestions

- Use generation-segmented client state: atomically switch an active authority-generation pointer and let late writes land only in a sealed, unreadable generation that can be garbage-collected later.

- Give unrelated counters distinct names such as `sessionGeneration`, `revocationOperationTicket`, `clientAuthorityGeneration`, and `authorizationEpoch`.

- Model-check the mode, challenge, refresh/custody, and revocation state machines with a small executable scheduler. The rollback and supersession orderings are compact enough to exhaust.

- Add a response-sensitivity axis to the route registry alongside path authority and credential resolution.

- Centralize normalization of HTTP status errors, HTTP-200 action-envelope errors, live auth frames, and connection-close diagnostics so all terminal auth outcomes reach the same coordinator.

- Rename `adminBypass` if it suppresses no authorization check; the current name invites future code to infer broader power than the contract grants.

- State that non-extractable-key/DPoP work would constrain export and off-device replay but would not stop live XSS from using an in-origin signing oracle.

- Require `KeyMode::User` and `KeyMode::Session` to fail explicitly when the resolved authority lacks the required dimension rather than collapsing callers onto a shared synthetic key.

## Open questions

- What exact envelope or module ABI can every already-deployed receiver be proven to reject?

- Is data created under forgeable dev authority trusted when enabling sessions, discarded, audited, or accepted through an explicit operator acknowledgement?

- What is the precise linearization point for revocation relative to database commits, room effects, outbox enqueue/drain, and response publication?

- Is full authority-instance scoping acceptable as the safe default for online client state, with user-only preservation as an opt-in optimization?

- Which durable primitive provides atomic conditional writes across IndexedDB, SQLite, localStorage, and multiple tabs?

- What operation raises the unreconciled-family alarm, and what residual is accepted when the victim is offline?

- Which diagnostic, receipt, inspect, and configuration fields can contain app-derived or identity-derived values?

- Is physical backup restricted to stopped instances, or will Snapback provide a quiesced/online snapshot mechanism?

- Does v1 support sessions on Windows, and if so, what ACL and verification contract replaces `0600`?

- Must session activation wait for all client and connection safety machinery, or is a deliberately restricted server-only intermediate capability intended?

## Readiness verdict

Verdict: NOT READY

The proposal has a good architecture and a substantially correct 0039/0053 seam, but the current text retains multiple material safety and feasibility gaps: legacy receivers can fail open, mode staging is not deployment-atomic, revocation is not linearizable as specified, public/tokenless value channels remain, and the client barrier is neither authority-complete nor transactionally enforceable. Resolving those contracts should preserve most of the present design while making its strongest security claims true.
### Orchestrator verification notes — round 7 (outside the verbatim body)

Both families NOT READY (GPT: 9 HIGH; Claude: 6 HIGH). Every decisive claim
spot-checked and verified. Four findings are **fail-open traps the round-5/6
revisions created**, and one **breaks the split's own premise**:

- **The split's central claim was false.** The authorization-stream
  **incarnation** is LLP 0053's deliverable (item 6), but 0039 depends on it in
  items 3–5: the `--restored-from-backup` procedure regenerates it, `app.reset`
  fencing *is* its regeneration, and the offline cold-boot carve-out renders from
  stored `(incarnation, epoch)`. So "items 1–5 and 7 can land while 0053 is in
  review" did not hold. Resolution adopted: the incarnation is an
  *authority-stream* anchor (regenerated on restart/reset/import/restore — none
  of which is 0053's subject), so it **moves to 0039** and 0053 consumes it.
- **Privilege escalation this slice introduces.** The capture mailbox and
  `auth.mintSession` make "holds the admin token" ≡ "is any user", and the
  shipped admin console persists that token in **browser-readable
  `localStorage` on the server's origin**
  (`packages/snapback-admin-client/index.mjs:13,112-118`;
  `admin-ui/main.ts:22-27`). The round-6 justification ("a 0600 file a browser
  page cannot read") is true of the file and false of the system: in the
  same-origin topology §Summary blesses, an app-page XSS mints a session as any
  user.
- **Rejecting body auth on the live path deletes the ownership guard.** The
  shipped resume/unsubscribe/supersede guard compares `principal`/`user_id` and
  **short-circuits when both are absent** (`src/local.rs:1706-1718`,
  `1780-1792`, `1604-1608`). Under sessions, the round-6 rejection rule leaves
  the stored owner empty, so cross-owner protection disappears for any caller
  holding a connection grant and a subscription id. The anonymous case
  short-circuits even under a charitable implementation.
- **"Persisted across the restart" imports an attacker's bundle.** While
  `active == dev`, `/app/ensure` is Public and calls `load_functions`
  (`src/server.rs:646`; `src/local.rs:1096-1110`; `provisioning_allowed = !Prod`,
  `src/admin.rs:94-96`), so an attacker-installed bundle can be the last one
  loaded before staging and would then run under server-resolved `ctx.auth`.
- **The fencing rule contradicts the document's own lock order.** Live deltas are
  produced and enqueued **inside** the global write mutex (`with_snapback`,
  `src/server.rs:53-65` → `invoke_mutation_recording_with_id`, `:1955` →
  `notify_live_subscriptions_in_frame`, `src/local.rs:1423`, `3284`, `3402`), so
  "re-check the fencing generation immediately before the outbound delta takes
  effect" would require taking the projection lock inside the write lane — which
  the same section forbids. The drain side (`src/server.rs:2466-2476`,
  `2246-2258`) is lock-order-compatible and is the real effect boundary.
- **The must-understand structural gate is false** (both families).
  `validateDeploymentMetadata` compares stored `schema_hash`/`bundle_hash`
  against compiled-in hashes and **iterates expected keys**, so unknown metadata
  is silently ignored — it fails *open* on formats it has never seen
  (`cloudflare/src/coordinator.js:249-300`). A true structural argument exists
  and is adopted instead: the app is compiled into the Worker and `deploy.sh`
  ships the coordinator from the same tree, so no channel through the repo's
  deploy path delivers a sessions bundle to an old coordinator; the residual is a
  third-party fork vendoring a stale coordinator. Gate 3 remains real work —
  `ensureSchema()` runs DDL (including a destructive
  `migrateSubscriptionsSchema` DROP/RENAME) in the DO constructor *before*
  validation, with no enclosing transaction.
- **A third "sessions are decorative" surface exists.** `admin_run_function`
  classifies a *query* as a read and authorizes it tokenless on loopback while
  accepting a body `HandlerInput.auth` (`src/admin.rs:870-876`, `558-559`) — so a
  hostile local page can run auth-filtered queries under a forged identity. Worse
  than the raw table scan; §Existing surfaces claimed there were two.
- Also verified: tokenless value channels beyond raw rows — receipts carry an
  arbitrary `correlation: Value` echoed verbatim plus subscription `scope`
  (`src/live_wire.rs:205`), and the public inspect projection includes
  `recentDiagnostics` (`src/local.rs:170`) while handler rejection messages enter
  diagnostic details; per-source throttling is not merely degenerate but
  **unimplemented** (no `peer_addr`/`ConnectInfo` anywhere; `ctx.loopback` is
  bind-derived, `src/cli.rs:482`), which also means the LLP 0030 LAN proxy path
  presents every LAN request as loopback; and LLP 0034 already pins that an
  ownership check must be **atomic with the destructive act** (ENG-23426) — the
  ratified precedent the round-6 check-then-act fencing violates.

**Disposition (2026-07-12, revision 7):** all HIGH findings and the actionable
MEDIUMs applied — see the document's Changelog. Notably: the incarnation moves to
0039 (restoring the split's premise); session-minting capabilities are moved off
any browser-reachable credential; the live-path ownership predicate is pinned to
the server-resolved authority **and** the connection grant (anonymous compared on
the grant, never on "no user"); bundle provenance is attested across the mode
boundary and "or persisted across the restart" is deleted; the fencing effect
boundary is pinned to the **drain** with the generation carried on the enqueued
payload and the projection→`EphemeralApi` wiring named as an item-5 deliverable,
with the honest statement that revoked rows are still computed and serialized —
the guarantee is non-delivery, not non-computation; must-understand gate 2 is
replaced with the true structural argument and its residual named; the direct
runner is named as the third decorative surface and folded into landing item 2;
fencing markers get unique per-operation tokens; the ephemeral closure names
`session_id`/`user_id`/`custom_key` explicitly; and the code exchange is
verify-and-consume in **one** transaction (0011's outside-the-lock pin is about
Argon2, not a microsecond HMAC — and attempt accounting is a durable write on
every attempt anyway, so the compare-and-consume race the round-4 text spent a
paragraph closing was self-inflicted).

## Round 8 — 2026-07-12

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md` revision 7 (sha256
`6f56905a90b533212f91ce1ee3455628abdf4770211556b4d701aa6016173346`).
**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1 (`codex exec`), `gpt-5.6-sol`,
reasoning effort `ultra`, sandbox `read-only`. Fresh session.
**Date:** 2026-07-12
**Redacted:** Same as earlier rounds.
**Method:** Same round-8 brief as the paired reviewer; blind to it and to all
archived reviews. Authorization invalidation scoped out (LLP 0053's, reviewed
separately); the 0039/0053 seam in scope.

### Review body (verbatim)

## Overall assessment

The proposal has the right architecture: server-resolved authority, one invocation gate, protected identity storage, authority-bound connections, and a centralized client barrier form a credible first auth slice. It is unusually candid about offline-read loss, bearer/XSS exposure, restore limits, and the refresh-family ambiguity.

It is not ready to implement as written. Several load-bearing safety claims remain false or underspecified: `auth.mode` is not structurally must-understand, browser and operator privilege are not fully separated, staged deployment and revocation lack complete state machines, client fencing has no cross-tab or pre-dispatch linearization point, replay remains unsafe in dev mode, and the seam with LLP 0053 describes contracts that 0053 no longer promises. These are repairable, but they affect correctness and security rather than polish.

## Strengths

- The authority-resolution design correctly separates untrusted wire auth, server-resolved authority, and immutable `ctx.auth`; it also correctly rejects “stamp and ignore.” The current `HandlerInput.auth` default really does erase presence, as §Authority resolution observes ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:191), [manifest code](/Users/ccheever/projects/snapback/src/manifest.rs:912)).

- The subscription-ownership analysis is excellent. Current resume and unsubscribe checks short-circuit when both stored identity fields are absent, so replacing them with bound authority plus connection-grant ownership closes a real anonymous-owner hole ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:203), [current ownership check](/Users/ccheever/projects/snapback/src/local.rs:1707)).

- §Existing surfaces under sessions accurately finds the three major bypasses. Raw table reads are loopback-open `AdminRead`; `/app/ensure` is Public and applies executable artifacts; and the direct query runner accepts body auth while being tokenless on loopback ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:334), [route registry](/Users/ccheever/projects/snapback/src/server.rs:638), [admin access](/Users/ccheever/projects/snapback/src/admin.rs:534), [direct runner](/Users/ccheever/projects/snapback/src/admin.rs:854)). The response-sensitivity audit is an important improvement over route-only authorization.

- The protected identity/app-profile split follows the parent design well: credentials and verification material remain server-owned and unsynced, while applications join ordinary profile and membership data through `userId` ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:422), [LLP 0011](/Users/ccheever/projects/snapback/llp/0011-auth-and-permissions.rfc.md:80)).

- Moving code verification, attempt accounting, consumption, and first-session creation into one transaction is the right decision. LLP 0011’s outside-lock guidance concerns expensive password hashing, not a short HMAC operation that already requires a transactional attempt write ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:570), [LLP 0011](/Users/ccheever/projects/snapback/llp/0011-auth-and-permissions.rfc.md:80)).

- The session-family design thoughtfully distinguishes ordinary supersession from refresh reuse and avoids treating a sleeping healthy tab as a stolen-token event. It also names the remaining thief-first ambiguity rather than claiming bearer rotation can solve it ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:591)).

- Connection binding is scoped honestly: the connection token is a delegated bearer, not a second identity proof. Triggering grant expiry, caps, and revocation work is appropriate now that grants carry user authority ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:699), [LLP 0031](/Users/ccheever/projects/snapback/llp/0031-server-route-taxonomy.spec.md:458)).

- Extending client fencing from terminal errors to every success, callback, optimistic reconciliation, queue operation, and durable write is exactly the right principle. Current fire-and-forget retained writes demonstrate the problem concretely ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:818), [Contract adapter](/Users/ccheever/projects/snapback/packages/snapback-contract/index.mjs:418), [client store](/Users/ccheever/projects/snapback/packages/snapback-contract/client-store.mjs:147)).

- Disabling session-mode retained reads until durable authorization fences exist is a sound, honest product trade. Likewise, the restore section correctly acknowledges that an undeclared rollback cannot be detected using only state that was itself rolled back.

## Concerns

1. **HIGH** — The structural must-understand claim is false for both legacy local receivers and mixed-version Cloudflare deployments.

   §Target scope recognizes that legacy receivers ignore unknown fields, but does not establish a structural boundary for the local target. A legacy Rust `SchemaManifest` ignores unknown fields, and public `/app/ensure` can then apply the artifact as dev-mode state ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:58), [SchemaManifest](/Users/ccheever/projects/snapback/src/manifest.rs:63), [ensure handler](/Users/ccheever/projects/snapback/src/server.rs:2007)). Existing receivers already reject unsupported artifact versions, which is the structural boundary LLP 0012 defines ([artifact validation](/Users/ccheever/projects/snapback/src/manifest.rs:1456), [LLP 0012](/Users/ccheever/projects/snapback/llp/0012-headless-integration-contract.spec.md:89)).

   The Cloudflare replacement argument is also factually wrong. The handler Worker is deployed before the gateway/coordinator, using separate Wrangler services; during that window an old coordinator can invoke a new handler while still sending empty auth ([deploy script](/Users/ccheever/projects/snapback/cloudflare/deploy.sh:104), [handler config](/Users/ccheever/projects/snapback/cloudflare/wrangler.all-aboard.handler.jsonc:8), [gateway config](/Users/ccheever/projects/snapback/cloudflare/wrangler.all-aboard.jsonc:9), [empty auth invocation](/Users/ccheever/projects/snapback/cloudflare/src/coordinator.js:1220)). This is a first-party rollout channel, not merely a third-party-fork residual.

   *Resolves with:* introduce a legacy-rejected artifact/protocol version for every sessions-bearing schema and executable bundle; require a coordinator-to-handler mode/bundle protocol marker that a sessions handler rejects when absent or mismatched; and use atomic or version-pinned rollout. Acceptance must cover delivery to an old local server and both mixed Worker rollout directions, with no durable mutation or handler execution.

2. **HIGH** — The operator-only impersonation capability is not applied to all existing impersonation paths.

   §Built-in first provider correctly says the browser-held admin token must not read codes or mint sessions, but §Authority resolution directs user-scoped reads through host-ops, and the route table still describes `auth.mintSession` as `AdminWrite` plus the admin token ([LLP 0039 authority resolution](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:175), [provider restriction](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:657), [route table](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:1059)).

   Today host-ops accepts `userId`, constructs handler auth from it, and is gated only by the ordinary admin token ([request DTO](/Users/ccheever/projects/snapback/src/host_ops.rs:201), [authority construction](/Users/ccheever/projects/snapback/src/host_ops.rs:510), [HTTP gate](/Users/ccheever/projects/snapback/src/server.rs:1862)). The console stores that token in same-origin `localStorage` ([admin client](/Users/ccheever/projects/snapback/packages/snapback-admin-client/index.mjs:13)). Thus the same XSS the RFC analyzes can already call `function.run` as an arbitrary user, even if mailbox and mint receive a second check.

   *Resolves with:* define a distinct operator capability and carrier that is never exposed to browser code—preferably a Unix-domain socket or separate 0600 capability—and require it for every effective-principal assertion, mailbox read, and session mint. Enumerate host-ops suboperations as logical registry entries. Acceptance must prove that an admin-token-only caller cannot impersonate, read the mailbox, or mint a session.

3. **HIGH** — The staged-mode and executable-bundle transition is not a complete durable state machine.

   §Auth mode says the rest of the schema applies while only the mode becomes desired, consume failure leaves the active mode running, and `--clear-desired-auth-mode` unstages non-destructively ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:222)). Current storage persists one complete manifest and replaces the active in-memory schema atomically; it has no separate active and staged identities ([storage](/Users/ccheever/projects/snapback/src/storage.rs:463)). The RFC therefore does not define which manifest/hash is active during the transition, what unstage rewrites, or how reapplying the same artifact restages after a clear.

   The claimed “pre-bind startup provisioning—and only that” is also inconsistent with allowing `AdminWrite` schema/function provisioning. Existing direct and host-ops function-load channels remain post-bind operations ([LLP 0039 bundle rule](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:387), [route registry](/Users/ccheever/projects/snapback/src/server.rs:665), [host-ops load](/Users/ccheever/projects/snapback/src/host_ops.rs:406)). This matters before item 6 because LLP 0053 promises that function or authorization-metadata activation is an authorization event ([LLP 0053](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:169)).

   *Resolves with:* preferably stage the entire deployment—schema, functions, auth metadata, requested mode, and expected hashes—while leaving the active deployment untouched, then atomically activate it pre-bind. Otherwise define an explicit durable transition record with active identity, staged identity, desired mode, expected bundle hash, state, and error. Deny every post-bind activation channel under sessions until the 0053 activation-event mechanism exists. Validate all session invariants, including `KeyMode::Custom`, against requested, active, and desired modes. Test stage failure, clear, same-artifact reapply, restart, and every direct/host-ops load alias.

4. **HIGH** — The two-phase revocation protocol lacks a correct multi-operation representation and compatible linearization rule.

   A unique operation token identifies a marker owner, but does not define what happens when two same-generation revocations are pending ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:725)). With one marker, either the second operation replaces the first—allowing its rollback to expose the still-pending first operation—or it does not, allowing the first rollback to expose the second. “Stronger marker” has no ordering because both operations read the same generation.

   The locking rules are also incomplete. Every connection-scoped act must recheck atomically with the act, while the projection lock may never be taken under the global writer ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:780)). Current subscribe/resume/unsubscribe verifies before acquiring `SharedSnapback` ([server](/Users/ccheever/projects/snapback/src/server.rs:2026)); the cited teardown precedent achieved atomicity by acquiring the writer first and checking under it—the nesting this RFC prohibits ([LLP 0034](/Users/ccheever/projects/snapback/llp/0034-contract-source-seam-provider-side.rfc.md:491), [implementation](/Users/ccheever/projects/snapback/src/server.rs:2215)). The drain must also reject `pending-revoked` state, not merely a changed generation.

   Finally, the five-second close guarantee requires active cancellation. The current sender can await a non-reading socket indefinitely while serially sending a drained batch ([send loop](/Users/ccheever/projects/snapback/src/server.rs:2243)).

   *Resolves with:* define projection state as a per-session pending-operation set/refcount or a formally ordered state word, with exact begin/commit/rollback transitions and durable generation CAS semantics. Specify one linearization point for writer-lane acts, ephemeral acts, and drains without holding the projection lock while waiting for the writer. Add a transport abort handle and bounded sends. Model-check generated interleavings covering two revocations, commit/rollback in both orders, expiry, rotation, drains, and a blocked socket.

5. **HIGH** — The client barrier has neither a shared cross-context fence nor a compare-before-dispatch rule.

   The RFC calls its guard a “local monotonic authority epoch” ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:818)). That cannot fence another tab or an expired lease owner writing the shared local store after a newer tab clears it. The current localStorage implementation is unconditional read-modify-write, confirming that a shared CAS or namespace is new required work ([client store](/Users/ccheever/projects/snapback/packages/snapback-contract/client-store.mjs:83)).

   Compare-and-commit also protects only local state. An A-era mutation, retry, connection open, or scheduled refresh can be delayed until after A→B, reload B’s custody, perform a server effect under B, and merely discard its response as stale. This is particularly likely because refresh is required to read custody immediately before sending.

   The transition matrix also preserves same-user data without requiring immediate hiding, even though `sessionId` and `provider` may affect visibility ([matrix](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:855), [retained-scope caveat](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:844)). The same issue can occur across anonymous→authenticated transitions. A fresh connection is insufficient if old rows remain rendered until its snapshot arrives. Receipts, diagnostics, failed records, and listener history must also be part of the authority-scoped wipe because §Existing surfaces recognizes that they may contain arguments and scope.

   *Resolves with:* define a shared durable `clientAuthorityGeneration`, distinct from the server authorization epoch, and serialize authority transitions and all store writes under one cross-context lock/CAS or generation-keyed namespace. Add `compareAndDispatch(expectedAuthority)` that atomically verifies the generation and binds the credential/descriptor before every initial request and retry. Hide all authority-sensitive boundaries on any authority-instance change until a fresh snapshot proves equivalence, unless a function is explicitly `userId`-only. Test two tabs, stale lease owners, delayed outbound effects, same-user session replacement, and observability-state sentinels.

6. **HIGH** — The replay descriptor does not fence every authority class it claims to protect.

   The descriptor is per session but only per boot in dev mode, and its required predicate is stated only under sessions ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:950)). A per-boot value does not distinguish dev user A from dev user B, so an A mutation that never reached the server can first-deliver under B—the exact first-delivery hole the section claims to close. The lifecycle of the “anonymous-scope descriptor” is not defined: per-handshake strands offline work, per-boot strands it on restart, and a longer-lived value risks crossing reset/import boundaries.

   There is also a response-loss conflict. LLP 0051 currently promises original-result redelivery and exactly-once application after a lost response ([LLP 0051](/Users/ccheever/projects/snapback/llp/0051-language-neutral-data-tier.rfc.md:939), [settlement code](/Users/ccheever/projects/snapback/src/storage.rs:270)). If X/A committed, its response was lost, and the user reauthenticates as B, the descriptor now produces `AUTH_STALE_RESULT`; “re-record” may duplicate a committed effect, while discard may abandon an effect that never committed. The replacement of LLP 0011’s client-carried replay-auth wording also needs an explicit parent amendment ([LLP 0011](/Users/ccheever/projects/snapback/llp/0011-auth-and-permissions.rfc.md:121)).

   *Resolves with:* define descriptor scope for every authority-equivalence class. Dev requires a boot-scoped value bound to `userId`; anonymous should be explicitly incarnation-scoped; queued requests should carry and enforce descriptors in both modes after the protocol upgrade. Add an `outcome-unknown` state or same-principal settlement-status lookup so rollover recovery never casually re-executes. Amend LLP 0011’s replay language and test A→B first delivery, anonymous restart/reset/import, and lost-response→reauth.

7. **HIGH** — The refresh-family takeover mitigation has no executable carrier or failure protocol.

   The RFC promises that an unreconciled ordinary supersession revokes the family before local clearing, but only the client knows that custody reconciliation failed ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:618)). The route table offers only normal `SessionAuth` refresh/logout operations, so it does not state how a tombstoned stale bearer requests revocation or how the client confirms it ([route table](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:1059)). The same fail-safe is absent after an unreconciled `AUTH_REFRESH_SUPERSEDED` inside grace.

   *Resolves with:* define an idempotent, non-enumerating family-revoke operation that accepts an attributable current or tombstoned family token, or explicitly require a stale-token refresh after the grace period to trigger reuse revocation. The client must persist a pending revocation obligation, remain hidden/quarantined, retry after network loss, and not let a later login erase the obligation. Test thief-first rotation, sleeping tabs, storage failure, and lost revocation acknowledgement.

8. **HIGH** — The documented `_auth_*` collision recovery cannot be executed under the blanket reservation.

   The RFC makes `_auth_*` a codegen and manifest-load error, yet recovery requires an app migration that reads the legacy reserved table and writes a renamed table ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:449)). Current schema application validates the whole incoming manifest and then makes it the active schema; handler table access resolves only through that manifest ([schema apply](/Users/ccheever/projects/snapback/src/storage.rs:463), [table lookup](/Users/ccheever/projects/snapback/src/storage.rs:2694)). Once reservation enforcement lands, no ordinary manifest can name both the legacy table and its replacement.

   *Resolves with:* specify a narrow grandfathering rule for exact pre-existing reserved declarations in dev mode, forbidding new or changed `_auth_*` declarations, or provide a pre-bind host-op that performs the copy/rename and rewrites the stored manifest. Acceptance must execute the complete recovery without an old binary or manual SQLite access.

9. **MEDIUM** — Physical backup consistency and declared restore execution are underspecified.

   §Protected identity core says copying the whole instance directory produces an internally consistent SQLite/keyring pair ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:494)). The current database runs in WAL mode, so a live directory copy is not necessarily an atomic SQLite snapshot, much less atomic with keyring rotation ([storage configuration](/Users/ccheever/projects/snapback/src/storage.rs:1309)). LLP 0007 distinguishes byte-level backup as its own future contract rather than proving arbitrary directory-copy consistency ([LLP 0007](/Users/ccheever/projects/snapback/llp/0007-storage-portability.spec.md:413)).

   A post-bind host-ops restore verb would also leave a window in which a resurrected session could authenticate. The startup flag’s one-shot/idempotence behavior is unspecified, and Acceptance incorrectly says an unqualified physical restore invalidates sessions even though the design only handles declared restore.

   *Resolves with:* require a stopped/quiesced copy or coordinated snapshot covering SQLite, WAL state, and keyring. Execute declared restore pre-bind as one atomic database transaction that rotates incarnation, revokes sessions, and purges challenges. Define the flag as one-shot and idempotent, add crash-injection tests, and qualify Acceptance as “declared physical restore.”

10. **HIGH** — The LLP 0039↔0053 seam and landing edges describe contracts LLP 0053 does not promise.

   §Permission dependencies still assigns 0053 a dependency-classification model, `permissionDependencies`, typed subject/scope expressions, and an unclassified-dependency diagnostic ([LLP 0039 seam](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:885), [registrations](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:1075)). LLP 0053 explicitly abandons classification in favor of orthogonal result/authorization declarations, an event universe, persistent obligations, and per-query fences ([LLP 0053 motivation](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:64), [declarations](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:142), [obligations](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:241)).

   The claimed independence of item 5 is also not established. A coordinator that merely accepts a disposition is insufficient for 0053’s target scope, `(incarnation, epoch)` witness, durable obligation, and per-query fence ([LLP 0039 landing order](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:1091), [LLP 0053 client fences](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:298)). The card-game claim that a removed player necessarily keeps receiving until item 6 also conflicts with 0053’s promise that connected writes to read tables are handled by matcher re-query. This is a seam inconsistency, irrespective of whether 0053’s underlying design is good.

   *Resolves with:* rewrite the seam around what 0053 actually promises. Either put the complete coordinator command—expected authority, target/scope, disposition, witness/fence—into 0039 so item 5 is genuinely independent, or make item 5 depend on Accepted 0053. Remove abandoned vocabulary and diagnostics, then recalculate activation and landing edges and correct the proving-demo claim.

11. **MEDIUM** — The provider/catalog contract is not sufficiently exact for interoperable, crash-safe implementation.

   Request-code has an exact response, but exchange, refresh, logout, and session responses do not. The kit must rotate a bearer older than seven days, yet `_auth_sessions` has no current-token issuance timestamp from which that age can be computed ([catalog](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:422), [provider state machine](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:529)). Token and authenticated-session responses also need `Cache-Control: no-store`; current CORS middleware overwrites `Vary` with `Origin`, so an independently added `Vary: Authorization` would be lost ([CORS middleware](/Users/ccheever/projects/snapback/src/server.rs:1563)).

   The catalog omits important relational invariants: identity→user integrity, session identity/user agreement, expiry ordering, exactly one current family token, deterministic oldest-session eviction, and the complete generation-bump set. Mailbox-capacity failure is not integrated into the challenge transaction, so a request can supersede a usable code and then fail to make the new one retrievable. The keyring contract names generic HMAC and write-temp/fsync/rename but not algorithm, key size, exact encoding, test vectors, safe temporary-file creation, or parent-directory fsync ([keyring section](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:548)).

   *Resolves with:* add versioned request/response schemas, `current_token_issued_at` or equivalent, no-store/cache-variation rules, and a compact relational/transition invariant table. Reserve mailbox capacity before supersession or define atomic compensation. Pin HMAC-SHA-256 or another exact primitive, key size, encoding, test vectors, constant-time comparison, symlink-safe `create_new` replacement, and parent-directory durability.

12. **MEDIUM** — Diagnostics and Acceptance contain unresolved protocol contradictions.

   `AUTH_MODE_PENDING` is listed as startup/load-time even though app-data requests emit it, while `AUTH_MODE_DEV` has no HTTP/retry row at all ([diagnostics](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:1008)). The current mapper sends every unknown code to 400, so “add the mappings above” leaves these states incomplete ([status mapper](/Users/ccheever/projects/snapback/src/server.rs:2624)). The list also retains the obsolete classification diagnostic.

   Descriptor absence and unknown version are protocol/capability failures, not evidence of a different authority, yet both receive `AUTH_STALE_RESULT` and discard-or-re-record guidance. Finally, §Auth mode deliberately permits offline cold boot to render stored stale data before a handshake, while Acceptance says the handshake precedes any retained render ([offline exception](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:239), [Acceptance](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:1278), [LLP 0043](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:74)).

   *Resolves with:* make the diagnostic registry exhaustive and generated into the HTTP/live/client mappings; distinguish descriptor-required/version-unsupported from actual stale authority; remove obsolete 0053 vocabulary; and qualify the handshake acceptance as preceding online interaction or retained-data release, with a separate offline-cold-boot case.

## Suggestions

- Model-check the staged-mode and revocation state machines before implementation. A small TLA+, Stateright, or property-based reference model would pay for itself here because the dangerous cases are interleavings, rollback, and crash recovery rather than ordinary happy paths.

- Implement client fencing as generation-keyed namespaces rather than relying entirely on destructive clearing. A stale tab may still write, but it can write only into an unreachable old generation that later GC removes.

- Consider making the operator plane a local Unix-domain socket with peer/permission checks. That gives impersonation, restore, and pre-bind provisioning a transport that browser JavaScript cannot accidentally inherit.

- Generate logical-operation policy metadata, route parity tests, diagnostic mappings, and capability declarations from one schema. The registry unit should include host-op IDs, function kinds, and WebSocket variants, not merely HTTP paths.

- Add reference wire vectors for token parsing, code HMAC input encoding, authority descriptors, and session DTOs. Rust and TypeScript should consume the same vectors.

- Keep the named undeclared-restore residual and bearer/XSS residual even after tightening their procedures; their explicit treatment is one of the document’s strengths.

## Open questions

- Is Cloudflare explicitly unsupported for sessions in this slice? If so, what hard structural refusal prevents deploying a sessions bundle there? If supported, what is the atomic/versioned rollout protocol?

- What operations belong exclusively to the operator plane: impersonation, mailbox reads, session mint/revoke, code activation, restore, and raw data access?

- Is auth-mode transition best modeled as a whole-deployment activation rather than a field overlay on the currently active manifest?

- What exact data structure and linearization point makes concurrent revocation, rollback, connection acts, and outbound drains mutually coherent without violating L9?

- What constitutes authority equivalence for keeping live rows: `userId`, the whole `ctx.auth`, or a declared function-specific subset?

- What is the lifetime of an anonymous replay authority, and how should a committed-but-response-lost mutation be settled after session rollover?

- Is the first slice willing to accept bearer-only takeover ambiguity, or should device/attempt identifiers or sender-bound keys enter v1?

- What backup/quiescence guarantee is operationally supportable, and is an external monotonic restore anchor worth requiring?

- Does item 5 own the full 0053 coordinator command and durable-fence interface, or should the landing graph admit that it depends on 0053?

## Readiness verdict

Verdict: NOT READY

The architecture is promising, but unresolved structural-gating, privilege-separation, transition, revocation, client-linearization, replay, and cross-RFC seam defects remain material to security and correctness. The proposal should return to review after those protocols and dependency edges are made executable and their failure interleavings are reflected in Acceptance.
### Orchestrator verification notes — round 8 (outside the verbatim body)

**Sharp divergence between the families, worth recording.** Claude: 1 HIGH,
"close… a single focused revision should close them and reach READY." GPT:
9 HIGH, "should return to review after those protocols are made executable."
The gap is methodological, not factual: GPT holds the document to *executable
protocol* standards (durable state machines, linearization proofs, carrier
definitions for every failure path), while Claude accepts well-argued design pins
at RFC altitude. Both are defensible readings of what an RFC owes; LLP 0005
reserves the call to the author.

Claude's single HIGH was a **self-contradiction the revision-7 fix created**: the
prose forbade a browser-held credential from minting sessions, but the **route
table still said `AdminSecretRead`** for the mailbox — so an implementer following
the normative table would ship exactly the app-XSS → any-user takeover the prose
identifies as the worst risk. Fixing prose without fixing the table.

Findings applied in revision 8: the route table now carries an
`ImpersonationCapability` distinct from any admin token; that capability is
generalized to **every** impersonation path (host-ops `function.run --as-user` /
`--as-role`, not just the two new capabilities — gating only the new doors would
have left the old one open); a **`requiredCapabilities`** list in the persisted
manifest gives the local target the must-understand backstop it lacked (verified:
no `deny_unknown_fields` anywhere in `src/`, so an older binary could reopen a
sessions database and serve it under legacy body authority — a rollback was a
downgrade attack on yourself); the `_auth_*` collision recovery becomes a
dedicated operator verb, because the blanket reservation makes the previously
proposed app-level migration **unexecutable** (`ctx.db` refuses the prefix, so no
handler can read the colliding table); and the 0039→0053 seam stops naming 0053's
internals — the vocabulary it copied went stale the moment 0053's model was
redesigned, so the seam is now stated as outcomes only, with the registration list
re-partitioned by owning registry (0012 diagnostics/capability facts; 0051 D4 wire
schemas; 0053 its own).

Remaining GPT-family concerns (revocation multi-operation representation, client
cross-context fence, replay descriptor authority classes, refresh-family carrier,
staged-bundle durable state machine) are substantive and carried into round 9.

## Round 9 — 2026-07-13 (focused audit of the final unreviewed fixes)

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md`, current working-tree
revision (sha256
`437a5324317f48b7b737524bcbf8d3eea2c97d5de4541e0f2ac45eede8fc28b9`).
**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1 (`codex exec --ephemeral`),
model `gpt-5.6-sol`, reasoning effort `xhigh`, sandbox `read-only`, workdir
`/Users/ccheever/projects/snapback-eng-24593-auth-review`. Fresh session
`019f5b00-7c7e-7fb3-bb39-77fc3ef2a7a1`.
**Date:** 2026-07-13
**Redacted:** Same as earlier rounds.
**Method:** Focused ENG-24593 gate review of the five residuals and the final
unreviewed corrections. This review was explicitly informed by all prior
`0039-auth-vertical-slice.*.md` artifacts (not blind), LLP 0053 at the seam,
and direct source verification. The reviewer was instructed to judge at the
author-ratified RFC altitude and not accept on the author's behalf.

### Review body (verbatim)

## Overall assessment

**Not ready for author acceptance.** No HIGH architectural defect emerged: the core authorization model remains coherent and implementable at the author-ratified RFC altitude. However, the final unreviewed revision contains two MEDIUM normative contradictions and several LOW source/citation inconsistencies.

The PublicInspect correction and LAN/proxy residual are sound. The console-token and collision-rescue fixes express the right intent but were not propagated consistently into the route table, transition prose, and acceptance suite. Status should remain Draft pending bounded edits.

## Strengths with exact sections

- **PublicInspect correction is verified.** §Existing surfaces correctly identifies `/` and `/inspect` as `Public`, not loopback-tokenless `AdminRead` ([0039:384](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:384); [route registry](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/server.rs:1367)). The current `PublicDiagnostic` projection also structurally removes free-form `message` and `details` ([diagnostic.rs:31](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/diagnostic.rs:31)), supporting the RFC’s typed-projection remedy.

- **The console threat model is now honest.** §Built-in first provider recognizes that the shipped console stores one token in `localStorage`, uses it for raw table scans, and shares the app origin ([0039:737](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:737); [admin client:13](/Users/ccheever/projects/snapback-eng-24593-auth-review/packages/snapback-admin-client/index.mjs:13); [admin UI:24](/Users/ccheever/projects/snapback-eng-24593-auth-review/admin-ui/main.ts:24)). Making a scoped, expiring credential an item-2 deliverable is the correct direction.

- **The principal collision-rescue design is executable at RFC altitude.** §Protected identity core correctly concludes that app-level rename-and-copy is impossible under an absolute reservation and introduces a storage-layer operator verb below `ctx.db` and manifest validation ([0039:501](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:501)).

- **The local rollback backstop is technically valid.** A present-but-unparseable legacy manifest value fails with `SNAPBACK_SCHEMA_PARSE_FAILED`, propagated from database open; merely removing the key would fall open to the default manifest ([storage.rs:344](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/storage.rs:344); [storage.rs:1954](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/storage.rs:1954)). Relocate-and-poison is therefore the correct structural mechanism.

- **The LAN/proxy residual is accurately stated.** The final mode-table text admits that an explicitly LAN-bound Vite proxy re-exposes client-asserted dev authority and that the fence protects only unproxied defaults ([0039:283](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:283)). This now matches LLP 0030’s warning that non-loopback Vite may expose both read and token-gated surfaces ([0030:629](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0030-managed-snapback-vite-dev.rfc.md:629)).

- **The intended ephemeral replacement predicate is complete.** §Authority transitions explicitly rejects `auth`, `session_id`, `user_id`, and `custom_key`, including explicit nulls, and derives identity solely from bound connection authority ([0039:942](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:942)). The current source confirms why this is necessary: publish/delete carry the sibling key fields, and `resolved_identity` only compares them with an `auth` value that is itself currently client-supplied ([ephemeral.rs:441](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/ephemeral.rs:441); [ephemeral.rs:3458](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/ephemeral.rs:3458)).

## Findings

### HIGH

None.

### MEDIUM

1. **The short-lived console-token deliverable is not yet a coherent authorization contract.**

   Evidence: §Built-in first provider says whatever the console persists cannot bulk-read raw data ([0039:750](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:750)), but the route table still grants `AdminSecretRead` using “admin token” ([0039:1211](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1211)), and acceptance still says raw reads fail without and succeed with that token ([0039:1394](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1394)). The shipped client uses the same stored token for every request, including `scanTable`.

   This is security-significant: implementing the table preserves the app-XSS bulk-read capability, while implementing the prose leaves the console’s raw-data workflow undefined.

   Concrete resolution:

   - Pin that the console-persisted credential never satisfies `AdminSecretRead`.
   - Pin a separate, operator-minted, short-lived `AdminSecretRead` lease held in memory only, scoped to named table(s), bounded rows/bytes, and without a wildcard scope.
   - Change the route-table credential cell to that lease, not “admin token.”
   - Replace the acceptance row with: persisted console credential and durable admin token both fail raw scans; a live lease reads only its named table and bounded extent; the same lease fails another table and fails after expiry; no persisted browser value grants bulk reads.
   - Amend the standing residual to say that an in-memory lease remains stealable for its remaining TTL and granted scope.

2. **The collision-rescue correction remains contradicted by transition and acceptance prose.**

   Evidence: the governing section says app rename-and-copy is impossible and requires `auth.rescueCollidingTable` ([0039:501](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:501)), but the transition section still calls “dev-mode rename-and-copy” sanctioned recovery ([0039:293](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:293)), and acceptance still requires “dev-mode rename-copy” ([0039:1427](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1427)). The impersonation-capability carrier obligation also omits the rescue verb.

   Concrete resolution:

   - Replace both rename-copy references with `auth.rescueCollidingTable`; retain `--drop-orphaned-auth-tables` only as the separately tested destructive fallback.
   - Change “only code permitted to read a reserved-prefix table” to “only recovery code permitted to read a foreign/unowned reserved-prefix table”; the auth subsystem necessarily reads catalog-owned `_auth_*` tables.
   - Add the rescue verb to the route/effect-gate table and §Protocol obligations item 7.
   - Add this acceptance row:

     > Given a dev/test database containing an unowned physical `_auth_*` table, staging sessions fails pre-DDL with `SNAPBACK_AUTH_TABLE_COLLISION`. Without `ImpersonationCapability`, and on `prod`, rescue is refused without mutation. With the capability, `auth.rescueCollidingTable` transactionally copies schema and rows into an operator-named non-reserved app table, drops only the source after successful copy, and leaves the source intact on any failure. The subsequent collision check and sessions activation succeed.

### LOW

1. **The item-5-to-item-7 enforcement window remains unnamed and avoidable.**

   Sessions become enableable after items 1–5 ([0039:1275](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1275)), while first-delivery descriptor enforcement and the two-axis store arrive in item 7 ([0039:1269](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1269)). During that window queue-authority consistency is client-only. This remains a consistency risk rather than an authentication bypass because the descriptor grants no authority.

   Concrete resolution: change the activation gate to require **items 1–5 and 7**. Acceptance should prove that a build lacking the descriptor capability refuses sessions activation with `SNAPBACK_CAPABILITY_UNSUPPORTED`, while health and the bootstrap handshake remain available.

2. **The diagnostics and route-table editorial pass is incomplete.**

   Precise contradictions and edits:

   - Change `auth.mintSession` at [0039:343](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:343) from “admin token” to “route `AdminWrite` plus `ImpersonationCapability`.”
   - Reconcile `MODE_DEV`: keep the table’s typed HTTP 404 and change [0039:1215](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1215) to “a typed 404, not an untyped missing-route response.”
   - Replace “token-gated mailbox” at [0039:1191](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1191) and in provider acceptance with `ImpersonationCapability`-gated; explicitly test that an ordinary admin token is insufficient.
   - Express mailbox/mint/rescue rows as `AdminWrite` route policy plus an `ImpersonationCapability` effect gate; do not place the effect capability in the path-policy column.
   - Give `/app/ensure` credential resolution as “none for attestation; `AdminWrite` or pre-bind authority for mutation,” replacing the dash.
   - Move `app.reset → ConnectionRegistry` ownership at [0039:546](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:546) from item 4 to item 5.
   - Replace the dead `§Durable clearing` link at [0039:923](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:923).
   - Assign mode-dependent wire DTOs consistently to LLP 0051 D4, not LLP 0012.
   - In §Protocol obligations, make outbox **drain** the atomic effect boundary; enqueue stamps the generation but is not the effect boundary ([0039:1320](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1320)).
   - Change “handshake precedes any retained render” to “handshake precedes online retained-data promotion/release and connection open,” preserving the explicitly allowed offline stale render.

3. **The retained-scope seam still presents a settled 0053 decision as open.**

   Evidence: 0039 offers either `userId`-only dependence or widening retained scope as a future choice ([0039:923](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:923)); 0053 already pins `Retainable ⇒ userId-only authority dependence` ([0053:603](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0053-authorization-invalidation.rfc.md:603)). In addition, item 8 names `authorizedUntil` and “its 24-hour default” despite the outcome-only seam and 0053 still treating the number as an author-owned product question.

   Concrete resolution:

   - State categorically that v1 retainable functions declare `userId`-only authority dependence; widening retained scope is a future protocol change, not an item-8 alternative.
   - Add to the handshake: the minimum disposition-aware client protocol is reported and both server and kit refuse session-mode retained subscriptions from older/unknown clients, matching [0053:580](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0053-authorization-invalidation.rfc.md:580).
   - Rewrite item 8 in outcome terms: it requires items 5–7, 0053’s accepted invalidation contract, and a disposition-aware client. Leave lease mechanism and numeric default to 0053.

4. **Citation precision remains below the RFC’s own provenance standard.**

   Concrete corrections:

   - `PublicInspect` is public, but its current `PublicDiagnostic` projection already strips messages/details. Say that explicitly instead of implying raw handler messages currently escape; retain the response-sensitivity audit as a regression gate.
   - Replace “LLP 0031 D3-style sentinel test” with “a field-level public-vs-gated projection sentinel following 0031 D3, plus a separate secret-redaction test.” D3 is the projection decision, not a general log-secrecy test.
   - Replace every unqualified “M1/M2 has shipped” with “the first closed-IR, single-query M1/M2 slice shipped,” matching LLP 0043’s own revision record ([0043:8](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0043-offline-replay-retention.rfc.md:8)).
   - Replace the claim that 0051 merely has stale “auth replayed from the ledger” prose with the exact semantic conflict: 0051 D1 freezes the server-retained handler-observed identity for replay ([0051:250](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0051-language-neutral-data-tier.rfc.md:250)), while 0039 requires current credential resolution and descriptor mismatch refusal before execution. The 0051 amendment must make retained auth evidence/fingerprint, not replay execution authority.

5. **The relocate-and-poison backstop still lacks acceptance and downgrade semantics.**

   Concrete acceptance row:

   > After sessions activation, the capability-aware binary reads the relocated manifest key and the legacy key remains present with a sentinel that fails typed manifest deserialization. A pre-slice binary fails database open with `SNAPBACK_SCHEMA_PARSE_FAILED`, binds no listener, and performs no mutation. A missing legacy key is separately shown not to satisfy the backstop. The capability-aware binary continues to open normally.

   Add a normative downgrade sentence. Recommended pin:

   > `--allow-auth-downgrade` leaves the legacy key poisoned and the manifest relocated; it authorizes dev mode in a capability-aware binary, not rollback to a pre-slice binary.

6. **The complete-ephemeral-field explanation contains one source-fact error.**

   `PublishRequest` and `DeleteRequest` carry `session_id`, `user_id`, `custom_key`, and `auth`; `SubscribeRequest` carries only `auth` ([ephemeral.rs:441](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/ephemeral.rs:441)). The current sentence says all three request types carry all sibling fields.

   Concrete resolution: describe the field set per operation. Add acceptance proving, over both HTTP and WebSocket:

   - Publish/delete reject `auth`, `session_id`, `user_id`, and `custom_key`, including explicit null.
   - Subscribe/unsubscribe reject `auth`; their closed session DTOs also reject injected unknown identity fields.
   - Every permitted key mode derives only from bound authority.
   - Missing required authority dimensions fail explicitly.
   - Cross-user replace and delete fail for every permitted key mode.

## Five-item closure checklist

1. **Enforcement window:** require items 1–5 **and 7** before sessions activation; add missing-capability and first-delivery acceptance.

2. **Diagnostics/route debris:** perform the bounded consistency edits for `MODE_DEV`, impersonation gates, console `AdminSecretRead`, mailbox acceptance, `/app/ensure`, item ownership, DTO registry ownership, drain semantics, offline handshake wording, and both stale collision-recovery references.

3. **0053 retained seam:** replace the open choice with pinned `userId`-only retainability; add the minimum disposition-aware client capability to the handshake; rewrite item 8 in outcome-only terms.

4. **Citation precision:** qualify PublicInspect’s existing typed projection, split the D3 projection and redaction tests, narrow the 0043 shipped claim, state the actual 0051 replay-semantic conflict, and correct the per-operation ephemeral source description.

5. **Relocate-and-poison:** add the old-binary/current-binary fixture row and pin that authorized downgrade leaves the legacy key poisoned.

## Open questions

- Is the recommended console split authoritative: persisted non-secret-read console credential plus an in-memory, table-scoped `AdminSecretRead` lease? The current text needs one concrete capability model.
- Will the author gate sessions on item 7, as recommended, or explicitly accept client-only queue enforcement between items 5 and 7?
- Is typed HTTP 404 the intended `SNAPBACK_AUTH_MODE_DEV` status? If not, both the diagnostics table and prose need one replacement status.
- Will `--allow-auth-downgrade` deliberately preserve the poison fence? Restoring the legacy key would require a substantially larger security and migration argument.

## Recommended next step

Apply one bounded correction pass covering the edits above while retaining Draft status. A **focused confirmation review is required** afterward, limited to:

- console credential and route-table coherence;
- collision-rescue transition and acceptance;
- activation gating;
- 0053 handshake/retainability alignment;
- ephemeral per-operation rejection;
- poison-fence acceptance and downgrade behavior;
- the enumerated citation/debris replacements.

A new broad twelve-round refinement loop is unnecessary, but confirmation should occur before any author acceptance decision.

## Round 10 — 2026-07-13 (blind confirmation of the focused correction)

**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** Codex CLI 0.144.1, `gpt-5.6-sol`, reasoning effort `xhigh`
**Method:** CLI runner, fresh ephemeral thread, read-only sandbox; reviewer was forbidden from reading `llp/reviews/`
**Session id:** `019f5b19-c0b2-7490-9d2d-d50796508cff`
**Reviewed SHA-256:** `33d4522e1fc8966aa51a4d4abbe761e316551b12af82b98b6099f8e2d036462b`
**Redacted:** no

Digest `33d4522e…36462b` matches. I read all 1,945 lines, inspected only necessary source/LLPs, did not read `llp/reviews/`, and made no edits. `./ref-check --verbose` passes with zero errors.

### Verified strengths

- Cloudflare’s handler-first split deployment and current empty `authJson` are accurately identified; the invocation marker is the right receiver-side protection. See [deploy.sh](/Users/ccheever/projects/snapback-eng-24593-auth-review/cloudflare/deploy.sh:337), [coordinator.js](/Users/ccheever/projects/snapback-eng-24593-auth-review/cloudflare/src/coordinator.js:2363), and [LLP 0039](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:90).
- Admin, secret-read lease, root minting authority, and impersonation authority are conceptually separated; the root never enters browser memory. This correctly addresses the shipped console’s `localStorage` credential behavior in [snapback-admin-client](/Users/ccheever/projects/snapback-eng-24593-auth-review/packages/snapback-admin-client/index.mjs:13).
- Relocate-and-poison now has permanent-downgrade, crash-boundary, missing-key, and actual-predecessor acceptance. Collision rescue is executable below manifest/`ctx.db` validation and transactionally specified.
- Item 5→7 queued replay is explicitly disabled in design, handshake behavior, landing order, acceptance, status, and changelog.
- Route policy, credential resolution, invocation authority, legacy-body acceptance, effect policy, response sensitivity, and mode overlay are separated. `MODE_DEV` is consistently a typed HTTP 404.
- `Retainable ⇒ userId-only` matches [LLP 0053](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0053-authorization-invalidation.rfc.md:601), including the legacy-client retained-read gate.
- The per-operation ephemeral field sets match the shipped DTOs in [ephemeral.rs](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/ephemeral.rs:441) and are carried into acceptance.
- `PublicInspect` is now described correctly. `PublicDiagnostic` structurally drops message/details, and `PublicInspect` uses exhaustive projection, matching LLP 0031 D3 and the source in [diagnostic.rs](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/diagnostic.rs:31) and [local.rs](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/local.rs:215).

### Defects

No HIGH defects.

MEDIUM

1. Landing ownership is still incomplete.

   Evidence: landing item 3 names only the collision check, not `auth.rescueCollidingTable`; item 4 names generic body-auth rejection but not the corrected per-operation sibling-field rejection, closed session DTOs, `KeyMode::Custom` prohibition, or permission-policy failure ([LLP 0039](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1320)). Those obligations appear in design and acceptance at lines 562 and 1639, but no numbered landing item owns them. Because activation is defined solely as completion of items 1–5, this is a real sequencing gap.

   Resolution: assign collision rescue explicitly to item 3, and assign the complete session-mode ephemeral DTO/key/policy closure explicitly to item 4; state that neither item is complete without its corresponding acceptance cases.

2. Acceptance does not prove credential non-substitutability across every impersonation path.

   Evidence: design correctly says the mailbox, `auth.mintSession`, and legacy `function.run --as-user/--as-role` all require `ImpersonationCapability` ([LLP 0039](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:377)); the route matrix repeats that at lines 1282–1290. But §Acceptance explicitly tests only mailbox carrier separation at lines 1518–1523. Its registry sweep covers `AppAuth`/`ConnectionAuth` and the direct runner, not the host-ops impersonation verbs.

   Resolution: add an acceptance matrix proving that ordinary admin, persisted console credential, `AdminSecretRead`, and the secret-read root authority cannot invoke any impersonation effect; cover mailbox, `auth.mintSession`, rescue, and `function.run --as-user/--as-role`, including production refusal.

LOW

1. The Cloudflare current-state description is stale.

   Evidence: the RFC says deployment validation currently runs after system-table/subscription migration and that `ensureSchema()` performs destructive migration before validation ([LLP 0039](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:146), lines 1452–1456). Current `initializeSchema()` validates deployment metadata before `ensureCurrentSchema()` and subscription migration; only `_snapback_meta` creation precedes validation ([coordinator.js](/Users/ccheever/projects/snapback-eng-24593-auth-review/cloudflare/src/coordinator.js:164)).

   Resolution: state the exact current order. Preserve the byte-for-byte requirement by requiring session preflight before even the metadata-table DDL, without claiming destructive migration currently precedes validation.

2. “No struct in the repo uses `deny_unknown_fields`” is false.

   Evidence: `SchemaManifest` does omit it, which supports the downgrade argument ([manifest.rs](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/manifest.rs:78)); other structs do use it, such as `OpenConnectionRequest` ([server.rs](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/server.rs:959)).

   Resolution: change the sentence to “`SchemaManifest` does not use `deny_unknown_fields`.” The relocate-and-poison argument remains valid.

### Final verdict

NOT READY

## Round 11 — 2026-07-13 (second blind confirmation)

**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** Codex CLI 0.144.1, `gpt-5.6-sol`, reasoning effort `xhigh`
**Method:** CLI runner, fresh ephemeral thread, read-only sandbox; reviewer was forbidden from reading `llp/reviews/`
**Session id:** `019f5b24-8410-76d1-aa11-8ed4c8624e94`
**Reviewed SHA-256:** `6a801ed0bee048b681a69b7aff0001a69e0a11db4e2e516c767bcb6e172c650a`
**Transcript SHA-256:** `0166296861ed5c494f2744a684a3b5a0ca167a448be54a94376890f9ab978cfb`
**Redacted:** no

## Verified strengths

- Collision rescue is owned by landing item 3, while the complete session-mode ephemeral closure is owned by item 4, with corresponding acceptance coverage.
- Credential non-substitutability covers all four impersonation effects: mailbox, session minting, collision rescue, and host-ops impersonation.
- Cloudflare facts match source: `_snapback_meta` is created before deployment validation, schema reconciliation follows validation, handler invocations currently receive empty auth, and deployment is handler-first then gateway/coordinator.
- The relocate-and-poison design includes actual-predecessor, missing-key, crash-boundary, permanent-poison, and downgrade acceptance cases.
- The item-5→7 window, `userId`-only retention, client capability gating, per-operation ephemeral fields, and `PublicInspect` projection are propagated through design, acceptance, status, and changelog.

## Findings

### HIGH

1. The local legacy-receiver backstop protects rollback after activation, but not first installation onto a pre-slice binary.

The RFC correctly states that sender checks are insufficient because a bundle outside first-party tooling would fail open ([RFC 0039:71](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:71)). But its local structural mechanism is installed only “on sessions activation” ([RFC 0039:121](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:121)).

A fresh sessions manifest sent directly to a pre-slice local binary therefore remains unprotected:

- `SchemaManifest` has no `deny_unknown_fields`, so `auth.mode` is discarded ([manifest.rs:78](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/manifest.rs:78)).
- The apply path validates only the existing artifact header ([local.rs:1190](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/local.rs:1190)).
- Existing binaries reject a different `schemaVersion`, but the RFC mandates no version/discriminator change for sessions bundles ([manifest.rs:2044](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/manifest.rs:2044)).
- The typed manifest is then reserialized without the unknown field and persisted ([storage.rs:784](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/storage.rs:784)).

Thus a sessions-oriented bundle reaching an old local receiver can be accepted and served under legacy client-supplied body authority—the exact must-understand failure the section claims to close.

Concrete resolution: require sessions deployments to carry a discriminator that pre-slice local binaries already reject, most naturally a new schema/deployment artifact version. A session-aware binary may accept both legacy-dev and new-sessions versions; an old binary must reject the sessions version before applying schema, functions, or seed. Add acceptance using a pinned pre-slice binary and a fresh database—not an already activated/poisoned database—proving the complete sessions `/app/ensure` deployment leaves schema, bundle, seed, and database unchanged. Keep relocate-and-poison for rollback protection.

### MEDIUM

None.

### LOW

None substantive.

Editorial nit: [RFC 0039:62](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:62) says the `auth.mode` carve-out is “registered” in LLP 0012, while [RFC 0039:1397](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1397) correctly lists that registration as a future companion obligation, and LLP 0012 currently contains no such entry. Change the former to “must be registered.”

## Verification

- SHA-256 verified unchanged: `6a801ed0bee048b681a69b7aff0001a69e0a11db4e2e516c767bcb6e172c650a`.
- Read all 1,974 lines.
- Did not read any file under `llp/reviews/`.
- `./ref-check --verbose` passed: 54 LLPs, 553 references, 0 errors, 8 informational unchecked shorthands.
- No edits made.

NOT READY


## Round 12 — 2026-07-13 (final blind confirmation of the exact gate candidate)

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md` at SHA-256
`9a2be519160ff4f1d43dc3795c842140bae175519b4c08f46acd6bf55d1ad1ad`
and `llp/0012-headless-integration-contract.spec.md` at SHA-256
`a740d9da6fe4f309caf4fc18a37b237267f3ff5a54c54a7bae2e9a71e97611ec`.
**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1
(`codex exec --ephemeral`), model `gpt-5.6-sol`, reasoning effort
`xhigh`, sandbox `read-only`, workdir
`/Users/ccheever/projects/snapback-eng-24593-auth-review`.
Fresh thread `019f5b6c-a7c3-72f0-9664-8225215f39d9`.
**Date:** 2026-07-13
**Review-body SHA-256:**
`53494f47d4019b084e843e66bbe46e606e11ca46b8df4826a49a55d3af549597`.
**Redacted:** no
**Method:** Blind final confirmation of the exact immutable pair. The reviewer
was forbidden from reading prior review artifacts, verified both hashes,
inspected governing LLPs and source, and edited nothing.

### Review body (verbatim)

# Verdict: NOT READY

Both immutable-candidate hashes match:

- `0039`: `9a2be519160ff4f1d43dc3795c842140bae175519b4c08f46acd6bf55d1ad1ad`
- `0012`: `a740d9da6fe4f309caf4fc18a37b237267f3ff5a54c54a7bae2e9a71e97611ec`

I found one security-contract blocker and one cross-document enforceability defect. Neither requires reopening the architecture.

## Finding 1 — HIGH: the allowed version/auth-mode relation is not closed

Evidence:

- LLP 0012 says dev may use v0 and sessions must use v1, but later says the receiver accepts “a v1 pair when v1 is explicitly supported.” It rejects `v0-sessions` but never rejects `v1-dev`. [LLP 0012](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0012-headless-integration-contract.spec.md:117), [acceptance rule](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0012-headless-integration-contract.spec.md:143)
- Target support is represented by two independent arrays—versions and modes—whose natural interpretation is a cross-product. [LLP 0012 capabilities](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0012-headless-integration-contract.spec.md:214)
- “Pair consistency” checks equal version, `appId`, and `inputsHash`, but does not explicitly validate the tuple `(schemaVersion, effectiveMode)`. [LLP 0012 preflight](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0012-headless-integration-contract.spec.md:153)
- Both acceptance matrices omit `v1-dev`. [LLP 0012 acceptance](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0012-headless-integration-contract.spec.md:665), [LLP 0039 obligation](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1513), [LLP 0039 acceptance](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1684)
- This is not harmless extensibility: v1 identities are explicitly domain-separated under a `sessions` namespace. [LLP 0012 identity contract](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0012-headless-integration-contract.spec.md:124)

Concrete failure trace:

1. The target advertises `["snapback.v0","snapback.v1"]` and `["dev","sessions"]`.
2. A provision request supplies two internally consistent v1 manifests but resolves effective mode to `dev`.
3. A literal implementation finds the version supported, the mode supported, and all cross-artifact fields equal.
4. Nothing enumerated requires rejection, so the v1 artifact—whose identity asserts `sessions`—can execute under legacy dev authority.
5. The must-understand discriminator no longer uniquely identifies the authority boundary it is intended to protect.

Bounded resolution:

Explicitly define the current admissible set as exactly:

- `(snapback.v0, dev)`
- `(snapback.v1, sessions)`

Reject every other tuple, including `(snapback.v1, dev)`, before hashes or effects. Add `v1-dev` to the negative matrices in both LLPs. This is a small contract closure, not an architectural change.

## Finding 2 — MEDIUM: the claimed LLP 0053 queue-fence dependency is not source-grounded

Evidence:

- LLP 0039 claims item 6’s “queue fence” keys item 5’s `AuthCoordinator` custody/generation, with item 7’s descriptor optional. [LLP 0039 landing order](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1423). The status repeats that this is the “final LLP 0053 seam.” [LLP 0039 status](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1894)
- LLP 0053 contains no such queue-fence contract. Its actual client fence is `(incarnation, epoch)`. [LLP 0053 client fences](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0053-authorization-invalidation.rfc.md:585)
- LLP 0053 then says its final correction changed both obligation discharge and the client fence to commit-version witnesses, but the normative client-fence section still says epoch, and acceptance still permits epoch-witnessed discharge. [design correction](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0053-authorization-invalidation.rfc.md:475), [stale acceptance](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0053-authorization-invalidation.rfc.md:699), [status](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0053-authorization-invalidation.rfc.md:776)
- Its acceptance also says ordinary restart does not force retained subscriptions to resnapshot, contradicting the mandatory resnapshot rule for every non-live resumption. [normative rule](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0053-authorization-invalidation.rfc.md:230), [contradictory acceptance](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0053-authorization-invalidation.rfc.md:713)

Concrete failure trace:

1. An item-6 implementer follows LLP 0039 and looks for a custody/generation queue fence.
2. An LLP 0053 implementer follows its normative section and uses `(incarnation, epoch)`, or follows its status and uses commit version.
3. A matcher-mediated removal does not advance the epoch.
4. Under the stale epoch-witnessed text, a snapshot computed before the removal can pass the fence or discharge its obligation—the precise stale-row failure LLP 0053’s correction describes.
5. Different implementers therefore cannot derive one enforceable item-6 protocol from the governing documents.

The existing item-6 gate contains this defect: LLP 0039 correctly forbids item 6 from starting before LLP 0053 is accepted. It is therefore not an immediately exploitable partial-landing hole.

Bounded resolution:

Remove the unsupported custody/generation queue-fence assertion from LLP 0039 and retain only the established dependency: item 5 supplies the coordinator, disposition execution, clear serialization, and incarnation. Reconcile LLP 0053’s normative and acceptance text to its already-selected commit-version and mandatory-resnapshot rules before its separate acceptance gate. No new mechanism is needed.

## Confirmed areas

The five previously low residuals are closed:

- Queued replay is explicitly unavailable between items 5 and 7. [LLP 0039](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1450)
- `MODE_DEV` is a typed HTTP 404. [LLP 0039](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1282)
- Route policy, credentials, invocation authority, effect policy, body-auth, and response sensitivity are separate axes. [LLP 0039](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:280)
- `Retainable ⇒ userId-only` is categorical. [LLP 0039](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1034)
- The 0031/0043/0051 provenance claims agree with the governing documents and shipped source.

The predecessor proof is source-grounded:

- The predecessor accepts only `snapback.v0`. [manifest validator](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/manifest.rs:2044)
- Its current ensure path compares raw hashes before validation. [ensure implementation](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/local.rs:1367)
- A nonmatching schema reaches artifact validation before database application. [apply_schema](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/local.rs:1190)
- The specified v1 serialized namespaces are disjoint from the current v0 hash encodings, so valid generated v1 artifacts cannot take the predecessor’s equality shortcut.
- Consequently, the fresh and identical-content provisioned-v0 matrices are implementable as written.

The public attestation/privileged provisioning split is clean and effect-ordered. [LLP 0012 attest](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0012-headless-integration-contract.spec.md:191), [provision](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0012-headless-integration-contract.spec.md:200)

The capability additions are correctly optional for historical v0 artifacts, absent/empty means unsupported, and auth-aware emitters must provide both facts. [LLP 0012 capability registration](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0012-headless-integration-contract.spec.md:283)

## Bottom line

- Architecture remains sound: **yes**.
- Material blocker remains: **yes**, the unclosed `v1-dev` tuple; the false LLP 0053 seam statement is an additional bounded enforceability defect.
- ENG-24593 can close: **no**, not for this exact immutable pair.
- Required work is limited to contract/matrix closure and cross-document reconciliation; it does not require a new auth architecture.

No files were edited, and no file under `llp/reviews/` was read. This reports readiness only and does not accept either LLP on the author’s behalf.


## Round 13 — 2026-07-13 (focused exact confirmation after bounded closure)

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md` at SHA-256
`8ba5becada849cb1d074b17a5858134de807abe103d3f086047cfac751b893fc`
and `llp/0012-headless-integration-contract.spec.md` at SHA-256
`ade9da47881828342fd591ff4d1bb1c0bff643c2f67b9fb086a987b56bf51170`.
**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1
(`codex exec --ephemeral`), model `gpt-5.6-sol`, reasoning effort
`xhigh`, sandbox `read-only`, workdir
`/Users/ccheever/projects/snapback-eng-24593-auth-review`.
Fresh thread `019f5b7a-fd59-7d11-b837-c3e65237db34`.
**Date:** 2026-07-13
**Review-body SHA-256:**
`0f80fc9187b98d57d72de9e93bae1bffc65b1aa31892f197e3a7ac8877dca01b`.
**Redacted:** no
**Method:** Blind focused confirmation of the exact immutable pair after the
Round 12 bounded corrections. The reviewer was forbidden from reading prior
review artifacts, verified both hashes, inspected governing LLPs and source,
and edited nothing.

### Review body (verbatim)

# READY

Both immutable hashes match:

- LLP 0039: `8ba5becada849cb1d074b17a5858134de807abe103d3f086047cfac751b893fc`
- LLP 0012: `ade9da47881828342fd591ff4d1bb1c0bff643c2f67b9fb086a987b56bf51170`

All four closures are complete:

1. The admissible set is exactly `(snapback.v0, dev)` and `(snapback.v1, sessions)`. V1-dev is rejected before hashes or effects throughout tuple definition, versioning, implementation obligations, and acceptance matrices ([LLP 0012](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0012-headless-integration-contract.spec.md:126), [LLP 0039](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:129)).

2. The predecessor proof explicitly runs the actual unmodified predecessor under `dev` and asserts `SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION` for fresh and provisioned-v0 snapshots ([LLP 0039](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1537), [LLP 0012](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0012-headless-integration-contract.spec.md:710)). Source corroborates that `dev` permits provisioning, the existing ensure path has the cited hash shortcut, and the v0 validator emits that exact diagnostic ([admin.rs](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/admin.rs:105), [local.rs](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/local.rs:1373), [manifest.rs](/Users/ccheever/projects/snapback-eng-24593-auth-review/src/manifest.rs:2070)).

3. During `MODE_PENDING`, ordinary app-data and Public attestation are refused. Only the explicitly privileged `provision` branch—`AdminWrite` or pre-bind startup authority—may correct or re-stage, after full preflight; no generic admin bypass exists ([LLP 0039](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:394), [LLP 0012](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0012-headless-integration-contract.spec.md:241)).

4. The LLP 0053 seam attributes to item 5 only the `AuthCoordinator`, disposition execution, serialized clear barrier, and durable incarnation. LLP 0053 owns its item-6 authorization-invalidation fence; no transient queue-fence keying to item-5 custody or generation is asserted ([LLP 0039](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0039-auth-vertical-slice.rfc.md:1433), [LLP 0053](/Users/ccheever/projects/snapback-eng-24593-auth-review/llp/0053-authorization-invalidation.rfc.md:52)).

No blocking findings. **ENG-24593 can close.** This is a readiness verdict only—not acceptance, ratification, or a status transition on the author’s behalf. I made no edits and did not read any file under `llp/reviews/`.
