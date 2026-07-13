# Review: LLP 0039 — Auth vertical slice (Fable / Claude family)

Artifact for the `/llp-super-refine` dual-model refine loop (LLP 0005 review
norms). One dated, numbered section per round; review bodies are preserved
verbatim as received. Orchestrator verification and disposition notes sit
outside the verbatim bodies. The earlier 2026-07-07 Claude-family review of
this document lives in `0039-auth-vertical-slice.claude.md`.

## Round 1 — 2026-07-12

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md`, working tree at git HEAD
`91828cb` (file clean; sha256
`1a1bf8611220ee5399fe99e2dab4c0eebd34040c37c62af071f5176e0509e68b`).
**Reviewer family:** Claude (Anthropic)
**Provider / runtime:** Claude Code CLI 2.1.207 headless (`claude -p`), model
`claude-fable-5` (invoked as `claude-fable-5[1m]`), effort `max`
(`--effort max`). Fresh non-interactive session
`51a0f024-f1f7-4927-834b-7eeb927acf9a`, 33 turns. The session delegated part
of its code exploration to three Claude-family subagents that ran on
`claude-opus-4-8[1m]`; every assistant message in the reviewing session —
including the entire review text below — was authored by `claude-fable-5`
(verified against the session transcript).
**Date:** 2026-07-12
**Redacted:** No — reviewed locally; nothing sent beyond the Anthropic models
serving the session. Instructed not to read `.agent-local-secrets.md` and not
to quote secret material into the review.
**Method:** cli-runner — fresh non-interactive session given the same round-1
brief as the concurrent GPT-family reviewer and run blind to it: instructed
not to read anything under `llp/reviews/`, launched concurrently with (and
without access to) the other family's round-1 review. Brief carried the
LLP 0005 standard review questions and required severities, resolution
criteria, and an explicit READY / NOT READY verdict with "ready" defined as
no unresolved material correctness, coherence, feasibility, safety, or
decision-quality concern.

> **Independence (LLP 0005).** Fresh session — not the orchestrating session
> that revises the document (which is also Claude Fable 5 and therefore never
> counts as this independent review). Cross-family coverage each round comes
> from the paired Codex review (`0039-auth-vertical-slice.codex.md`).

### Review body (verbatim)

## Overall assessment

This is the right RFC at the right time, and most of it is built on verified ground. LLP 0038's own ranked recommendations put the auth vertical slice second among all next moves, and 0039 implements exactly that recommendation's shape: `ctx.auth` from a real session, one built-in provider, declared auth-variable dependencies feeding the existing epoch/resync machinery. The slice is genuinely small because it reuses machinery that I verified actually exists and works end-to-end in the code: `ValueExpr::AuthUserId` and `PermissionScopeExpr::AuthUser` with fail-closed `SNAPBACK_AUTH_USER_MISSING` evaluation (`src/manifest.rs:859`, `src/manifest.rs:327-332`, `src/value_expr.rs:117-126`, `src/local.rs:4014-4051`), the declared `permission_epoch_bumps` → epoch advance → `resync_required` → resnapshot pipeline (`src/local.rs:1387`, `1411-1421`, `3615-3676`), and the server-minted connection-token guard on `ConnectionAuth` routes (`src/server.rs:604-610`, `366-367`, `2095-2100`). The document's discipline about its parent is also real, not performed: divergences from 0011 (account merge, write-side RLS deferral, replay-parity deferral) are each named and ratified rather than implied, and the same-day correction of the connection section against post-0038 code is exactly the drift honesty this corpus is supposed to practice.

The design choices are sound. I looked hard for something wrongheaded and did not find it: email-code-first is the correct first provider (no password storage, exercises the 0045 outbox seam, dev-capturable); merging `_auth_accounts` into `_auth_identities` is a defensible narrowing with the return path flagged; direct session invalidation instead of a general epoch sweep is the right cost line; and the protected-core versus app-visible-profile split faithfully carries 0011's reconciliation of "auth as first-class data" with Valet's never-sync-credentials lesson.

What keeps this from being ready is not the destination but the boundary with the world it replaces. Today every app-data route trusts a client-supplied `AuthInput` in the request body (`src/manifest.rs:913-924`, `src/server.rs:1927-1991`), and the RFC's entire treatment of that legacy surface is one sentence of intent. The precedence rules, the wire mechanism for marked impersonation on app-data routes, the per-profile enforcement, and the migration of every existing demo and acceptance suite are all unspecified — and that seam is precisely where this slice can fail open. Beyond that, the cookie/CSRF stance is gestured at rather than decided, the connection↔principal binding lifecycle (the mechanics behind the slice's own acceptance bullets) is unpinned, one of the five "new" diagnostic codes has since shipped with different semantics, and the route-registry integration needs a policy vocabulary that does not exist yet. All of these are resolvable in one focused revision pass; none requires redesign.

## Strengths

- **Correct scope selection, explicitly grounded.** The §Summary slice list matches LLP 0038 Part 7 recommendation #2 nearly item for item, and §Motivation correctly identifies auth as the unbuilt leg the most differentiation routes through (0038 Part 4 #2). The "0011 wins; divergences are called out explicitly below, not implied" rule in §Summary is followed in practice.
- **Economy through verified reuse.** §Permission dependencies claims the `authUserId()` expression and fail-closed scope evaluation "already exist" — confirmed in code, including the TypeScript authoring half (`packages/snapback-codegen/define.mjs:171`) and pre-commit rejection of missing auth (`src/local.rs:1380-1387`). The "declared, not inferred" epoch stance matches the shipped `permission_epoch_bumps` mechanism exactly (LLP 0020 §Remaining Phase 4; `src/manifest.rs:288`).
- **The connection section is accurate to the code after its correction.** §Session transport's description of the shipped transport guard — `ConnectionAuth` classification of `/outbox/{connection_id}` and `/live/{connection_id}/stream`, server-minted `connectionToken` — is verifiably true (`src/server.rs:653-659`, 401 `SNAPBACK_CONNECTION_TOKEN_REQUIRED` / 403 `SNAPBACK_CONNECTION_TOKEN_INVALID` at `src/server.rs:2639-2645`), and the claim that the token attaches no principal today is also true (`ConnectionRegistry` is an id→token map, `src/server.rs:313-315`). The revision header records this as a same-day correction against post-0038 code — good process.
- **The two restated 0011 constraints are the right two.** §Built-in first provider restates transactional first-login provisioning and hashing-outside-the-write-lock — precisely the constraints 0011 says a builder violates by default, and the second one matters concretely in this single-writer architecture.
- **Acceptance quality.** §Acceptance is machine-checkable in the house style and includes 0011's sharpest partial-sync proof (two clients, same query, different results), fail-closed unauthenticated subscribe, the cross-principal connection cases, user-switch wipe, and throttle/lockout diagnostics. It goes beyond 0011's validation list where the slice adds surface (connection-principal binding).
- **Ecosystem coherence.** The handoffs all check out on both ends: 0045 records ownership of the capture mailbox and the migration decision; 0043 stores this document's authorization epochs in the client-store contract and enforces the wipe rule; 0046 inherits the export exclusion list; 0042 gates `servicePrincipal` on the session core. The `AuthContext` name-collision implementation note is accurate (`src/ephemeral.rs:213-219`).

## Concerns

**1. (HIGH) The legacy client-asserted auth path — the slice's fail-open seam — has no specified precedence, enforcement, or migration.** §Session transport pins intent in one sentence ("Clients may not supply `userId` directly except through the explicit local-dev impersonation authority already modeled by LLP 0024"), but today `AuthInput { principal, session_id, user_id }` rides in every `HandlerInput` body (`src/manifest.rs:913-924`), is deserialized by `/query`, `/mutation`, and `/action` handlers (`src/server.rs:1927-1991`), is surfaced to JS handlers as `ctx.auth` (`packages/snapback-harness/ctx-bootstrap.js:268-288`), and drives live-subscription ownership checks (`src/local.rs:1707-1708`, `1781-1782`). LLP 0031's invariant states plainly that "app routes trust the `ctx.auth` the client supplies." LLP 0024's authority tuple exists only on host-ops envelopes, not on app-data routes, so there is currently no wire mechanism to mark a request as impersonation. The RFC never says: what precedence applies when both a session and body auth are present; whether body auth is rejected, ignored, or reinterpreted per target profile; what marks legitimate 0024 impersonation on app-data routes; or how the kit, demos, and acceptance suites migrate (a wire-shape change that LLP 0012 classifies as a compatibility event). Failure scenario: a session-enabled profile keeps honoring `input.auth` when no session is presented — the entire slice is bypassed by simply not logging in — or, on the other side, every existing demo and suite breaks with no migration path. *Resolves with:* a "Legacy dev auth and migration" subsection pinning (a) a source-precedence rule (session token, then explicitly-marked impersonation, then unauthenticated — never bare body auth), (b) the wire marker for impersonation on app-data routes and its per-profile availability, (c) the deprecation/compat path for `AuthInput` and the kit/demo migration note, and (d) an acceptance row that bare body-supplied auth without the impersonation marker is rejected on a session-enabled profile.

**2. (MEDIUM) The connection↔principal binding lifecycle is unspecified, and it is the mechanics behind three acceptance bullets.** §Session transport says "a connection created under a session carries that session's auth context" and that cross-principal presentation is rejected, but the grant registry today holds only id→token (`src/server.rs:313-325`), grants are process-lifetime with idempotent re-open under `previousToken` (LLP 0031 §Connection capability grants), and `/outbox/{id}` drains present only the token with no session in sight (`src/server.rs:2473-2474`). Unanswered: where the principal binds (open time? first subscribe?); what happens to a connection opened anonymously when the user then logs in (upgrade, or forced re-open — and is anonymous→authenticated a "user switch" for the wipe rule?); what a re-open with a valid `previousToken` but a different session's principal does; and whether bare-token operations (outbox drains) act under the bound principal. The document's own open question about the WebSocket handshake ("blocks a builder on day one") is one facet of this same unpinned lifecycle. *Resolves with:* pinning the binding point and transition rules — see the bind-at-open proposal under Suggestions, which resolves the WebSocket open question simultaneously — and extending the cross-principal acceptance bullet to cover the re-open path.

**3. (MEDIUM) The cookie-mode security stance is motivated but not designed, and the current text under-describes the mechanics it depends on.** §Session transport requires "an origin check" for cookie mode, citing the loopback CORS echo (consistent with LLP 0017:483-484). But the code today does *not* set `Access-Control-Allow-Credentials` (absent from `src/server.rs:1553-1597`), so cross-origin cookie mode cannot work at all without adding it — and adding it under the echo-any-localhost policy would grant credentialed reads to every local page, which is the trap the RFC should name and forbid. Meanwhile `SameSite` is port-blind (localhost:3000 and localhost:4287 are the same site), so "same-site cookies" provide no isolation between local apps and the origin check is the *only* load-bearing defense — the RFC's phrasing does not make that clear. There is also no acceptance row exercising the origin check. Failure scenario: a builder ships cookie mode with `SameSite=Lax` believing it covers CSRF, plus `Allow-Credentials` to make the dev origin work; any local page can then both forge writes and read authenticated responses. *Resolves with:* a pinned stance — bearer-first as the kit default; cookie mode permitted only same-origin (via the LLP 0030 managed proxy) or against an explicit origin allowlist; `Allow-Credentials` never combined with the wildcard loopback echo — plus an acceptance row that a cookie-authenticated state-changing request from an unapproved origin is refused with a structured diagnostic.

**4. (MEDIUM) `SNAPBACK_AUTH_STALE_RESULT` is presented as a new code, but it already ships with pinned replay semantics.** §Diagnostics groups all five codes as the ones this slice introduces ("maps [`SNAPBACK_AUTH_USER_MISSING`] alongside the new codes"). Since the 2026-07-07 revision, LLP 0043's ENG-23965 slice landed `SNAPBACK_AUTH_STALE_RESULT` in code with a replay-ledger meaning — retained `auth_fingerprint` mismatch refuses replay (`src/runtime.rs:405`, `src/storage.rs:304`, `src/storage.rs:2821`, consumed at `packages/snapback-contract/index.mjs:564`). Per LLP 0012, changing an emitted code's meaning is a compatibility event, so 0039 cannot mint a divergent live-path meaning for the same code without owning the reconciliation. Relatedly, "maps it alongside" is not a semantics: the boundary between `SNAPBACK_AUTH_REQUIRED` (no session on a surface that needs one) and the existing `SNAPBACK_AUTH_USER_MISSING` (scope/expression evaluation without a user) needs one defining sentence each, or the two will be emitted interchangeably. *Resolves with:* updating §Diagnostics to acknowledge the shipped `AUTH_STALE_RESULT` semantics and either unify the meaning ("a result or queued mutation is invalid because the auth context changed") or choose a distinct code for the live path, plus one-line definitions delimiting `AUTH_REQUIRED` vs `AUTH_USER_MISSING`.

**5. (MEDIUM) The route-registry integration is named but the policy vocabulary it needs does not exist, and one pinned meaning inverts.** §Diagnostics requires `/auth/*` routes to be "classified in the LLP 0031 route registry with the same enforcement-test coverage as existing routes." The registry's policies are `Public | AppAuth | ConnectionAuth | AdminRead | AdminWrite` (`src/server.rs:604-610`); none expresses "requires a valid session" (needed for logout/refresh), and `AppAuth` is pinned in both code comments and LLP 0031 as "the handler may enforce the *app-supplied* `ctx.auth` — not that the transport authenticates the caller" (`src/server.rs:594-599`) — a meaning this slice deliberately inverts for session-derived auth. Note also that the existing "enforcement tests" verify the declared registry's internal consistency (`src/server.rs:2770-2831`), not per-route runtime enforcement, so the acceptance phrase promises less than it sounds like. *Resolves with:* a short list naming each new route's class and policy (e.g., request-code/exchange as `Public`, logout/refresh under a new `SessionAuth` policy), an explicit note that LLP 0031 needs a matching revision redefining `AppAuth` post-slice, and runtime 401/403 enforcement tests for the new routes in §Acceptance.

**6. (MEDIUM) The "auth next to your data" surface — app-visible profile and membership rows — has no defined creation mechanism.** §Protected identity core says these are "ordinary app tables keyed by `ctx.auth.userId`," and §Built-in first provider makes provisioning transactional, but provisioning is only ever specified for the `_auth_*` core. Nothing says who writes the first profile row: system code from a declared mapping, an app-level hook (which does not exist as a concept yet), or app code lazily on first authenticated mutation. The final open question ("Which auth facts are safe to mirror into app-visible profile rows by default?") presupposes mirroring machinery the document never introduces, and §Acceptance has no profile-row item — so the slice as written can complete without ever proving the claim that is its product differentiator. *Resolves with:* naming the mechanism (or explicitly scoping profile creation to app code for this slice), aligning the open question with that choice, and adding an acceptance row in which a test app's profile/membership table is populated and joined against by an authorized query.

**7. (LOW) The dev capture mailbox's access surface is unclassified, and a Public HTTP surface would let any local page mint sessions.** §Built-in first provider ships local capture; tests must read codes from it. If that read is a Public route, the loopback CORS echo (`src/server.rs:1582-1597`) lets any local web page fetch codes for arbitrary addresses and complete the exchange — defeating, on a dev machine, the very session isolation the slice's acceptance proves. There is also a small ownership ambiguity: 0039 says the slice "seeds" 0045's outbox with a minimal implementation, while 0045 says 0039 "ships a minimal capture path first and migrates onto this outbox once it is stable" — first implementation versus throwaway shim. *Resolves with:* one sentence classifying the mailbox surface (admin-gated under `/_snapback/api/*`, or file-based like the 0017 admin-token file), and one sentence aligning the seeds-vs-migrates language with 0045.

**8. (LOW) The `_auth_*` prefix introduces a second reserved namespace with no stated reservation or fail-closed proof.** Existing system tables uniformly use `_snapback_*` (`src/storage.rs:1326-1358`); no `_auth_*` table exists today. The document does not reserve the prefix in schema validation (an app table named `_auth_users` should be a load-time error), does not name the enforcement mechanism for "never synced / not in generated types" (structurally, handlers reach tables through the schema-scoped `ctx.db` and the admin data explorer exposes tables — both paths need a stated rule), and §Acceptance has no row proving a client or handler cannot reach these tables. *Resolves with:* pinning the prefix deliberately (consider `_snapback_auth_*` to inherit the existing convention, or reserve `_auth_*` explicitly), naming the enforcement points, and one fail-closed acceptance row.

**9. (LOW) Metadata, terminology, and artifact-registration debt.** (a) LLP 0046 is cited in the body (export exclusions) but missing from the Related header. (b) The document says "authorization epoch" throughout; the code and wire uniformly say "permission epoch" (`src/local.rs:835`; wire reason `permission_epoch_changed`) — one mapping sentence avoids a pointless synonym. (c) `roles` is carried in the shape but nothing states its source for real sessions (presumably always empty in this slice — say so). (d) The slice's contract deltas are LLP 0012 registry events it never names: the new `AUTH_*` diagnostic family, capability-manifest auth fields (only `auth_impersonation` exists today, `src/manifest.rs:1150-1151`; provider/session-transport facts do not), and runtime-state auth facts. *Resolves with:* the Related fix, the naming note, one sentence on `roles`, and a short paragraph enumerating the 0012/capability-manifest registrations the implementation must land.

## Suggestions

- **Resolve the WebSocket open question by binding the principal at `POST /connection/open` — and consider making that the whole answer.** The open must be a POST where headers work, so the bearer token binds there; the grant then carries the principal; the WS upgrade keeps presenting only the connection token exactly as today (`src/server.rs:2082-2104`); login/logout/user-switch means opening a fresh connection (which composes cleanly with the wipe rule and with 0008's reconnect-is-a-fresh-subscribe pin). This collapses the WS-handshake question and most of Concern 2 into machinery that already exists, and it keeps session tokens out of query strings — important because the existing connection-token fallback rides `?connection_token=`, an acceptable pattern for a transport capability but a log-leak hazard for a session credential given the slice's own redaction rule.
- **Consider bearer-only for v1.** The kit is the only consumer; cookie mode is the sole reason this slice needs a CSRF design at all. Shipping bearer-first and admitting cookies only behind the 0030 same-origin proxy later would shrink the security surface of the first slice considerably.
- **Decide session refresh semantics now rather than leaving them open.** The document itself calls this "a real design fork" — for a gap-closing implementation RFC, sliding expiry with token rotation on refresh (and pinned TTL defaults) is the boring, adequate v1 answer; the open question can then narrow to whether rotation invalidates concurrent in-flight requests.
- **Pin the auth-fingerprint composition with LLP 0043, and answer the offline-expiry case.** The replay ledger already stores an `auth_fingerprint` (`src/storage.rs:304`). If the fingerprint is session-scoped, every session expiry strands the offline mutation queue; if userId-scoped, re-authenticating as the same user revives it. That choice belongs in this document (it owns session semantics) and is currently in neither.
- **State whether ephemeral room permissions are in or out.** The ephemeral subsystem's `AuthContext.permissions` is client-supplied today, and its auth-revocation hooks were removed as dead code explicitly awaiting this integration (`src/ephemeral.rs:426-447` — "durable permission-change revocation is not integrated yet"). 0038 names ephemeral privacy as blocked on auth; the slice binds connections to principals but says nothing about the ephemeral `AccessPolicy` checks that would consume them. One scoping sentence either way.
- **Acceptance additions worth their cost:** the cookie/origin refusal (Concern 3); a redaction sentinel test in the 0031 D3 style (plant a token/code, assert it never appears in logs, diagnostics, or public payloads); concurrent first-login requests for one address provision exactly one user (the transactional-provisioning claim, tested); a handler attempting to read `_auth_users` through `ctx.db` fails closed (Concern 8); and a regression pin that `SNAPBACK_AUTH_USER_MISSING` behavior is unchanged for session-derived contexts.
- **Note the 0024 authority-mode gap this slice creates.** 0024's five pinned modes (`none`/`unauthenticated`/`devUser`/`devAdminBypass`/`servicePrincipal`) cannot represent "a real session," yet §Diagnostics requires the console to display exactly that distinction, and agents will want `function.run` under a real session. One sentence flagging the future `session` authority mode keeps 0024 and 0039 from drifting.
- **Add one clarifying sentence on hashing polarity.** 0009 pins "never hash secret values into audit logs" (low-entropy leak via hash equality); 0039 stores high-entropy session tokens hashed at rest. These are compatible, but the word "hash" carries opposite polarity across the two documents; also note that hashed six-digit codes are brute-forceable offline and are protected by attempt limits, not by the hash.
- **Make the proving demo the card game or private rooms.** 0038 names the card-game slice as blocked on auth, and the two-clients-different-results acceptance is exactly its core mechanic. Landing the slice with that demo (and its 0016 diary) converts the sharpest claim into diary evidence in the same motion.

## Open questions

1. What is the exact precedence and per-profile enforcement among session token, marked local-dev impersonation, and the legacy body-supplied `AuthInput` — and what is the migration/compat window for existing clients and suites? (Concern 1; must be answered before implementation.)
2. Where does the connection↔principal binding occur, and is an anonymous→authenticated transition a "user switch" for the wipe rule? Does a `previousToken` re-open under a different principal reject or re-mint? (Concern 2.)
3. Which `RoutePolicy` does each `/auth/*` route carry, and does `AppAuth`'s pinned meaning get redefined in a 0031 revision when `ctx.auth` becomes server-derived? (Concern 5.)
4. Who writes the first app-visible profile row, and is any automatic mirroring of auth facts in scope for this slice at all? (Concern 6.)
5. Is the auth fingerprint for queued offline mutations userId-scoped or sessionId-scoped — i.e., can a user whose session expired offline re-authenticate and replay their queue? (Joint with LLP 0043.)
6. How is session expiry observed on the live path — a lazy check at delivery/subscribe time, an expiry timer, or both — given that expiry is passive and the chosen design deliberately avoids epoch sweeps for session lifecycle?
7. What does the capability manifest report for auth per target profile (provider present, session transports, impersonation availability), so adapters and agents can assert the surface exists rather than probing?
8. The document's own retained questions stand: the first external provider (and whether `_auth_accounts` returns), the permission-declaration syntax before Design Mode owns authoring, and — once Concern 6 picks a mechanism — which auth facts are safe to mirror by default.

## Readiness verdict

Verdict: NOT READY

The direction, scope, and grounding are right — this is the correct next slice, it is honest about its divergences from LLP 0011, and its claims about existing machinery verify against the code almost everywhere I checked. But material concerns remain unresolved in the current text: the boundary with the legacy client-asserted auth path (Concern 1) is the slice's single fail-open seam and is specified only as intent; the connection-binding lifecycle, cookie/CSRF stance, and route-policy vocabulary (Concerns 2, 3, 5) leave builder-blocking security decisions open in a document whose purpose is to close gaps; one diagnostic code's "new" status is now stale against shipped 0043 code (Concern 4); and the slice's differentiating claim lacks a creation mechanism and proof (Concern 6). All of these are addressable in a single revision pass without redesign, after which this RFC would merit READY.

### Orchestrator verification notes — round 1 (outside the verbatim body)

Spot-checked by the orchestrating session before revising. The review's
decisive factual claims verify against the repository:

- LLP 0031's invariant states the app routes trust client-supplied `ctx.auth`
  in local v0 (LLP 0031 §The invariant, line 93), matching the `AppAuth` doc
  comment (`src/server.rs:594-599`); `AuthInput` rides in `HandlerInput`
  (`src/manifest.rs:912-925`) and drives live-subscription ownership checks
  (`src/local.rs:1705-1710`, `1779-1784`).
- The route-registry "enforcement tests" are declared-registry consistency
  checks (`s1_route_registry_matches_the_invariant`,
  `src/server.rs:2770+`), not per-route runtime enforcement.
- `authUserId()` exists in the TypeScript authoring surface
  (`packages/snapback-codegen/define.mjs:171`); `permission_epoch_bumps`
  exists in the manifest layer (`src/manifest.rs:285-288`).
- The connection grant registry is an id→token map with no principal
  (`src/server.rs:313-325`, `366-367`), the WS/query-string fallback
  `?connection_token=` exists (`src/server.rs:2095-2097`), and the CORS layer
  sets no `Access-Control-Allow-Credentials` (`src/server.rs:1553-1597`).
- `SNAPBACK_AUTH_STALE_RESULT` already ships with replay-ledger semantics
  (`src/runtime.rs:405`, `src/storage.rs:304`, `src/storage.rs:2821`;
  consumed at `packages/snapback-contract/index.mjs:563`).
- The ephemeral auth-revocation vocabulary was removed as dead code pending
  integration (`src/ephemeral.rs:426-448`, citing LLP 0026 §Auth and
  revocation).
- Cross-document citations verify: 0024's five authority modes and
  `localDevOnly` audit fact; 0043 storing authorization epochs in the
  client-store contract; 0045 owning the capture mailbox with the
  "ships a minimal capture path first and migrates onto this outbox"
  phrasing 0039 must align with; 0046 inheriting the export exclusion list;
  0042 gating `servicePrincipal` on the session core; 0031 D3's
  source-sentinel test style; 0008's reconnect/full-resubscribe pins.
- One minor imprecision, not decisive: the capability manifest carries
  `permissionDiagnostics` in addition to `authImpersonation`
  (`src/manifest.rs:1150-1152`) — the review's point (no provider or
  session-transport facts exist) stands.

**Disposition (2026-07-12 revision):** concerns 1–9 accepted as material or
editorial and addressed in the same-day revision — legacy-auth precedence,
enforcement, and migration subsection; connection↔principal binding pinned at
`POST /connection/open` (adopting this review's bind-at-open proposal, which
also resolves the WebSocket open question); bearer-first cookie stance with
an origin allowlist and never credentialed wildcard reflection; the shipped
`AUTH_STALE_RESULT` semantics acknowledged and unified; a `SessionAuth` route
policy with a concrete route table and runtime enforcement tests; the
profile-row creation mechanism scoped to app code with an acceptance row;
capture-mailbox access admin-gated and the seeds/migrates language aligned
with 0045; `_auth_*` reserved with named enforcement points and fail-closed
acceptance; Related/naming/`roles`/LLP 0012 registration debt fixed.
Suggestions adopted: refresh semantics decided (sliding expiry + rotation),
auth-fingerprint scope pinned with 0043, ephemeral room permissions scoped
out as a declared capability gap, redaction-sentinel and concurrent-
provisioning acceptance rows, 0024 session-mode gap noted, hashing-polarity
sentence added, card-game proving-demo note added.

## Round 2 — 2026-07-12

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md`, working-tree revision of
2026-07-12 round 1 (sha256
`e4ab3e17b8cf80cade21fafbe18459295f4ed301cfd42fb434bb5ebb45396655`;
deliberately newer than git HEAD — the working tree is the revision under
review).
**Reviewer family:** Claude (Anthropic)
**Provider / runtime:** Claude Code CLI 2.1.207 headless (`claude -p`), model
`claude-fable-5` (invoked as `claude-fable-5[1m]`), effort `max`
(`--effort max`). Fresh non-interactive session
`d6991884-ef67-4145-80be-06fce9efccb2` — not resumed from round 1. The
session delegated part of its code exploration to three Claude-family
subagents on `claude-opus-4-8[1m]`; every assistant message, including the
entire review text below, was authored by `claude-fable-5` (verified against
the session transcript).
**Date:** 2026-07-12
**Redacted:** No — reviewed locally; nothing sent beyond the Anthropic models
serving the session. Same secret-handling instructions as round 1.
**Method:** Same as round 1 — shared round-2 brief, blind to the concurrent
GPT-family round-2 review and to all archived reviews under `llp/reviews/`.

### Review body (verbatim)

## Overall assessment

This is a strong, unusually well-grounded implementation RFC, and the right next slice for the corpus to build: LLP 0038 names the unbuilt auth layer as the highest-leverage subsystem, LLP 0011's ratified v1 sync/auth direction gives it a settled foundation, and 0039 selects a narrow, coherent path through it — server-resolved authority, one passwordless provider, protected `_auth_*` tables, principal-bound connections, declared permission dependencies feeding the existing epoch/`resync_required` machinery, and a concrete diagnostics/route contract. I verified the document's factual claims about existing code directly against the source, and they are almost uniformly accurate — often precisely so: the `ConnectionAuth`/`connectionToken` guard and its process-lifetime grant map (`src/server.rs:312-401`), the loopback CORS echo with no `Access-Control-Allow-Credentials` anywhere (`src/server.rs:1553-1597`), the HTTP status mapper knowing no `AUTH_*` codes and defaulting to 400 (`src/server.rs:2630-2648`), codegen hardcoding `authRequirement: 'optional-user'` with no runtime consumer anywhere in `src/` (`packages/snapback-codegen/index.mjs:1544`; `src/manifest.rs:275-276`), the FNV-1a `auth_fingerprint` over exactly `(principal, session_id, user_id)` with the shipped `SNAPBACK_AUTH_STALE_RESULT` semantics (`src/manifest.rs:1039-1058`; `src/storage.rs:302-309,2817`; `src/runtime.rs:401`), live-subscription ownership compared against the client-supplied auth on supersede/unsubscribe/resume (`src/local.rs:1604,1706,1780` → `SNAPBACK_LIVE_RESUME_OWNERSHIP`), fail-closed `ValueExpr::AuthUserId` → `SNAPBACK_AUTH_USER_MISSING` (`src/value_expr.rs:117-126`), the manifest-only `PermissionScopeExpr` with no TypeScript authoring surface (`src/manifest.rs:327-332`; `packages/snapback-codegen/define.mjs:171` has only the `authUserId()` marker), `clear_retained: true` emitted on overflow, reset, and permission-epoch changes yet read by no shipped client (`src/ephemeral.rs:773-776`; `src/local.rs:1046,3600,3658`; `demos/_kit/client.mjs:808-816` reads only `reason` and `subscription_id`), the capability manifest carrying `authImpersonation` but no `authProviders`/`sessionTransports` yet (`src/manifest.rs:1150`), no `/auth/*` routes in the registry, and the client-supplied `ephemeral::AuthContext.permissions` with the `AuthRevoked`/`AuthChanged` vocabulary removed (`src/ephemeral.rs:213-243,426,445`). The security reasoning at the sharp edges — keyed code digests, the admin-gated mailbox under the CORS echo, the cookie origin-allowlist rationale, subject-vs-actor scope semantics — is correct and well-argued.

What keeps it short of ready is a small set of load-bearing mechanisms the text invokes but does not pin: the "marked 0024 impersonation envelope" on app-data routes exists nowhere (in 0024 or in code) and 0024 defines authority tuples only for the host-ops surface; the HMAC pepper is assigned to LLP 0036, whose ratified v1 model has no system-owned, host-side-readable entry class; the per-operation session-validity re-check and sliding-expiry writes are specified without reconciling them against the corpus's own pinned no-global-mutex/single-writer performance properties; and the central new switch — the per-profile auth mode — has no declared home. Each resolves with a paragraph, not a redesign.

## Strengths

- **Correct slice selection and scope discipline.** The §Summary/§Motivation framing ("selects a first implementation path through" 0011, "0011 wins" on restated contracts) and the §Non-goals list defer exactly the right things: write-side RLS stays 0011's later surface with an explicit substitute that must be proven (§Acceptance's cross-user write case), hosted hardening stays with 0009/0047, offline consequences stay with 0043, ephemeral room permissions are a *declared capability gap* rather than a hand-wave — which matches LLP 0026's recorded state ("durable permission-change revocation is deliberately deferred"; dead `AuthRevoked`/`AuthChanged` vocabulary removed).
- **Fail-closed posture in the right places.** §Authority resolution pins presented-but-invalid credentials as errors, never silent anonymous fall-through, with the correct rationale (revocation must be a denial, not a downgrade). §Legacy dev auth and migration pins rejection — "never silently honored, ignored, or reinterpreted" — as the only unmistakable behavior, and keeps every existing profile working unchanged, which is the honest migration for a corpus whose demos and suites all speak body `AuthInput` today (`src/manifest.rs:913-924`, confirmed as the live surface in `demos/_kit/client.mjs:236-238,341-360`).
- **The provider is a state machine, not a flow sketch.** §Built-in first provider pins canonicalization, supersession, attempt accounting, TTLs, and — the two things a builder would otherwise get wrong — verification outside the single-writer lock with a transactional compare-and-consume (`consumed_at IS NULL`), and transactional first-login provisioning, both traceable to 0011's Valet-grounded rules. The hashing-polarity note (keyed digests for low-entropy codes, plain SHA-256 acceptable for 256-bit bearers, nothing hashed into logs) correctly threads LLP 0009 §Secrets' "never hash secret values into audit logs" rule rather than misapplying it to at-rest storage.
- **The connection-binding design extends what shipped instead of re-inventing it.** §Session transport and connection binding correctly records that the LLP 0038 Part 4 #6 hole is already closed (verified: `ConnectionAuth` on `/outbox/{id}`, `/live/{id}/stream`, and ephemeral routes; token gate before the WebSocket upgrade at `src/server.rs:2082-2100`), and adds principal binding at `POST /connection/open` — which settles the WebSocket-handshake question cleanly (no session material on the upgrade; the token is an attenuated capability under its bound principal). The lifecycle rules (anonymous-stays-anonymous, user-switch wipe per 0011's ratified rule, `previousToken` re-open under a different principal rejected) compose correctly with LLP 0008's reconnect-is-a-fresh-subscribe pin and the shipped re-open idempotence (`src/server.rs:341-372`).
- **The mailbox admin-gating argument is exactly right.** Under the verified any-localhost-origin CORS echo, a Public mailbox would let any local page read codes and mint sessions; gating it behind LLP 0017's admin token works precisely because the auto-minted token lives in a 0600 file a browser page cannot read (LLP 0017 §Security Defaults, ENG-23443). The cookie-mode analysis (SameSite is port-blind on localhost; the origin allowlist, not SameSite, is the CSRF boundary; `Allow-Credentials` must never join the echo — and today is never set) is verified and correct, including applying the origin check to WebSocket upgrades, which CORS does not cover.
- **Subject-vs-actor is pinned and tested.** §Permission dependencies names the exact bug a builder would write (declaring `AuthUser` on an admin revocation bumps the admin's own scope and revokes nothing) and §Acceptance covers exactly that case, plus "unrelated users do not resync." The shipped/unshipped split is accurate: expression half shipped, `permissionEpochBumps` manifest machinery shipped (`src/manifest.rs:283-288`; `src/local.rs:3615-3658`; LLP 0020 Phase 4 notes), TS authoring absent (verified) and correctly claimed as this slice's deliverable.
- **The diagnostics section is implementation-grade.** The table pins boundary, HTTP status, live-path form, and retryability per code; adopts rather than re-mints the two shipped codes (with the correct LLP 0012 compatibility-event reasoning); and names the enforcement plumbing an implementer could otherwise skip — the 400 fall-through, the typed denial helper so handler denies don't normalize to `SNAPBACK_HANDLER_FAILED`, and `authRequirement` gaining its first runtime consumer. §Route table correctly observes the registry enforcement tests prove declaration consistency only (verified: `s1_route_registry_matches_the_invariant` asserts over the declared vec) and adds runtime 401/403 acceptance accordingly.
- **Acceptance is unusually sharp.** Concurrency proofs (one challenge → exactly one session; concurrent first-logins → exactly one user), negative write authorization with no commit-version advance, the `SNAPBACK_AUTH_USER_MISSING` regression pin, refresh-rotation and reuse-revocation observability on the live path, the redaction sentinel in the LLP 0031 D3 style, and the two-clients-different-results proof tied to the card-game demo 0038 names as blocked on exactly this slice.
- **Cross-document hygiene.** The 0045 capture-mailbox handoff is recorded identically on both sides; the 0046 export-exclusion inheritance matches 0046's text verbatim; the 0043 fingerprint description matches the code to the field (including the wire split — the fingerprint is server-retained, and the contract client store already wipes retained rows on fingerprint change, `packages/snapback-contract/client-store.mjs:92`); the needed 0031 revision (`SessionAuth`, `AppAuth` re-scoping) and 0024 addition (a `session` authority mode) are named rather than silently assumed.

## Concerns

1. **MEDIUM — The "marked 0024 impersonation envelope" on app-data routes is invoked but defined nowhere.** §Authority resolution says dev impersonation is "carried by its marked envelope and audit fact, never by bare body fields," and §Legacy dev auth and migration makes it the sole exception to body-auth rejection on session profiles ("unless the request carries the marked 0024 impersonation envelope on a dev-capable profile"). But LLP 0024 defines the authority tuple only inside the host-ops request envelope on the admin-write-gated `POST /_snapback/api/host-ops` surface (LLP 0024 §Authority Tuple, §HTTP Projection), and no impersonation carrier of any kind exists in code today — no request-side marker, no `--as-role`; the only shipped `localDevOnly` fact is the host-ops *result*-envelope boolean (`src/host_ops.rs:94`), and `HandlerInput` has no marker field (`src/manifest.rs:919-941`). As written, the fail-closed rule has an exception whose transport, marking, and gating (does it require the admin token? which profiles are "dev-capable"?) are all unpinned — in the one path where a mistake re-opens the hole this slice exists to close. The document flags a 0024 revision for the `session` authority mode but not for this. *Resolves with:* pinning the envelope's transport and gating (and naming the owning 0024 revision), or explicitly scoping dev impersonation on session-enabled profiles to the admin-gated host-ops surface only.

2. **MEDIUM — The pepper (and the configurable session knobs) don't fit LLP 0036's ratified model, and no 0036 revision is named.** §Built-in first provider holds the HMAC pepper "as LLP 0036 config" and makes expiry windows "configurable per 0036." 0036 v1 is app-declared entries in the app's generated manifest, granted to *actions only*, with values reaching only fresh action VMs through `ctx.secrets` handles (0036 §Runtime exposure, D8); there is no system-owned entry class and no host-side (Rust) read path, and non-secret entries fail closed as unimplemented (verified: `CONFIG_NON_SECRET_UNIMPLEMENTED`, `packages/snapback-codegen/index.mjs:1329-1331`). A server-internal auth pepper is a new consumer class: not app-declared (the wizard would nag every app about an internal entry), not action-granted, read by the Rust core. The document names matching revisions for 0031 and 0024 but is silent on the 0036 extension this depends on. *Resolves with:* either naming the 0036 revision (a system-entry class with a host-side consumer) in the same change, or re-homing the pepper — e.g., an auto-minted 0600 instance secret beside the admin token (the ENG-23443 pattern), excluded from exports — and stating how `key_id` rotation works in that scheme; same disposition for the TTL/throttle knobs.

3. **MEDIUM — The auth path's storage discipline is unreconciled with the corpus's own pinned performance properties.** Two specifics. (a) §Connection binding says "the grant's validity is re-checked against the session on every connection-scoped operation" — but LLP 0031 §Connection capability grants pins verification as "registry-lookup plus constant-time compare in a dedicated small lock — never the global write mutex, so the L9 … latency bounds still hold," and LLP 0026's as-built L9 tests assert ephemeral operations proceed while a mutation holds the write lane. A naive per-op validity check is a SQLite read of `_auth_sessions` on every ephemeral publish/drain, re-coupling exactly what L9 decoupled. (b) Sliding expiry (`expires_at (sliding)`, `last_used_at`) implies a durable write per authenticated request on the single-writer lane whose measured ceiling is ~1,050–1,280 mutations/s (LLP 0038 Part 3 #1). Neither the memory-only mechanism for (a) (e.g., grants carry `{sessionId, userId, generation}` and the write path maintains an in-memory revocation/generation set — the session→connections index already implies such a structure) nor a coarse-bump policy for (b) is stated. *Resolves with:* one paragraph pinning that per-op validity checks are memory-only (maintained by the session write path) and that sliding-expiry bumps are coarse-grained (e.g., at most once per fraction of the window), or an explicit argument for why per-request storage traffic is acceptable.

4. **MEDIUM — The per-profile auth mode has no declared home.** The mode (`auth: dev` | `auth: sessions`) is the single switch the whole migration story hangs on (§Legacy dev auth and migration), and §Observability registers it as an LLP 0012 event — but nothing says which artifact or configuration declares it, who may set it, or how a client/agent discovers it (the capability manifest gains `authProviders`/`sessionTransports`, but not, explicitly, the mode). Today's `ServerContext` profile machinery (`allows_provisioning`, `require_non_prod_profile` — `src/server.rs:479`, `src/server.rs:1649`) has no auth axis. Relatedly, "session-enabled" and "dev-capable" are used as two orthogonal properties without a table saying which combinations exist. *Resolves with:* naming where the mode lives (server profile? 0036 config? startup flag?), its discovery surface, and the valid mode combinations.

5. **LOW — Mis-citation: the fingerprint-scope open question is *not* recorded in 0043.** §Replay parity says "whether a userId-scoped fingerprint should revive same-user queues is 0043's open question, recorded there," and §Open Questions repeats "(0043's question; recorded there.)" — but LLP 0043's Open Questions (`llp/0043:174-180`) contain three items, none of which is this question. As written, a real UX question (expiry-while-offline permanently strands queues even after same-user re-login) is orphaned between the two documents. *Resolves with:* adding the question to 0043 in the same change, or owning it in 0039's list without the cross-reference.

6. **LOW — The reserved-prefix premise misstates the current state (conclusion still holds).** §Reserved prefix says "Today only `_snapback`-prefixed identifiers are rejected at schema validation and no storage-side reservation exists." A storage-side reservation *does* exist: `validate_user_identifier` (`src/storage.rs:2737-2746`) rejects `_snapback*` and is applied independently at table/field/index creation (`src/storage.rs:1637,1648,1667`), parallel to codegen's check (`packages/snapback-codegen/index.mjs:290`). The load-bearing conclusion is verified true — `_auth_users` passes both layers today and would load and collide — and the proposed enforcement ("both codegen and storage validation") matches the two existing hooks exactly. *Resolves with:* correcting the sentence to "both layers reserve only `_snapback*` today."

7. **LOW — The "never synced" enforcement list omits the change journal and commit-version stream.** §Enforcement points covers generated types, `ctx.db`, sync/live paths, export, and the admin console — but if `_auth_*` writes ride the ordinary write machinery, `record_change` journals full `row_json` into `_snapback_changes` (`src/storage.rs:2515-2541`), the app commit version advances, and the live matcher inspects the changed rows — putting token hashes and code digests into a surface the enforcement list never names, and waking fan-out for writes no subscription may see. *Resolves with:* one line adding the journal/commit-stream to the enforcement points (or stating that `_auth_*` persistence bypasses the app-data write machinery, as `_snapback_client_mutations` already does).

8. **LOW — Related-header omissions.** LLP 0047 (§Summary, load-bearing deferral) and LLP 0016 (§Acceptance, the diary-evidence hook) are cited in the text but absent from the **Related** list.

## Suggestions

- **Make the body-auth rejection test registry-driven.** Instead of per-route 401/403 tests alone, iterate `route_registry()` and assert every `AppAuth`-classified route rejects bare body `AuthInput` under a session profile — the same pattern as `s1_route_registry_matches_the_invariant`, so a future route cannot dodge the sweep.
- **Reconsider `SessionAuth` on `GET /auth/session`.** Every client boot flow will call it to answer "am I logged in?"; as specified, the anonymous case is a 401 used as control flow. An optional-user Public introspection returning `{ isAuthenticated: false }` is friendlier and leaks nothing (it only reflects the caller's own credential). If 401-as-signal is intended, say so deliberately.
- **Name the authoring spelling for `authRequirement`.** The slice makes `authenticated` enforced, and the typed scope constructors are in scope — but nothing says how an app declares `authRequirement: 'authenticated'` in `define.mjs` (codegen currently hardcodes `optional-user` for every function). Add the authoring option to the deliverable list.
- **Prefix session bearers** (e.g., `sbs_…`) the way connection tokens use `sct_…` — greppable in review, and friendly to secret scanners; cheap to pin now, annoying to change later.
- **Acknowledge the single-active-challenge supersession nuance:** an attacker requesting codes for a victim's address (within throttle) repeatedly supersedes the victim's in-flight challenge — a mild login-DoS inherent to the single-active-challenge choice, bounded by the per-address throttle. One sentence keeps it a decision instead of a surprise.
- **Add over-declaration guidance beside the under-declaration lint.** The named sharp edge is omitted `permissionEpochBumps`; the opposite failure — declaring `permissionScope.user(authUserId())` on frequent self-writes — synchronously clears and resubscribes the actor's own auth-scoped subscriptions on every such write (visible flash under the fail-closed clearing contract). A sentence of authoring guidance ("declare bumps only on permission-*changing* writes") completes the picture.
- **Align LLP 0004's illustrative `.sync({ filter: (q, ctx) => q.eq('userId', ctx.auth.userId) })` example** with the pinned `authUserId()` rule when this lands, so the corpus's most-copied example doesn't teach the non-analyzable form.
- **Add a session-auth replay acceptance item** binding this slice to 0043's shipped M1/M2 machinery: a queued mutation fingerprinted under a real session survives refresh rotation (same `sessionId`) and strands on revocation — and state explicitly that once `ctx.auth` is server-resolved, the fingerprint input is the resolved authority, not the rejected body `AuthInput` (the kit's TS fingerprint mirror, `packages/snapback-contract/client-store.mjs:25`, currently fingerprints the client-asserted tuple).

## Open questions

Beyond the document's own list (which is good), these need answers to refine it:

1. What is the transport and gating of dev impersonation on app-data routes under session profiles — a marked envelope (defined where, in 0024?), or host-ops-only? (Concern 1.)
2. Where does the pepper live and who provisions/rotates it — a 0036 system-entry class, or an auto-minted instance secret outside 0036? Do the session TTL/throttle knobs wait for 0036 v2 non-secret entries? (Concern 2.)
3. What is the memory-only mechanism for per-operation grant-validity checks, and what is the sliding-expiry write policy on the single-writer lane? (Concern 3.)
4. Where is the per-profile auth mode declared, and how do clients and agents discover it? (Concern 4.)
5. Do `_auth_*` writes ride the app change journal and commit-version stream, or bypass them? (Concern 7.)
6. Should `GET /auth/session` answer anonymously instead of 401? (Suggestion 2.)

## Readiness verdict

Verdict: NOT READY

The proposal is the right slice, its security reasoning at the dangerous edges is correct, and its factual claims about the existing system are verified accurate to a degree that materially de-risks implementation — most of the document could be executed as written. But four material items remain unresolved in the current text: the undefined "marked 0024 impersonation envelope" that is the sole exception to the fail-closed body-auth rule (Concern 1), the pepper/config dependency on a 0036 model that cannot currently hold it (Concern 2), the unreconciled per-operation session checks and sliding-expiry writes against the corpus's own pinned no-global-mutex and single-writer properties (Concern 3), and the undeclared home of the per-profile auth mode the migration hinges on (Concern 4) — plus two small factual corrections (Concerns 5–6). Each resolves with a paragraph-scale revision, not a redesign; with those pinned, this is READY and should proceed to implementation ahead of the card-game/private-rooms demo it unblocks.

### Orchestrator verification notes — round 2 (outside the verbatim body)

Spot-checked before revising; the decisive claims verify:

- LLP 0024 defines the authority tuple only for the host-ops envelope, and no
  app-data impersonation carrier exists in code (`HandlerInput` has no marker
  field, `src/manifest.rs:912-941`; the only shipped `localDevOnly` fact is
  the host-ops result envelope, `src/host_ops.rs:94`) — the round-1 text's
  "marked 0024 impersonation envelope" on app-data routes was invoked but
  defined nowhere.
- LLP 0036 v1 is secret entries only, app-declared, action-granted
  (`CONFIG_NON_SECRET_UNIMPLEMENTED`,
  `packages/snapback-codegen/index.mjs:1329-1331`) — it cannot hold a
  server-internal pepper or non-secret TTL knobs without a revision the
  round-1 text never named.
- LLP 0031 §Connection capability grants pins verification as registry-lookup
  plus constant-time compare "in a dedicated small lock — never the global
  write mutex" (line 493), and LLP 0038 Part 3 records the ~1,050–1,280/s
  single-writer ceiling — the round-1 per-operation validity re-check and
  sliding-expiry writes were unreconciled with both.
- LLP 0017 §Security Defaults confirms the auto-minted admin token persists
  0600 next to the database (ENG-23443) — the basis for token-gated mailbox
  reads (and the paired GPT-family round-2 review independently established
  that plain `AdminRead` is loopback-open, so the gate must be the
  token-required read class).
- LLP 0043's Open Questions do not contain the fingerprint-scope question the
  round-1 text attributed to it (mis-citation confirmed).
- `validate_user_identifier` does reserve `_snapback*` at the storage layer
  (`src/storage.rs:2737-2746`, applied at table/field/index creation) — the
  round-1 "no storage-side reservation exists" sentence was wrong, while its
  conclusion (`_auth_*` passes both layers and would collide) holds.
- `record_change` journals full `row_json` into `_snapback_changes`
  (`src/storage.rs:2515+`) — the never-synced enforcement list omitted the
  change journal and commit-version stream.
- The contract client store wipes retained rows on fingerprint change at open
  (`scopeToAuth`, `packages/snapback-contract/client-store.mjs:88-96`), and
  its fingerprint mirror hashes the client-asserted tuple
  (`client-store.mjs:25`), consistent with the paired review's finding that
  the fingerprint is not yet derived from server-resolved authority.

**Disposition (2026-07-12 revision 2):** all four MEDIUM and four LOW
concerns addressed — dev impersonation on session-enabled profiles scoped to
the admin-token-gated host-ops surface only (no new app-data marker; the
undefined-envelope exception is deleted, which also simplifies connection
grants to anonymous-or-session); the pepper re-homed as an auto-minted 0600
instance secret beside the admin token (ENG-23443 pattern) with keyed
rotation, and TTL/throttle knobs pinned as v1 constants (no 0036 dependency);
per-operation grant checks pinned memory-only (session projection maintained
by auth writes; deadline index for expiry) with coalesced sliding-expiry
writes, preserving the 0031 small-lock and L9 pins; the auth mode homed in
the app manifest with a profile-combination table and capability-manifest
discovery; the fingerprint-scope open question owned by 0039 without the
false 0043 cross-reference; the reserved-prefix sentence corrected; `_auth_*`
persistence pinned to bypass the app change journal and commit-version
stream; Related gains 0016 and 0047. Suggestions adopted: registry-driven
body-auth rejection sweep, `GET /auth/session` as Public optional-user
introspection (200 with `isAuthenticated: false` rather than 401-as-control-
flow), typed `authRequirement` authoring named as a deliverable, `sbs_`
bearer prefix, the supersession login-DoS sentence, over-declaration
authoring guidance, the 0004 example-alignment landing note, and the
session-fingerprint replay acceptance items (fingerprint input = resolved
authority, never body auth).

## Round 3 — 2026-07-12

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md`, working-tree revision of
2026-07-12 round 2 (sha256
`60ff321e70b747ad5744d84fa14f35d03eb913213afa63a9cbca278494fde416`).
**Reviewer family:** Claude (Anthropic)
**Provider / runtime:** Claude Code CLI 2.1.207 headless (`claude -p`), model
`claude-fable-5` (invoked as `claude-fable-5[1m]`), effort `max`. Fresh
non-interactive session `a630a12b-dae5-45be-8963-4c35dc45d817` — not resumed
from earlier rounds; exploration delegated to four Claude-family subagents;
every assistant message including the review text was authored by
`claude-fable-5` (verified against the session transcript). The review body
below is verbatim, including its one-line preamble (the brief asked for no
preamble; honesty over tidiness).
**Date:** 2026-07-12
**Redacted:** No — reviewed locally; same secret-handling instructions as
earlier rounds.
**Method:** Same as earlier rounds — shared round-3 brief, blind to the
concurrent GPT-family round-3 review and to all archived reviews.

### Review body (verbatim)

All verification is complete — four agents covered the server code, manifest/fingerprint/ephemeral code, and both sets of referenced LLPs, and I confirmed the remaining details (LLP 0043 status, `CONFIG_NON_SECRET_UNIMPLEMENTED`) directly. Nearly every factual claim in the document checks out against code; one load-bearing claim (the replay-fingerprint record path) is materially off, and my own design analysis surfaced several unpinned safety gaps. Here is the review.

## Overall assessment

This is a strong, unusually honest implementation RFC, and the right slice to cut first. The selection — one built-in email-code provider, protected `_auth_*` tables, server-resolved authority with a manifest-homed mode, connection binding via a memory-only validity lease, declared permission dependencies feeding the existing epoch machinery, and structured diagnostics — is exactly the minimal path through LLP 0011 that exercises every layer a later provider will need. The document's factual claims about the existing system are almost uniformly accurate: I verified the route-policy vocabulary, the `ConnectionAuth`/`sct_` guard, the CORS echo with no `Allow-Credentials`, the `#[serde(default)]` presence-erasure on `AuthInput`, the loopback-open `AdminRead` semantics, the idle-based connection reaper, the authority-free grant record, `PermissionScopeExpr::Arg`'s unprefixed lowering, the unconsumed `authRequirement`, the `_snapback`-only prefix reservation in both validation layers, and the router/registry-as-separate-literals claim (the registry test at `src/server.rs:2771` really does check only internal consistency — the doc is more accurate here than LLP 0031's own status text). The round-2 fixes are real fixes, not word-smithing: the `AdminSecretRead` mailbox gate responds to a genuine fail-open (`src/admin.rs:534-563` allows tokenless loopback reads), and the `PermissionScopeExpr::User` variant responds to a genuine unimplementability.

The document is not ready yet, for a bounded set of reasons: one factual claim in the replay-fingerprint section is wrong in a way the section itself calls load-bearing ("stated honestly"); the sessions→dev mode transition is a silent fail-open the document's own transition machinery doesn't cover; the logout/sign-out clearing rule diverges from ratified 0011 without being called out; and three pinned contracts (reuse revocation, cookie-mode CSRF trigger, the conservative epoch fallback) have sharp edges the text doesn't yet acknowledge. All are addressable with paragraph-scale edits; none invalidates the architecture.

## Strengths

- **The slice is honest about what it is.** §Summary and §Non-goals name every narrowing explicitly: write-RLS substituted by `authRequirement` plus handler checks with a capability report and a dated 0011 addendum; ephemeral room permissions as a declared capability gap failing closed with `SNAPBACK_AUTH_PERMISSION_DENIED`; retained reads disabled under sessions until 0043's quarantine primitive lands; hosted deployment security named as an unowned contract rather than half-implemented. Each of these was verified against the cited LLPs — 0026 §Auth and revocation really does defer the integration; 0047 really does own only execution limits; 0045 §Summary records the mailbox handoff verbatim as claimed; 0046 carries the reciprocal export exclusion list.
- **Code claims verified accurate.** §Authority resolution's presence-erasure claim matches `src/manifest.rs:923-924`; §Diagnostics' claim that the status mapper knows no `AUTH_*` codes and falls through to 400 matches `src/server.rs:2630-2649`; the envelope-allowlist normalization to `SNAPBACK_HANDLER_FAILED` matches `src/runtime.rs:1854-1873`; exactly the two claimed `SNAPBACK_AUTH_*` codes exist. A design doc whose "what ships today" statements survive line-level audit is rare and materially de-risks implementation.
- **The memory-only validity lease (§Session transport and connection binding)** is a well-reasoned resolution of a real tension: per-operation SQLite reads would re-couple what LLP 0026's L9 tests decoupled (confirmed: `l9_ephemeral_ops_proceed_while_a_busy_mutation_holds_the_write_lane`), and the deadline index answers the confirmed idle-based-reaper gap (`CONNECTION_IDLE_TTL_MS`, `src/server.rs:1487`) where heartbeats would keep sockets alive past session expiry. Coalesced sliding-expiry writes correctly respect the measured ~1,050–1,280 mutations/s single-writer ceiling (confirmed in 0038 Part 3).
- **The challenge/session state machine (§Built-in first provider)** is specified at the right depth: keyed digests with a keyed-map pepper and rotation, verification outside the write lock with conditional compare-and-consume (`consumed_at IS NULL AND superseded_by IS NULL`), transactional first-login provisioning, and the hashing-polarity note that correctly reconciles SHA-256-at-rest for high-entropy tokens with 0009's "never hash secret values into audit logs" pin (confirmed in 0009 §Secrets).
- **Acceptance (§Acceptance)** is genuinely adversarial: the mailbox access matrix, property-style interleaving traces over both state machines, the registry-driven body-auth sweep, per-class negative write authorization, the deadline-close-under-heartbeat assertion, and the redaction sentinel. This is a test plan that would actually catch the failure modes the design worries about.
- **Migration realism.** Dev-mode behavior is preserved exactly as 0031 pins it, the body-auth rejection preserves wire presence (naming the `#[serde(default)]` obstacle), and the required 0031 revision (SessionAuth, AdminSecretRead, AppAuth re-scoping, router↔registry parity) is well-founded — I confirmed the current router is assembled from independent `.route()` literals and the registry test cannot catch an unregistered route.

## Concerns

1. **HIGH — The sessions→dev mode transition is a silent fail-open; only the enable path is guarded.** §Authority resolution pins `auth.mode` absent = `dev`, and §Protected identity core adds a pre-DDL collision check only for *enabling* sessions. Nothing covers the reverse: a manifest reload where the mode field is absent (author edit, codegen regression, stale bundle) silently converts a database full of real `_auth_users` and session-era app data back to dev mode — where every app-data route trusts client-supplied body auth (`src/manifest.rs:912-924`, 0031's invariant), and the loopback CORS echo (`src/server.rs:1582-1597`) lets any local page assert any `userId` and read that user's rows. The profile table makes this worse, not better: `prod` × `dev` still serves app data on loopback binds — precisely the same-origin-proxy topology. The document fixed exactly this class of bug in round 2 (the loopback-open mailbox), but its own mode machinery has the same shape of hole. *Resolves with:* a pinned transition rule — e.g., startup with `auth.mode: "dev"` over auth-subsystem-created `_auth_*` state fails closed with a stable diagnostic (`SNAPBACK_AUTH_MODE_DOWNGRADE`-class) requiring an explicit host-ops override — plus an acceptance row, symmetric with `SNAPBACK_AUTH_TABLE_COLLISION`.

2. **MEDIUM — The replay-fingerprint "stated honestly" paragraph is factually wrong about the record path, and mischaracterizes LLP 0051.** §Authority resolution says "the production record paths deliberately leave `auth_fingerprint` unset (the LLP 0051 D1 wire split leaves attaching it to producers)." In code, only the **wire-ledger** channel is unset (`CtxAnswerLedger.auth_fingerprint: None` at `src/runtime.rs:541`, `src/storage.rs:1081`, `src/local.rs:1510`); the **server-retained record** is populated on the production path (`auth_fingerprint(&input.auth)` at `src/local.rs:1361`, inserted into `_snapback_client_mutations` at `src/storage.rs:2953`) — and that retained field is exactly what the shipped `SNAPBACK_AUTH_STALE_RESULT` duplicate-settlement check compares (`src/storage.rs:302-308`). The sentence also contradicts the clause before it (a "changed retained fingerprint" can only be detected if the retained fingerprint is set). And 0051 D1 does not "leave attaching it to producers" as future work: it pins the wire split as settled and reports the record-side ledger landed (ENG-23892), with the fingerprint channel deliberately server-side. The correct honest statement is *stronger* for this RFC's motivation: the shipped retained fingerprint is computed from **client-asserted body auth**, which is precisely the trust hole v1's server-resolved-authority fingerprint closes. *Resolves with:* rewriting the paragraph to distinguish the populated server-retained record from the deliberately-unset wire ledger, citing 0051 D1 as pinned-and-landed rather than deferred.

3. **MEDIUM — Logout/sign-out and expiry-time client clearing is unpinned, silently diverging from ratified 0011.** 0011's ratified rule covers wipe on "user switch / **sign-out**" (§Local-First and Realtime Implications; the open-questions list marks local-store clearing on "user switch / sign-out" largely answered), and requires clients not to keep trusting rows they may no longer see. §Session transport's lifecycle rules pin the wipe only for authenticated→different-user and are silent on authenticated→anonymous. The two mechanisms also don't connect: §Permission dependencies' fail-closed clearing contract triggers on `resync_required` with reason "session invalidation," but §Connection binding says logout/revocation are "handled directly … without a general permission-epoch sweep," delivering only the typed auth-error frame plus close — and the kit's pinned reaction to that frame is suppress-reconnect-and-surface, with no clearing obligation. So no mechanism in the document actually attaches the clearing contract to logout, expiry, or revocation. Per the document's own rule ("divergences from 0011 are called out explicitly, not implied"), this must be pinned one way or the other. *Resolves with:* a pinned client contract for auth-coded closes and logout (clear in-memory rows and queues, or explicitly ratify a narrower rule as a 0011 divergence), plus an acceptance row.

4. **MEDIUM — Reuse-revocation on ordinary requests is likely too aggressive for a single-token design.** §Built-in first provider: "Any use of a superseded bearer outside the window is reuse evidence and revokes the session." With one bearer serving as both access and refresh credential, *ordinary* requests legitimately race rotation well beyond 10 s: background tabs with throttled timers/storage events, laptop sleep mid-flight, slow links. Each such benign event destroys the session everywhere, and recovery costs an email round trip (no password re-entry path exists). OAuth-style reuse detection is calibrated for refresh tokens, where post-rotation presentation is never legitimate; applying it to the request path imports the detection without the precondition. The open question asks only whether 10 s is the right window, which doesn't reach the real issue — the severity of the response. *Resolves with:* a tiered contract (e.g., ordinary-request reuse outside the window → `SNAPBACK_AUTH_SESSION_EXPIRED` without revocation, or a much longer ordinary-request grace; hard revocation reserved for *refresh* reuse), or an explicit justification of the aggressive rule with its false-positive blast radius acknowledged.

5. **MEDIUM — The cookie-mode CSRF trigger misses credential-establishing requests (login CSRF), and the absent-Origin case is unpinned.** §Session transport pins the origin check to fire "whenever the resolved credential arrived via cookie." `POST /auth/exchange` carries no cookie credential — it *sets* one — so a cross-origin form POST (no CORS needed) submitting an attacker's own valid `{challengeId, code}` logs the victim's browser into the attacker's account. Not exploitable in the capture-mailbox-only v1 (codes are unobtainable without the admin token), but the pinned contract is what ships, and it becomes live the day 0045 delivery or any real mail seam lands. Separately, the check's behavior when the Origin header is absent (same-origin GETs, non-browser clients) is unspecified — "require allowlisted Origin" breaks legitimate traffic, "absent → allow" needs saying out loud. *Resolves with:* extending the origin requirement in cookie mode to any request that would set or rotate a session cookie, and pinning the absent-Origin rule (e.g., cookie-credentialed non-GET requests and upgrades require a present, allowlisted Origin).

6. **MEDIUM — The conservative epoch fallback is only one declaration deep, so the property it claims is not achieved.** §Permission dependencies: "an omitted declaration must not be a silent staleness leak" — but the coarse global bump triggers only on writes to tables declared `permissionBacking: true`. A membership table whose author forgot the flag produces no bump at all: silent staleness, the exact failure the paragraph exists to prevent, moved one declaration up. LLP 0020's cited posture ("unknown permission impact is conservative" — confirmed verbatim) is about *unknown* impact; here unknown impact (undeclared table) is treated as *no* impact. The doctor lint is named only as follow-on work. *Resolves with:* stating the residual honestly and strengthening it — make the omission lint a landing requirement rather than follow-on, and/or derive permission-backing candidates mechanically (the manifest already carries per-function read summaries and `authScopeField`, so "mutation writes a table appearing in an auth-scoped live query's read summary, with no bump declared and no `permissionBacking` flag" is a computable check, not a heuristic).

7. **LOW — Per-source throttling is degenerate in every topology this slice supports, and the plaintext-non-loopback refusal does not fence out proxied hosting.** In all supported deployments (loopback bind, the 0030 proxy, a local TLS proxy) every request arrives from 127.0.0.1, so the §Built-in first provider per-source throttle collapses to one global bucket — either a trivial instance-wide code-request DoS lever for any local page, or a cap too high to matter. Relatedly, §Non-loopback binds' refusal gate (`SNAPBACK_AUTH_TRANSPORT_INSECURE`) does not prevent the loopback-bind-behind-TLS-proxy topology, which is exactly hosted exposure without the trusted-proxy contract the document defers. Low severity because v1's capture-only delivery keeps the stakes small, but the text currently implies protections these topologies don't deliver. *Resolves with:* one honest paragraph — per-source degrades to global in v1 (pick the failure mode consciously), and the loopback gate is not a fence against proxied hosting (operator-owned risk until the deployment-security contract exists).

8. **LOW — The LLP 0012 registration list overstates 0012's registry scope.** 0012's evolution policy covers diagnostic-code meaning changes and the shared artifact/capability-manifest families (confirmed), but it has no route-policy family and no general "wire-behavior change" category. §Authority resolution labels the body-auth rejection "an LLP 0012 compatibility event (a wire-behavior change…)", and §Observability lists "the `SessionAuth`/`AdminSecretRead` route policies" among 0012 registry events. Route policies belong in the 0031 revision this slice already requires. *Resolves with:* tightening the registration list to the families 0012 actually owns (diagnostics, capability-manifest fields, artifact/frame schemas), moving route policies to the 0031 revision, or explicitly extending 0012.

9. **LOW — Citation and spelling hygiene.** (a) §Lifecycle matrix attributes the file-custody posture to LLP 0007, which defines logical-vs-physical contracts but never assigns custody to the operator — that pin lives in 0036's backup discussion; (b) LLP 0007 and LLP 0051 are cited in the body but absent from **Related** (0051 isn't even linked); (c) §Authority resolution writes `AuthInput { principal, sessionId, userId }` but the wire keys are snake_case (`session_id`, `user_id`, `src/manifest.rs:912-917`) — the ingress presence-preservation work will be specified over the wrong spellings; (d) the AuthRevoked/AuthChanged removal sits in 0026's "Finding: scope-epoch machinery was dead code," not §Auth and revocation as cited; (e) 0038 names the *card-game slice* as auth-blocked — "private-rooms demo" is this document's own phrase and shouldn't be attributed to 0038.

## Suggestions

- **Add a mode-transition table** (dev→sessions, sessions→dev, sessions with schema change) beside the profile-combination table, so every transition has a named behavior — this also carries the Concern 1 fix naturally.
- **Pin retention/GC for `_auth_sessions` and `_auth_verification_codes`** (are revoked sessions retained for audit? are consumed/expired challenges swept?), and say whether a minimal auth event trail (logins, failures, revocations) is in or out of the slice — 0011's provider section implies audit metadata, and the doc currently has only `identity_id` provenance.
- **State `authRequirement` enforcement behavior on dev profiles.** Enforcing `authenticated` against the dev-resolved authority (body auth present) would let apps discover their gates in dev instead of first on session profiles, at no compatibility cost since the typed option is new.
- **Say where the bearer lives client-side and name the XSS trade** (localStorage-class custody is exfiltratable by app-origin XSS; HttpOnly cookies trade that for the CSRF surface §Session transport already analyzes). One sentence keeps the bearer-first decision from looking unexamined.
- **Add a sentence on projection rebuild at startup**: write-behind means the durable `expires_at` only ever lags the in-memory value, so rebuilding the session projection from `_auth_sessions` after restart is fail-closed by construction — worth stating so the implementation doesn't discover it accidentally.
- **Consider a host-ops `auth.mintSession` verb for suites** (admin-gated, dev/test profiles only, audit-marked), or explicitly reject it: walking request-code → mailbox → exchange is honest but three round trips per test identity; a gated minting verb would keep session-profile suites cheap. Weigh the backdoor risk in the text either way.
- **Align authority-kind names with 0024 when it gains the `session` mode** (`devImpersonation`/`adminBypass` here vs `devUser`/`devAdminBypass` there), or state the mapping, so the promised no-drift table is checkable.
- **Sharpen which subscription class the epoch machinery serves** — declarative sync filters vs `authScopeField` JS live queries — since read-set-driven re-runs may already cover part of the latter; a two-row matrix would clarify what `permissionBacking` protects and could shrink the coarse-bump blast radius.

## Open questions

Beyond the document's own list (which is good), these need answers to refine it:

- What are the pinned semantics of a **mode downgrade** (sessions→dev) over a database with real auth state, and who may perform it? (Concern 1.)
- Should superseded-bearer handling be **tiered by surface** (ordinary request vs refresh), and what is the false-positive budget for reuse revocation given email-round-trip recovery? (Concern 4.)
- What clears client-visible state on **logout and auth-coded closes**, and does the fail-closed clearing contract attach to the auth-error frame or only to `resync_required`? (Concern 3.)
- What is the **absent-Origin rule** in cookie mode, and does the origin check cover credential-establishing requests? (Concern 5.)
- How is **per-source throttling keyed** in topologies where every request arrives from loopback, and is a forwarded-header stance deferred wholesale to the deployment-security contract? (Concern 7.)
- Is the omission-lint for permission declarations a **landing requirement or follow-on**, and can permission-backing candidates be derived from the manifest's read summaries instead of relying solely on author declarations? (Concern 6.)
- Do session-profile acceptance suites always walk the mailbox flow, or does a gated **test session-minting** surface exist?

## Readiness verdict

Verdict: NOT READY

The proposal is architecturally sound, verifiably grounded in the current code, and honest about its narrowings — closer to ready than most drafts at this stage — but material concerns remain unresolved in the current text: a silent fail-open in the sessions→dev mode transition (Concern 1), a factually wrong load-bearing claim about the shipped replay-fingerprint record path plus a mischaracterization of LLP 0051 (Concern 2), an uncalled-out divergence from 0011's ratified sign-out clearing rule with an internal gap between the clearing contract and the logout mechanism (Concern 3), and pinned contracts with sharp edges in reuse revocation, cookie-mode CSRF coverage, and the conservative epoch fallback (Concerns 4–6). Each is resolvable with paragraph-scale revisions and corresponding acceptance rows; none requires rethinking the slice. With Concerns 1–6 addressed in the text, this document would be ready to move to Review.

### Orchestrator verification notes — round 3 (outside the verbatim body)

Spot-checked before revising; the decisive claims verify:

- **The round-2 fingerprint paragraph was indeed wrong.** The server-retained
  record path *is* populated on production mutations
  (`ClientMutationIdentity::new(…, &input)` at `src/local.rs:1360-1361`;
  `auth_fingerprint` inserted into `_snapback_client_mutations` at
  `src/storage.rs:2945-2958`); only the wire-ledger channel is deliberately
  `None` (`src/runtime.rs:541`, `src/local.rs:1510`), and LLP 0051 D1's table
  pins "auth context + fingerprint: crosses the wire — no; server-retained —
  yes, checked at replay" as settled and landed. The retained fingerprint is
  computed from client-asserted body auth — the sharper framing the review
  proposes is correct.
- 0011's ratified posture does cover sign-out ("full wipe on user switch /
  sign-out", `llp/0011:322-323`; adapters expose sign-out cleanup, `:262`).
- LLP 0012's registry covers the `runtimeState`, `capabilityManifest`, and
  diagnostic-code families (line 104) — no route-policy family; route
  policies belong to the 0031 revision.
- The operator-custody backup pin lives in LLP 0036 ("backups therefore
  carry live keys", `llp/0036:419-427`), not LLP 0007; `AuthInput` wire keys
  are snake_case; LLP 0007 and 0051 were cited but missing from Related.
- The mode-downgrade fail-open, login-CSRF, one-declaration-deep fallback,
  reuse-revocation severity, and loopback throttle-degeneracy concerns are
  design analyses of the round-2 text and are accepted as stated.

**Disposition (2026-07-12 revision 3):** all six material concerns
addressed — a mode-transition table with a fail-closed downgrade guard
(`SNAPBACK_AUTH_MODE_DOWNGRADE`) and startup-immutable mode; the fingerprint
paragraph rewritten around the verified record/wire split with a
server-issued authority descriptor design and pinned diagnostic precedence;
the authority-transition matrix now attaches the clearing contract to
logout/expiry/revocation and auth-coded closes (0011's sign-out rule cited);
reuse revocation tiered (ordinary-request reuse → `SESSION_EXPIRED` without
revocation; revocation reserved for refresh-path reuse) with token-family
tombstones replacing one-deep history; cookie mode removed from v1 entirely
(login-CSRF and absent-Origin questions become moot; the deferral records
them for the cookie slice); the conservative fallback strengthened to
mechanically-derived auth-relevant tables with coarse bumps that precise
declarations do not suppress in v1, and the omission lint promoted to a
landing requirement. LOW concerns: throttle degeneracy and the proxied-
loopback fence stated honestly; the 0012 registration list tightened to the
families 0012 owns; citation/spelling hygiene fixed (0036 custody, Related +=
0007/0051, snake_case wire keys, 0026 finding section, card-game
attribution). Suggestions adopted: the mode-transition table, retention/GC
pins, `authRequirement` enforced identically on dev profiles, the bearer-
custody XSS sentence, the projection-rebuild-at-startup sentence, a gated
host-ops `auth.mintSession` test verb, the 0024 authority-name mapping, and
the subscription-class matrix folded into the derivation rule.

## Round 4 — 2026-07-12

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md`, working-tree revision of
2026-07-12 round 3 (sha256
`7d48ddc1b991b95ed89a125afec15602d660747ea308da5114c7d683bb77206a`).
**Reviewer family:** Claude (Anthropic)
**Provider / runtime:** Claude Code CLI 2.1.207 headless (`claude -p`), model
`claude-fable-5` (invoked as `claude-fable-5[1m]`), effort `max`. Fresh
non-interactive session `a550d17e-0cfc-439e-a648-aaf62a1207f2`; Claude-family
exploration subagents; every assistant message authored by `claude-fable-5`
(verified against the session transcript). Review body verbatim, including
its one-line preamble.
**Date:** 2026-07-12
**Redacted:** No — reviewed locally; same secret-handling instructions.
**Method:** Same as earlier rounds — shared round-4 brief, blind to the
concurrent GPT-family round-4 review and to all archived reviews.

### Review body (verbatim)

All verification is complete. I have what I need to write the review — every load-bearing code claim was checked against the working tree, and the referenced LLPs (0011, 0031, 0043, 0051, 0038, 0020, 0026, 0024, 0012, 0017, 0036, 0045, 0046, 0030, 0009, 0004, 0013, 0000, 0042, 0047) were consulted. Here is the review.

## Overall assessment

This is a strong, unusually well-grounded RFC, and its central design calls are right. Server-resolved authority with one shared invocation gate, bearer-only transport in v1, a protected `_auth_*` system catalog outside the app manifest, connection binding at `POST /connection/open` layered on the shipped grant machinery, durable incarnation-scoped permission epochs, and a server-issued authority descriptor that is a consistency input rather than authentication — each of these is the correct narrow path through LLP 0011, and each is argued from the code as it actually exists. I verified the document's factual claims against the working tree extensively, and they hold with remarkable precision: the `#[serde(default)]` presence erasure on `AuthInput` (`src/manifest.rs:913-924`), live-ownership comparison omitting `session_id` (`src/local.rs:1707-1708`, `1781-1782`), the FNV-1a fingerprint retained per settled mutation and enforced only on duplicate settlement (`src/manifest.rs:1039-1058`, `src/storage.rs:302-309`), the deliberately-unset wire-ledger fingerprint channel (`src/runtime.rs:517-518`, LLP 0051 D1 landed via ENG-23892), the userId-only contract-store mirror (`packages/snapback-contract/index.mjs:314`, `client-store.mjs:27-29`), the process-memory epoch map advanced post-commit and cleared on reset (`src/local.rs:835`, `1003`, `1412`, `3618-3619`), `clear_retained` sent by the server and read by no shipped client, the `user:`-prefix double-prefix hazard in `PermissionScopeExpr` evaluation (`src/local.rs:3759-3761`, `4014-4040`), the hardcoded `optional-user` `authRequirement` with no runtime consumer (`packages/snapback-codegen/index.mjs:1545`), the status mapper knowing no `AUTH_*` codes (`src/server.rs:2630-2648`), the router/registry parallel-literals gap (`src/server.rs:621-626`), the tokenless-loopback direct admin runner (`src/admin.rs:854-894`, `558-562`), and the scoping of today's reserved-prefix checks (codegen table-names-only at `packages/snapback-codegen/index.mjs:290`; storage all-three at `src/storage.rs:2737-2744`). A document that gets this much right about its own substrate has earned trust on its pinned contracts.

The remaining problems are not architectural. They are: one silent cross-target fail-open hole in how `auth.mode` travels (the manifest field is ignorable by every consumer that predates it, including the one actually-hosted target); a recovery path and lifecycle matrix that lean on logical export/import machinery that does not exist anywhere in the code; two spec ambiguities (the `adminBypass` handler projection, and when/where the derived auth-relevant table set is computed); a missing sequencing story for what is, despite its narrowings, a very wide slice; and a handful of citation-precision defects in a document whose whole method is citation precision. All are fixable with paragraphs, not redesigns.

## Strengths

- **The three-type separation and rejection-not-stamping contract** (§Authority resolution). Distinguishing wire auth input / resolved authority / frozen `ctx.auth` projection, naming the `ephemeral::AuthContext` collision (`src/ephemeral.rs:213-219` is exactly the room-permission shape described), and pinning rejection of every client-auth-bearing field on session apps — with the enumerated surfaces matching the code's actual carriers (nested `HandlerInput.auth` at `src/runtime.rs:765-784`, live resume/unsubscribe owner auth, ephemeral `session_id`/`user_id`/`auth` fields at `src/ephemeral.rs:321-351`) — is the right fail-closed posture, stated enforceably.
- **Replay-fingerprint honesty and the descriptor design** (§Replay parity and the authority descriptor). The as-built statement is exactly true, including the subtle parts (server-retained fingerprint populated from client-asserted body auth; wire channel deliberately unset per LLP 0051 D1, which did land 2026-07-09). The descriptor's pinned properties — never authentication, `SESSION_EXPIRED`-before-`STALE_RESULT` precedence, session-scoped v1 with the stranding cost stated, versioned fingerprint with cross-language vectors — are careful and correctly costed. Discard-or-re-record as a user decision rather than auto-retry is the right call.
- **The auth-mode transition table** (§Authority resolution). Startup-immutability kills a whole class of live-transition races; the fail-closed downgrade guard with an explicit audited override is exactly the "boring, safe rule" idiom this corpus does well; the loopback-CORS-echo rationale is verified real (`src/server.rs:1582-1597` echoes any ported localhost origin).
- **The keyed-digest and keyring reasoning** (§Built-in first provider). The salted-vs-keyed distinction for low-entropy codes, the hashing-polarity note reconciling with LLP 0009's "never hash secret values in audit logs" pin (0009:683-686), the atomic-replace/rotation/fail-closed keyring contract, and reuse of the ENG-23443 0600-file capability pattern (verified at `src/admin.rs:236-317`, LLP 0017 §Security Defaults) are all correct and well-sourced. Gating the mailbox on token-required `AdminSecretRead` is precisely right given that `AdminRead` is tokenless on loopback and CORS-reachable.
- **The tiered superseded-bearer state machine** (§Built-in first provider). Applying reuse-revocation only where its precondition holds (refresh) while grace-tolerating ordinary-request races is a genuinely better design than the standard uniform reuse-detection rule, and token-family tombstones fix the N-2 attribution hole a one-deep `prev_token_hash` would have. The pinned lost-response answer (unrecoverable by design) is honest.
- **Connection binding scoped to what it can actually guarantee** (§Session transport and connection binding). The "delegated bearer" framing is honest rather than overclaiming a second identity check; the grant-bounds revisit honors LLP 0031's recorded trigger verbatim ("revisit if grants ever carry more than two small strings" — and the grant map today is exactly two strings, `src/server.rs:314`); the memory-only validity projection preserves the L9 decoupling LLP 0026 pinned; and the write-behind under-extension argument for fail-closed restart rebuild is logically sound.
- **Durable in-transaction epochs with a reset-scoped incarnation** (§Permission dependencies). This fixes verified-real defects (post-commit memory-only advance, reset ABA) and gives LLP 0043's retained epochs the substrate they need. The incarnation echoes the ephemeral scope-epoch resolution (LLP 0026's dead-code finding), which is good precedent reuse.
- **The typed-scope lowering analysis** (§Permission dependencies). The double-prefix hazard is real in the shipped evaluator, and the unprefixed `PermissionSubjectExpr` with round-trip tests over old and new forms is the right compatible fix. The subject-vs-actor pin, with acceptance covering the admin-revokes-membership case, addresses the exact way a builder would silently get this wrong.
- **Scope honesty throughout** (§Summary, §Non-goals). Capture-only delivery narrowing the claim to admin-driven onboarding; the unowned deployment-security contract named as a prerequisite with the loopback-behind-proxy limit stated; the write-RLS narrowing of 0011 declared, reported in runtime-state facts, and given a dated addendum vehicle; ephemeral room permissions as a declared capability gap. The acceptance section is unusually concrete (negative write classes per operation type, generated-interleaving state-machine traces, the registry-driven client-auth sweep).

## Concerns

1. **HIGH — `auth.mode` is enforceable only by targets that understand it, and every other consumer fails open by design.** §Authority resolution homes the mode in the persisted schema manifest, and LLP 0012's evolution policy pins that adapters "must ignore fields they do not recognize" (0012:96-101). The Cloudflare coordinator — a real, currently-serving consumer of the app schema manifest (`cloudflare/src/coordinator.js:55-64` imports `schema`, serves app-data traffic, and has no auth machinery) — would silently serve a `sessions`-mode app under client-asserted auth, which is exactly the trust hole the slice closes, and directly contradicts the matrix's categorical "prod never serves client-asserted auth; there is no override." The document pins discovery (capability manifest carries what the target supports) but no refusal obligation for targets that cannot enforce the declared mode, and never scopes which targets the mode matrix binds. The proving demo (the card game) is plausibly the next thing someone deploys to the Cloudflare target. *Resolves with:* an explicit target-scope pin for v1 (local Rust server), plus a pinned cross-target rule — `auth.mode` is a must-understand field: codegen/deploy tooling refuses to produce or load a `sessions`-mode bundle for a target whose capability manifest lacks session support (and the 0012 registration records this carve-out from ignore-unknown-fields) — plus an acceptance row exercising the refusal.

2. **MEDIUM — the catalog-collision recovery and lifecycle matrix depend on logical export/import machinery that does not exist, without naming it as a deliverable or dependency.** §Protected identity core pins the `SNAPBACK_AUTH_TABLE_COLLISION` recovery as "logical export → fresh database → apply the renamed app schema → import," and §Lifecycle matrix (plus the Acceptance row "logical export excludes sessions/tokens/challenges and logical import rejects identity collisions") specifies export/import semantics. No logical export/import exists anywhere in the code: no host-ops verb in `SERVED_HOST_OPS`/`CLI_ONLY_HOST_OPS`/`PINNED_UNBUILT_HOST_OPS` (`src/host_ops.rs:27-44`), and `src/schema_export.rs` is JSON-Schema generation for artifact shapes, not data export. LLP 0046's export/import path is itself proposal-stage. As written, the slice quietly acquires a whole subsystem through its recovery path and acceptance rows. *Resolves with:* naming an owner — either a minimal identity-scoped export/import is a listed deliverable of this slice, or the collision recovery is restated as a documented operator procedure (with the export/import contract pinned here but its construction explicitly gated on LLP 0007/0046 work), and the acceptance rows conditioned accordingly.

3. **MEDIUM — the `adminBypass` contract is self-contradictory for the direct admin runner.** §Authority resolution pins "`adminBypass` — host-ops surfaces only; it never materializes as an app-handler `ctx.auth`," yet the same section has the direct admin function runner (which runs app query handlers: `src/admin.rs:854-894`, body `Json<HandlerInput>`) "run as audit-marked `adminBypass`" on session-enabled apps. If bypass never materializes as a handler `ctx.auth`, what projection do those handlers receive, and what (if anything) does bypass bypass — do auth-variable filters fail with `AUTH_USER_MISSING`, do `authenticated` functions fail with `AUTH_REQUIRED`, do auth-filtered queries return empty? Each answer is defensible; the document pins none, and the acceptance sweep covers only the token requirement, not the handler-visible semantics. *Resolves with:* one pinned paragraph — e.g., "on session apps the direct runner resolves to an anonymous projection with an envelope-level `adminBypass` audit fact; bypass grants no identity and suppresses no check in v1; user-scoped admin reads go through host-ops `function.run` impersonation" — plus an acceptance row for what a direct-runner-executed auth-scoped query actually does.

4. **MEDIUM — the mechanically-derived auth-relevant table set is defined over subscriptions, making the conservative fallback subscription-lifetime-dependent.** §Permission dependencies derives auth-relevant tables from "the read summary or captured read set of an auth-scoped subscription." Captured read sets are per-live-subscription state (`src/local.rs:874`) that vanishes on restart and doesn't exist while no subscription is live. A permission-affecting write landing in that window advances nothing, and once LLP 0043's retained reads arrive, a later resume compares epochs that never moved — retained rows presented as current, which is precisely the "silent staleness" the fallback exists to prevent. The static half (manifest read summaries, `src/manifest.rs:341-351`) is load-time-computable and doesn't have this hole, but the text doesn't distinguish the two or say when the derived set is computed, persisted, or rebuilt. *Resolves with:* pinning load-time derivation from the static read summaries of every auth-scoped function as the floor; captured-read observations only ever *add* (durably, or by forcing a coarse bump when a previously-underived table is first observed); and a sentence on restart behavior of the derived set.

5. **MEDIUM — the custody trade cites "0009's XSS posture" as the mitigation, and LLP 0009 contains no XSS posture.** §Built-in first provider (client custody) closes with "0009's XSS posture is the mitigation, not token invisibility." LLP 0009 covers runtime/code-execution security, secrets handling, and database isolation; it says nothing about client-page XSS, CSP, or app-origin script injection (no such section or vocabulary exists in the document). The bearer-in-app-origin-storage decision is defensible, but its stated mitigation is a phantom — the honest form, which this document uses elsewhere for the deployment-security contract, is "no LLP owns the client XSS posture today." *Resolves with:* correcting the citation to name the gap (and, if desired, adding client-page security to the unowned-contract list beside deployment security).

6. **MEDIUM — the slice has no internal sequencing, and it is wide.** Despite the genuine narrowings, this one RFC carries: the shared gate across seven entry paths, mode machinery, the full provider and session state machines, keyring, connection binding plus the session projection and deadline closes, the typed authoring surface and a manifest-vocabulary change, durable epochs plus incarnation, the derived-set lint and doctor checks, the descriptor with first-delivery enforcement, an 0031 revision (registry enforceability plus two new policies), a new live frame variant, and substantial kit work — with cross-cutting prerequisites (0043's quarantine primitive, the 0031 revision, the 0051 amendment) named but unordered. The corpus's own pattern for work of this size is phased plans with landing gates (0020, 0026, 0032); an RFC that will be implemented across many landings needs at least a dependency sketch, or drift between its halves is likely (e.g., routes landing before the registry revision that makes their policies mechanical). *Resolves with:* a short landing-order section (or an explicit pointer to the companion plan/issue set that will own sequencing), naming the lands-before edges the text already implies.

7. **LOW — "the existing `SNAPBACK_OVERLOADED`" overstates what exists on the surface that will emit it.** §Grant bounds reuses `SNAPBACK_OVERLOADED` for open-cap refusal as "the existing" typed overload error. In the local server it exists only as an envelope passthrough (`src/runtime.rs:1854-1872`); it is produced today only by the Cloudflare platform layer (`cloudflare/src/platform-errors.js:44`), and the local status mapper doesn't map it (falls through to 400). The diagnostics table's "gains the mappings above" covers only `AUTH_*` codes. *Resolves with:* adding `SNAPBACK_OVERLOADED` (with its 429/503 status and retryability) to the enforcement-plumbing list, or minting the intended code explicitly.

8. **LOW — "0011's ratified sign-out rule" stretches the ratification.** §Authority-transition matrix grounds logout/expiry clearing in 0011's *ratified* rule, quoting "full wipe on user switch / sign-out." That phrase exists in 0011 only in the "(Largely answered)" open-question note (0011:322-323); the ratified 2026-07-02 call in §Status names "the user-switch full wipe" (0011:338), with sign-out/expiry cleanup appearing as adapter guidance (0011:262-263). The matrix's obligations are right and consistent with 0011's direction; the provenance is overstated. *Resolves with:* softening the citation, or folding an explicit sign-out clearing ratification into the dated 0011 addendum this slice already lands.

9. **LOW — mode-dependent behavior on statically-declared route policies has no registry representation.** Several pinned behaviors switch on `auth.mode` for a route whose registry policy is fixed: the direct runner's reads require the admin token only on session apps; the `?connection_token=` fallback is dev-mode-only; body-auth rejection applies only under session mode. The 0031 revision this slice requires pins router↔registry parity and centralized policy middleware, but the registry vocabulary as described (policy per route) cannot express "policy X in dev mode, policy Y in session mode," so the registry-driven sweep can't assert these mechanically. *Resolves with:* a sentence in the 0031-revision requirements pinning how mode-conditional policy is encoded (per-mode policy columns, or a session-mode overlay the middleware consults).

## Suggestions

- **Add a `permissionSubjectField` rung between the lint and full machine-proof.** For declared `permissionBacking` tables, allow (or require) declaring the subject column (e.g., `permissionSubjectField: 'userId'`); the runtime then derives `User(...)` bumps mechanically from the touched rows' old/new values for that column. This retires the wrong-subject residual for the common membership-table case at near-zero authoring cost, and is a natural stepping stone to the captured-reads graduation path the document names.
- **Pin the refresh cadence, or a maximum bearer age.** With sliding expiry extended by ordinary activity, an active client may never organically refresh, so a stolen bearer's exposure window and the `_auth_session_tokens` tombstone volume are both governed by a kit scheduling policy the document leaves as "ahead of expiry." A pinned rotate-if-older-than-N-days rule makes the security property and the GC math concrete; the 10 s grace-window open question is really downstream of this.
- **Fix the admin-token comparison alongside `AdminSecretRead`.** LLP 0038 Part 4 #6 records the non-constant-time admin-token compare (`src/admin.rs`, `c == p`); the mailbox gate materially raises what that token protects (codes → sessions). The connection-token path already has `constant_time_str_eq` (`src/server.rs:414-420`) to reuse.
- **Consolidate the companion-document obligations into one checklist.** The slice obligates: the 0031 revision (policies + enforceability), the 0051 descriptor-channel amendment, the 0012 registrations, the 0011 dated addendum, a 0024 amendment (the `session` authority mode *and* the `auth.mintSession` verb — 0024 owns the host-ops contract per its own seed precedent), the 0045 handoff, and the 0004 filter-example alignment. Today these are scattered inline; a single list makes the land-together contract auditable.
- **Pin the request-path bearer-resolution locus.** The document carefully pins the connection-path validity check (small lock, memory projection) but not where ordinary bearer-presenting requests resolve `token_hash → session` (read-lane SQLite lookup? in-memory token index maintained beside the session projection?). One sentence prevents an implementer from putting it under the write mutex.
- **Bound the capture mailbox.** The global request-code budget bounds ingestion rate but nothing pins mailbox retention/size; a cap plus sweep keeps the dev artifact from growing unboundedly under suites.
- **Acceptance additions:** (a) restart-rebuild of the session projection proves under-extension-only (the write-behind argument deserves a test, not just prose); (b) an unknown `auth.mode` value is a manifest-load error; (c) the descriptor's cross-language test vectors are an acceptance row, not just a design promise.
- **Note the admin-console surfacing change.** Today `_snapback_*` tables are hidden by omission (the console's table list derives from the app manifest — `src/storage.rs:257-267`, `src/admin.rs:837-852`); "surfaces them as protected system tables through a redacted DTO" is therefore new surfacing behavior, worth a word so the implementer doesn't assume a redaction tweak suffices.

## Open questions

- Which targets does the auth-mode matrix bind, and what must a target that cannot enforce `sessions` do with a manifest that declares it? (Concern 1 — the must-understand rule needs an owner: this slice, 0012, or the deploy tooling.)
- Who builds logical export/import, and when — this slice minimally, or LLP 0007/0046 first, with the collision recovery interim being an operator procedure? (Concern 2.)
- What exactly does `adminBypass` project into an app handler, and does it suppress any check in v1? (Concern 3.)
- What is the intended refresh cadence / maximum bearer age, given sliding expiry means active clients never organically rotate? (Also governs tombstone growth and the grace window's real-world hit rate.)
- Does `AdminSecretRead` stop at the mailbox, or should other secret-adjacent gated reads (e.g., parts of the gated inspect twin, config status) migrate to it in the same revision?
- Should there be a per-user cap on live sessions (repeated exchanges mint unbounded session rows until absolute expiry, bounded today only by the code-request throttle)?
- Is the descriptor's schema versioned in a way that lets v2 (userId-scoped) be introduced without a second compatibility event — e.g., should v1 already carry an explicit `descriptorVersion` the client echoes?
- The document's own open questions are the right ones — of them, the machine-checkable subject-coverage question and the deployment-security-contract ownership question are the two that gate real deployments and deserve answers first.

## Readiness verdict

Verdict: NOT READY

The proposal's architecture, safety posture, and honesty are excellent, and its claims about the existing system verified true at a level rare for design documents — most of this RFC could be implemented as written. But one HIGH concern (the ignorable-by-design `auth.mode` field silently failing open on non-Rust targets, contradicting the matrix's categorical containment claim) and several MEDIUM concerns (a recovery path resting on nonexistent export/import machinery that acceptance nonetheless asserts, the self-contradictory `adminBypass` projection, the subscription-dependent derivation hole in the conservative fallback, a phantom "0009 XSS posture" citation at a load-bearing custody decision, and the absence of any sequencing for a very wide slice) are material and unresolved in the current text. Each fix is a paragraph or a short section rather than a redesign; with them applied, this document is READY.

### Orchestrator verification notes — round 4 (outside the verbatim body)

Spot-checked before revising:

- **Cross-target fail-open confirmed:** `cloudflare/src/coordinator.js:55-64`
  imports the app schema/functions and serves app tables with no auth
  machinery, and LLP 0012:96-101 pins "adapters must ignore fields they do
  not recognize" — a `sessions`-mode manifest would be silently ignored on
  that target.
- **Logical export/import confirmed absent:** no such verb in
  `SERVED_HOST_OPS`/`CLI_ONLY_HOST_OPS`/`PINNED_UNBUILT_HOST_OPS`
  (`src/host_ops.rs:27-44`); `src/schema_export.rs` is artifact-shape JSON
  Schema generation.
- **The "0009 XSS posture" citation was phantom:** LLP 0009 contains no
  XSS/CSP/cross-site vocabulary at all.
- `SNAPBACK_OVERLOADED` is produced only by the Cloudflare platform layer
  (`cloudflare/src/platform-errors.js:44`); the local runtime only
  allowlists it in envelopes (`src/runtime.rs:1864`) and the status mapper
  does not map it.
- The 0011 sign-out provenance nuance verifies: the ratified §Status call
  names the user-switch wipe; "user switch / sign-out" appears in the
  "(Largely answered)" open-question note and adapter guidance.
- **One suggestion premise is stale, not adopted:** the admin-token compare
  is already constant-time (`token_eq`, `src/admin.rs:540,565`, with tests;
  the ENG-23441-era hardening recorded in the 0039–0047 gap-closure review's
  correction) — no fix needed; LLP 0038's original recording predates the
  hardening.

**Disposition (2026-07-12 revision 4):** the HIGH concern is addressed by a
target-scope pin (v1 binds the local Rust server target) plus an
`auth.mode`-is-must-understand rule — codegen/deploy tooling refuses a
sessions-mode bundle for a target whose capability manifest lacks session
support, recorded as an explicit carve-out from 0012's ignore-unknown-fields
policy — with an acceptance row. MEDIUMs: the collision recovery is restated
as an executable dev-mode procedure (schema rename + app-level copy, then an
explicit destructive orphan-drop flag) with logical export/import demoted to
a pinned future contract for 0007/0046 and its acceptance rows moved to the
companion-obligations checklist; `adminBypass` on the direct runner is
pinned (anonymous projection, envelope-level audit fact, bypass grants no
identity and suppresses no check in v1, user-scoped admin reads go through
host-ops impersonation, refused on prod) with an acceptance row; the derived
auth-relevant set gains a load-time floor from static read summaries, with
captured-read observations additive-only (first observation forces a coarse
bump) and restart covered by incarnation regeneration; the custody trade now
names the client-page XSS posture as unowned (beside the deployment-security
contract); a Landing order section with lands-before edges and a
consolidated companion-obligations checklist is added. LOWs: the
`SNAPBACK_OVERLOADED` mapping joins the enforcement-plumbing list; the 0011
sign-out citation is softened and an explicit sign-out-clearing ratification
is folded into the planned 0011 addendum; mode-conditional route policy gains
a pinned registry encoding (a session-mode overlay consulted by the policy
middleware). Suggestions adopted: `permissionSubjectField` as the middle
rung; a pinned kit rotation cadence (rotate past 7 days of bearer age);
per-user live-session cap; explicit `descriptorVersion` echoed by the
client; a bounded mailbox retention pin (already in-memory/TTL — capacity
sentence added); the admin-console new-surfacing note; projection-rebuild
and unknown-mode acceptance rows. Declined: the constant-time-compare fix
(already shipped; premise stale). The paired review's document-split
suggestion is declined for this loop (the slice lands as one unit; noted as
the author's call at acceptance) — the Landing order section addresses the
underlying sequencing need.

## Round 5 — 2026-07-12

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md`, working-tree revision of
2026-07-12 round 4 (sha256
`8f9f1b588ebb7e1ba5441176f1aab9e13b00f351fdbc0654ed0553d74bb5e7ce`).
**Reviewer family:** Claude (Anthropic)
**Provider / runtime:** Claude Code CLI 2.1.207 headless (`claude -p`), model
`claude-fable-5` (invoked as `claude-fable-5[1m]`), effort `max`. Fresh
non-interactive session `1c8d3dd3-644b-4e38-9602-f2ccbc18bcbb`; every
assistant message authored by `claude-fable-5` (verified against the session
transcript).
**Date:** 2026-07-12
**Redacted:** Same as earlier rounds.
**Method:** Same as earlier rounds — shared round-5 brief, blind to the
concurrent paired review and to all archived reviews under `llp/reviews/`.

### Review body (verbatim)

## Overall assessment

This is the strongest document I have reviewed in this corpus, and it is the right document to exist: LLP 0038 Part 7 names the auth vertical slice as the highest-leverage next subsystem, and 0039 executes exactly that recommendation with unusual rigor. I verified its factual claims about existing code extensively, and they hold up almost without exception — the route taxonomy and `RoutePolicy` set (`src/server.rs:604`), the `#[serde(default)]` presence-erasure on `HandlerInput.auth` (`src/manifest.rs:920-924`), the FNV-1a fingerprint and shipped `SNAPBACK_AUTH_STALE_RESULT` check (`src/storage.rs:302-308`), the `PermissionScopeExpr::AuthUser` double-prefix trap (`src/local.rs:3759`, `4019-4039`), the required-`auth` ephemeral DTOs (`src/ephemeral.rs:331-350`), the status-mapper gap (`src/server.rs:2630-2648`), the dead `authRequirement` literal (`packages/snapback-codegen/index.mjs:1545`), the `_auth_*` reservation gap (`src/storage.rs:2737`), the unread `clear_retained` flag, and the todo demo's `authScopeField` posture all check out. The state machines, the mode staging, the descriptor design, and the landing order are genuinely good engineering, and the document's habit of naming what is unowned (deployment security, client-page XSS) is exactly the honesty the corpus demands.

It is nevertheless not ready, for one load-bearing reason and a few medium ones. The v1 conservative-fallback rule in §Permission dependencies — "a committed write to an auth-relevant table always advances the coarse global auth epoch," with auth-relevance derived from the read summaries of every auth-scoped function — collapses under the document's own examples: it makes every ordinary write in the todo demo (and every move in the card-game proving demo) a global resync-plus-synchronous-clear event, contradicts the document's own "permission-affecting writes are rare" premise, and regresses shipped, measured machinery (the DK-3 delta path and the matcher's disjointness proofs exist precisely to avoid re-query storms). That rule needs a precise, narrower derivation — or an honest, quantified acceptance of the cost — before this RFC can be accepted. The remaining concerns are pinnable: server-side `clear_retained` semantics, receiver-side enforcement of the `auth.mode` must-understand rule (plus one mischaracterization of the Cloudflare coordinator's failure mode), the session-projection lock-order/L9 interaction, and an unpinned kit custody rule whose miss revokes healthy sessions.

## Strengths

- **Verified factual accuracy about the code it supersedes.** §Authority resolution's description of the wire auth type, presence erasure, live-ownership comparison (`principal`/`user_id`, not `session_id` — `src/local.rs:1780-1788`), and §Replay parity's precise account of what the fingerprint does and does not guard ("no *server-authoritative* guard on first delivery"; the contract store keyed off `userId` alone — `packages/snapback-contract/client-store.mjs`) are all correct against source. The document's "stated honestly" annotations (e.g., `--as-role` specified-not-shipped) are themselves accurate.
- **Scope honesty as a design section, not a disclaimer.** §Summary's target-scope rule, the named unowned deployment-security and XSS contracts (verified absent from LLP 0009 and 0047), the loopback-behind-a-reverse-proxy fence limit, and §Session transport's "the connection token is a delegated bearer" framing state the real security boundary instead of implying a stronger one.
- **The provider is specified as state machines with the right invariants.** §Built-in first provider restates 0011's two easy-to-violate constraints (verification outside the single-writer lock; transactional first-login provisioning — LLP 0011 lines 85-88) and then actually solves the compare-and-consume race they create. The keyed, domain-separated code digests with the LLP 0009 hashing-polarity reconciliation ("never hash secret values in audit logs," 0009:683) show unusual care.
- **The tiered superseded-credential design.** Distinguishing `CREDENTIAL_SUPERSEDED` (reload custody, retry once) from session expiry — so a sleeping tab cannot wipe a healthy session — designs away a real defect class, and the refresh-path reuse detection applies revocation exactly where its precondition holds.
- **Mode staging matches storage reality.** §Authority resolution's staged desired→active activation is honest about the shipped schema path (hot-apply and persist, open-without-revalidation — verified in `src/storage.rs:463-491`, `227-243`), and `SNAPBACK_AUTH_MODE_DOWNGRADE` failing closed over real user data is the right default. The staging rule also incidentally prevents hot mode-flips through any schema-apply surface — worth stating as a property.
- **The `authorityInstanceId` descriptor.** Opaque rather than a canonicalized hash, versioned for the userId-scoped v2, pinned precedence below credential validity, and explicitly "a consistency input, never authentication" — this is a better design than the fingerprint it replaces, and the store-version migration is correctly named an LLP 0012 compatibility event.
- **Diagnostics discipline.** The §Diagnostics table pins meaning boundaries, HTTP statuses, live-path behavior, and retry guidance; adopts the two shipped codes rather than re-minting; and names the enforcement plumbing (the status mapper's real gap, the `SNAPBACK_HANDLER_FAILED` normalization) so the implementation cannot skip it.
- **Landing order with lands-before edges and consolidated companion obligations.** Every companion claim I checked is right: LLP 0045 does record the mailbox handoff (0045:22-26); LLP 0051 D1 does pin the fingerprint's server-retained wire split; the 0011 sign-out ratification really is only adapter guidance plus a "largely answered" note (0011:262-264, 322-323), so the addendum plan is exactly the correct provenance repair; LLP 0004's filter example really is in neither declared form (0004:102).

## Concerns

**1. HIGH — The derived auth-relevant floor turns ordinary writes into global resyncs, contradicting the document's own premise and regressing shipped behavior.**
§Permission dependencies defines auth-relevant tables as (a) `permissionBacking` tables plus (b) "tables derived at manifest load from the static read summaries of every auth-scoped function," and pins "a committed write to an auth-relevant table always advances the coarse global auth epoch in v1 — declarations narrow, they do not suppress." The todo demo's `listTodos` is auth-scoped (`authScopeField: 'userId'`, `demos/todo/snapback/functions.mjs:29`; consumed at `src/live_matcher.rs:139` via `read_set_summary.auth_scope_field`), and its read summary is the `todos` table itself. So under (b), **every `addTodo` write advances the coarse global epoch**, every auth-scoped subscription receives `resync_required`, and — under this document's own fail-closed clearing contract — every client **synchronously blanks its rows and re-snapshots on every write by anyone**. The same holds for the card-game proving demo: every move is a global resync for every player. This directly contradicts the section's justification ("Permission-affecting writes are rare; over-resync on them is the acceptable cost"), and it regresses what ships today: the matcher already proves other-user todo writes disjoint and skips them (LLP 0020 Phase 4 implementation notes), and the corpus built the DK-3 `live_delta` path (0008, ~0.32 µs/sub vs ~1.7–2 ms/sub re-query, LLP 0035/0038 Part 4 #7) precisely to escape resnapshot-per-write. The omission lint compounds it: "the doctor flags runtime writes to derived auth-relevant tables that carried none" would flag every ordinary mutation in these apps. The design goal (0008's "false negatives are correctness bugs") is right; the derivation is over-broad because it conflates *tables a query reads as results* with *tables its visibility depends on*.
*Resolves with:* a precise derivation that excludes a table from the coarse floor when the auth-scoped function's dependence on it is fully mediated by a declared, matcher-analyzable row scope (`authScopeField` / `authUserId()`-derived predicates — exactly 0008's sanctioned analyzable subset, with the existing captured-read runtime-add rule catching declarations that lie), keeping the coarse floor for `permissionBacking` tables, secondary/cross-table reads, and non-analyzable functions; **or** an explicit, quantified acceptance of resync-per-write for v1 with the "rare" sentence corrected and an acceptance item bounding steady-state resync amplification in the proving demo. Either way, the fan-out semantics of a coarse bump (which subscriptions are "affected") must be stated, and the doctor-lint rule adjusted to not flag ordinary result-table writes.

**2. MEDIUM — The fail-closed clearing contract is defined against a server flag whose emission semantics are unpinned and currently degenerate.**
§Permission dependencies pins the client: clear synchronously "on a `resync_required` whose reason is authorization-affecting or that carries `clear_retained: true`." But the server today sets `clear_retained: true` on **every** resync emission, including `reset` and `outbox_overflow` reasons (`src/local.rs:1046`, `3600`, `3658`), and the document's only statement about the server half is that the flag is already sent. Implementing the pinned client contract against the shipped server means synchronous UI blanking on every resync of any kind (an outbox overflow would blank every handle on the connection). Even with Concern 1 resolved, this bites.
*Resolves with:* the slice pinning server-side emission semantics for `clear_retained` (true only for authorization-affecting invalidation; reset may keep it deliberately), or scoping the client clearing rule to authorization reasons — and an acceptance item that a non-authorization resync does not blank in-memory rows.

**3. MEDIUM — The `auth.mode` must-understand rule is enforced only at the sender, and its motivating sentence misstates the coordinator's actual failure mode.**
§Summary justifies the carve-out with "the Cloudflare coordinator … would silently run a sessions app under client-asserted auth." Verified against code, that is not what would happen: the coordinator **discards** client wire auth entirely — `invokeHandler` hardcodes `authJson: JSON.stringify({})` (`cloudflare/src/coordinator.js:1228`) and never reads `authScopeField` — so a sessions bundle would run every request as *empty-auth*, with declared-auth-scope queries silently running unscoped. That is still exactly a hole worth the rule (arguably worse: silent unscoped reads rather than impersonation), but the claim about code is wrong as written. Second, the rule's enforcement lives only in "codegen and deploy tooling refuse" — the loading end still obeys 0012's ignore-unknown-fields rule (verified: 0012:96-98; the coordinator destructures named fields and validates only hashes via `validateDeploymentMetadata`, `coordinator.js:279-300`), so any bundle reaching a target by a path that bypasses this repo's tooling fails open. A receiver-side seam already exists (`validateDeploymentMetadata`/`startupError` fails closed with 409 today; `scripts/cf-check-compat` is the existing deploy-time REFUSED pattern).
*Resolves with:* correcting the coordinator sentence (empty-auth/unscoped, not client-asserted), and either adding a receiver-side rejection (coordinator manifest load refuses `auth.mode: "sessions"` absent session support) to the companion obligations, or explicitly accepting tooling-only enforcement with the bypass risk named.

**4. MEDIUM — The session-projection linearization couples connection operations to write-lane latency and leaves rotation's ordering unpinned.**
§Session transport pins: "revocation-class writes hold that small lock across the durable commit and the projection swap." Holding the projection lock across a durable SQLite commit means every connection-scoped check *and* every ordinary bearer resolution (the token index is "maintained beside the projection") stalls behind the write lane plus fsync during revocation-class events — momentarily violating the isolation LLP 0031 pinned ("registry-lookup plus constant-time compare in a dedicated small lock — never the global write mutex, so the L9 latency bounds still hold," 0031:492-495; `tests/concurrency_v0.rs:472`). It also inverts lock order (small lock held while entering the write lane) without pinning the ordering discipline that prevents a future deadlock. Rare revocations make lock-across-commit defensible, but the document neither names the L9 interaction nor covers **rotation**: a refresh writes a tombstone and must swap the token index, and no ordering is pinned for it (an index published before a failed commit briefly honors a token that never durably existed).
*Resolves with:* either an explicit acceptance ("revocation-class commits may stall connection ops for one commit; L9 bounds exempt them") plus a pinned lock-order rule, or a fail-closed two-phase (publish a pending-revoked marker before the commit, finalize after, un-mark on rollback — spurious denials during rollback are fail-closed); and extending the linearization pin to rotation's tombstone/index swap or stating why grace-window slop absorbs it.

**5. MEDIUM — The thief-vs-sleeping-tab discrimination on refresh rests on an unpinned kit rule, and the penalty for missing it is session revocation.**
§Built-in first provider: a refresh with a superseded token **outside** the grace window revokes the session ("post-rotation refresh is never legitimate"). But a tab that slept through another tab's rotation and fires its scheduled refresh from a memory-cached bearer on wake produces exactly that signature. The design implicitly requires the kit to read current custody from shared storage immediately before every refresh; the kit-deliverables list pins cross-tab coordination and reload-and-retry for *ordinary* requests but never states the read-before-refresh rule, and §Acceptance's waking-tab trace covers only the ordinary-request path. A kit regression here silently destroys healthy sessions — the exact failure mode round 4 worked to eliminate.
*Resolves with:* pinning "refresh always reads current custody immediately before sending" in the custody deliverables, plus an acceptance trace for a woken tab whose scheduled refresh fires before custody reload.

**6. LOW — The pinned 0045 migration path latently conflicts with the at-rest code posture.**
§Delivery migrates auth-code delivery onto LLP 0045's **durable** outbox "once it is stable." 0045's intents are durable rows with rendered payloads; a plaintext code inside a durable intent lands in the database (and exports/backups), which the capture mailbox avoids *by construction* and the keyed-digest rule exists to prevent. Neither document pins the constraint.
*Resolves with:* one sentence pinning that auth-code payloads never persist in durable outbox intents (a capture-class/ephemeral-payload seam is a 0045 obligation of the handoff).

**7. LOW — `app.reset` wiping connection grants is new cross-component wiring the landing order doesn't own.**
§Lifecycle matrix says `app.reset` "wipes auth state with the rest — … and connection grants." Today it cannot: the `ConnectionRegistry` lives in server `AppState`, unreachable from `LocalSnapback::reset` (verified; grants deliberately survive reset today per `src/server.rs:305-308`). The pin is *correct* — a bound grant must not survive the wipe of the users it binds — but the text reads as description, and no landing item owns the wiring.
*Resolves with:* naming the reset→registry wiring in landing item 4 (or the 0024 amendment).

**8. LOW — "Use" for sliding expiry excludes visibly active clients.**
§Session transport: extension is triggered by "authenticated app-data requests and connection opens." A connected, read-only client (a live dashboard on a WebSocket) makes neither for 30 days and slides out mid-use; the kit's 7-day `/auth/refresh` cadence also does not extend. Possibly deliberate (refresh should not immortalize a session; the deadline-driven close is a feature), but the interaction is unstated.
*Resolves with:* one sentence defining whether socket liveness and/or refresh count as use, and why.

**9. LOW — Citation and naming precision (batch).**
(a) §Authority resolution attributes the live-ownership comparison detail to "LLP 0031's invariant"; 0031 states the client-supplied-auth trust plainly but not the ownership-comparison specifics (those are code facts, `src/local.rs:1706-1788`) — split the citation. (b) §Built-in first provider's `CONFIG_NON_SECRET_UNIMPLEMENTED` is shipped as `SNAPBACK_CONFIG_NON_SECRET_UNIMPLEMENTED` (`src/local.rs:2117-2135`). (c) §Status cites "LLP 0005's large-RFC rule" — that rule exists in the *upstream* corpus (`vendor/llp/llp/0005-rfc-process.guide.md` §Large RFCs), while repo-local LLP 0005 is the Contract/Exact explainer; qualify the cross-corpus reference. (d) "emits 0024's audit fact" — host-ops today has only the envelope `authority` block (0024 says "emit **or retain**"); apply the document's own shipped-vs-pinned honesty here. (e) §Session transport cites "LLP 0026's L9 tests" — fine (0026 documents L9), but the code labels them LLP 0032 L9; a dual cite avoids the hunt.
*Resolves with:* the five wording fixes.

## Suggestions

- **A load-bearing lint instead of coarse-always (novel, feeds Concern 1).** Make manifest load *fail* when an auth-scoped function's static read summary contains a table covered by neither its declared row scope nor a `permissionBacking` declaration. That forces every auth-relevant table into an explicit class at load time — false negatives become structurally impossible without per-write global resyncs — and reserves the coarse bump for the genuinely rare case the runtime-add rule exists for (captured reads exceeding the static summary). This is arguably a cleaner fulfillment of 0008's bar than shadow-mode graduation, and it composes with the machinery the document already specifies.
- **Name the LAN/phone-dev story under loopback-only dev mode.** The recent All Aboard iPhone-dev work rides LLP 0030's same-origin proxy (Vite binds the LAN; snapback stays loopback). One sentence saying the proxy is the sanctioned LAN-dev route — and that it deliberately re-exposes client-asserted auth to the LAN in dev — prevents the loopback-only rule from reading as a workflow regression.
- **Specify `/auth/*` behavior on dev-mode apps** in the session-mode overlay (404 vs. a typed refusal); the route table currently only defines session-mode behavior.
- **Cite the instance lock** (`src/instance_lock.rs`) as the precondition making the memory-only session projection sound (exactly one process owns the database).
- **Consider a checksummed token format** (`sbs_` + CRC, GitHub-style) so secret scanners can validate candidates cheaply; cheap now, annoying later.
- **Add to §Non-goals:** identity subject (email) change/rename, and built-in user deletion (0011's `UserDeleted` guidance covers BYOP but not the built-in provider); both are common asks that the `(provider, subject)` uniqueness model will eventually face.
- **Decide `authorizedUntil` before retained reads re-enable** (the document's own open question): recommend shipping the lease with a conservative default rather than indefinite retention, since retained reads are disabled in v1 anyway and defaults are cheap to set before anyone depends on them.
- **State the incidental staging property:** because mode changes are never hot-applied, no schema-apply surface (including `/app/ensure`) can flip auth mode at runtime — a nice invariant worth pinning so a future refactor doesn't lose it.
- **Header diet (non-blocking, 0038 recommendation 9):** the Revised block is now ~50 lines of prose; consider moving history to a changelog section.

## Open questions

- What is the precise membership rule for the derived auth-relevant set, and what is the fan-out semantics of a coarse bump — which subscriptions are "affected," and is there per-subscription coalescing that bounds amplification under sustained write load? (Must be answered to resolve Concern 1.)
- Who owns server-side `clear_retained` emission semantics — this slice, or a 0008/0020 amendment? (Concern 2.)
- Should the `auth.mode` must-understand rule be enforced at manifest-load time on every target (receiver-side), and if so, is the coordinator's `startupError` seam the right home? (Concern 3.)
- Is lock-across-commit the accepted linearization for revocation-class writes (with L9 exemption named), or should a pending-revoked two-phase be pinned instead — and what is rotation's ordering? (Concern 4.)
- Does the kit pin "read custody immediately before refresh," and does multi-tab custody need a shared worker in practice? (Concern 5; extends the document's existing grace-window question.)
- Do socket liveness and `/auth/refresh` count as "use" for sliding expiry? (Concern 8.)
- When auth-code delivery migrates onto the 0045 outbox, what payload class keeps codes out of durable intents, exports, and backups? (Concern 6.)
- Of the document's own open questions, two are load-bearing enough to want owners before implementation reaches item 4 of the landing order: who writes the deployment-security contract (and the XSS posture), and what machine-checkable proof graduates declarations from narrowing to suppressing the coarse bump — the answer to the latter should co-evolve with Concern 1's fix.

## Readiness verdict

Verdict: NOT READY

The document is close — its factual grounding is the best I have verified in this corpus, its narrowings are explicitly negotiated with the parent RFC, and most of its contracts are correct and implementable as written. But one load-bearing rule is materially defective: the v1 conservative-fallback derivation in §Permission dependencies, taken with the shipped manifests it cites, makes every ordinary write to the flagship demos a global resync with synchronous client clearing — contradicting the section's own "rare writes" premise, regressing measured shipped behavior, and installing a pathological paved path that the acceptance suite as specified would not catch. Until that rule is re-derived (or its true cost is owned and bounded), accepting this RFC would ratify a sync-layer regression alongside an otherwise excellent auth design. The medium concerns — `clear_retained` emission semantics, receiver-side must-understand enforcement plus the coordinator mischaracterization, the projection lock-order/L9 interaction, and the unpinned refresh-custody rule — are each resolvable with short pins, and none threatens the overall architecture. With Concern 1 resolved and Concerns 2–5 pinned, this document is ready to move to Review/Accepted.

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
**Reviewer family:** Claude (Anthropic)
**Provider / runtime:** Claude Code CLI 2.1.207 headless (`claude -p`), model
`claude-fable-5` (invoked as `claude-fable-5[1m]`), effort `max`. Fresh
non-interactive session `f0cd1f45-c470-4929-b124-8805d764d962`; every
assistant message authored by `claude-fable-5` (verified against the session
transcript). Review body verbatim, including its one-line preamble.
**Date:** 2026-07-12
**Redacted:** Same as earlier rounds.
**Method:** Same as earlier rounds — shared round-6 brief, blind to the
concurrent paired review and to all archived reviews under `llp/reviews/`.

### Review body (verbatim)

All verification is complete. The document's code-facts held up almost everywhere under adversarial checking (which is itself notable), but I found a specification gap at the centerpiece mechanism plus several medium-severity spec holes. Writing the review now.

## Overall assessment

This is a strong, unusually well-grounded implementation RFC, and the slice it selects through LLP 0011 is the right one: server-resolved authority at one shared gate, one passwordless provider with capture delivery, protected `_auth_*` state, connection binding with a fail-closed revocation protocol, and epoch-fed invalidation — with the existing loopback bypasses closed so sessions are not decorative. Its distinguishing virtue is factual hygiene: nearly every claim it makes about shipped code survived independent verification against the source — the presence-erasing `#[serde(default)]` on `HandlerInput.auth` (src/manifest.rs:920-924), live resume/unsubscribe comparing `principal`/`user_id` but never `session_id` (src/local.rs:1780-1782, 1706-1708), `clear_retained: true` on every resync emission including `outbox_overflow` and `reset` (src/ephemeral.rs:776-783, src/local.rs:1041-1047, 3653-3658), `authRequirement` emitted as a hardcoded `'optional-user'` with no runtime consumer (packages/snapback-codegen/index.mjs:1545), the process-memory post-commit epoch map (src/local.rs:835, 1387-1418), the Cloudflare coordinator's hardcoded empty auth (cloudflare/src/coordinator.js:1228), tokenless-loopback `AdminRead` raw table reads plus the localhost CORS echo (src/admin.rs:558, src/server.rs:1582-1596), the `Public` `/app/ensure` that installs executable bundles (src/server.rs:646), the reset-surviving `ConnectionRegistry` (src/server.rs:305-314), and the userId-only contract store mirror (packages/snapback-contract/client-store.mjs:26-30). A proposal built on a verified map of the present is worth far more than one built on an imagined one.

Is it a good idea? Yes — and most of the individual designs (staged mode activation, two-phase revocation, the two-axis client store, superseded-token tiering, keyed code digests, `clear_retained` emission semantics) are correct responses to verified gaps. Is the plan good? Largely yes; the landing order and companion obligations are explicit and credible. What keeps it from READY is a small number of specification gaps at load-bearing points: the round-5 centerpiece — the load-time classification lint — cannot, as literally written, classify the shared-visibility tables of its own proving demo without contradicting its own no-regression acceptance; the mode-transition failure path can wedge a brownfield instance with no specified escape; the must-understand carve-out does not bind receivers that never learn it; the bootstrap-handshake pin contradicts offline-first cold start (including 0043's already-shipped retained stale boot); and "physical restore invalidates all sessions" is asserted without a detection mechanism. None of these reverses direction; all are completable with text, and the document's own machinery (permissionDependencies, pre-bind startup authority, the 0012 registration) contains the ingredients for each fix.

## Strengths

- **Verified factual ground.** The "what ships today, precisely" discipline (§Replay parity, §Permission dependencies, §Authority resolution) is real, not rhetorical — see the code citations above. Where the document distinguishes code facts from LLP statements ("a code fact, not an LLP 0031 statement"), the distinction checks out: LLP 0031 pins only that app routes carry client-supplied `ctx.auth`; the principal/user_id comparison is indeed code-only.
- **Sessions-are-not-decorative reasoning (§Existing surfaces under sessions).** Both bypasses are real and confirmed: raw rows via tokenless-loopback `AdminRead` under an origin-echoing CORS layer, and `Public` `/app/ensure` installing executable functions. Pulling their closure into the slice with hostile-origin acceptance proofs — rather than deferring it — is the single most important scoping decision in the document.
- **The `clear_retained` catch (§Permission dependencies, "Fail-closed clearing").** Implementing 0011's fail-closed client against today's server would blank the UI on an outbox overflow, because the server sets `clear_retained: true` unconditionally (verified at every emission site). Pinning server emission semantics before the client rule lands is exactly what a design review pass is for.
- **Two-phase revocation (§Session transport).** It honors LLP 0031's verified lock pin (registry lookup plus constant-time compare in a small lock, never the write mutex) and LLP 0026's L9 isolation tests, states in-flight semantics honestly instead of overclaiming, orders rotation's tombstone/index swap correctly, and pins restart rebuild as under-extend-only with an acceptance test.
- **The authority-transition matrix and single `AuthCoordinator` (§Authority transitions).** The late-terminal-error hazard (`compareAndClear` against a newer authority) and the optimistic-reducer-reapply hazard are both real client-architecture traps; assigning clearing to one epoch-carrying coordinator is the right shape, and the honest sourcing of the 0011 sign-out ratification (adapter guidance plus a "largely answered" note today — verified) is exemplary provenance practice.
- **The two-axis store and opaque descriptor (§Replay parity).** The shipped one-axis mirror is confirmed (`session_id` hardcoded null, userId-only), and the transition matrix genuinely requires two axes. Making the descriptor opaque — a consistency input, never authentication — avoids the cross-language canonicalization trap, and extending `AUTH_STALE_RESULT` to first delivery rather than minting a new code is the 0012-compatible choice.
- **Provider crypto posture (§Built-in first provider).** Keyed, domain-separated, length-prefixed HMAC for low-entropy codes; plain SHA-256 only for 256-bit bearers; the keyring's atomic-replace/rotation/fail-closed lifecycle; and the correct rejection of LLP 0036 config as the pepper home (0036's ratified v1 is secrets-to-action-VMs-only, verified). The 0009 hashing-polarity note ("never hash secret values into audit logs" — verified verbatim) shows the right threat literacy.
- **`KeyMode::Custom` rejection under sessions (§Ephemeral rooms).** Verified: key mode is uncoupled from `AccessPolicy` and the caller-supplied `custom_key` is adopted with no ownership check (src/ephemeral.rs:2305-2363), so an `AllowAll` collection with custom keys permits cross-caller overwrite — which LLP 0013 §Scope and keys already forbids. Failing closed here enforces an existing pin rather than inventing a new one.
- **Diagnostics discipline (§Diagnostics and route registry).** Adopt-don't-remint for the two shipped codes, the status-mapper gap named explicitly (verified: no `AUTH_*` arm today, fall-through 400; `SNAPBACK_OVERLOADED` originates only in the Cloudflare layer), and 0012 registrations scoped to the families 0012 actually owns.
- **Scope honesty (§Summary).** Naming the three unowned contracts, the fence's reverse-proxy limit, and the corrected Cloudflare failure mode (empty-auth unscoped, not impersonation — verified against the coordinator) is the kind of honesty that makes the rest of the document trustworthy.

## Concerns

1. **HIGH — The classification lint, as written, cannot classify the proving demo's shared-visibility tables; its class (a) definition and the "auth-scoped" trigger are under-specified at the exact point the round-5 fix depends on.** §Permission dependencies pins: manifest load fails when an *auth-scoped function's* static read summary contains a table covered by neither (a) "a declared, matcher-analyzable row scope — `authScopeField`, or an `authUserId()`-derived predicate: exactly 0008's sanctioned analyzable subset" nor (b) `permissionBacking: true`. Three problems compound. (i) The appositive is wrong: LLP 0008's sanctioned analyzable subset is structured *single-table filter expressions generally* (0008 §Subscription Contract, §Reactivity), not the two auth-derived forms named — `authScopeField`/`authUserId()` appear nowhere in 0008; they are code/authoring vocabulary (src/manifest.rs:349-350, packages/snapback-codegen/define.mjs:171). (ii) Under the enumerated-forms reading, a membership-gated shared table — the card game's `games`/`moves`, visible to all players of a game; any chat's `messages` — fits neither class: it has no user-disjoint row scope (declaring `authScopeField` on it would make the verified matcher skip other players' writes, src/live_matcher.rs:139-150 — a staleness false negative, exactly what 0008 forbids), and declaring it `permissionBacking` makes every move an epoch-advancing write, which directly contradicts the acceptance pin that ordinary card-game writes advance no epoch and ride DK-3 deltas. Yet §Invalidation-by-class lists "the card game's moves" as a row-scope-mediated result table, and plain auth-independent reference tables read by auth-scoped functions have no legal class at all. So either the proving demo fails manifest load, or the intended class (a) is broader than the text says. (iii) "Auth-scoped function" is undefined (filter-references-auth? reads `ctx.auth`? `authenticated`?), and the rule attaching subscriptions to epoch scopes (which subscriptions depend on `user:U` versus the global auth scope) is gestured at but not pinned — the "false negatives are structurally impossible" claim rests on both. Note also that the runtime-discovery safety net catches reads *beyond* the summary but not a *misdeclared* class-(a) table, so a lying `authScopeField` is an unnetted false-negative channel. *Resolves with:* a precise definition of class (a) (whether arg-derived/analyzable non-auth scopes qualify and, if so, an explicit statement that they prove nothing about authorization — visibility gating then rides on declared `permissionDependencies` over a classified backing table, which appears to be the intended third shape and should be named as one); a definition of "auth-scoped function"; the pinned subscription-to-scope dependency-attachment rule; a validation story for `authScopeField` truthfulness (e.g., 0008's L4-style debug convergence assertion); and a worked classification of the todo and card-game manifests — every (function, table) pair, its class, and the resulting invalidation behavior — demonstrating consistency with the no-regression acceptance. Correct the "exactly 0008's sanctioned analyzable subset" appositive.

2. **MEDIUM — The dev→sessions transition has no specified failure/unstage semantics; a misordered brownfield operator is wedged with only a destructive exit.** §Authority resolution: while `desired != active`, app-data is refused; the next startup consumes `desired` pre-bind. §Protected identity core: a colliding physical `_auth_*` table "fails startup with `SNAPBACK_AUTH_TABLE_COLLISION`", and the sanctioned non-destructive recovery (rename-and-copy via an app-level migration mutation) must run "while still in dev mode." But once staged, that path is unreachable: app-data (including `/app/ensure`, registered `AppData` — src/server.rs:646) is refused while pending, and a failed consume fails startup, so no route serves at all. Whether an admin/host-ops schema apply survives `MODE_PENDING`, whether re-applying `auth.mode: "dev"` clears `desired`, and what a failed consume does to `desired` are all unspecified; the only specified escape, `--drop-orphaned-auth-tables`, deletes the very tables the operator was told to migrate first. This repo treats wedge traps as first-class defects (ENG-22659's bootstrap posture), and this one is avoidable. *Resolves with:* specified consume-failure semantics (boot in the still-active mode with `desired` quarantined plus a startup diagnostic, or a non-destructive `--clear-desired-auth-mode`), an explicit statement of which surfaces can re-stage during `MODE_PENDING`, and ideally running the collision check at stage time as a fast-fail so a doomed transition is refused before the restart barrier. State the fresh-app flow (pre-bind startup provisioning activating sessions with no pending window) while at it.

3. **MEDIUM — Receiver-side must-understand enforcement cannot bind receivers that never learn the field; already-deployed targets fail open by construction.** §Target scope enforces the carve-out sender-side and receiver-side, and correctly observes sender-side alone fails open for non-repo tooling — but the symmetric limitation is unaddressed: LLP 0012's evolution rule is ignore-unknown-fields (verified), so any *already-deployed* coordinator predating the carve-out ignores `auth.mode` entirely and runs the bundle empty-auth and unscoped (cloudflare/src/coordinator.js:1228) — the failure the document itself rates "worse than impersonation." Receiver-side enforcement only exists in receivers new enough to know the field. *Resolves with:* making the gate structural for legacy receivers — e.g., sessions bundles ship under a deployment-metadata/format version that the existing `validateDeploymentMetadata`/`startupError` seam (coordinator.js:279, 358-366) already rejects with its 409, or an equivalent poison-pill encoding an ignore-unknown receiver cannot load — or, if the deployed validation is not strict enough to reject unknown versions, an explicit statement accepting the residual with its operational bound (which receivers, until when).

4. **MEDIUM — The bootstrap-handshake pin contradicts offline-first cold start, including behavior 0043 already shipped.** §Authority resolution pins: "The kit must complete it **before** it renders a retained store, opens a connection, or constructs an auth-bearing request." An offline device can never complete a server handshake; LLP 0043's shipped M1/M2 slice explicitly includes "retained stale boot" (0043 §Status), so the pin as written is unsatisfiable for offline boot of dev-mode apps today, and it will collide with item 8's whole purpose (retained reads under sessions) the moment they re-enable. In v1 the conflict is masked under sessions only because retained reads are disabled. *Resolves with:* scoping the pin — handshake precedes any *online* interaction (first connection, first auth-bearing request, first resubscribe); offline boot renders from stored `(incarnation, epoch)` and last-active mode with staleness marked, and a mode change discovered at the eventual handshake forces the clearing transition — or explicitly assigning the offline-boot handshake rule to item 8 with this constraint named.

5. **MEDIUM — "Physical restore invalidates all sessions" is asserted without a detection mechanism, and the document's own backup definition defeats the obvious one.** §Protected identity core (Lifecycle matrix) requires restore to regenerate the incarnation (free — restart already regenerates it) *and revoke every restored session* (not free — sessions are durable and a restart does not revoke them). No mechanism is named for distinguishing a restored instance directory from a normal boot, and since the pinned backup unit is the whole instance directory — SQLite file *and* keyring — a restored pair is internally consistent, so no sidecar-nonce comparison inside the instance directory can detect it. As written, the acceptance row ("physical restore invalidates restored sessions") tests a mechanism the design never defines. *Resolves with:* either naming a real detection anchor outside the backup unit, or restating the contract honestly as an operator-declared procedure (a documented restore flag/verb that performs the mass revocation) with the residual named — an undeclared restore leaves resurrected sessions live until expiry or the next revocation event.

6. **LOW — Two provenance/wording inaccuracies beneath the document's own standard.** (i) The mode-matrix `dev` cell reads "today's behavior — **loopback binds only**, on every profile, absent an explicit dangerous override": no bind fence or override flag exists today — the server binds any `--host` and merely disables admin on non-loopback without a token (src/cli.rs:723-733, 568-571); the fence is this slice's new deliverable (acceptance treats it as such). (ii) LLP 0030 is characterized as "the sanctioned route, which deliberately re-exposes client-asserted auth to the LAN in dev"; 0030 actually pins loopback-by-default with non-loopback as an explicit opt-in that must warn — the "sanctioned/deliberate" framing is this document's gloss, not 0030's posture. *Resolves with:* rewording both — mark the fence as new enforcement, and attribute the LAN re-exposure consequence to this document's analysis of the opt-in path rather than to 0030's sanction.

## Suggestions

- **Ship a classification report artifact.** Make manifest load (or the doctor) emit the per-(function, table) classification table with the reason each table passed — this is simultaneously the worked example Concern 1 demands, the teachable explainer for `PERMISSION_DEPENDENCY_UNCLASSIFIED`, and 0011's "doctor output explaining an allow and a deny" made concrete for sync.
- **Consider DPoP-style sender-binding as the named XSS-mitigation trajectory.** Since bearer custody in app-origin storage is the accepted trade and no LLP owns the XSS posture, pinning a future path — bind the bearer to a non-extractable WebCrypto keypair, proof-of-possession per request (RFC 9449 shape) — would give the custody section a destination stronger than the deferred cookie contract, without changing v1.
- **Capability-URL onboarding before 0045.** Admin-driven onboarding currently means host-ops session minting. A gated host-ops verb that mints a one-time login link (a pre-issued challenge/code pair encoded in a URL, delivered out-of-band by a human) would make "admin-onboarded same-origin deployments" genuinely usable by non-agents while remaining inside the capture-only posture — the code never rides durable delivery.
- **Same-user re-login stranding: name the relaxation criteria.** Row 3 of the transition matrix strands queued mutations on every same-user session change; for a local-first product that is real friction on a common path (expiry then re-login). The document already reserves a userId-scoped `descriptorVersion: 2` — state the conditions under which it would be adopted (e.g., handlers reading only `userId`, no `sessionId`-dependent behavior) so the v1 conservatism is visibly a decision with an exit.
- **Extend the throttle-honesty note to connection opens.** §Grant bounds pins per-source open caps, but under the same-origin proxy topology every open arrives from 127.0.0.1, so per-source degenerates to global exactly as §Built-in first provider concedes for request-code; say so and tune the caps as effectively global.
- **Specify anonymous `authorityInstanceId` minting under sessions** (per what — connection, boot, browser profile?); it governs the anonymous-queue stranding behavior in row 1 of the transition matrix. One sentence suffices.
- **Name the non-browser custody story.** Web Locks and BroadcastChannel are browser APIs; Snapback's clients include the Ibex/React Native runtime this repo vendors. Single-process native custody is trivial — say that, and confirm the bounded-lease fallback covers the rest.
- **Acceptance additions:** constant-time comparison for code digests and token-hash checks (0031 pins it for grants; the provider section is silent), and a test that a stage-time collision pre-check (if adopted per Concern 2) refuses a doomed transition.
- **Clarify what `generation` buys over `revoked_at`.** Every listed generation-bumping event also ends the session, making the field look redundant; if it exists for future partial-revocation semantics or grant-staleness comparison, say so.
- **Citation tightening:** LLP 0011 §Security Considerations pins log redaction but not hashed-at-rest storage (that inference comes from 0011's Valet-derived model text); `SNAPBACK_CONFIG_NON_SECRET_UNIMPLEMENTED` is not 0036's named code (0036 names the behavior, and `SNAPBACK_CONFIG_MISSING`/`SNAPBACK_CONFIG_UNDECLARED`); "the shipped host-ops request carries only `userId`" is a code claim, while 0024's pinned envelope carries `userId` plus `roles` — mark it as a code fact if verified, and add `SNAPBACK_AUTH_MODE_DEV` to the diagnostics family listing rather than route-table prose only.
- **Consider the split-at-acceptance now rather than later.** Items 6–8 (classification, descriptor/two-axis store, retained re-enable) form a coherent "authorization invalidation" sub-RFC under the upstream large-RFC rule; the least-settled mechanism (Concern 1) would then be independently revisable without reopening the settled authority/provider/transport core. Non-blocking; the Status section already reserves the author's call.

## Open questions

Beyond the document's own list (which is good — and its recommendation to decide `authorizedUntil` before item 8 should be treated as binding):

1. What exactly qualifies a table for class (a) — and is the intended third shape "result table whose visibility rides on a declared `permissionDependencies` entry over a classified backing table"? (Concern 1; this is the question the revision must answer first.)
2. What are the consume-failure and unstage semantics for a staged mode transition, and does any admin/host-ops surface remain able to re-stage during `MODE_PENDING`? (Concern 2.)
3. Can already-deployed coordinators be made to fail closed on sessions bundles via a metadata-version bump their existing validation rejects — and if not, what residual is accepted, for which targets, until when? (Concern 3.)
4. What is the offline-boot contract once retained reads re-enable — render-from-stored-facts with which staleness marks, and what happens when the eventual handshake reports a mode change? (Concern 4.)
5. Is "physical restore" operator-declared or detected, and by what anchor? (Concern 5.)
6. When LLP 0045 real delivery lands, does `request-code` become open self-serve signup by default, or does the handoff include a signup policy (allowlist/invite/open) knob? The non-enumeration design quietly implies open signup the moment delivery is real.
7. What budget does per-request session resolution and the sliding-expiry write-behind get against the ~1,050–1,280 mut/s single-writer ceiling — is there a measured bound on auth-induced write-lane traffic under the coalescing rule?

## Readiness verdict

Verdict: NOT READY

The direction, slice selection, and the great majority of the mechanism design are right, and the document's verified factual grounding is the best I have seen in this corpus — most sections could be implemented as written. But Concern 1 is material and unresolved in the current text: the load-time classification lint is the round-5 revision's centerpiece, and as literally specified it either fails the proving demo's manifest at load or forces classifications that contradict the document's own no-regression acceptance; the fix requires new normative text (class definitions, the dependency-attachment rule, a worked demo classification), not a wording touch-up. Concerns 2–5 are each a missing-mechanism or missing-failure-path specification on safety- or availability-relevant claims (transition wedge, legacy-receiver fail-open, offline boot, restore detection) that should be written down before acceptance, since implementers will otherwise resolve them ad hoc. None of these challenges the architecture; with a revision addressing Concerns 1–5 (and the LOW wording fixes at will), I would expect this document to be READY.

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
**Reviewer family:** Claude (Anthropic)
**Provider / runtime:** Claude Code CLI 2.1.207 headless (`claude -p`), model
`claude-fable-5` (invoked as `claude-fable-5[1m]`), effort `max`. Fresh
non-interactive session `a67e2361-d1f4-47e2-aed3-dff756f85ac7`; exploration
delegated to Claude-family subagents on `claude-opus-4-8`; every assistant
message in the reviewing session was authored by `claude-fable-5` (verified
against the session transcript).
**Date:** 2026-07-12
**Redacted:** Same as earlier rounds.
**Method:** Same as earlier rounds — shared round-7 brief, blind to the
concurrent paired review and to all archived reviews. The brief scoped
authorization invalidation OUT (LLP 0053 owns it, reviewed separately and
independently) while keeping the 0039/0053 **seam** in scope, and directed the
reviewer at the contracts written in rounds 5–6 that had never faced a reviewer.

### Review body (verbatim)

## Overall assessment

This is a strong document and, on the parts the split left behind, largely a settled one. The authority-resolution model, the one-gate invocation matrix, the provider state machines, the bearer-only transport decision, the connection-authority binding, and the diagnostics/route work are specified at a level a competent implementer could build from, and the document's claims about the shipped system are — with the exceptions below — verifiably accurate against the code. I checked roughly two dozen load-bearing code claims and most held exactly: `HandlerInput.auth` really is `#[serde(default)]` over a `Default`-deriving struct, so presence is erased (`src/manifest.rs:912-924`); the live ownership comparison really does compare `principal`/`user_id` and not `session_id` (`src/local.rs:1706-1718`, `:1780-1792`); `AdminRead` really is loopback-open for reads even when a token is configured (`src/admin.rs:558-559`) and the CORS layer really does echo any localhost origin (`src/server.rs:1582-1597`); `POST /app/ensure` really is `Public` and really does call `load_functions` (`src/server.rs:646`, `src/local.rs:1096-1110`); the Cloudflare coordinator really does hardcode an empty auth object (`cloudflare/src/coordinator.js:1228`); the status mapper really knows no `AUTH_*` code (`src/server.rs:2630-2648`); and `authRequirement` really is inert (`packages/snapback-codegen/index.mjs:1545`, read only by `admin-ui/admin-boundary.mjs:698`). The habit of naming residuals rather than assuming them away is the document's best quality and it is doing real work.

The split is also the right call, and §Permission dependencies draws a mostly clean seam: the four invariants 0039 says it depends on from 0053 are all things 0053 actually promises. But the seam has one load-bearing leak that breaks the split's central claim, and the contracts written in the last two rounds — the ones the prompt correctly flags as never having faced a reviewer — do not survive contact with the code. Two of them are wrong in ways that matter: the structural must-understand gate rests on a property the deployed Cloudflare validator does not have, and the revocation protocol's fencing rule contradicts its own pinned lock order because live deltas are produced inside the global write lane. A third, the existing-surface closure, leaves the ingress-rejection contract pinned against a guard that fails open when the fields it names are removed. None of these are fatal to the design; all of them are fixable with pins the document already knows how to write. But they are material, and this document should not move past Draft with them in it.

## Strengths

- **The existing-surface closure is the most important thing in the document, and it is correctly motivated.** "Sessions are decorative if a hostile local page can read the same rows without one" (§Existing surfaces under sessions) is exactly right, and both named surfaces check out against the code. `GET /_snapback/api/data/{table}` is `AdminRead` (`src/server.rs:684`), reads are open on a loopback *bind* with no per-request peer check anywhere in the server, and the CORS layer reflects any `localhost`/`127.0.0.1`/`[::1]` origin verbatim — so the "any local page can dump every private table" claim is precisely true. Making this a landing-order dependency of sessions rather than a follow-on is the single decision that keeps the slice honest.

- **The `(requested, active, desired)` privilege gate on `/app/ensure` is a genuinely subtle catch.** "Otherwise the activation itself is the hole: while active mode is still `dev`, today's Public ensure could stage sessions and persist attacker-chosen schema before the restart" (§Existing surfaces) is the kind of finding that only falls out of taking the state machine seriously. It is correct, and the fix is right.

- **The staged, never-hot-applied auth mode with `MODE_PENDING` is the correct shape**, and the wedge-avoidance work around it (§Auth mode transitions: stage-time collision pre-check, non-destructive `--clear-desired-auth-mode` unstage distinct from the destructive `--drop-orphaned-auth-tables`, consume-failure booting in the still-active mode) reflects a real institutional lesson (ENG-22659) rather than a generic safety gesture.

- **The connection-binding framing is honest where it would have been easy to overclaim.** "That token is a **delegated bearer** — possession acts under the bound authority; there is no second caller identity to compare on token-only operations. What the binding guarantees is narrower and real" (§Session transport and connection binding). This is exactly what the `ConnectionRegistry` can and cannot support (`src/server.rs:312-315`: it maps connection id to token and carries no identity), and the document says so instead of pretending otherwise.

- **The refresh-family takeover hole is named rather than buried** (§Built-in first provider), along with the observation that the tiered design protecting a sleeping tab is what a thief exploits, and that distinguishing them needs evidence a bearer does not carry. That is the correct conclusion, reached honestly.

- **`AUTH_CREDENTIAL_SUPERSEDED` as a code distinct from expiry** — "the session is healthy, another custody holder has the successor" — is a real insight about multi-tab custody that most session designs get wrong by collapsing into a destructive logout.

- **The document caught a genuine cross-document conflict** it did not have to: LLP 0051 §D1 does still say "`ctx.auth` is captured at first execution and re-supplied on replay, never re-read … the ledger's auth entry is the *resolved* auth context" (`0051:247-253`), which cannot coexist with 0039's "the server always re-resolves authority from credentials." Naming that as a companion amendment rather than silently diverging is the right move.

- **The keyed, domain-separated, length-prefixed code digest** with the explicit hashing-polarity note (plain SHA-256 is fine for a 256-bit bearer; a 6-digit code needs a pepper; neither may be logged) is correct cryptographic reasoning stated at the right level of detail, and the keyring contract (versioned JSON, atomic replace, rotation retains old keys for one TTL, missing/corrupt fails closed) is complete.

## Concerns

### 1. The authorization-stream incarnation is 0053's deliverable, but landing items 3, 4, and 5 depend on it — which breaks the split's central claim. **HIGH**

The document's whole argument for the split is that "items 1–5 and 7 — including the two-clients-different-results proof and the card-game demo — can land and be proven while 0053 is still under review" (§Status). That claim does not survive its own text.

The **authorization-stream incarnation** is defined and owned by LLP 0053 (§Epochs: "Every epoch is paired with a durable **authorization-stream incarnation**, regenerated on restart, reset, import, and declared physical restore… The subscribe/resume and client-store schemas carry the incarnation"), and it lands in 0039's item 6. But 0039 depends on it in at least four places that land earlier:

- §Protected identity core (item 3): the restore procedure's `--restored-from-backup` flag "regenerates the authorization-stream incarnation."
- §Acceptance, Mode and lifecycle (item 3): "physical restore invalidates restored sessions and **regenerates the incarnation**."
- §Auth mode (item 4): the offline cold-boot carve-out has the client render "from its stored `(incarnation, epoch)`."
- §Session transport (item 5): "`app.reset` uses the same fencing (**its incarnation regeneration is the reset generation**)" — and item 5 explicitly "owns the `app.reset` → `ConnectionRegistry` wiring."

Item 5 is stated as "requires 3–4," not 6. So either items 3–5 silently depend on item 6 — in which case the settled core cannot land while 0053 is in review, and the split's payoff evaporates — or the incarnation must move.

It should move. The incarnation is an *authority-stream* anchor, not a permission-classification mechanism: it is regenerated on restart, reset, import, and declared restore, none of which are things 0053 is about. 0039 already needs it for reset fencing and for the restore procedure it owns. *Resolves with:* move the durable authorization-stream incarnation into 0039 (landing with item 3 or 5, alongside the session projection it fences), have 0053 *consume* it for `(incarnation, epoch)` pairing, and re-verify that no item-1-through-5 or item-7 obligation references a 0053 deliverable. If instead the incarnation stays in 0053, add the dependency edges and withdraw the "settled core can land and be proven" claim.

### 2. The structural must-understand gate rests on a property the deployed Cloudflare validator does not have. **HIGH**

§Target scope pins gate 2: "A sessions bundle ships under a **bumped deployment-metadata/format version** that already-deployed validators reject — the coordinator's existing `validateDeploymentMetadata` fails closed with a 409 on metadata it cannot accept. This binds receivers that have never heard of `auth.mode`, which semantic enforcement cannot."

That is not what `validateDeploymentMetadata` does. At `cloudflare/src/coordinator.js:279-300` it compares the *stored* `_snapback_meta` values for `schema_hash` and `bundle_hash` against **this deployment's compiled-in hashes** (`:249-254`, `:62-63`). It is a stale-persisted-state guard, not a format or version guard. There is no `schemaVersion`, no `artifactKind`, and no metadata-format-version field anywhere in the coordinator. Worse for the argument: the loop iterates the **expected** keys, so unknown or extra metadata keys are **silently ignored** — the coordinator fails *open* on metadata it has never heard of, which is precisely the case gate 2 claims it fails closed on. (The 409 status is right — `:365`, `:393-394` — but it fires on a hash mismatch, not on an unrecognized version.)

The document anticipated this outcome conditionally ("If a deployed validator turns out not to reject unknown versions strictly, the residual must be named explicitly") but left it as a conditional. The condition is now met, and the residual is the catastrophic one the section itself describes: a sessions bundle reaching a session-unaware coordinator runs every request unscoped with empty auth.

There is a better argument available, and it happens to be true. On Cloudflare the app is *compiled into the Worker at deploy time* (`APP_SCHEMA_HASH = schema.schemaHash`) and `cloudflare/deploy.sh` ships `cloudflare/src/coordinator.js` from the same tree via `wrangler deploy` — so a bundle and its coordinator are one artifact and there is **no channel through the repo's deploy path by which a sessions bundle can reach an old coordinator**. Gate 2's threat model is therefore a third-party fork vendoring a stale coordinator, which is a nameable residual rather than a mechanism to invent.

*Resolves with:* delete gate 2's false premise; replace it with the structural fact above; keep gate 1 (`cf-check-compat`-shaped refusal) and gate 3 (receiver-side refusal before durable mutation); and name the forked-coordinator residual explicitly. Note that gate 3 is real work on the coordinator regardless — see concern 3.

### 3. Gate 3 ("refuses before any durable mutation") is correct about the hazard and understates the fix. **MEDIUM**

The document's claim that "today the coordinator's validation runs *after* those, so even a correct refusal would leave mutated state behind" is **verified and accurate**, and it is a good catch. Concretely, `ensureSchema()` runs in the Durable Object *constructor* (`coordinator.js:92`) and, before validation at `:224`, it: creates the system tables, writes a `_snapback_version` row (`INSERT OR IGNORE`, `:142`), runs `migrateSubscriptionsSchema()` which does a destructive `DROP TABLE _snapback_subscriptions` / recreate / copy / `RENAME` (`:167` → `:228-247`), and **creates this deployment's app tables into the foreign stored state** (`:219-223`) — all with **no enclosing transaction** (contrast `:1364`, `:1539`, which do wrap writes).

What the document does not say is that the acceptance row it writes — "a refused sessions bundle leaves the target byte-for-byte unchanged" — cannot be satisfied by adding a check; it requires restructuring the coordinator's constructor so that validation precedes all DDL and the whole of `ensureSchema` is either transactional or ordered validation-first. That is a non-trivial, separately-reviewable change to a live deployment, and it belongs in the landing order and the companion obligations rather than as an acceptance assertion. *Resolves with:* name the coordinator constructor reordering as an explicit deliverable with an owning landing item, and note that `migrateSubscriptionsSchema`'s DROP/RENAME is the specific operation that makes a post-hoc refusal non-recoverable.

### 4. The two-phase revocation's "fencing extends to the effect boundary and outbound deltas" contradicts its own pinned lock order, because live deltas are produced inside the global write lane. **HIGH**

§Session transport pins two rules that cannot both hold as written:

- "Lock order is pinned (projection lock is never taken while holding the write lane), so no future deadlock."
- "Every connection-scoped **act** and every **outbound sensitive delta** re-checks the session/reset fencing generation immediately before taking effect."

In the shipped code, outbound deltas are *produced and enqueued entirely inside the global write lock*. `with_snapback` takes an owned mutex guard and moves it into the blocking closure (`src/server.rs:53-65`); `invoke_mutation_recording_with_id` runs inside that closure (`src/server.rs:1955`) and its post-commit fan-out calls `notify_live_subscriptions_in_frame` (`src/local.rs:1423` → `:3284`), which re-executes each subscription's query (`:3368-3369`), serializes it, and calls `enqueue_durable` (`:3402`). So checking the fencing generation "immediately before the delta takes effect" at the point of production means taking the projection lock inside the write lane — exactly what the lock-order rule forbids.

The drain side is compatible with the lock order — `/outbox/{connection_id}` (`src/server.rs:2466-2476`) and the WebSocket sender (`:2246-2258`) both reach the per-connection outbox through `EphemeralApi` and never touch `SharedSnapback` — but the document never says the check happens there, and moving it there requires two pins it does not make: the enqueued payload must **carry the fencing generation** so the drain can compare it, and the session projection must be **reachable from `EphemeralApi`** (`src/ephemeral.rs:1731-1736`), which is a new cross-component wiring of exactly the kind the document explicitly owns for `app.reset` → `ConnectionRegistry` in item 5 — but does not own here. Separately, "revoked streams are notified and closed within a pinned bound" pins no bound.

*Resolves with:* state the effect boundary explicitly as the **drain**, not the enqueue; pin the fencing generation as a field on the enqueued outbox payload; name the session-projection → `EphemeralApi` wiring as an item-5 deliverable alongside the `app.reset` wiring; give the stream-close bound a number; and state honestly that a revoked session's rows are still *computed and serialized* under the lock — the guarantee is non-delivery, not non-computation.

### 5. Rejecting client-supplied auth on the live path removes the only thing the ownership guard compares, and the guard fails open when it is empty. **HIGH**

§Authority resolution pins that under sessions ingress "**rejects** every client-auth-bearing field — nested `HandlerInput.auth`, live resume/unsubscribe owner auth… 'Stamp and ignore' is not the contract; rejection is." It never pins what *replaces* the rejected fields as the ownership predicate — and the shipped guard is written against exactly those fields, with a short-circuit that fails open:

```rust
let owner = &subscription.input.auth;
if (owner.principal.is_some() || owner.user_id.is_some())
    && (owner.principal != input.auth.principal || owner.user_id != input.auth.user_id)
{ return Err(... "SNAPBACK_LIVE_RESUME_OWNERSHIP" ...) }
```
(`src/local.rs:1706-1718` for unsubscribe; `:1780-1792` for resume; the same tuple gates supersede-on-resubscribe at `:1604-1608`.)

Two failure modes follow. If the resolved authority is not written back into the stored owner fields, then under sessions every subscription's stored owner is empty, the `is_some()` guard never engages, and **the cross-owner protection on resume and unsubscribe disappears entirely** for any caller holding a connection grant and a subscription id. Even under the charitable implementation that does populate them server-side, the **anonymous** case still short-circuits — and anonymous grants are a first-class case under sessions (`/connection/open` is `optional-user`, and anonymous bound authorities are named in §Connection binding). This is a fail-open-by-construction trap that the document's own instruction creates.

*Resolves with:* pin that under sessions a subscription records its **server-resolved authority and its connection grant** at subscribe time, and that resume/unsubscribe compare the caller's bound authority against both — with the anonymous case compared on the **connection grant**, never on "no user"; add an acceptance negative that connection B cannot resume or unsubscribe connection A's subscription, in both the anonymous and authenticated cases.

### 6. Under this slice the admin token becomes a universal impersonation credential, and the stated justification is incomplete against the shipped console. **HIGH**

Two new capabilities are gated by the admin token: the capture mailbox (`GET /_snapback/api/auth/mailbox`, `AdminSecretRead`), which exposes the login code for *any* address, and host-ops `auth.mintSession` (`AdminWrite`), which mints a session for *any* email. Either one converts "holds the admin token" into "is any user." The document's justification is: "the gate works because the admin token is a 0600 file a browser page cannot read" (§Built-in first provider), which matches LLP 0017 §Security Defaults.

That is true of the file and false of the shipped system. The admin console persists the token in **localStorage** under `snapback_admin_token` (`packages/snapback-admin-client/index.mjs:13`, `:112-118`) and calls the admin API at `${location.origin}/_snapback/api` (`admin-ui/main.ts:22-27`) — i.e. the token is a browser-readable credential on the server's own origin. In the "admin-onboarded same-origin deployments" that §Summary names as a supported topology for this slice, the app page and `/_snapback/admin` share an origin, so an app-page XSS reads the admin token and mints a session as any user. That is a strictly worse consequence than the bearer exfiltration the document names as the unowned XSS residual, and it is a consequence this slice *introduces*.

*Resolves with:* keep session-minting capabilities off any browser-reachable credential — restrict the mailbox and `auth.mintSession` to the CLI/host-ops path (or a per-boot secret printed to the terminal), or introduce a second capability class that a browser-held admin token cannot satisfy — and, either way, state the escalation explicitly where the XSS residual is named rather than leaving it implied by "a browser page cannot read files."

### 7. "Persisted across the restart" carries a dev-mode-installed bundle across the mode boundary into the session trust domain. **HIGH**

§Existing surfaces offers two ways to supply a session-enabled app's executable bundle: "**pre-bind startup provisioning** (a startup-time bundle path/manifest) **or persisted across the restart**." The second option is unsafe and the document does not say so.

While `active == dev` and `desired == dev` — the state every app passes through before staging, and the state `--allow-auth-downgrade` returns it to — `/app/ensure` remains `Public` and, per the document's own threat model, reachable by a hostile local page through the localhost CORS echo. `ensure_app` calls `load_functions` whenever `provisioning_allowed` (`src/local.rs:1096-1110`), and `provisioning_allowed = !Prod` (`src/admin.rs:94-96`), with the loopback default profile being `Dev`. So an attacker-installed bundle can be the last bundle loaded before staging. The `AdminWrite` gate on the *staging* payload authorizes the staging request; it does not attest the bundle that is already loaded or persisted. If the implementation chooses persistence, the session-enabled app boots running attacker-chosen handler code with server-resolved `ctx.auth` and full `ctx.db` access — which defeats the entire slice.

*Resolves with:* require that consuming a `dev → sessions` transition establish bundle provenance: the staged transition pins the expected bundle hash and the pre-bind consume verifies it (refusing otherwise), or the consume discards every non-startup-provisioned bundle. In practice, delete the "or persisted across the restart" alternative unless it is paired with an attestation. Add an acceptance row: a bundle installed through Public `/app/ensure` while in dev mode is not executable after a sessions transition.

### 8. The ephemeral closure names `auth` but not the fields that actually derive the key. **MEDIUM**

§Ephemeral rooms rejects `KeyMode::Custom` under sessions on the grounds that "an `AllowAll` collection with custom keys lets any caller overwrite or delete another caller's key," and permits `Connection`, `Session`, and `User`. That asymmetry is only sound if `session_id` and `user_id` are server-derived — and today they are **client-supplied top-level request fields sitting beside `auth`, not inside it**: `PublishRequest { collection, scope, connection_id, session_id, user_id, custom_key, value, ttl_ms, auth }` (`src/ephemeral.rs:321-332`; `DeleteRequest` at `:335-343`), with key derivation reading them directly (`:2285-2361`). A closure specified as "reject client-auth-bearing fields" does not reach them, and under an `AllowAll` collection with `KeyMode::User` any connection could then publish or delete with `user_id: "victim"`.

§Acceptance already asks for "cross-user overwrite/delete negatives on the permitted key modes," so the intent is right; the design text is what is missing. *Resolves with:* name the exact field set (`session_id`, `user_id`, `custom_key` on `PublishRequest`/`DeleteRequest`/`SubscribeRequest`) and pin that under sessions they are **derived from the connection's bound authority** and rejected if present on the wire — not merely that `auth` is rejected.

### 9. `authorityInstanceId` "per-boot in dev mode" strands every dev client's queued mutations on every server restart. **MEDIUM**

§Replay parity pins the authority-instance axis as "minted per session, stable across refresh; **per-boot in dev mode**," and pins that this axis governs the queue: "a new session strands the old session's queue as non-executable-but-visible for discard-or-re-record." In dev mode there are no sessions, so a per-boot value changes on every `cargo run` — with no authority change at all — and strands the client's queue every time. That regresses the shipped LLP 0043 M2 behavior (`packages/snapback-contract/client-store.mjs`, whose pending queue and retained rows are already auth-fingerprint-scoped) in exactly the scenario offline replay exists for: the server restarted while the client was away. Dev servers restart constantly.

*Resolves with:* make the dev-mode authority instance stable across restarts (persist it, or derive it from `(appId, devUserId)`), or exempt dev mode from the queue-scope axis entirely; and add an acceptance row that a dev-mode server restart does not strand a queued mutation.

### 10. The refresh-takeover mitigation turns a transient custody failure into a global logout, and its trigger is undefined. **MEDIUM**

§Built-in first provider pins: "an ordinary-request supersession that the client cannot reconcile against custody **revokes the family server-side before local clearing**." The whole point of `AUTH_CREDENTIAL_SUPERSEDED` was that it is "**not** an authority loss" so a woken tab recovers a healthy session — and this mitigation re-arms destruction on a predicate a browser cannot evaluate reliably. "No successor exists in custody" and "custody is temporarily unreadable" are different facts (Web Locks contention, BroadcastChannel failure, storage partitioning, private browsing, a slow reload past the bounded wait), and the document collapses them into "cannot reconcile." Under the collapse, a transient storage failure signs the user out of every tab and device. §Acceptance tests two woken-tab paths but not custody-unavailable.

*Resolves with:* define "cannot reconcile" as *authoritatively absent after a bounded reload*, make custody-unavailable fall back to local re-authentication rather than family revocation, and add the custody-unavailable interleaving to the generated-trace acceptance.

### 11. The fencing identity is under-specified for two concurrent revocations of one session — the case it was introduced to fix. **MEDIUM**

§Session transport pins: "Each marker records the **fencing generation** of the operation that set it, and un-marking is **compare-and-unmark** — only the operation that owns the marker may clear it." A generation does not identify an operation. Two concurrent revocation-class writes against the same session (a logout racing an admin revoke, say) read the same current generation and would compute the same target, so "the operation that owns the marker" is not distinguishable by the only identity named. If B rolls back and clears a marker that A — still pending — owns, the exact interleaving the fencing rule exists to prevent is reopened, and operations validate against a session that is about to be revoked. The "no stronger marker has superseded it" clause only helps once A has already finalized.

*Resolves with:* pin the marker identity as a unique per-operation token allocated under the projection lock (with the generation retained as the *ordering* key, not the identity), and add two-concurrent-revocations-of-one-session to the generated-interleaving acceptance.

### 12. Per-source throttling collapses into the global bucket under the document's own loopback fence, so `AUTH_THROTTLED` and `SNAPBACK_OVERLOADED` carry the same information for connection opens. **MEDIUM**

§Built-in first provider states the problem honestly for codes — "in every supported topology all requests arrive from 127.0.0.1, so a per-source key degenerates to a global bucket" — and then §Grant bounds relies on per-source keying anyway ("per-source and global open caps"), minting a code specifically for it ("`SNAPBACK_AUTH_THROTTLED` for per-source rate limiting, `SNAPBACK_OVERLOADED` for global capacity exhaustion"). Under the v1 fence those are the same bucket. The server also has no per-request peer address today — there is no `ConnectInfo`/`peer_addr` anywhere in `src/`, and `ctx.loopback` is derived once from the *bind* (`src/cli.rs:482`) — so per-source keying is not merely degenerate, it is unimplemented. The consequence the document does not draw: with only a global cap, a hostile local page can exhaust the grant registry and deny service to the legitimate app.

*Resolves with:* drop the per-source axis for v1 (global cap plus `OVERLOADED` only), or state that per-source keying is inert under the fence and exists for the future trusted-proxy contract — and name the local-DoS residual for grants exactly as it does for codes.

### 13. The loopback fence is bypassed by the LAN workflow the document names as the escape hatch. **MEDIUM**

The dev/sessions matrix justifies the new fence with: "LAN/phone development keeps working through [LLP 0030](./0030-managed-snapback-vite-dev.rfc.md)'s proxy (Vite binds the LAN; Snapback stays loopback)." Because Snapback's loopback determination is bind-derived and not peer-derived, **every request arriving through that proxy is a loopback request** — so the sanctioned LAN path serves dev-mode client-asserted auth (and, absent the reserved-prefix refusal, the tokenless `AdminRead` surface) to the LAN exactly as before. LLP 0030 says so itself: its default is *both* hosts on `127.0.0.1`, a non-loopback Vite bind is an explicit opt-in, and it warns that "exposing Vite beyond loopback can still expose the read surface and the token-gated lane to the network" (`0030:599-610`, `:515-518`). §Summary names the reverse-proxy limit but frames it as *hosted* exposure, not as the dev workflow it just blessed — and this repo actively ships that workflow (`ENG-23988`, iPhone dev startup).

*Resolves with:* pair the fence with an LLP 0030 obligation — a non-loopback Vite bind fronting a dev-mode Snapback must refuse app-data forwarding (or refuse to start) — or drop the claim that the fence protects dev-mode auth and state precisely what it does buy (it stops a direct `--host 0.0.0.0` Snapback bind, and nothing else).

### 14. The 0012 registration list is mis-scoped, and three of its items belong to 0053. **MEDIUM**

§Observability says "LLP 0012 registrations, **limited to the families 0012 governs**" and then lists items 0012 does not govern. LLP 0012 owns `runtimeState`, `capabilityManifest`, and the diagnostic-code families (`0012:96-104`, `:185-186`); **wire serde types and generated-schema registration are LLP 0051 D4's**. Yet the list includes the typed live auth-error frame, the mode-dependent ephemeral DTOs, the `authorityDescriptor` field, and the incarnation-bearing subscribe/resume/store schemas — all wire-schema registrations. Separately, three entries (the incarnation schemas, the `PermissionScopeExpr::User`/`PermissionSubjectExpr` vocabulary, and `permissionDependencies`) are claimed by **0053** as well (0053 §Authoring vocabulary, §Epochs), directly contradicting 0039's own companion-obligations line that "0053 registers its own manifest and wire vocabulary." `SNAPBACK_PERMISSION_DEPENDENCY_UNCLASSIFIED` is likewise listed among 0039's startup codes but is 0053's.

This matters because the registration list *is* the companion-obligation list — it determines which document gets amended. *Resolves with:* re-partition it by owning registry (0012 for diagnostics and capability/runtime-state facts; 0051 D4 for wire schemas) and by owning document (0039 vs 0053).

### 15. Retained/offline reads under sessions: the v1 product consequence is unstated, and the handshake's offline carve-out describes a state that cannot exist in v1. **MEDIUM**

Retained reads are disabled under session mode until item 8, which is 0053's and gated on an unreviewed document. The consequence — **adopting auth removes the offline capability the project just shipped** (LLP 0043 M1/M2, `ENG-23965`) — appears nowhere in §Summary's "Scope honesty" paragraph, which is otherwise scrupulous about naming what the slice does and does not deliver. It should.

The incoherence is sharper in §Auth mode's bootstrap-handshake carve-out: "an offline client renders from its stored `(incarnation, epoch)` and last-known mode with staleness marked (LLP 0043's shipped retained-stale-boot behavior, which a mandatory live handshake would break)." Neither v1 state matches that sentence — a session app has no retained reads to render, and a dev app has no incarnation (it is 0053's, unlanded). The rule is written for the post-item-8 world and presented as a v1 constraint. *Resolves with:* say plainly in §Summary and §Non-goals that a session-enabled app has no offline retained reads until item 8, and either restate the carve-out for the states that actually exist in v1 or explicitly defer it to item 8.

### 16. The direct admin function runner is a third instance of the "sessions are decorative" class, and §Existing surfaces says there are two. **MEDIUM**

`admin_run_function` authorizes a *query* as a read — `let write = matches!(snapback.function_kind(&name), Some(FunctionKind::Mutation | FunctionKind::Action)); authorize(&ctx, &headers, write)?` (`src/admin.rs:870-876`) — and reads are loopback-open even when a token is configured (`src/admin.rs:558-559`). With the localhost CORS echo, any local page can `POST /_snapback/api/functions/{someQuery}/run` with an arbitrary body `HandlerInput.auth` and read any user's rows. This is *worse* than `/_snapback/api/data/{table}`, because it runs auth-filtered queries under a forged identity.

The document knows this — §Authority resolution describes it accurately ("which today executes queries tokenless on loopback with a body `HandlerInput`") and §Acceptance covers it. But §Existing surfaces asserts "**Two** shipped surfaces do exactly that today," and landing item 2 ("Existing-surface closure") names only the other two — so an implementer can mark item 2 complete with this hole open. *Resolves with:* name the direct runner in §Existing surfaces as the third surface, and either fold its closure into item 2 or state explicitly in the landing order that item 4 owns it and that sessions cannot be enabled before item 4 lands.

### 17. Diagnostics-table and route-matrix completeness. **LOW**

Four small gaps, grouped because each is a one-line fix:

- `SNAPBACK_AUTH_MODE_DEV` is used in the route table ("On dev-mode apps the `/auth/*` routes return a typed refusal") but appears in neither the HTTP diagnostics table nor the startup/load-time list — an unregistered code in a document that claims to register the whole `SNAPBACK_AUTH_*` family.
- `SNAPBACK_AUTH_MODE_PENDING` is filed under startup/load-time but is also a **request-path** refusal, and no HTTP status is pinned for it (503 is presumably intended).
- The route × mode matrix is specified over two modes (dev, sessions), but `MODE_PENDING` is a third behavioral state with its own exempt set (health, identity, `/auth/session`), which the session-mode registry overlay must key on. The exempt set is never enumerated.
- `SNAPBACK_AUTH_STALE_RESULT` already ships and is emitted today (`src/runtime.rs:401-411`, `src/storage.rs:302-309`, `:2817-2825`), and with no `AUTH_*` codes in the mapper it currently returns **400** (`src/server.rs:2647`); the document's table pins it at **409**. The 0012 compatibility analysis reasons carefully about the code's *meaning* and never mentions its *status* changing. Consumers appear to key on the code string, not the status (`packages/snapback-contract/index.mjs:561-565`), so this is likely safe — but it should be stated and registered rather than discovered.

## Suggestions

- **Move the session-token key outside the backup unit and the restore residual closes itself.** §Protected identity core argues correctly that no *in-directory* anchor can distinguish a restore from a restart, because the backup unit is the whole instance directory (SQLite *and* keyring) and a restored pair is internally consistent. The escape it names — "a monotonic anchor outside the backup unit" — is available cheaply: derive session-token validation from a key held in a **host-scoped** location (e.g. under the user's config directory), not beside the database. A restore onto a different host then invalidates every restored session automatically, which is the common disaster-recovery case; a same-host restore is detected by a monotonic counter in that host-scoped file, which the restore cannot roll back. The cost is that an instance directory is no longer self-contained across hosts — which is arguably the correct semantics, and it also softens LLP 0036's "instance backups carry live keys" posture. This turns the named residual from "an undeclared restore leaves resurrected sessions live until expiry" into a real mechanism.

- **Verify the code inside the write transaction; the constraint being inherited is about Argon2, not HMAC.** §Built-in first provider cites 0011 for "Verification runs **outside the single-writer lock**," but 0011 pins that of **password hashing (Argon2)** specifically — "hash first, then take the lock only for the brief user/session write, because the single-writer model serializes everything held under that lock" (`0011:86-88`). A keyed HMAC over a 6-digit code is microseconds, not 100ms, against a write lane whose measured ceiling is ~1,050–1,280 mutations/s. And the outside-the-lock choice buys nothing in this design anyway, because **attempt accounting is a durable write on every attempt** — a wrong code must take the lock to increment `attempts` regardless. So the compare-and-consume race the section then spends a paragraph closing is self-inflicted. Keep the outside-the-lock *shape* documented for a future password provider, but for v1 verify-and-consume in one transaction: it is simpler and strictly safer. (The document should also stop attributing "verification" to 0011; the phrase "0011's two easy-to-violate constraints" is the author's, not 0011's.)

- **Make the invocation gate a type, not a test.** The slice's central safety property is "every entry path resolves authority before the handler runs," and it is currently guaranteed by a registry-metadata-driven acceptance sweep. Rust can make it a compile-time fact instead: give `ResolvedAuthority` a private constructor reachable only from the resolver, and make `invoke(...)` require one. A new entry path then *cannot* invoke a handler without resolving authority — a stronger guarantee than any sweep, and it matches an idiom this corpus already uses (LLP 0031 D3's typed public-inspect projection, "so that adding a sensitive field to the struct is a compile error at the projection rather than a silent leak"). Keep the sweep for the wire-rejection half, where a type cannot help.

- **Ship a session list and "sign out everywhere."** The refresh-takeover hole is, correctly, not closeable in v1 without sender-constrained tokens. But it can be made *recoverable* for almost no cost: `_auth_sessions` already carries `created_at`, `last_used_at`, `expires_at`, and `identity_id`, so a user-facing session list plus a global revoke is a query and a mutation. An undetectable takeover that the user can nuke is a far better v1 posture than an undetectable takeover with no user-reachable remedy — and it is a direct expression of the "auth data next to your data" claim the slice exists to prove.

- **Land item 5's `AuthCoordinator` with the disposition enum already in its interface.** 0053 owns what `retain < quarantine < delete` *means*, but 0039 owns the coordinator that executes it and lands it two items earlier. If the clear barrier takes a disposition from day one (defaulting to `delete` for every authority loss), item 6 becomes purely additive instead of reopening the client barrier. Say so in the landing order.

## Open questions

- Where should the authorization-stream incarnation live? (Concern 1.) I think the answer is 0039, and that this is the single most consequential structural question left after the split — it determines whether the "settled core lands independently" claim is true.
- If gate 2 is dropped (concern 2), what is the actual must-understand mechanism for the *next* must-understand field? The version-bump trick works once, and only because `validate_artifact_header` does exact-equality on `schemaVersion` (`src/manifest.rs:1482-1498`). Bumping it globally is a flag day for every artifact; bumping it only for sessions bundles overloads a format-generation field as a capability flag and forces new receivers to accept a *set* of versions, which is no longer "structural." Is there a general answer, or is each must-understand field its own negotiation?
- What is the client-page XSS posture, given that this slice makes the admin token a session-minting credential (concern 6)? The document already names XSS as unowned; the question is now sharper than "who owns it" — it is "does this slice's own design raise the cost of not owning it past what we're willing to pay?"
- Can the two-clients-different-results proof — the slice's sharpest claim — be landed earlier, against host-ops impersonation, before the client coordinator and connection binding land? If so, the sync half de-risks independently of the session half, which would make the landing order more robust to a surprise in items 4–5.
- What does the card-game demo actually prove at item 7? (Concern: membership revocation is 0053's, so a removed player keeps receiving the game until item 6 lands. The hidden-state mechanic is provable; the revocation mechanic is not.) This should be stated in the acceptance and in the diary, not discovered when the demo ships.
- The document's own list is good and I would keep all of it, particularly the `authorizedUntil` question and the DPoP/sender-binding trajectory — the latter is the honest answer to both the refresh-takeover hole and the XSS posture, and it is worth deciding whether it is a v2 or a "we will never do this."

## Readiness verdict

Verdict: NOT READY

Six material concerns remain unresolved in the current text. Two are factual errors about shipped code that load-bearing arguments rest on: the structural must-understand gate claims a rejection behavior the Cloudflare coordinator does not have (`validateDeploymentMetadata` compares content hashes and silently ignores unknown metadata keys), and the revocation protocol's "fencing extends to the outbound delta" rule cannot be implemented at the production boundary without violating the document's own pinned lock order, because live deltas are produced inside the global write mutex. Two are fail-open traps the document's own instructions create: rejecting client-supplied auth on the live path removes the only fields the shipped resume/unsubscribe ownership guard compares, and "persisted across the restart" carries a bundle installed through the still-Public `/app/ensure` across the mode boundary into the session trust domain. One is a privilege escalation the slice introduces and mis-justifies: the mailbox and `auth.mintSession` make the admin token a universal impersonation credential, while the shipped console keeps that token in browser-readable localStorage on the server's origin. And one breaks the split's central promise: the authorization-stream incarnation is 0053's deliverable but items 3, 4, and 5 depend on it, so the settled core cannot in fact land and be proven while 0053 is in review. Every one of these is fixable with pins this document already knows how to write — several are a paragraph each — and the rest of the slice is in good enough shape that a single focused revision should be able to close them and reach READY. The document's own §Status anticipated exactly this ("A further pass over this document after the split is warranted before it moves past Draft"); it was right.

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
**Reviewer family:** Claude (Anthropic)
**Provider / runtime:** Claude Code CLI 2.1.207 headless, `claude-fable-5`
(`claude-fable-5[1m]`), effort `max`. Fresh session
`5dad8e46-087a-421d-b3e9-cba8bb7e0acc`.
**Date:** 2026-07-12
**Redacted:** Same as earlier rounds.
**Method:** Same round-8 brief as the paired reviewer; blind to it and to all
archived reviews. Authorization invalidation scoped out (LLP 0053's, reviewed
separately); the 0039/0053 seam in scope.

### Review body (verbatim)

All four verification agents have completed and I've cross-checked the referenced LLPs. I now have everything needed to write the review.

## Overall assessment

This is a strong document — much stronger than most auth designs I have reviewed at this stage — and the split that produced it was the right structural move. The slice selection is correct: server-resolved authority at one shared gate, bearer-only transport, one passwordless provider with local capture, protected `_auth_*` tables outside the app-data machinery, connection binding with a memory-only lease, and a single client coordinator owning every authority transition. That is a defensible minimal path through LLP 0011, and the document's discipline about what it does *not* claim (offline cost stated in §Summary, unowned contracts named, residuals stated rather than engineered away) is exemplary.

I verified the document's claims about the shipped system against the code, and they hold to an unusual degree: the `#[serde(default)]` presence erasure on `HandlerInput.auth` (`src/manifest.rs:919-924`), the live-ownership guard's empty-owner short-circuit (`src/local.rs:1706-1718`, `1780-1792`), the direct runner's tokenless-query-on-loopback behavior (`src/admin.rs:872-876` plus the `loopback || token_ok` read branch at `src/admin.rs:558-559`), the CORS localhost echo (`src/server.rs:1582-1597`), the Public `/app/ensure` loading executable bundles whenever the profile is not Prod (`src/local.rs:1099-1100`, `src/admin.rs:94-96`), the `ConnectionRegistry` surviving `app.reset` (`src/local.rs:991-1007` never touches it), delta production inside the global write lock (`src/local.rs:3368-3402` under `with_snapback`), the drain path bypassing that lock (`src/server.rs:2461-2475`), the status mapper's `AUTH_*` fall-through to 400 (`src/server.rs:2630-2649`), `authRequirement` as a hardcoded literal with no runtime consumer (`packages/snapback-codegen/index.mjs:1545`), the Cloudflare empty-auth hardcode (`cloudflare/src/coordinator.js:1228`), `validateDeploymentMetadata` iterating only expected keys and failing open (`coordinator.js:279-300`), the one-artifact deploy channel (`cloudflare/deploy.sh:114-116` + `wrangler.jsonc`), the `KeyMode::Custom` overwrite/delete hole (`src/ephemeral.rs:2305-2363`), `_auth_users` passing both reservation checks today (`src/storage.rs:2737-2746`, codegen `index.mjs:290`), and the admin console's `localStorage` token on the server's own origin (`packages/snapback-admin-client/index.mjs:13-25`, `admin-ui/main.ts:22-27`). A specification whose baseline is this accurate materially de-risks implementation.

The remaining problems are concentrated where the document itself predicts: contracts written in the last two rounds that have never faced a reviewer. The worst is an internal contradiction in the impersonation-capability story — the route table says the mailbox is admin-token-gated while the surrounding prose and acceptance say the admin token must *not* suffice — which is exactly the escalation the round-7 fix was written to close. Second, the round-7 seam text was written against the four-class model that LLP 0053's same-day revision abandoned, so several of 0039's vocabulary-level dependencies (`permissionDependencies`, `SNAPBACK_PERMISSION_DEPENDENCY_UNCLASSIFIED`, the scope-expression registrations) now name things 0053 no longer promises, even though the outcome-level invariants still hold. Third, the must-understand enforcement is airtight for Cloudflare and silent about the one target this slice actually binds: a stale local binary ignores `auth.mode` (no `deny_unknown_fields` anywhere in `src/`) and would run a sessions bundle under client-asserted dev auth. These are all fixable in one focused pass, which §Status already calls for.

## Strengths

- **Verified baseline.** Every load-bearing "code fact" I checked is true (see above). The document's practice of distinguishing "a code fact, not an LLP 0031 statement" (§Authority resolution) is exactly right, and the corrected round-7 claims (the Cloudflare validator failing open; the loopback fence being new work — confirmed: `bind_listener` at `src/cli.rs:723-757` binds any host, and `resolve_profile` at `src/admin.rs:111-121` accepts `demo` on non-loopback binds) fix real errors honestly.
- **§Existing surfaces under sessions.** Naming the three bypasses that would make sessions decorative — and making their closure a landing prerequisite rather than a follow-on — is the single most important product decision in the document. The `(requested, active, desired)` evaluation of the `/app/ensure` privilege gate closes a genuinely subtle activation-order hole, and the cold-start bundle-hash pin closes a non-obvious laundering attack (an attacker-resident bundle surviving into the session trust domain) that most designs would miss.
- **The admin-token escalation analysis (§Built-in first provider).** The observation that the mailbox and `auth.mintSession` convert *holds the admin token* into *is any user*, combined with the verified fact that the shipped console keeps that token in browser-readable `localStorage` on the server's own origin, is a first-class catch. The remedy is inconsistently propagated (Concern 1), but the analysis itself is correct and important.
- **§Session transport's two-phase revocation.** The design respects the shipped lock discipline (LLP 0031's small-lock rule; the L9 bounds), states its guarantee honestly ("non-delivery, not non-computation"), handles rollback with fencing identities and per-operation marker tokens, and pins restart rebuild as under-extending only. The "no operation *validates* after the marker publishes" framing is the right, provable claim.
- **The exchange correction (§Built-in first provider).** Reading LLP 0011's outside-the-lock pin as being about Argon2 (~100 ms) rather than a microsecond HMAC — confirmed against 0011 ("Password hashing (Argon2) must run outside the DB lock") — and collapsing verify-and-consume into one transaction eliminates a self-inflicted race while keeping the outside-the-lock shape documented for the password provider that will need it.
- **The seam (§Permission dependencies).** Relocating the authorization-stream incarnation into this document was the right call and is argued for the right reason: without it, items 3–5 secretly depended on item 6 and the split's premise was false. The four dependency bullets are (at the outcome level) exactly what 0053's current revision promises, and the "0053 must reach Accepted before item 6 starts" gate plus the activation gate ("items 1–4 alone would be strictly worse than dev mode, because it *looks* authenticated") show real sequencing judgment.
- **Honesty devices throughout.** The offline-reads cost stated in §Summary rather than discovered; the unreconciled-supersession hole named with partial mitigations instead of hand-waved; the operator-declared restore with its residual ("an undeclared restore leaves resurrected sessions live"); the throttle honesty ("a per-source key degenerates to a global bucket"); the demo-proof honesty ("its *revocation* mechanic is not [provable at item 7]"). This is what makes the document reviewable at all.
- **Diagnostics discipline (§Diagnostics and route registry).** Adopting the shipped `AUTH_STALE_RESULT` and `AUTH_USER_MISSING` codes rather than re-minting them correctly treats emitted-code changes as LLP 0012 compatibility events, and naming the enforcement plumbing (the status mapper knows no `AUTH_*` codes today — verified) prevents the classic gap where codes exist but surface as 400s.

## Concerns

1. **HIGH — The impersonation-capability contract contradicts itself, and the contradiction sits exactly on the escalation the document calls its "worst security error."** §Built-in first provider first pins "Mailbox reads are gated by the token-required `AdminSecretRead` policy," and the route table (line ~1067) pins `GET /_snapback/api/auth/mailbox | AdminSecretRead | admin token even on loopback`. Three paragraphs later, the round-7 fix pins the opposite: "session-minting effects are not reachable by any browser-held credential… Acceptance proves that a caller holding **only** the console's admin token… can neither read the mailbox nor mint a session." For the mailbox, the route *is* the effect — the response body contains the codes — so "the route policy gates the route; the impersonation capability gates the effect" cannot reconcile the two statements the way it can for `auth.mintSession`. An implementer following the route table builds precisely the app-XSS→admin-token→any-user escalation the fix was written to close (premise verified: the console token lives in `localStorage` on the server origin and is sent as `x-snapback-admin-token`). Compounding this, the impersonation capability itself is undecided — "the 0600 keyring read directly… or a per-boot secret printed to the terminal" is two alternatives, not a contract — with no named credential, transport, lifecycle, or rotation story, and the admin-token-only negative appears in §provider prose but not in §Acceptance. *Failure scenario:* the mailbox ships per the route table; an app-origin XSS reads `snapback_admin_token` from `localStorage`, GETs the mailbox, reads any address's login code, and exchanges it — full account takeover of any user, in the admin-onboarded same-origin topology §Summary blesses. *Resolves with:* a distinct policy row for the mailbox (and any code-bearing read) that names the impersonation capability as its credential; a pinned decision on what that capability concretely is, how the CLI presents it, and how it rotates; the §Delivery sentence and route table brought into agreement with the round-7 pin; and the admin-token-only negative moved into §Acceptance.

2. **MEDIUM — The must-understand enforcement has no leg on the local target, which is the target this slice binds.** All three enforcement points are argued for Cloudflare: sender-side deploy tooling, the one-artifact deploy channel (which the document itself warns "is specific to a target whose app and receiver ship together"), and knowing-receiver refusal. The local Rust server is exactly a target whose app and receiver do *not* ship together — a stale installed binary plus newer codegen is an ordinary skew — and I verified there is no `deny_unknown_fields` anywhere in `src/`, so a pre-auth binary silently drops `auth.mode` from the schema manifest and loads a sessions bundle as a dev-mode app. `/app/ensure` on that binary is Public and loads executable bundles (`src/local.rs:1099-1100`), and no fence exists (`src/cli.rs:723-757`). The acceptance row "the target itself refuses it at manifest load" can only ever hold for session-aware binaries. *Failure scenario:* a developer upgrades the app toolchain but not the `snapback` binary; the sessions app boots, the kit's `ensureApp` provisions it, everything appears to work — and every function runs under client-asserted dev auth, so any local page (or any LAN peer, on an old binary with a non-loopback bind) impersonates any user of an app whose author believes sessions are enforced. *Resolves with:* pinning the bootstrap handshake as the local structural backstop — a sessions-generated client kit must fail closed (refuse to provision or issue any app-data request) when `GET /auth/session` is absent (404) or the capability manifest lacks session support — and adding that skew case to §Acceptance alongside the de-facto minimum-binary-version requirement it implies (the binary already carries a git-commit/dirty stamp on `/health`, per LLP 0031).

3. **MEDIUM — Several concrete 0053 seam dependencies name the abandoned four-class model, not 0053's current surface.** The seam text and the round-7 changelog were written against the four-class classifier; LLP 0053's same-day revision *abandoned classification as the primitive* and replaced it with two orthogonal declarations plus an enumerated event universe. The outcome-level invariants in §Permission dependencies still hold under the new design (I checked each against 0053's current text — "ordinary writes do not resync," "permission-affecting writes fail closed," disposition not boolean, retained-disabled-until-item-8 all survive). But the vocabulary-level dependencies do not: §Diagnostics registers `permissionDependencies` and `PermissionScopeExpr::User`/`PermissionSubjectExpr`; the diagnostics list pins `SNAPBACK_PERMISSION_DEPENDENCY_UNCLASSIFIED` as a startup code; §Permission dependencies still says "the authoring vocabulary… is 0053's deliverable." Under 0053-current, `permissionBacking`/`permissionFields` is the authorization-dependence declaration, `authScopeField` (userId-only) is the result-dependence one, and the conservative-matcher reframe means there may be no "unclassified" *load* failure at all — an opaque function is simply online-only, not a manifest-load error. This is a cross-document consistency issue, which the prompt defers, *except* where 0039 depends on something 0053 no longer promises — and `SNAPBACK_PERMISSION_DEPENDENCY_UNCLASSIFIED` as a load-time contract, plus the "0053 owns `permissionDependencies`" registration, are that. *Failure scenario:* item 7's route/diagnostics registration lands a code and a manifest-vocabulary registration that 0053 never produces, or that mean something different, and the "0053 registers its own manifest and wire vocabulary" hand-off (line ~1088, ~1152) double-registers or conflicts. *Resolves with:* re-pinning the §Permission dependencies vocabulary bullet and the §Diagnostics registration list against 0053's current two-declaration surface (name `permissionBacking`/`permissionFields`/`authScopeField`, drop or re-scope `SNAPBACK_PERMISSION_DEPENDENCY_UNCLASSIFIED` to match 0053's online-only fallback), and stating explicitly which of these 0039 registers versus which 0053 registers.

4. **MEDIUM — The refresh-family takeover hole is disclosed honestly but leaves a v1 decision unmade, and one of its two mitigations rests on an unowned posture.** §Built-in first provider and §Authority transitions name the hole (a thief rotates first, the victim's prescribed no-refresh recovery means reuse detection never fires) and offer two partial mitigations: revoke-the-family-server-side on an unreconcilable ordinary-request supersession, and a fencing token on the bounded-lease custody fallback. The first is sound and I'd keep it. But the document leaves the residual as "an open question, not a claim" while still shipping the tiered grace-window design that *creates* the exploit — and the honest closing move (sender-binding the bearer to a non-extractable WebCrypto key, DPoP-shaped) is explicitly parked on the "unowned client-XSS posture." So v1 ships a known family-takeover vector whose only real fix is unowned. That may be an acceptable v1 risk, but the document does not actually *decide* that — it describes the hole and moves on. *Failure scenario:* the slice ships; a bearer is exfiltrated via app-origin XSS (the residual §Summary already accepts); the thief rotates once and the legitimate user is silently logged out while the thief's family stays healthy and undetected. *Resolves with:* an explicit v1 risk-acceptance line ("family takeover via a stolen bearer is accepted in v1 at the 7-day cadence; the fix is sender-binding, gated on the client-XSS owner") in §Non-goals or §Summary, so the decision is recorded rather than left implicit — and a note on whether the server-side family-revoke is itself a griefing lever (an attacker who observes a superseded token can force a family revoke).

5. **LOW — The response-sensitivity audit is correctly identified as a prerequisite but is scoped as prose, not as a closed checklist.** §Existing surfaces makes "a response-sensitivity audit is a prerequisite of sessions becoming enableable" and adds a route-registry response-sensitivity axis — both right. I confirmed the leak surfaces are real and broader than the raw-table door: `recentDiagnostics` rides the **Public** `/inspect` (`src/server.rs:642`), not merely a tokenless-loopback `AdminRead` one, and `fail_subscription_fanout` writes the underlying query error verbatim into `diagnostic.details` (`src/local.rs:3579-3594`); receipts echo adapter `correlation` and subscription `scope` under tokenless-loopback `AdminRead` (`src/server.rs:683`). The concern is that "classify every public or tokenless response" is open-ended, and the audit's completion criterion is not pinned. *Resolves with:* enumerating the specific known carriers as the audit's floor (public `/inspect.recentDiagnostics` and `/` , `AdminRead` receipts `correlation`/`scope`, handler-error `details`, the data explorer) with the disposition for each (typed projection vs. `AdminSecretRead`), so "audit done" is checkable rather than judged.

6. **LOW — Reserving `_auth_*` at load time is a latent breaking change for existing apps, and the migration is under-specified for the app that is *already* using the prefix in production.** §Protected identity core makes `_auth_*` a load-time error and provides a dev-mode rename-and-copy recovery. Verified that `_auth_users` passes both reservation checks today (`src/storage.rs:2737-2746` reserves only `_snapback`; codegen `index.mjs:290` likewise). But the recovery assumes the collision is discovered *before* sessions staging on an app the operator controls; an app already shipping an `_auth_notes` table (entirely legal today) breaks at the next codegen/load after this slice lands, regardless of whether it ever adopts sessions, because the reservation is unconditional at load time. *Failure scenario:* an unrelated app with an `_auth_*`-prefixed table upgrades the toolchain and fails manifest load with no sessions involvement. *Resolves with:* stating whether the reservation is gated on sessions-adoption or is corpus-wide-immediate, and if immediate, adding a deprecation path (warn-then-error across a version) rather than a hard load-time error on first upgrade.

## Suggestions

- **Name the mailbox's read-effect explicitly in the route table.** The cleanest structural fix for Concern 1 is a policy that encodes "this response body is itself a minting capability" — i.e. a row distinct from `AdminSecretRead` — so the route table can never again be read as blessing the token-only path. This also generalizes to any future code-bearing read.
- **Consider whether `auth.mintSession` and the mailbox should exist at all in v1, versus a single "print the current login code to the terminal" CLI verb.** The mailbox is a standing read-any-code surface; a pull-based CLI verb that prints the code for a challenge the operator names has the same testing utility with a smaller blast radius and no standing HTTP surface to gate. Worth a sentence in §Open Questions.
- **The 20-session cap (`_auth_sessions`) interacts with the multi-tab custody model.** Web Locks + BroadcastChannel custody means one user across many tabs shares one session, so 20 is generous — but a user with several devices plus the 7-day rotation tombstones could approach it under pathological reconnection. Pin whether the cap counts sessions or (session × live tombstones), since the tombstone table is retained to absolute expiry.
- **§Replay parity's descriptor and §Permission dependencies' incarnation are two separate server-issued consistency values now.** The descriptor (`{ descriptorVersion, authorityInstanceId, sessionGeneration }`) and the `(incarnation, epoch)` pair both ride the `GET /auth/session` handshake and both gate client replay/retention. A single small table in the document mapping "which value governs which client decision" (retained rows ← userId; queued mutations ← authorityInstanceId; resnapshot ← incarnation; resync ← epoch) would prevent an implementer from conflating them.
- **The 0051 reconciliation is named but its direction is asserted, not shown.** §Replay parity says 0051's prose "still says resolved auth is replayed from the ledger — that must be reconciled." I confirmed 0051 D1 says the ledger's auth entry is "the *resolved* auth context (LLP 0039's `AuthContext` shape)… re-supplied on replay, never re-read." That is consistent with 0039's descriptor-is-not-authentication stance, but 0039 should state the reconciliation's *outcome* (the ledger keeps the resolved auth for fingerprint-checking; the descriptor is the separate first-delivery consistency input) rather than leaving it as a to-do, since the two could be misread as competing.

## Open questions

- What, concretely, is the impersonation capability (Concern 1)? Until it is one named thing with a lifecycle, the mailbox/mintSession security story is unbuilt-by-underspecification, not merely unbuilt.
- Does the local target get a structural must-understand backstop (Concern 2), or is the answer explicitly "the kit handshake is the only local defense and a pre-auth binary with a hand-written client is out of scope"? Either is defensible; the document currently implies the former while only building it for Cloudflare.
- Is v1 family-takeover-via-stolen-bearer an accepted risk (Concern 4)? The document should say yes-or-no, not just describe the hole.
- Is the `_auth_*` reservation immediate-corpus-wide or sessions-gated (Concern 6)?
- The document defers the `authorizedUntil` decision and the retainable-function `userId`-only restriction to "before item 8." Both are now 0053's per the split — but 0039 still owns the *sequencing*. Should the landing order make the `authorizedUntil` decision an explicit gate on item 8 rather than a companion note, given 0053 lists it as an open question too (so neither document currently *owns* the decision, only points at it)?
- `SNAPBACK_OVERLOADED` is mapped by the local status mapper as new work — but it is currently minted only in the Cloudflare platform layer (`cloudflare/src/platform-errors.js:44`) and merely passed through by the Rust runtime. Who mints it locally when a global connection-grant cap trips, and does that path exist in item 5's scope?

## Readiness verdict

Verdict: NOT READY

The document is close, and the bulk of it — authority resolution, the one-gate matrix, staged auth-mode machinery, the provider state machines, connection binding, two-phase revocation, the client coordinator, and the seam's outcome-level invariants — is implementable as written and rests on a verified-accurate baseline. But Concern 1 is a material, unresolved *self-contradiction* sitting on the exact privilege escalation the document identifies as its worst risk: the route table blesses a token-only mailbox while the prose forbids it, and an implementer following the table ships the app-XSS→any-user takeover. Concern 2 (the must-understand gate has no local backstop, verified against the absence of `deny_unknown_fields` in `src/`) and Concern 3 (concrete seam dependencies naming a model 0053 has abandoned) are also material and in-scope. None requires new design — each is a reconciliation or a pinned decision the author can make in one focused pass, which §Status already anticipates — but until Concern 1 in particular is resolved in the text, the document is not ready to move past Draft.

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

## Round 9 — 2026-07-12 (RFC altitude; Fable's bar is the governing standard)

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md` (sha256 `3b879ff9eb530cfe6ca355b80131c9f9c984b7433f112104b41fe36d251b1e52`).
**Reviewer family:** Claude (Anthropic)
**Provider / runtime:** Claude Code CLI headless (`claude -p`), `claude-fable-5`
(`claude-fable-5[1m]`), effort `max`. Fresh non-interactive session.
**Date:** 2026-07-12
**Redacted:** No — reviewed locally.
**Method:** Fresh session, blind to all archived reviews. Authorization
invalidation scoped OUT (LLP 0053's); the 0039/0053 seam IN scope.

**Author's ratification (Charlie, 2026-07-12):** this is an RFC, not a protocol
spec — "take Fable's bar … and let the Spec-level rigor Codex wants land in the
implementation LLPs." The brief instructed the reviewer to judge at RFC altitude
but to flag anything **mis-deferred** (a design hole disguised as a spec gap).

### Review body (verbatim)

All five verification agents have completed; every load-bearing code claim in the document checked out except two precision slips, and I've confirmed the three coherence defects I spotted in the text. I have everything needed to write the review.

## Overall assessment

This is a strong, unusually honest RFC, and the split that produced it worked: with authorization invalidation moved to LLP 0053, the remaining document is small enough to audit, and auditing it confirms that the authority, provider, transport, connection-binding, and diagnostics contracts are coherent, fail-closed, and implementable as written. I verified the document's factual claims about shipped code against the code itself, and the accuracy is exceptional — the Cloudflare coordinator's hardcoded empty auth (`cloudflare/src/coordinator.js:1228`), the fail-open `validateDeploymentMetadata` (`coordinator.js:279-300`), the constructor-order DDL hazard (`coordinator.js:92,167,228-247`), the tokenless-loopback `AdminRead` plus localhost CORS echo (`src/admin.rs:558-562`, `src/server.rs:1582-1597`), the Public `/app/ensure` applying schema, functions, and seed gated only by profile (`src/local.rs:1068-1149`), the direct runner's dynamic read-gate accepting body auth into the filter environment (`src/admin.rs:854-894`, `src/storage.rs:2364-2366`), the `#[serde(default)]` presence erasure (`src/manifest.rs:923-924`), the FNV-1a fingerprint and `SNAPBACK_AUTH_STALE_RESULT` check (`src/manifest.rs:1039-1058`, `src/storage.rs:302-309`), the unconsumed `authRequirement` (`packages/snapback-codegen/index.mjs:1545`), the auth-less status mapper (`src/server.rs:2630-2648`), the console's `localStorage` token at `location.origin` (`packages/snapback-admin-client/index.mjs:13`, `admin-ui/main.ts:22-27`), and the deltas-enqueued-inside-the-write-lock premise of the fencing correction (`src/local.rs:1422-1423,3368-3402`) all check out. The plan is a good one: the slice is genuinely minimal, the activation gate prevents the looks-authenticated intermediate state, and the landing order's claim that items 1–5 and 7 need no 0053 deliverable holds now that the incarnation lives here (0053 explicitly concurs that it consumes 0039's incarnation).

What keeps it from READY is not design rot but three localized defects, all of the class this review round exists to catch: the seam paragraph attributes a session-loss deletion requirement to 0053 that 0053's current text does not make (and arguably contradicts), leaving three passages in 0039 specifying three different behaviors for the same transition; the local `requiredCapabilities` backstop is claimed to make must-understand "true rather than aspirational" while it structurally cannot bind the pre-slice binaries in its own hazard statement, and that residual — unlike the analogous Cloudflare fork residual — is never named; and a stale sentence still specifies the capture mailbox under `AdminSecretRead`, the exact admin-token-suffices reading the round-7 revision elsewhere calls "this slice's worst security error." Each is a small, targeted fix. I also checked §Protocol obligations at the ratified RFC altitude and found the deferrals correctly classified — they are specification gaps, not disguised design holes — with one missing entry (the impersonation-capability carrier).

## Strengths

- **Evidentiary hygiene.** Nearly every claim about the shipped system is true and precisely stated, including self-corrections against the document's own earlier rounds: the must-understand gate's replacement of the false version-bump claim with the verified fail-open behavior of `validateDeploymentMetadata` and the true one-artifact deploy argument (§Summary gate 2; verified: `cloudflare/deploy.sh:116`, `wrangler.jsonc:9,15,29`, `gateway.js:16,20`), with the third-party-fork residual named rather than engineered away.
- **The privilege-escalation catch** (§Built-in first provider). The observation that the mailbox and `auth.mintSession` convert the browser-held admin token into universal impersonation is correct and verified (`snapback_admin_token` in `localStorage`, admin API at `location.origin`), the `ImpersonationCapability` split is the right shape, and the acceptance pins the exact negative — a caller holding only the console token can neither read the mailbox nor mint a session. Extending the gate to the pre-existing `--as-user`/`--as-role` doors instead of only the new capabilities is the kind of closure reviews usually have to ask for.
- **The ownership-guard preservation** (§Authority resolution). The shipped short-circuit is real (`src/local.rs:1706-1709`, `1780-1783`), and "rejection must be paired with a replacement predicate, or it opens the hole it closes" is exactly the migration trap that kills auth retrofits. The replacement — record server-resolved authority *and* connection grant, compare anonymous on the grant — is correct, with acceptance negatives in both the anonymous and authenticated cases.
- **The drain-boundary fencing correction** (§Session transport). Its premises are verified in code — delta production and enqueue happen inside the global write lock; the HTTP drain and WebSocket sender reach the outbox through `EphemeralApi` without the snapback mutex — the lock-order pin is sound, and "non-delivery, not non-computation" is the honest statement of what the mechanism guarantees.
- **Verify-and-consume in one transaction** (§Built-in first provider). The diagnosis that 0011's outside-the-lock pin is about Argon2, not a microsecond HMAC (verified against 0011 §Authentication Model), and that attempt accounting forces the lock anyway, removes a self-inflicted race rather than papering over it.
- **Wedge-free staged transitions** (§Authority resolution). Stage-time collision pre-check, non-destructive `--clear-desired-auth-mode`, consume-failure booting in the still-active mode with the desired mode quarantined, and the admin schema-apply surface staying reachable during `MODE_PENDING` collectively honor the repo's wedge-traps-are-defects rule; the `(requested, active, desired)` ensure gate closes the activation-is-the-hole problem, and the bundle-hash pin closes the resident-hostile-bundle carry-over.
- **Honest costs and residuals.** The offline-capability cost of adopting sessions is stated in §Summary rather than discovered; the refresh-family takeover hole, the undeclared-restore residual, and the bearer-custody XSS trade are named with their partial mitigations rather than claimed solved.
- **The seam construction itself** (§Permission dependencies). Moving the incarnation into this document so items 3–5 have no 0053 dependency is verified in both documents, and stating the seam as four outcome invariants is the right discipline — the one place it lapses is Concern 1.

## Concerns

1. **MEDIUM — coherence / seam error: the session-loss retained-data disposition is specified three different ways, and the deferral cite attributes to 0053 a requirement its current text does not make.** §Permission dependencies says "On session loss, affected retained slices are **deleted**, not 'wiped or quarantined': **0053 requires deletion there**, and this document defers to it" (line ~948). LLP 0053's working-tree dispositions table maps `delete` only to proof, reset, declared restore, and lease expiry, and maps "**every coarse authorization event**" — including event 4, "explicit out-of-band revocation… also what LLP 0039's session revocation calls into" — to `quarantine`; its changelog records that the quarantine-live/delete-retained mapping was attempt four, replaced in attempt five ("coarse events now quarantine… delete only on proof"). Meanwhile 0039's own §Authority transitions matrix says authenticated→anonymous "wipe[s] **or quarantine[s]** retained rows and queues," the barrier prose says the coordinator "commits durable **quarantine**," and §Replay parity says "same-user re-login **preserves**" retained rows — which delete-at-the-barrier forecloses for any logout/expiry path. Three behaviors for one transition, plus a stale attribution, in the one section whose stated rule is "names 0053's outcomes, never its internals." Both branches are fail-closed, so this is incoherence rather than exposure — but it also brushes the split-integrity claim: if item 5's barrier genuinely needs *quarantine*, it depends on 0053's client primitive, which the landing order says it must not. *Resolves with:* pick one behavior for session loss and state it as 0039's own conservative v1 default (day-one `delete` is defensible, and keeps item 5 free of 0053's quarantine primitive); update the transition-matrix row and the "commits durable quarantine" phrase to match; scope "same-user re-login preserves them" to the transitions that actually preserve; and either delete the "0053 requires deletion there" sentence or note quarantine-then-prove as the item-8 refinement 0053 currently specifies.

2. **MEDIUM — overstated safety mechanism: the local `requiredCapabilities` backstop cannot bind the binaries in its own hazard statement, and that residual is unnamed.** §Summary gate 2's hazard is "an **older binary** can reopen a sessions-mode database, silently ignore `auth.mode`, and serve it under legacy body authority." The proposed backstop — a persisted `requiredCapabilities` list checked at open — is ignored by a pre-slice binary for exactly the same reason `auth.mode` is: verified, no struct in the repo uses `deny_unknown_fields`, and `Database::open` → `load_schema_manifest` (`src/storage.rs:227-243`, `1368-1390`) is a bare `serde_json::from_str` that errors only on JSON parse failure, with validation living solely on the apply path. So the mechanism protects against *future* capability-unaware binaries at or after this slice, while the stated hazard — rollback across the sessions boundary to today's binaries — remains fully open. The document applies exactly the right "a new field cannot bind a receiver that predates it" logic to Cloudflare and names the fork residual there, but claims the local gate "is what makes 'must-understand' true rather than aspirational" without naming the symmetric local residual. The backstop is also not assigned to any landing item. *Resolves with:* either name the pre-slice-rollback residual explicitly (mirroring the Cloudflare treatment, with operator guidance not to roll back across the boundary), or make the gate structural for old binaries too — e.g., on sessions activation relocate the persisted manifest to a new meta key and write a deliberately unparseable sentinel at the legacy key, so a pre-slice binary fails closed with `SNAPBACK_SCHEMA_PARSE_FAILED` at open instead of serving (the shipped `?` propagation makes this refusal real today) — and assign the backstop to a landing item.

3. **MEDIUM — internal contradiction on a security gate: one sentence still specifies the mailbox under `AdminSecretRead`.** §Built-in first provider's Delivery bullet (lines ~670-672) says "Mailbox reads are gated by the token-required `AdminSecretRead` policy" — a policy the console's `localStorage` admin token satisfies. The round-7 escalation paragraph (lines ~686-694) and the route table (line ~1089: "`ImpersonationCapability` — *not* `AdminSecretRead`… not reachable from the console at all") specify the opposite, and the document itself calls the admin-token-suffices reading "this slice's worst security error." An implementer working from the Delivery bullet builds the escalation the acceptance elsewhere forbids. *Resolves with:* correcting the Delivery bullet to `ImpersonationCapability` (keeping the CORS-echo rationale as the reason plain `AdminRead` was never viable).

4. **LOW — the `ImpersonationCapability` has no named carrier and is missing from §Protocol obligations.** It gates the mailbox route, `auth.mintSession`, and host-ops `function.run --as-user`/`--as-role`; host-ops has an HTTP projection (LLP 0024), so the capability needs a wire carrier that does not put raw keyring bytes on requests — or an explicit statement that impersonation verbs are CLI-only. The deferral ledger records seven obligations and this is a natural eighth; as it stands, the gate's most attackable detail is neither pinned nor recorded as deferred. *Resolves with:* adding it to §Protocol obligations (a per-boot derived secret — e.g., HKDF over the keyring key and the boot nonce — would satisfy the "never the localStorage token" pin cleanly).

5. **LOW — registry and ownership bookkeeping inconsistencies.** (a) §Ephemeral rooms says the mode-dependent DTO families are "0012-registered," contradicting §Observability's corrected partition, which assigns wire/serde schemas to LLP 0051 D4. (b) `SNAPBACK_CAPABILITY_UNSUPPORTED` (§Summary) and `SNAPBACK_AUTH_MODE_DEV` (route-table note) appear in prose but not in the diagnostics/startup-code lists. (c) The `app.reset` → `ConnectionRegistry` wiring is "owned by landing item 4" in §Protected identity core but by item 5 in §Session transport and §Landing order. *Resolves with:* three text fixes.

6. **LOW — two code-fact precision slips.** (a) "resume, unsubscribe, and supersede-on-resubscribe all share this tuple": resume and unsubscribe share the byte-identical short-circuit deny-guard (`src/local.rs:1706-1709`, `1780-1783`), but the supersede path (`src/local.rs:1604-1608`) is a *positive* match gate that additionally requires `same_connection` and silently no-ops on mismatch — a different structure with different failure behavior (the pinned replacement contract still covers all three, so no design change follows). (b) `scripts/cf-check-compat` refuses on compatibility-date/flag drift and a forbidden `nodejs_compat` flag (`scripts/cf-check-compat:28-30`), not on capability-manifest gaps; citing it as "the existing … REFUSED pattern" for a capability-manifest refusal reads as if that check half-exists when the sender-side gate is wholly new work. *Resolves with:* tightening both sentences.

7. **LOW — residual seam vocabulary drift into 0053 internals.** Invariant 1 opens "Classification is a load-time property" — 0053's attempt six rejected classification as the primitive ("classification is the wrong primitive"), replacing it with two orthogonal declarations and machine-enforced retainability; the invariant's *outcome* (ordinary writes advance no epoch and clear nothing) is still exactly what 0053 promises. Similarly, §Authority transitions' retained-scope caveat presents the `userId`-only retainable restriction as a decision still to be made "with the `authorizedUntil` decision," while 0053 pins it outright ("Retainable ⇒ `userId`-only authority dependence"). *Resolves with:* restating invariant 1 in outcome terms and acknowledging 0053's pinned restriction.

8. **LOW — dev-mode semantics of the two-axis store are unstated.** `authorityInstanceId` is "per-boot in dev mode," while descriptor enforcement is specified only "under sessions." Read literally, either every dev-server restart (a constant event in this repo's workflow) strands the client's queued mutations for discard-or-re-record — a regression of the shipped LLP 0043 M2 dev flow worth stating — or the dev-mode instance id has no enforcement consequence and is dead weight. *Resolves with:* one sentence stating which.

## Suggestions

- **Answer the undeclared-restore open question with an out-of-directory anchor.** A small host-state file outside the instance directory (keyed by instance identity, carrying a monotonic watermark advanced on revocation-class events) would let open detect durable-state rollback and auto-run the restore procedure for same-host restores — the overwhelmingly common case — leaving only cross-host restores as the named residual. Cheap, and it converts the residual from "until expiry" to "detected."
- **State the provenance of the staged bundle-hash pin**: the expected hash is supplied in the `AdminWrite` staging payload by the operator's deploy tooling, never derived from the resident bundle — the acceptance test would catch a derive-from-resident implementation, but saying it prevents the implementation from being written.
- **Assign the response-sensitivity audit to landing item 2 explicitly.** It is currently "a prerequisite of sessions becoming enableable" without an owner in the landing list, and item 2 is its natural home.
- **Extend the throttle-honesty note to connection-open caps.** §Session transport specifies "per-source" open caps; §Built-in first provider already concedes per-source keys degenerate to a global bucket on loopback. The same degeneration applies here and is worth one clause.
- **Note in the 0024 companion obligation that the amendment also re-gates `--as-user`/`--as-role`** under the impersonation capability — the body pins it (§Built-in first provider), but the companion list only mentions the `session` mode and `mintSession` verb.
- **Add one sentence to item 5 clarifying that queue-stranding on session change is detected client-locally** (the client knows its own session id) and does not need item 7's wire descriptor — the transition matrix references authority-instance scoping that the landing order places at item 7, and the sentence closes an apparent forward dependency.

## Open questions

1. On session loss once item 8 lands, which disposition governs retained slices — 0039's immediate `delete` at the barrier, or 0053's quarantine-then-prove for coarse events — and which document owns that call? Relatedly: exactly which transitions does "same-user re-login preserves retained rows" cover?
2. Is the pre-slice rollback residual accepted and documented, or should the sessions transition also poison the legacy manifest key so genuinely-old binaries fail closed at open?
3. What is the wire carrier for the `ImpersonationCapability` on the HTTP host-ops path — a per-boot derived secret, or are impersonation verbs CLI-only?
4. In dev mode, does the per-boot `authorityInstanceId` strand queued mutations on every server restart, and is that acceptable for the dev loop that LLP 0043 M2 just shipped?
5. (Endorsing the document's own asks) Who owns the deployment-security contract and the client-page XSS posture before item 5 lands — and should the DPoP-shaped sender-binding trajectory get a stub LLP now so the custody and refresh designs can cite a real owner?

## Readiness verdict

Verdict: NOT READY

The document is one focused revision from READY. Its verified-against-code factual base is excellent, its new contracts (two-phase revocation fencing, the staged mode machine, the existing-surface closure, the impersonation-capability split, the client barrier) are sound at the ratified RFC altitude, and its deferral ledger correctly separates specification work from design work. But three material defects remain in the current text: the session-loss disposition is specified three inconsistent ways around a stale attribution to LLP 0053 (Concern 1 — a seam error in the one section whose job is seam fidelity, with a side effect on the split-integrity claim), the local must-understand backstop's central claim overstates what the mechanism can bind and omits the residual the document names for the analogous Cloudflare case (Concern 2), and a surviving sentence specifies the capture mailbox under the exact gate the document elsewhere identifies as its worst possible security error (Concern 3). All three are text-level fixes with clear resolution criteria; the LOW concerns and suggestions are non-blocking polish.

### Orchestrator verification notes — round 9 (outside the verbatim body)

**Zero HIGH concerns — the first time in nine rounds.** 3 MEDIUM, 5 LOW; verdict
"one focused revision from READY."

All three MEDIUMs applied. Notably #1 was the **joint-consistency defect** the
author had asked to watch for: 0039's seam asserted "0053 requires deletion" on
session loss, but 0053's attempt five had replaced that with quarantine-then-prove,
while 0039's own transition matrix said a *third* thing ("wipe or quarantine").
Resolved by making session loss **delete**, as 0039's own decision — which also
keeps landing item 5 free of 0053's quarantine primitive, so the split's landing
independence stays real rather than becoming fiction.

#2 was an overclaim the author had made **locally** after correctly diagnosing it
for Cloudflare: a new `requiredCapabilities` field cannot bind a binary that
predates it, for exactly the reason `auth.mode` cannot. Replaced with a structural
mechanism that works against *today's* binaries (relocate the persisted manifest to
a new meta key; write an unparseable sentinel at the legacy key, so a pre-slice
binary fails closed at `serde_json::from_str` rather than serving a sessions
database under legacy authority). #3: one surviving sentence still gated the
mailbox at `AdminSecretRead` — the exact escalation the document calls its worst
security error — while the route table and the escalation paragraph said otherwise.

## Round 10 — 2026-07-12 (RFC altitude; Fable's bar is the governing standard)

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md` (sha256 `742fb36019ada09cfe1bf8162d82c14316fc2fe4d9571d382f0564a14745a249`).
**Reviewer family:** Claude (Anthropic)
**Provider / runtime:** Claude Code CLI headless (`claude -p`), `claude-fable-5`
(`claude-fable-5[1m]`), effort `max`. Fresh non-interactive session.
**Date:** 2026-07-12
**Redacted:** No — reviewed locally.
**Method:** Fresh session, blind to all archived reviews. Authorization
invalidation scoped OUT (LLP 0053's); the 0039/0053 seam IN scope.

**Author's ratification (Charlie, 2026-07-12):** this is an RFC, not a protocol
spec — "take Fable's bar … and let the Spec-level rigor Codex wants land in the
implementation LLPs." The brief instructed the reviewer to judge at RFC altitude
but to flag anything **mis-deferred** (a design hole disguised as a spec gap).

### Review body (verbatim)

## Overall assessment

This is a strong, unusually honest document, and its round-7 revision fixed real defects rather than performing fixes. I verified its load-bearing claims about shipped code line by line, and the great majority hold — including several that would have been easy to get wrong. The Cloudflare coordinator really does hardcode an empty auth object into every invocation (`cloudflare/src/coordinator.js:1228`), so the "unscoped with empty auth" hazard in §Target scope is exactly as stated. `validateDeploymentMetadata` really does iterate only the expected keys and therefore fails open on formats it has never seen (`coordinator.js:279-300`), so the round-7 self-correction ("that is false and is corrected here") was itself correct. The relocate-and-poison local backstop actually works: `load_schema_manifest` returns an error on a parse failure (`src/storage.rs:1368-1390`), `Database::open` propagates it with `?` (`src/storage.rs:238`), and the CLI opens the database before it binds the listener (`src/cli.rs:459-477`) — so a pre-slice binary really would refuse to open a poisoned database rather than serve it under legacy authority. That is a genuinely creative piece of design and it survives verification.

The two decisions I most expected to break under scrutiny did not. The live-ownership insight — that removing client-auth fields would delete the very fields the shipped guard compares, and that the guard short-circuits when both are absent — is correct (`src/local.rs:1780-1792`, `1706-1718`), and the replacement (record the server-resolved authority *and* the connection grant; compare anonymous on the grant) is the right fix. The admin-token privilege escalation is real and correctly closed: the console does persist the token in browser-readable `localStorage` (`packages/snapback-admin-client/index.mjs:13-25`) and calls the API at `location.origin` (`admin-ui/main.ts:23-24`), so "a 0600 file a browser page cannot read is true of the file and false of the running system" is precisely right.

The document nonetheless has two material defects, and the first is the same class of mistake the document itself invented the cure for. §Authority resolution pins the rule "**rejection must be paired with a replacement predicate, or it opens the hole it closes**" — and then §Ephemeral rooms rejects the ephemeral `auth` field without pinning a replacement predicate for *key derivation*, which in the shipped code reads a different, caller-controlled wire field in preference to the auth context. Two of the three key modes the document explicitly blesses as safe under sessions become fully caller-controlled. The second defect is in the 0053 seam: invariant 2 restates the pre-reframe epoch-and-resync model, which is the mechanism 0053 rejected as its first failed attempt, in the same section where the document declares it will name "0053's outcomes, never its internals."

Both are textual and scoped, not architectural. The authority, provider, transport, connection-binding, revocation, and diagnostics contracts are sound, and the split's landing-independence claim survives scrutiny. But both defects are material, so the verdict is NOT READY.

## Strengths

**The existing-surface closure is the most valuable section, and its worst finding is verified.** §Existing surfaces names the direct function runner as the third decorative-sessions surface, and the code confirms it is the worst: `admin_run_function` classifies a query as a read (`src/admin.rs:872-876`), reads are allowed tokenlessly on loopback (`src/admin.rs:534-563` — `loopback || token_ok`, so a configured token does not close it), and the handler deserializes a body `HandlerInput` whose `auth` field is `#[serde(default)]` (`src/manifest.rs:923`). Combined with a CORS layer that echoes any localhost origin verbatim (`src/server.rs:1582-1597`), a hostile local page can today run auth-filtered queries under a forged identity. Calling that "strictly worse than scanning raw rows" is correct, and folding it into landing item 2 rather than item 4 is the right sequencing call.

**The must-understand analysis is now correct in all three of its parts, including the part that says the mechanism does not generalize.** Sender-side refusal, the Cloudflare argument (app and coordinator are one `wrangler deploy` artifact — `cloudflare/deploy.sh:116`, `cloudflare/wrangler.jsonc:9`), and the local parse-fence are each independently sound, and §Target scope's closing note — "Neither is a general must-understand mechanism, and the corpus does not have one" — is the kind of honesty that keeps a corpus from accreting false primitives.

**The privilege-gate reasoning on `/app/ensure` is the sharpest single argument in the document.** Evaluating the gate against `(requested, active, desired)` rather than active mode alone, because "while active mode is still `dev`, today's Public ensure could stage sessions and persist attacker-chosen schema before the restart," is exactly right, and it is verified: `/app/ensure` is `Public` (`src/server.rs:646`), it applies both schema and executable bundles when provisioning is allowed (`src/local.rs:1085`, `:1100`), and the loopback default profile is `Dev` (`src/admin.rs:111-121`), which allows provisioning.

**The verify-and-consume correction is a model of reading a parent document carefully.** LLP 0011's outside-the-lock pin genuinely is about Argon2 password hashing (`llp/0011:86-88`), not a microsecond HMAC, and attempt accounting genuinely is a durable write on every attempt — so the conclusion that "the outside-the-lock choice bought nothing here and cost a race" is correct, and reverting to a single transaction is the right call.

**The landing-order independence claim holds.** Moving the authorization-stream incarnation to item 5 (§Permission dependencies) does make items 1–5 and 7 free of any 0053 deliverable, and LLP 0053 confirms the direction from its side ("The incarnation is LLP 0039's, and this document consumes it"). That is the load-bearing fix of the split, and it works.

**Honesty markers are everywhere and they are load-bearing, not decorative.** "The guarantee is **non-delivery, not non-computation**" (§Session transport); the named undeclared-restore residual (§Protected identity core); the refresh-family takeover hole named-and-not-closed; the delegated-bearer framing ("possession acts under the bound authority; there is no second caller identity to compare"); and above all the §Summary statement that adopting sessions *removes* the offline capability LLP 0043 just shipped. Documents that state their costs in the summary rather than the appendix are rare.

**Cross-document citation accuracy is high.** I spot-checked roughly fifteen claims against 0007, 0008, 0009, 0011, 0012, 0013, 0016, 0020, 0026, 0034, 0036, 0038, 0042, 0043, and 0046, and nearly all hold — including subtle ones like the parenthetical "LLP 0026's L9 tests (labeled LLP 0032 L9 in code)," which is precisely how the vocabulary and the work are actually split.

## Concerns

**1. (HIGH) Under sessions, two of the three key modes the document blesses remain fully caller-controlled, because key derivation reads a wire field the rejection list does not name.**

§Ephemeral rooms bans `KeyMode::Custom` at manifest load with the correct reasoning — an `AllowAll` collection with custom keys "lets any caller overwrite or delete another caller's key" — and then declares the safe subset: "only the `Connection`, `Session`, and `User` key modes are available under sessions." The DTO rule it relies on is "session-mode schemas omit the client-auth fields and reject their presence," and §Authority resolution's rejection list names "the ephemeral identity fields (which need mode-dependent DTOs: today's wire types *require* `auth`, so omission cannot deserialize)."

But `auth` is not the field that determines the key. `PublishRequest` and `DeleteRequest` carry `session_id`, `user_id`, and `custom_key` as fields *sibling to* `auth`, not inside it (`src/ephemeral.rs:321-343`), and the key resolver prefers those sibling fields over the auth context:

```rust
KeyMode::Session => request.session_id.clone()
    .or_else(|| request.auth.session_id.clone())          // src/ephemeral.rs:2321-2328
KeyMode::User    => request.user_id.clone()
    .or_else(|| request.auth.user_id.clone())             // src/ephemeral.rs:2329-2334
```

`entry_key_for_delete` has the same shape (`src/ephemeral.rs:2341-2351`), and neither `publish` nor `delete` compares the stored entry's owner before overwriting or removing it (`src/ephemeral.rs:1245-1341`, `1366-1388`) — the only authorization call consults the `AccessPolicy`, which is `AllowAll` in every demo. So if a session-mode DTO omits `auth` and keeps `session_id`/`user_id` — the literal reading of "omit the client-auth fields" — then `request.session_id` becomes the *only* source of the key, and any caller can publish `user_id: "victim"` into a `KeyMode::User` collection and overwrite or delete the victim's entry. That is not a weakened version of the `Custom` hole; it is the identical hole, in the modes the document declares safe, and LLP 0013 §Scope and keys already forbids it ("custom key: allowed when generated validation and auth can **prove the publisher may write that key**", `llp/0013:152-153`).

The document supplies the intent — "Under sessions the operation's identity is the connection's bound authority" — but that sentence governs `ensure_authorized`, and key derivation is a separate code path that never consults the auth context while the wire field is present. This is precisely the failure mode §Authority resolution names: rejection without a replacement predicate. The acceptance line ("with cross-user overwrite/delete negatives on the permitted key modes") suggests the author suspects it, but a test without a pinned rule is a test the implementation is free to fail.

*Resolves with:* pinning at field level that under sessions, `Session` and `User` key derivation comes from the **connection's bound authority only**, and adding `session_id`, `user_id`, and `custom_key` to the fields session-mode ephemeral DTOs reject alongside `auth` (`connection_id` stays — it is already verified against the grant). Naming `entry_key_for_publish`/`entry_key_for_delete` as the enforcement point, the way §Authority resolution names `HandlerInput.auth` and `ctx_ledger.auth_fingerprint`, would make this checkable rather than remembered.

**2. (HIGH) The 0053 seam's invariant 2 asserts a promise 0053 does not make, and the promise it asserts is the mechanism 0053 rejected as its first failed attempt.**

§Permission dependencies states, as an invariant this slice depends on: "**Permission-affecting writes fail closed.** They advance a durable, incarnation-scoped epoch in the same transaction as the write, and affected subscriptions receive `resync_required` and re-enter with a fresh authorized snapshot. LLP 0011's ratified v1 direction (server-directed resubscribe, not universal live re-evaluation) is preserved."

LLP 0053 does not deliver that, in two distinct ways.

*Scope.* 0053's authorization-event universe advances the version for exactly four causes: a committed write to a `permissionBacking` table, activation of new schema/functions/metadata, reset/import/declared restore, and explicit out-of-band revocation (0053 §The authorization-event universe). A permission-affecting write expressed *inside the query* advances **no** epoch and emits **no** `resync_required`. 0053's own worked-classifications table puts "n/a" in the authorization-event column for the mine-OR-public shape: "a `public → private` flip is an ordinary write whose replace removes the rows." The re-parented-document hierarchy is the same. Those changes ride the matcher, and their removals are obligation-backed — that reframe *is* 0053's central claim.

*Targeting.* "v1 has exactly one epoch: the global one. Subject-scoped epochs are computed in shadow mode only" (0053 §The authorization version). So a `permissionBacking` write does not notify "affected subscriptions" — it quarantines **every** auth-scoped subscription on every client, which is why 0053's acceptance carries a "Blast radius, measured not asserted" row over the card game's routine join/leave/kick traffic.

This matters for three reasons. First, an implementer discharging invariant 2 as written would advance an epoch on every permission-affecting write, which is 0053's rejected attempt one — "Every ordinary todo write globally resynced and cleared every client. *Rejected: the storm.*" Second, the document violates its own rule in the paragraph that states it: "This document names 0053's outcomes, never its internals. 0053's model has already been redesigned twice under review, so any vocabulary this document copied would go stale — **as it did**." Invariant 2 is that vocabulary, and it has gone stale again. Invariant 1 shows the author knows how to do this correctly ("Stated as an *outcome*… this document does not name the mechanism"). Third, 0039 is the umbrella that owns the landing order and the demo claims, and it therefore owns telling the reader that under 0053's v1 a single membership write quarantines every client's auth-scoped views until they resnapshot. §Summary states the offline-capability cost with exemplary candor; this cost gets no mention at all.

The in-scope core survives: session revocation runs through 0039's own two-phase revocation and its own coordinator defaulting to `delete`, so items 1–5 and 7 still depend on no 0053 deliverable and the split's landing-independence claim holds. What fails is the seam's accuracy, which is the thing this review was asked to judge.

*Resolves with:* rewriting invariant 2 as an outcome — permission changes must not leave a client able to see rows it may no longer see, fail-closed, with the mechanism left entirely to 0053 — and adding the v1 blast radius to §Summary beside the offline cost: under 0053 v1, any membership or ACL write in a session-enabled app quarantines every auth-scoped subscription until it resnapshots, and subject-scoped narrowing is shadow-mode-only.

**3. (MEDIUM) The largest diagnostics leak is on a `Public` route, not an `AdminRead` one, and the closure item does not name it.**

§Existing surfaces says: "the public inspect projection carries `recentDiagnostics`, and handler rejection messages and live fan-out failures flow into diagnostic details. Both surfaces are `AdminRead`, i.e. tokenless on loopback under the same CORS echo."

The receipts half is right — `/_snapback/api/receipts` is `AdminRead` (`src/server.rs:683`) and `LiveReceipt` carries both the verbatim adapter `correlation` and the subscription `scope` (`src/live_wire.rs:205-206`, `241-242`). The inspect half is wrong, and wrong in the unsafe direction. `PublicInspect` carries the full `Vec<Diagnostic>`, not a count (`src/local.rs:220-221`, copied through verbatim by the `From` impl at `:261`), and `GET /inspect` is registered `Public` (`src/server.rs:642`). So this surface needs no token, is served on any bind rather than only loopback, does not depend on the CORS echo at all, and — by LLP 0031's own corollary that a proxy may "forward the root and refuse `/_snapback/*`" — is **forwarded to the LAN by the LLP 0030 dev proxy**, the very topology §Auth mode offers as the sanctioned LAN-development path.

The remedy sentence is scoped correctly ("every public or tokenless response is classified for app-derived and identity-derived content"), so the audit does cover it. But the threat framing under-scopes the exposure, and §Landing order item 2 names only `/_snapback/api/data/{table}` and `/app/ensure` — so the single largest channel is in the audit's scope sentence and absent from its route list.

*Resolves with:* correcting the classification to `Public`, and naming `/inspect` and `/` in landing item 2 so the public projections are closure targets rather than only audit scope.

**4. (MEDIUM) The staged bundle-hash pin does not say whose hash it pins, and the unsafe source is the one the section exists to defend against.**

§Existing surfaces sets up the hazard perfectly: while `active == dev`, `/app/ensure` is Public and calls `load_functions`, so "an attacker-installed bundle could therefore be the last one loaded before staging, and `AdminWrite` on the *staging* payload authorizes the staging request — **it attests nothing about the bundle already resident**." The fix is then stated as: "the staged transition **pins the expected bundle hash**, and the pre-bind consume **verifies it and refuses otherwise**."

Whose hash? If the pin is read from the resident in-memory function manifest at stage time, it certifies the attacker's bundle, the pre-bind consume happily verifies it, and the section's own acceptance — "a bundle installed through Public `/app/ensure` while in dev mode is **not executable** after a sessions transition" — fails. The acceptance forces the safe reading, but the mechanism sentence permits the unsafe one, and the naive implementation is the unsafe one. The question is sharpened by the fact that a staging payload might carry only a schema change (`auth.mode`) and no bundle at all, in which case there is no operator-declared hash to pin unless one is required.

*Resolves with:* stating that the expected bundle hash is supplied by the `AdminWrite` staging payload or the pre-bind provisioning configuration, is **never** derived from the resident in-memory function manifest, and that a staging request carrying no bundle identity is refused.

**5. (MEDIUM) The transport fence does not fire in the topology the document recommends, and the LLP 0030 citation is stronger than 0030 supports.**

§Auth mode justifies fencing dev-mode auth to loopback with: "LAN/phone development keeps working through LLP 0030's proxy (Vite binds the LAN; Snapback stays loopback)." §Summary separately concedes "the fence's limit — refusing plaintext non-loopback binds does not fence out a loopback bind behind a reverse proxy, which is hosted exposure and remains operator-owned risk." Those are the same proxy. The fence keys on Snapback's *bind*, not on the transport a credential actually crossed, so in the sanctioned LAN topology dev-mode client-asserted auth — and, under sessions, real session bearers — cross the LAN in plaintext while `SNAPBACK_AUTH_TRANSPORT_INSECURE` never fires, because Snapback's own bind is loopback.

LLP 0030 says this itself, and more bluntly than 0039 credits: a non-loopback Vite host requires explicit opt-in, emits `SNAPBACK_DEV_HOST_EXPOSED`, and "exposing Vite beyond loopback can still expose the read surface and the token-gated lane to the network" (`llp/0030:517-518`, `:605`, `:609-610`, `:717`). It never discusses phones. So "LAN/phone development keeps working" through that proxy is true only in the sense that it keeps working *because the exposure is still there* — which is the opposite of the reassurance the mode table's cell is doing. Filing this residual under "hosted exposure" also mis-scopes it: it is the dev path, not a hosting concern.

*Resolves with:* stating in the mode table that the 0030 LAN-Vite topology re-exposes client-asserted auth (and, under sessions, plaintext bearers) to the LAN through the proxy, citing 0030's own warning; scoping the fence's guarantee honestly as "no direct non-loopback bind" rather than "auth is unreachable from the LAN"; and deciding whether a session-enabled app must additionally refuse to serve when it cannot establish that the transport was secure — which is exactly the trusted-proxy/`X-Forwarded-Proto` question the document already names as belonging to the unowned deployment-security contract.

**6. (LOW) Internal contradiction on who owns the `app.reset` → `ConnectionRegistry` wiring.**

§Protected identity core says it "is owned by landing item 4, not assumed." §Session transport says it is "an explicit item-5 deliverable," and §Landing order item 5 says item 5 "owns the `app.reset` → `ConnectionRegistry` wiring." Two places say five, one says four. No design consequence — both land before the activation gate — but this is genuinely new API surface, not just a new call site: `ConnectionRegistry` exposes only `open`, `verify`, and a private `lock` (`src/server.rs:327-401`), with no clear or revoke method at all, so it is exactly the kind of item that falls between two owners.

*Resolves with:* a one-word fix in §Protected identity core.

**7. (LOW) The ownership-guard evidence covers two of the three sites, and the third fails differently.**

§Authority resolution says resume, unsubscribe, and supersede-on-resubscribe "all share this tuple," which is accurate — all three compare `(principal, user_id)` and none compares `session_id`. But the failure-mode sentence ("the guard would never engage") describes only two of them. Resume (`src/local.rs:1780-1792`) and unsubscribe (`src/local.rs:1706-1718`) carry the quoted `is_some() || is_some()` short-circuit exactly. Supersede (`src/local.rs:1601-1608`) is structurally different: `same_connection && same_owner` with proceed-on-match polarity and a silent no-op on mismatch. With empty owners it does not fail to engage — `same_owner` becomes trivially true (`None == None`) — and only the `same_connection` check saves it. The prescribed fix covers all three, but the implementer is changing three differently-shaped call sites, and the document reads as though there is one.

*Resolves with:* naming the three sites and their two shapes, since the document is otherwise precise about exactly this kind of code fact.

**8. (LOW) Two accounting arguments the document makes carefully in one place and omits in another.**

The throttle honesty in §Built-in first provider is excellent — "in every supported topology all requests arrive from 127.0.0.1, so a per-source key degenerates to a global bucket" — but §Session transport then specifies "per-source and global open caps" on `/connection/open` without the same caveat, where it applies identically: on loopback the per-source cap adds nothing and the global cap becomes a self-denial lever any local page can pull, with `SNAPBACK_OVERLOADED` as the result. Separately, the document budgets sliding-expiry writes against the measured single-lane ceiling (~1,050–1,280 mutations/s, `llp/0038:377-378` — verified) and coalesces them, then establishes that "attempt accounting is a durable write on every attempt anyway," which puts every wrong-code exchange on that same lane; the global request-code budget is what bounds the resulting write-lane pressure, but the connection is never drawn.

*Resolves with:* one sentence in each place, matching the candor already applied to their siblings.

## Suggestions

**Make the session-mode DTO rule structural instead of a rejection list.** The corpus already has the pattern: LLP 0031 D3's `PublicFunctionManifest` is a typed projection "so that adding a sensitive field to the struct is a compile error at the projection rather than a silent leak." Session-mode ephemeral requests should be their own Rust types with **no identity fields at all**, taking the bound authority as a parameter to key derivation. That converts Concern 1 from a rule someone must remember into a thing that will not compile, and it generalizes: the same move applies to the session-mode live-subscribe input and to `HandlerInput`. The document already adds a response-sensitivity axis to the route registry for the outbound direction — this is the same idea applied inbound.

**A cheap way to distinguish theft from a shared-custody race, which the document says needs "stronger evidence than a bearer carries."** It may not. Custody is *already* a device-local, mutually-exclusive record (Web Locks plus BroadcastChannel), and a session is minted per login, so one session's token family lives inside exactly one device's custody. Therefore: have `/auth/refresh` return a per-family monotonic rotation ordinal, and have the custody record persist the ordinal of every rotation *it* performed. A client that observes a family ordinal higher than any rotation its own custody performed has proof that a rotation occurred outside its custody — and since the family is confined to that custody by construction, the only party who could have done it is a thief. This distinguishes the two cases the document says a bearer cannot distinguish, costs one integer on the wire, needs no device identifier and no WebCrypto, and degrades safely (a client whose custody record was cleared simply cannot make the claim and falls back to today's behavior). It does not replace sender-binding as the long-term answer, but it would let reuse detection fire on exactly the case the tiered design currently protects the thief in.

**Pin the `ImpersonationCapability` carrier now; it is the one deferred item that is a design decision.** §Protocol obligations item 7 offers a per-boot HKDF-derived secret or CLI-only verbs and says "Pin one" — but items 2–4 cannot be built without it, and the corpus already has the exact primitive: the readiness descriptor carries `adminTokenFile`, and LLP 0036 D3 states outright that reading a 0600 file *is* the local-admin capability ("filesystem access *is* local admin, honestly stated", `llp/0036:753`). A second 0600 file beside the first, surfaced through the same readiness descriptor, is the smallest carrier that satisfies the "never the browser-held token" pin, reuses ENG-23443's shipped machinery, and needs no key-derivation ceremony.

**Name the parse-fence as a corpus primitive.** The document says of the relocate-and-poison trick: "the corpus does not have [a general must-understand mechanism] — a future field will need its own argument." True of the *general* case, but the trick itself generalizes cleanly to any receiver that parses before it validates, which is most of them. Recording it in LLP 0012's evolution policy beside the ignore-unknown-fields rule — as a named pattern with its precondition — would save the next author from rediscovering it, and 0051's wire split and 0053's manifest vocabulary are both plausible next customers.

**Close the `recentDiagnostics` channel immediately rather than waiting for the general audit.** `/` already reports `recentDiagnostics` as a count (`src/server.rs:916`) while `/inspect` reports the full vector. Making `PublicInspect` match `/` is a one-field change against machinery LLP 0031 D3 already built, and it closes the largest identified leak without waiting for the full response-sensitivity classification.

**Reconcile the backup-unit premise with its own deferred obligation.** §Protected identity core reasons from "a restored pair is internally consistent" because the pinned backup unit is the whole instance directory; §Protocol obligations item 6 says "'copy the instance directory' is not a consistency protocol for a live WAL database." The security argument survives either way — an inconsistent backup would be *more* detectable, not less — but the two sentences should not sit in one document unreconciled.

## Open questions

- What is the acceptable blast radius for a session-enabled app under LLP 0053's v1 global epoch, given routine membership churn? If a kick quarantines every auth-scoped subscription on every client until it resnapshots, shadow-mode graduation may belong in the auth program's critical path rather than as a 0053 follow-on — and that is a landing-order question, which this document owns.
- The document closes the app-XSS-to-admin-token-to-*mint* path with great care. It is silent on app-XSS-to-admin-token-to-*read*: `AdminSecretRead` is gated by the same browser-reachable token, so operator-browser XSS still dumps every private table and every identity subject. That is arguably inherent (an admin token *is* a read-all credential, and the identity-subject line — emails are admin-read, login codes are impersonation — is a coherent one), but the document should say so rather than leave the reader to notice the asymmetry.
- Is one session ≡ one device's custody? The refresh-supersession design, the shared-custody framing, and the suggestion above all turn on this, and it is never stated.
- Under sessions with the sanctioned LLP 0030 topology, the proxy forwards the root app-data surface — which now includes `/auth/request-code` and `/auth/exchange` as Public root routes. Is a LAN-reachable credential-issuing surface intended? (The exposure looks bounded, since the mailbox requires the impersonation capability, so a LAN attacker can request codes but not read them — but it should be a decision, not a consequence.)
- Does the shipped kit's HTTP outbox drain use the `?connection_token=` query parameter? It exists on both `/outbox/{id}` and the stream today (`src/server.rs:2095-2100`, `:2473-2474`), and the document makes it dev-mode-only under sessions, so the kit's drain must move to the header — worth confirming rather than discovering.

## Readiness verdict

Verdict: NOT READY

Two concerns are material and unresolved in the current text. Concern 1 is a fail-open in a safety claim the document explicitly pins: it declares `Connection`, `Session`, and `User` the safe key modes under sessions, while the shipped key resolver takes the caller's `session_id`/`user_id` wire field in preference to the auth context (`src/ephemeral.rs:2321-2334`), so a session-mode DTO that omits only `auth` leaves two of those three modes fully caller-controlled — the identical cross-user overwrite and delete hole the document bans `KeyMode::Custom` to prevent, and precisely the failure the document's own rule ("rejection must be paired with a replacement predicate, or it opens the hole it closes") exists to catch. Concern 2 is a seam error: invariant 2 asserts that permission-affecting writes advance an epoch in the same transaction and notify affected subscriptions, which LLP 0053 does not promise — its reframe advances the version only for `permissionBacking`-table writes and enumerated writeless events, routes in-query visibility changes through the matcher with no epoch at all, and ships a *global* v1 epoch with subject targeting demoted to shadow mode. Both are fixable with text rather than redesign, and neither disturbs the architecture, the landing order, or the split's independence claim — which survived every check I ran. Everything else I found is a MEDIUM or below, and the three MEDIUMs (the `Public` rather than `AdminRead` classification of the `recentDiagnostics`-bearing inspect projection; the unspecified provenance of the staged bundle hash; and the transport fence's silence in the one LAN topology the document recommends) are each a paragraph's work. This document is close, and it earned that by fixing real defects in round 7 rather than arguing with them; it should get one more pass, and then it should land.

### Orchestrator verification notes — round 10 (outside the verbatim body)

Two HIGH, both verified against code, both applied:

1. **The ephemeral key fail-open.** `PublishRequest`/`DeleteRequest` carry
   `session_id`, `user_id`, and `custom_key` as **siblings of `auth`**, and the
   shipped resolver **prefers the wire field over the auth context**
   (`request.session_id.clone().or_else(|| request.auth.session_id.clone())`,
   `src/ephemeral.rs:2321-2334`). So rejecting only `auth` would have left
   `KeyMode::Session` and `KeyMode::User` — two of the three modes the document
   *declares safe* — fully caller-controlled, reproducing the exact cross-user
   overwrite/delete hole `KeyMode::Custom` is banned to prevent. This is the
   document's **own rule** violated ("rejection must be paired with a replacement
   predicate, or it opens the hole it closes") — stated for the live path two rounds
   earlier and not applied here. Fixed: the full field set is rejected on the wire
   and keys derive solely from the bound authority, with an explicit failure (never
   a shared synthetic key) when the authority lacks the mode's dimension.
2. **The seam asserted a mechanism 0053 had rejected** — "advance an epoch in the
   same transaction and send `resync_required` to affected subscriptions," which is
   0053's *first failed attempt* (the resync storm). The seam now states an
   **outcome only** and names no mechanism, precisely because 0053 has redesigned
   this six times and any mechanism named here will go stale again.

## Joint consistency pass — 0039 ↔ 0053 — 2026-07-12

**Method:** Orchestrator-run cross-document check (not an independent review):
every cross-reference in both directions extracted and tested against the other
document's *current* text, plus an ownership sweep for concepts that could be
claimed by both or by neither.

**Why it was needed, stated plainly:** 0053 was redesigned six times during the
loop. Every time it moved, 0039's seam went stale — and because each document was
reviewed in isolation (by the author's instruction, correctly), no single-document
review could catch it. Two of the four defects below had already been caught inside
the individual loops; two were found only here.

### Findings

1. **0039 named 0053's *rejected* mechanisms as its owned model.** The seam said
   0053 "owns the dependency classification model … and the `resync_required`
   disposition." Classification was rejected in attempt 4 ("classification is the
   wrong primitive"); per-write `resync_required` is attempt 1 (the resync storm).
   0039 was describing, as its dependency, two designs 0053 had explicitly
   discarded. *Fixed:* 0039 names **outcomes only** and no mechanism — because 0053
   has moved six times and anything named there will go stale again.

2. **A category error that produced a live contradiction.** 0053's event 4 claimed
   "LLP 0039's session revocation calls into" it — routing a session loss through
   0053's *coarse-event → quarantine* path, while 0039 pins session loss to
   **delete**. They are different things and only sound alike: a **session**
   revocation ends an *identity* (authenticated → anonymous — 0039's authority
   transition; the client may hold nothing, so it deletes); a **permission**
   revocation narrows what a still-authenticated user may *see* (0053's
   authorization event; quarantine-then-prove). *Fixed:* 0053 removes the claim and
   states the distinction; 0039 owns session loss outright.

3. **The disposition enum was owned by neither, and item 5 needs it.** 0039 said
   "0053 owns what the dispositions mean" while requiring its coordinator to take a
   disposition at item 5 — which would have made items 1–5 depend on a 0053
   deliverable and **silently falsified the landing-independence claim**, the exact
   error the incarnation move had already corrected once. *Fixed:* 0039 owns the
   **enum** (a coordinator interface type; at item 5 the only value it produces is
   `delete`); 0053 owns **when each disposition is produced** and the escalation
   rules (item 6).

4. **A pinned decision was still described as open.** 0053 now *pins* the
   `authorizedUntil` lease (24 h default) and the `userId`-only retainability
   restriction; 0039 still described both as decisions to be made before item 8.
   *Fixed:* 0039 defers to the pins; landing item 8 is gated on 0053 being
   **reviewed**, not on an open decision.

### Landing-order integrity — re-verified after the fixes

Items 1–5 and 7 now depend on **no** 0053 deliverable: the incarnation is 0039's
(moved in round 7), the disposition enum is 0039's (moved here), session loss is
0039's own `delete`, and item 5 needs no quarantine, no obligation machinery, and
no epoch. The claim that the settled core can land and be proven while 0053 is
under review is **true as of this pass** — it was false twice before, both times
because a primitive drifted across the seam unnoticed.

**Also recorded:** 0039's landing order now states that 0053 is **frozen at Draft
with known-unreviewed enforcement fixes**, so item 6 is blocked — not as a
formality, but because 0053's enforcement primitives have failed review twice and
building them as written would build a fail-open mechanism.

## Round 11 — 2026-07-13 (RFC altitude; Fable's bar governing)

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md` (sha256 `1ce2a534c2b0a638114eb016ff723c988d910486086cbdf333e14016949ca961`).
**Reviewer family:** Claude (Anthropic)
**Provider / runtime:** Claude Code CLI headless (`claude -p`), `claude-fable-5`
(`claude-fable-5[1m]`), effort `max`. Fresh non-interactive session.
**Date:** 2026-07-13
**Redacted:** No — reviewed locally.
**Method:** Fresh session, blind to all archived reviews. Authorization invalidation
scoped OUT (LLP 0053's); the 0039/0053 seam IN scope. Judged at the author-ratified
RFC altitude, with instructions to flag anything **mis-deferred**.

### Review body (verbatim)

## Overall assessment

This is a strong document, and the split that produced it worked. The settled core — authority resolution, the one-gate matrix, staged auth-mode, the existing-surface closure, the provider state machines, connection binding with two-phase revocation, the client `AuthCoordinator`, and the replay descriptor — is coherent, fail-closed by default, and implementable at the RFC altitude the author ratified. Its most unusual property is that its claims about the shipped system are *true*: I verified the load-bearing code claims independently (the Cloudflare coordinator's hardcoded empty auth and fail-open metadata validator, the tokenless-on-loopback direct runner accepting forged body auth, the console's `localStorage` token at `location.origin`, the `#[serde(default)]` presence erasure, the duplicate-settlement-only fingerprint check, the status mapper's 400 fall-through, `authRequirement`'s absent runtime consumer, the enqueue-under-write-lock fan-out, the manifest-open `?` propagation that the relocate-and-poison backstop exploits, the sibling-field ephemeral key resolver) and every one checks out, along with eleven of twelve cross-LLP citations at the level of exact quotes. The seam to LLP 0053 is drawn correctly: the four stated invariants are all things 0053 actually promises, the incarnation and disposition-enum ownership moves genuinely restore landing independence for items 1–5 and 7, and session-loss-deletes is symmetric in both documents. What keeps it one pass short of ready is a small set of medium-grade defects — an unnamed residual of the document's own XSS threat model, an under-specified dev-mode descriptor decision with regression potential, and stale descriptions of 0053's contents that violate the document's own names-nothing rule — all fixable by editing, none requiring redesign. That matches the document's own §Status, which already calls for one more conclusive pass.

## Strengths

- **Verified factual base.** The document's premise-level claims about shipped code are correct in detail, including the ones easiest to get wrong: the round-10 catch that the ephemeral key resolver prefers caller-supplied sibling `session_id`/`user_id` fields over the auth context (`src/ephemeral.rs:2289-2301`) is real, and the §Summary correction that Cloudflare's `validateDeploymentMetadata` iterates expected keys and fails open on unknown metadata (`cloudflare/src/coordinator.js:279-300`) is exactly right where the earlier version-bump claim was wrong.
- **The three-surface closure (§Existing surfaces under sessions).** Naming the direct function runner as the third and worst bypass (forged-identity auth-filtered queries, tokenless on loopback — confirmed at `src/admin.rs:854-894`), evaluating the `/app/ensure` privilege gate against `(requested, active, desired)` so the activation itself cannot be the hole, and making the response-sensitivity audit a prerequisite (receipts `correlation`, inspect diagnostics) shows the right adversarial instinct: sessions are worthless while any of these stands open.
- **Cold-start bundle provenance (§Existing surfaces).** The pinned-hash-at-stage / verify-at-consume design closes a genuinely subtle attack — an attacker-resident bundle installed through still-Public dev-mode ensure surviving into the session trust domain — that "persist the loaded bundle" would have opened. The code facts it rests on (functions are process-memory only; no boot artifact validation) are verified.
- **The impersonation capability (§Built-in first provider).** Separating *route* gating from *effect* gating, and refusing to let the browser-held admin token mint sessions — including through the pre-existing host-ops `--as-user` door, not just the new surfaces — is the document's best security decision, and the escalation analysis it rests on (console token in `localStorage` on the server origin) is code-verified.
- **The downgrade backstop (§Summary, gate 2-local).** Relocate-the-manifest-and-poison-the-legacy-key is clever and *feasible as claimed*: `Storage::open` does `load_schema_manifest()?.unwrap_or_default()` (`src/storage.rs:238`), so a poisoned key fails closed while a missing key would fall open to defaults — the design chose present-but-unparseable for exactly the right reason. The honesty that neither this nor the Cloudflare one-artifact argument generalizes to a must-understand mechanism is the correct scoping.
- **Two-phase revocation (§Session transport).** Lock-order-aware (the drain-side effect boundary correction is grounded in verified code structure: fan-out enqueues inside `with_snapback`, drains go through `EphemeralApi` without the global mutex), fencing identities with compare-and-unmark and unique operation tokens, and the honest "non-delivery, not non-computation" framing. LLP 0031's small-lock pin and the 0026-owned/0032-labeled L9 bounds are cited accurately.
- **Verify-and-consume in one transaction (§Built-in first provider).** Correctly re-scopes 0011's outside-the-lock pin to Argon2 (confirmed in 0011 §Authentication Model) and deletes a self-inflicted race rather than engineering around it.
- **The seam (§Permission dependencies).** Outcomes-only, mechanism-free, and each stated invariant is one 0053 actually promises (no-regression acceptance; obligation-backed removals; the disposition split with 0039 owning the enum and coordinator; retained reads disabled until the primitive and stored pair land). The incarnation move — with matching regeneration events and restart-persistence pins on both sides — is what makes "items 1–5 and 7 depend on no 0053 deliverable" true rather than aspirational.
- **Landing order and the activation gate (§Landing order).** The gate ("sessions not enableable until 1–5") kills the looks-authenticated-but-unfenced intermediate state, and the honest treatment of 0053's FROZEN status — including "building it as currently written would be building a fail-open mechanism" — is exactly what an umbrella owes its program.
- **Named residuals throughout.** The undeclared-restore exposure, the refresh-family takeover with partial mitigations, the throttle degeneracy on loopback, the offline-capability cost of adopting sessions, and the unowned deployment-security/XSS contracts are all stated instead of implied. The 0045 handoff constraint (auth codes must never enter durable intents) correctly identifies a gap in 0045's current migrate-onto-the-durable-outbox framing and pins the obligation on the amendment.

## Concerns

1. **MEDIUM — security-posture honesty.** The document's own threat model — app-origin XSS reads the console's `localStorage` admin token — defeats the *read* half of the existing-surface closure, and unlike the *mint* half this residual is never named. §Existing surfaces moves raw rows (and, via the response-sensitivity audit, receipts and diagnostics) to `AdminSecretRead`, which is precisely the class the stolen console token satisfies; §Built-in first provider says the token remains a "read/administer credential." So in the same-origin topology §Summary blesses, the attacker the impersonation capability was built to stop can still dump every private table of every user — comparable in confidentiality impact to the escalation the document calls its "worst security error," but treated asymmetrically: minting is re-gated, bulk reading is not mentioned. It cannot be fully engineered away (the token *is* the read capability), which is exactly why it must be named. *Resolves with:* a named residual beside the bearer-custody trade in §Summary or §Existing surfaces, plus a custody line in the planned 0017 amendment (e.g., under sessions the console credential should not be persisted on an origin that serves app content, or a derived short-lived console credential) — or an explicit ratification that stolen-token bulk read is accepted in that topology.

2. **MEDIUM — under-specified decision with regression potential.** §Replay parity mints the `authorityInstanceId` "per-boot in dev mode," but the enforcement clause is qualified "Under sessions," leaving dev-mode semantics unpinned. If the kit's queue axis strands on any instance-id change, every dev-server restart — the most common event in development — strands the queued-mutation flow LLP 0043's M1/M2 shipped (ENG-23965: reload persistence, ordered replay, exactly-once settlement survive restarts today, since the shipped fingerprint is derived from client-asserted auth). If instead the descriptor is ignored in dev, the per-boot mint is decorative and the text misleads. Per-boot also conflates ordinary restart with reset — the exact conflation the document's own incarnation design rejects ("an ordinary restart must not force every retained subscription to resnapshot"). *Resolves with:* pinning dev-mode behavior explicitly — most consistently, keying the dev queue axis to the incarnation (per-reset, restart-stable) rather than the boot — or stating and justifying the strand-on-restart choice.

3. **MEDIUM — internal self-contradiction at the seam.** §Permission dependencies pins that this document "names 0053's outcomes, never its internals" because copied vocabulary "went stale — as it did." Yet §Non-goals asserts, present tense, that "the dependency classification model … [and] `resync_required` dispositions … are LLP 0053's" — two mechanisms 0053 explicitly *rejected* (classification as its primitive; `resync_required`-per-write as its first failed attempt; its current design is the event universe plus obligations). §Status likewise says 0053 "carries the unreviewed four-class model as its first agenda item," which is stale twice over: 0053 abandoned the four-class model in its round 1 and is now FROZEN on two unreviewed *enforcement* fixes (0053 §Status). Landing item 6's description is current, so the document disagrees with itself about what its sibling contains; a reader routed by §Summary/§Non-goals will look for a classification model in 0053 and find a document that repudiates it. *Resolves with:* rewording the three passages to current outcome vocabulary (event universe, obligations, dispositions, lease) or explicitly historical framing ("what moved at the split"), and updating §Status's agenda sentence to 0053's actual frozen state.

4. **LOW — factual imprecision about shipped code.** §Authority resolution says resume, unsubscribe, and supersede-on-resubscribe "all share this tuple," presenting the `is_some()` short-circuit guard as common to all three. Resume (`src/local.rs:1780-1792`) and unsubscribe (`src/local.rs:1706-1718`) do share it; supersede (`src/local.rs:1601-1608`) uses a different gate — positive `same_owner` equality *and* `same_connection` — so its cross-connection protection does not collapse when stored owners are empty. The pinned replacement predicate is right regardless; only the characterization overreaches. *Resolves with:* correcting the parenthetical to scope the short-circuit claim to resume/unsubscribe and describing supersede's actual gate.

5. **LOW — diagnostics-table completeness.** `SNAPBACK_AUTH_MODE_DEV` (route-table note) is absent from the diagnostics table — no HTTP status, no retry guidance — though the table purports to enumerate the family being 0012-registered. `SNAPBACK_AUTH_MODE_PENDING` is listed under "Startup/load-time" but is described as a *request-path* refusal ("app-data refused while `desired != active`"), so it needs an HTTP mapping and a table row; the shipped mapper (verified) would otherwise emit it as a bare 400. *Resolves with:* rows for both codes with status and retry guidance.

6. **LOW — staged-transition ambiguity.** "Consume failure … boots in the still-active mode with `desired` quarantined" sits unreconciled against "while `desired != active`, the server refuses app-data." If quarantine clears the refusal, a scripted stage-and-restart that hits the (pre-checked, rare) consume failure silently *serves under the old mode* — for dev→sessions, continuing client-asserted authority when the operator staged enforcement, with only a startup diagnostic. If it does not clear it, "boots in the still-active mode" is misleading because app-data stays down. *Resolves with:* one sentence pinning quarantined-desired's effect on app-data availability, and surfacing the quarantined state through the handshake's `modeState` so scripts can detect it (the mechanism already exists).

7. **LOW — acceptance gap on the downgrade backstop.** The relocate-and-poison mechanism has no acceptance row (§Acceptance covers deploy-tooling refusal and manifest-load refusal, not the poisoned-legacy-key fail-closed open), and `--allow-auth-downgrade`'s effect on the relocated/poisoned key is unspecified — is a downgraded database re-openable by pre-slice binaries, and should it be? *Resolves with:* a fixture acceptance row (legacy-shaped parse of the poisoned key fails closed; capability-aware open succeeds) and a sentence pinning the downgrade path's key handling.

8. **LOW — transition-matrix tension.** The anonymous→authenticated row's rationale, "no wipe (no prior user's data)," conflicts with the two-axis store rule ("a different user wipes them") given that anonymous is elsewhere a first-class principal scope with its own descriptor. Harmless for confidentiality (anonymous-visible is world-visible), but once item 8 lands, anonymous retained slices exist and the two rules disagree. *Resolves with:* tightening the row's rationale and stating whether anonymous→authenticated is a principal-scope change for the retained axis, deferring the item-8 behavior explicitly if needed.

## Suggestions

- **Pin protocol obligation 7's carrier now.** It is the one §Protocol obligations item that is a bounded *design choice* rather than a specification task. Both named options preserve the invariant, so the deferral is not unsafe — but 0024's HTTP host-ops projection already ships admin-token-gated, so "CLI-only" would orphan a live surface; the per-boot HKDF-derived secret is the evident answer. Deciding it here costs a sentence.
- **State where the drain's comparison generation comes from.** The lock-order story only closes if the fan-out never reads the projection inside the write lane; the natural mechanism (stamp payloads with the generation recorded in the subscription's bound grant at subscribe time) is derivable but unstated. One sentence saves every implementer the derivation.
- **Consolidate scattered acceptance pins into §Acceptance** — the bundle-hash non-executability proof, the admin-token-only mailbox/mint negative, and the response-sensitivity hostile-origin sentinels currently live only in design-section prose, and §Acceptance is what an implementer will run against.
- **Name the response-sensitivity audit in landing item 2.** It is "a prerequisite of sessions becoming enableable" but appears in no landing item; item 2 is its home.
- **A conservative default for the undeclared-restore residual:** keep a per-instance anchor *outside* the backup unit but on the same host (e.g. `~/.snapback/instance-anchors/<instanceId>` recording the last boot/incarnation id), and fail toward declared-restore semantics whenever the marker is missing or behind. A first-ever boot has no sessions to resurrect, so missing-marker⇒restore-procedure is harmless; a legitimately migrated instance directory pays one forced re-login. This converts the open question into a shippable default without claiming the in-directory anchor the document correctly proves impossible.
- **Mirror the throttle-honesty note for connection-open caps.** The per-source open cap degenerates to a global bucket on loopback exactly as the request-code throttle does; §Session transport should say so once.
- **Direct the 0045 amendment explicitly at the payload seam.** 0045 currently records the handoff as "migrates onto this [durable] outbox" with no ephemeral-payload class; 0039's constraint is the stronger and correct one, so the companion obligation should say the amendment must land the seam, not just the pointer.

## Open questions

- Who owns console-credential custody under sessions (concern 1) — should the 0017 amendment forbid persisting the admin token on an origin that serves app content, or introduce a derived, short-lived console credential?
- What are the dev-mode descriptor semantics (concern 2) — is the queue axis keyed to the incarnation or the boot in dev, and is the descriptor predicate enforced there at all?
- At item 6, how do the coordinator's two fence keys compose — this document's local authority epoch and 0053's per-query fences (commit-version-witnessed after its round-4 fix)? Is "item 6 is purely additive" still true once fences must persist atomically with each durable client write, or does the barrier contract need a second key from day one?
- Should the registry's response-sensitivity axis be CI-enforced like the path-class invariant (a new tokenless route without a sensitivity classification fails the build), so the audit's conclusion stays true after item 2 rather than decaying route by route?
- Of the document's own open questions, the DPoP/sender-binding trajectory deserves priority: it is the one mechanism that simultaneously addresses the refresh-takeover ambiguity, the bearer-custody XSS residual, and (by devaluing stolen tokens) part of concern 1.

## Readiness verdict

Verdict: NOT READY

The architecture is sound, the seam to LLP 0053 is correctly drawn, the factual base is verified, and nothing here requires reopening a settled contract — but three medium concerns are material and unresolved in the current text: an unnamed residual of the document's own XSS threat model (stolen console token ⇒ bulk read of everything the closure protects), an under-specified dev-mode descriptor decision that plausibly regresses LLP 0043's shipped queued-replay flow, and present-tense descriptions of 0053's contents that contradict both 0053 and this document's own names-nothing rule. All three are editing-scale fixes — a named residual plus a custody line, a pinned dev-mode semantic, and three reworded passages — so one more revision pass, exactly the "further pass … before it moves past Draft" the document's own §Status already calls for, should carry it to READY.

### Orchestrator verification notes — round 11 (outside the verbatim body)

Zero HIGH; 3 MEDIUM, 5 LOW. All applied. The MEDIUMs: (1) the **read half** of the
document's own XSS threat model was never named — minting was re-gated off the
console token while *bulk reading* every private table with that same stolen token
went unmentioned, an asymmetry the reviewer rightly called out; (2) the dev-mode
`authorityInstanceId` was per-boot, which would strand queued mutations on every
`cargo run` and regress LLP 0043's shipped M1/M2 flow — re-keyed to the incarnation
(per-reset, restart-stable); (3) three passages still described 0053's **rejected**
mechanisms in the present tense, violating this document's own names-nothing rule.

## Round 12 — 2026-07-13 (RFC altitude; Fable's bar governing)

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md` (sha256 `8124b9611365f4dcde55a6c5774d87e760c83b10ab54985b11fb80e0d0f4d13c`).
**Reviewer family:** Claude (Anthropic)
**Provider / runtime:** Claude Code CLI headless (`claude -p`), `claude-fable-5`
(`claude-fable-5[1m]`), effort `max`. Fresh non-interactive session.
**Date:** 2026-07-13
**Redacted:** No — reviewed locally.
**Method:** Fresh session, blind to all archived reviews. Authorization invalidation
scoped OUT (LLP 0053's); the 0039/0053 seam IN scope. Judged at the author-ratified
RFC altitude, with instructions to flag anything **mis-deferred**.

**Author's freeze decision (Charlie, 2026-07-13):** the loop stops here.

### Review body (verbatim)

All seven verification agents have reported. The final two settled the load-bearing questions: the persistence agent **verified the relocate-and-poison premise** (a corrupt manifest at the legacy key fails closed via `SNAPBACK_SCHEMA_PARSE_FAILED` and `?` propagation at `src/storage.rs:227-243,1368-1390`, while a *missing* key boots fresh — confirming poisoning, not mere relocation, is essential and the design got this right), and the LLP-citation agent surfaced three citation-precision nits (0043 "M1/M2 shipped" is a first slice; 0051's prose is not stale as characterized; 0045 seam is future work as 0039 states). Combined with the earlier finding that the "public inspect projection" is actually `Public` (not `AdminRead`), I now have everything verified. Composing the review.

## Overall assessment

This is a strong proposal, and the plan is good. The slice is correctly chosen (server-resolved authority through one gate, one real provider, bearer-only transport, connection binding, a client clearing coordinator, and — critically — closure of the three shipped surfaces that would otherwise make sessions decorative), the fail-closed discipline is applied consistently, and the residuals the design cannot close are named rather than papered over. The document's most distinctive quality is that its claims about the shipped system are almost entirely true: I independently verified roughly fifty code-level assertions (route policies, the loopback-tokenless `AdminRead` gate, the localhost CORS echo, the `Public` `/app/ensure` that loads executable bundles gated only on `!Prod`, the direct runner accepting body `HandlerInput.auth` tokenless for queries, the ownership-guard short-circuit quoted verbatim from `src/local.rs:1706-1718`/`1780-1792`, the ephemeral sibling-field key resolver, deltas enqueued inside the write lock versus the lock-free drain, the Cloudflare coordinator's hardcoded empty auth and fail-open metadata validator, the un-transacted constructor DDL, the status mapper with no `AUTH_*` mappings, the unconsumed hardcoded `authRequirement`, the console's `localStorage` admin token) and found exactly one factual error (Concern 1). The two hardest new contracts survive scrutiny: the corrected must-understand section is now actually true against the code — including the subtle part, since the one runtime channel that accepts bundle-shaped payloads on Cloudflare (`kitEnsureApp`) only hash-compares against the compiled-in artifact and can never adopt a foreign bundle — and the relocate-and-poison backstop's load-bearing premise is verified: a present-but-unparseable manifest at the legacy key fails the open via `?` propagation (`src/storage.rs:227-243`, `1368-1390`), while a merely *missing* key would boot fresh, which is exactly why the design poisons rather than only relocates.

The split is well executed and the seam is correctly drawn. I checked each of §Permission dependencies' four invariants against LLP 0053's actual text: all four are things 0053 genuinely promises (no-regression on ordinary writes; durable fail-closed removals; the disposition ladder with 0039 owning the enum and the coordinator; retained reads disabled until the primitive and stored pair land). Both ownership moves — the incarnation and the disposition enum — are reflected verbatim on 0053's side ("The incarnation is LLP 0039's, and this document consumes it"), session-loss-deletes matches 0053's "not on this list, deliberately so" carve-out, and the frozen-at-Draft characterization of item 6 matches 0053 §Status exactly. The landing-independence claim for items 1–5 and 7 holds against both texts.

Nothing here is wrongheaded. The decisions most likely to attract that charge — bearer-only transport, temporarily trading away shipped offline reads, session-loss-deletes as 0039's own conservative default, the poison-sentinel downgrade backstop — are each argued from a named attack and honestly costed. What keeps the document from READY is smaller: one factual error about shipped code, an internally contradictory recovery procedure, two places where the document's own honesty standard isn't met (the same-origin console residual is named but never discharged; the LAN-proxy workaround quietly re-opens what the dev fence's stated rationale forbids), and a residue of split/round-10 debris (a dangling section reference, an item-ownership conflict, a table/prose contradiction). All are fixable in one pass, which is also what §Status itself predicts.

## Strengths

- **Verified factual grounding.** The document's line-by-line verification claim (§Status) essentially holds. Notable confirmations: the three "sessions are decorative" surfaces are exactly as described (§Existing surfaces — `src/admin.rs:558-559` tokenless loopback reads, `src/server.rs:1582-1597` CORS echo, `src/local.rs:1068-1141` Public ensure loading bundles, `src/admin.rs:854-894` the direct runner); the live ownership short-circuit and the supersede gate's different shape (§Authority resolution) match `src/local.rs:1706-1718`, `1604-1608` byte for byte; the round-10 ephemeral catch (resolver prefers sibling `session_id`/`user_id` wire fields, `src/ephemeral.rs:2289-2360`) is real.
- **The must-understand section (§Target scope) is now correct, including its own self-correction.** The Cloudflare validator does iterate only expected keys and fails open on unknown metadata (`coordinator.js:279-300`); the app and coordinator genuinely ship as one artifact (`wrangler.jsonc` alias, `deploy.sh:116`); and the local relocate-and-poison mechanism exploits a verified asymmetry in today's open path (corrupt → refuse, missing → fresh boot). Correcting one's own earlier version-bump overclaim and replacing it with a mechanism that binds *today's* binaries is the strongest kind of revision.
- **The privilege-escalation catch and its follow-through (§Built-in first provider).** The admin-token-is-not-an-impersonation-credential analysis is grounded in the real console (`packages/snapback-admin-client/index.mjs:13,24-25` persists the token in `localStorage`; `admin-ui/main.ts:23-24` calls `location.origin`), is extended to the pre-existing `--as-user` door (verified admin-token-gated today, `src/server.rs:1872`), and — rarest of all — is followed by an honest accounting of the read half it cannot close.
- **The two-phase revocation redesign respects the shipped concurrency contract.** Its premises verify: deltas are produced and enqueued inside the write lock (`src/local.rs:3453-3536`), the drain is lock-free through `EphemeralApi` (`src/ephemeral.rs:1731-1734`), and LLP 0031's small-lock pin and 0026's L9 family say exactly what the document claims. Moving the effect boundary to the drain rather than violating the lock order is the right call, and "non-delivery, not non-computation" is honest scoping.
- **The seam (§Permission dependencies) is disciplined.** Outcomes only, mechanisms unnamed, with the two ownership moves that keep items 1–5/7 free of 0053 deliverables — and both moves are mirrored in 0053's text, so the landing-independence claim is real rather than asserted.
- **The rejection-needs-replacement-predicate rule** (§Authority resolution) and its two applications (live ownership, ephemeral key modes) show the document catching its own class of bug twice; both underlying code facts verify.
- **The verify-and-consume correction** (§Built-in first provider) reads LLP 0011 correctly — the outside-the-lock pin really is about Argon2 (0011 §Authentication Model), so retracting the self-inflicted race is right.
- **Acceptance quality** (§Acceptance): hostile-origin proofs, generated interleavings over both state machines, byte-for-byte-unchanged refusal targets, L9 bounds held during revocation commits, and the woken-tab cases. The registry-metadata-driven sweep (§Authority resolution) is the right structural antidote to missed entry paths.
- **§Protocol obligations deferred to implementation** is a genuinely useful artifact: the deferrals I examined are specification gaps, not disguised design holes, and recording them as dischargeable obligations keeps the RFC-altitude ratification honest.

## Concerns

1. **MEDIUM — correctness (factual error about shipped code): the "public inspect projection" is `Public`, not `AdminRead`.** §Existing surfaces says receipts and "the public inspect projection [carrying] `recentDiagnostics` … Both surfaces are `AdminRead`, i.e. tokenless on loopback under the same CORS echo." Receipts are `AdminRead` (`src/server.rs:683`), but `PublicInspect` — which carries `recentDiagnostics` (`src/local.rs:196-224`, populated at `:294`, fed by `fail_subscription_fanout` at `src/local.rs:3579-3594`) — is served on the **`Public`** routes `/inspect` and `/` (`src/server.rs:640,642`), tokenless on *any* bind, not merely loopback. The error understates the exposure the response-sensitivity audit must close, and would mis-slot these routes in the item-1 existing-route × mode matrix. *Resolves with:* correcting the classification; explicitly slotting `/inspect` and `/` (and their `recentDiagnostics`/diagnostic-detail content) into the response-sensitivity audit and the 0031-revision matrix; adding an anonymous/hostile-origin sentinel for `recentDiagnostics` under sessions to §Acceptance.

2. **MEDIUM — coherence: the catalog-collision recovery contradicts the reservation it coexists with, and may be unexecutable as written.** §Protected identity core pins that after this slice, an app schema declaring `_auth_users` "is a load-time error at both" codegen and storage — unconditionally. The recovery paragraph then says the rename-and-copy happens in dev mode "(before the reservation gate applies to this database)," implying a per-database gate the reservation paragraph doesn't define. The copy step needs a manifest state that simultaneously declares `_auth_users` (to read the rows via an ordinary mutation) and its successor (to write them); if every post-slice schema application and codegen run rejects `_auth_*` outright, that state is unreachable — schema application is additive with per-name validation on apply (`src/storage.rs:1637`), dropped tables keep physical rows but become unaddressable, and codegen has no database-state input to condition on. The claim "the recovery is executable with machinery that exists" is not demonstrated by the current text. *Resolves with:* pinning exactly when and where the reservation binds (e.g. storage errors only at stage/consume time or on databases with an auth catalog, codegen warns rather than errors, or the copy is provided by a host-ops verb instead of an app mutation), such that the sanctioned recovery is executable step-by-step; the existing end-to-end acceptance row then proves it.

3. **MEDIUM — safety/decision-quality: the console read-token residual is named but never discharged, and it collides with the blessed topology.** The read-half residual (§Built-in first provider) correctly concludes that an app-origin XSS stealing the console's `localStorage` token can bulk-read every private table once raw rows move to `AdminSecretRead` (the route table's credential for `/_snapback/api/data/{table}` is that same admin token), and says operators "must not serve the console and the app from one origin under sessions" until a 0017 amendment lands. But the shipped server always serves console and app from one origin (`src/cli.rs:563`; `admin-ui/main.ts:23-24`), §Summary blesses admin-onboarded same-origin deployments as in-scope, and no landing item or acceptance row makes the console stop persisting the token or makes the server surface the hazard. As written, the mitigation for something the document itself rates "comparable in confidentiality impact to … its worst security error" is a sentence of operator guidance. *Resolves with:* making the console-credential change (non-persistence / short-lived derived token / separate admin origin) an explicit deliverable of item 2 or a condition of the activation gate, with an acceptance row (e.g. under sessions, no `AdminSecretRead`-satisfying credential is persisted in origin-readable storage on an app-serving origin) — or an explicit, dated acceptance of the residual plus an enforced startup diagnostic when sessions and a persisted console token coexist.

4. **MEDIUM — honesty of the dev fence's rationale: the recommended LAN workaround re-opens what the fence exists to prevent, and misstates 0030's posture.** The mode table (§Authority resolution) justifies the new loopback fence with "any non-loopback opt-in re-exposes client-asserted auth to the LAN, which is why the fence exists," and in the same cell offers LLP 0030's proxy as how "LAN/phone development keeps working." But the proxy forwards the app-data surface — client-asserted body auth included — so a LAN-bound Vite re-exposes dev impersonation to the LAN just as directly; 0030 itself never blesses a LAN/phone posture and instead warns that a non-loopback Vite "can still expose the read surface and the token-gated lane to the network" behind an explicit opt-in (0030 §Security posture). The document already names the exactly analogous residual for sessions (a reverse proxy in front of a loopback bind, §Summary); the dev-mode analogue is missing. *Resolves with:* naming the residual in the cell (the proxy path re-exposes client-asserted auth; the fence protects un-proxied defaults, not proxied opt-ins) and aligning the 0030 citation with 0030's actual opt-in-plus-warning posture.

5. **LOW — an unnamed enforcement window between items 5 and 7.** Sessions become enableable at item 5, but the descriptor-required predicate lands at item 7 — and under sessions the shipped replay-authority guard is inert in the interim: body auth is rejected, so the retained FNV-1a fingerprint (`src/storage.rs:302-309`) is computed over an empty tuple and never mismatches, and there is no first-delivery guard at all. Queue-authority consistency in that window rests entirely on the item-5 client barrier. Since the descriptor is a consistency input rather than authentication, this is a consistency gap, not a security hole — but the activation-gate paragraph argues carefully about why items 1–4 alone are unsafe and then goes silent about 5-without-7. *Resolves with:* a sentence naming the window and its accepted client-only enforcement (or gating sessions on item 7).

6. **LOW — split/round-10 debris (internal contradictions).** (a) The diagnostics table pins `SNAPBACK_AUTH_MODE_DEV` at HTTP **404** while the route-table prose says these routes "return a typed refusal … **not a 404**." (b) The `app.reset` → `ConnectionRegistry` wiring is "owned by landing item 4" in §Protected identity core but owned by item 5 in §Session transport and §Landing order. (c) §Authority transitions' retained-scope caveat cites "(§Durable clearing)" — no such section exists post-split. (d) The `auth.mintSession` parenthetical in §Authority resolution says "(dev/test/demo only, **admin token**, …)" two sentences after pinning that all impersonation requires the `ImpersonationCapability`; the route table's "in addition to AdminWrite" formulation is the correct one. (e) §Protocol obligations item 1 lists "outbox **enqueue** and drain" among sinks needing a check atomic-with-the-act, while the design section pins the **drain, not the enqueue** as the effect boundary for lock-order reasons. (f) The mailbox route-table Policy cell puts the effect capability where a route policy belongs, against the document's own route-gates-vs-effect-gates distinction. *Resolves with:* one editorial pass; none of these changes a decision.

7. **LOW — seam polish against LLP 0053.** (a) The retained-scope caveat (§Authority transitions) presents the `userId`-only retainability restriction as an open decision "belong[ing] with the `authorizedUntil` decision," but 0053 §Retained and offline authorization already pins "Retainable ⇒ `userId`-only authority dependence." (b) Item 8's parenthetical names 0053 internals (`authorizedUntil`, the 24-hour default) despite this document's own names-outcomes-only rule — and 0053's open question 4 still flags the number as unowned, so "no longer gated on an open decision" slightly overstates. (c) 0053 pins that "the minimum client capability is part of the handshake LLP 0039 defines" (clients that ignore dispositions must not enable session-mode retained reads); 0039's handshake enumeration (§Auth mode) reports retained-read availability but does not carry that gating duty. None of these breaks the seam; each is one alignment sentence. *Resolves with:* adopting or explicitly deferring each, so the later cross-document pass finds nothing.

8. **LOW — citation precision, judged by the document's own "exact provenance, not a stretched citation" bar.** (a) "An LLP 0031 D3-style sentinel test" (§Diagnostics): 0031's D3 is the inspect-trim *decision*; the sentinel is the ENG-23441 field-level source-sentinel asserting gated-vs-public payload separation — not a secrets-in-logs test. (b) "LLP 0043 (whose M1/M2 has shipped)": 0043 records a *first closed-IR single-query slice* of M1/M2 (ENG-23965) at status Draft; the behaviors 0039 relies on (retained stale boot, queued replay) did ship, but "M1/M2 has shipped" overstates. (c) "0051's prose still says resolved auth is replayed from the ledger": 0051 D1 pins that channel server-retained and never wire-crossing; the *real* reconciliation the 0051 amendment must do is substantive and worth stating — 0051 pins frozen-identity-re-supplied-at-replay ("what freezes is the identity the handler observed") while 0039 pins refuse-on-descriptor-mismatch under current authority, which are different replay semantics. *Resolves with:* tightened citations; every underlying obligation stands.

9. **LOW — the downgrade backstop has no acceptance row.** The relocate-and-poison mechanism is verified sound against today's code (corrupt manifest → `SNAPBACK_SCHEMA_PARSE_FAILED` propagates and open refuses; missing → fresh boot — the asymmetry that makes poisoning, not mere relocation, load-bearing), but §Acceptance's mode block covers only gates 1 and 3 (tooling refusal; knowing-target refusal). The one mechanism that binds *existing* binaries is untested by the suite as specified, and what `--allow-auth-downgrade` does to the poisoned legacy key is unstated. *Resolves with:* an acceptance row pinning that after activation the legacy key holds a value that fails typed manifest parse, plus a pinned downgrade behavior for the key (restore it, or deliberately leave it poisoned — either is defensible; say which).

## Suggestions

- **Name the enqueue-side fencing-generation source.** The enqueued payload "carries the fencing generation it was produced under," but reading the projection inside the write lane is exactly what the lock order forbids. The connection grant already carries the bound `generation` (§Session transport) and is readable without the projection lock — saying "the grant's bound generation, captured at open" in one sentence removes the apparent contradiction now rather than leaving it for obligation 1.
- **Make the poison sentinel a valid-JSON, wrong-type, greppable string** (e.g. `"SNAPBACK_SESSIONS_MANIFEST_RELOCATED: this database requires a session-aware binary"`). Typed deserialization to the manifest struct still fails (same fail-closed path), but the pre-slice binary's `SNAPBACK_SCHEMA_PARSE_FAILED` detail then carries an actionable message instead of a JSON syntax error.
- **Default the console off the app origin under sessions** rather than relying on an operator must-not: serve the console shell on a second loopback port (a distinct origin) when `auth.mode: "sessions"`, or switch it to a per-load derived token held only in memory. This converts Concern 3's residual from guidance into structure.
- **Restore detection via an out-of-unit boot counter (novel, for the named open question).** Write a monotonic boot counter to both the database and a sibling file explicitly *excluded* from the documented backup unit. At open, database-counter < sibling-counter ⇒ the database went backwards ⇒ force the declared-restore path; sibling absent ⇒ treat as new-host first boot (declaration required). This closes the same-host undeclared-restore case — the common one — without pretending an in-unit anchor can exist, and degrades exactly to today's posture when operators copy the sibling too.
- **A quarter-DPoP on refresh only (novel-ish, for the takeover hole).** Mint a WebCrypto non-extractable keypair at login and require proof-of-possession on `/auth/refresh` alone — not on ordinary requests. The hot path stays untouched, custody complexity barely grows, and a thief holding only the exfiltrated bearer can no longer rotate the family, which converts the unreconciled-supersession hole from silent takeover into detectable reuse. It is a concrete first step along the document's own named DPoP trajectory.
- **Add the live fan-out re-query to the one-gate matrix.** It is a function invocation with a `ctx.auth` (the subscription's recorded authority) and it is the path the two-clients-different-results proof actually rides; naming its authority source prevents an implementer from re-resolving it from the connection at fan-out time.
- **Extend the naming note.** Three epoch-like terms now coexist: the client-local authority epoch (§Authority transitions), the authorization epoch ("permission epoch" in code), and the session `generation`. One disambiguating sentence will save real confusion.
- **Fix the offline-cold-boot anachronism** (§Auth mode): "renders from its stored `(incarnation, epoch)`" describes LLP 0043's *shipped* behavior, but 0043 stores authorization epochs and an auth fingerprint — the incarnation vocabulary lands at items 5/8. Describe the shipped behavior in shipped terms.
- **State the data-provenance residual of dev→sessions.** The staged transition attests the *bundle* (hash pinned, verified at consume) but nothing attests schema or rows written while `/app/ensure` was Public: sessions activation attests code, not data. One sentence in §Existing surfaces keeps the trust story honest.
- **Pin the anonymous descriptor's scope under sessions.** §Replay parity keys the dev-mode `authorityInstanceId` to the incarnation; the sessions-mode anonymous case is unstated — presumably also incarnation-keyed, and worth one line.

## Open questions

1. When exactly does the `_auth_*` reservation begin to bind for a given database, and how does codegen — which has no database-state input — participate without breaking the sanctioned rename-and-copy recovery (Concern 2)?
2. Who owns the console-credential mitigation, in which landing item does it become enforceable, and until then should a session-enabled server refuse, warn, or merely document a persisted console token on an app-serving origin (Concern 3)?
3. Should item 7 join the activation gate, or is the 5→7 client-only consistency window an accepted interim (Concern 5)?
4. What does `--allow-auth-downgrade` do to the relocated/poisoned manifest key — restore the legacy key (re-admitting pre-slice binaries to a database that still holds `_auth_*` state) or leave it poisoned (Concern 9)?
5. Does the bootstrap handshake carry the minimum-client-capability check 0053 assigns it before session-mode retained reads enable, and under which registry does that capability fact live (Concern 7c)?
6. Is the `Public` inspect projection (served at `/` and `/inspect`) meant to be trimmed or reclassified by the response-sensitivity audit, given 0031 D3 already pins an identity-descriptor direction for it (Concern 1)?

## Readiness verdict

Verdict: NOT READY

The architecture is sound, the settled core is implementable as written, the seam to LLP 0053 is correctly drawn against 0053's actual text, and the document's factual reliability is exceptional — but material items remain in scope: one verified factual error about shipped code (the `Public`, not `AdminRead`, inspect projection — Concern 1), an internally contradictory recovery procedure whose "executable with machinery that exists" claim is not demonstrated (Concern 2), a self-declared near-worst-severity residual whose mitigation is never sequenced or tested and which collides with the blessed same-origin topology (Concern 3), and a security-rationale sentence contradicted by its own recommended workaround (Concern 4). All are resolvable with one focused pass — no architectural decision needs reopening, and the remaining LOW items are debris and precision work — which matches the document's own §Status assessment that a post-split pass is warranted before it moves beyond Draft.

### Orchestrator verification notes — round 12 (FINAL — document frozen after this round)

Zero HIGH for the third consecutive round. 4 MEDIUM, 5 LOW.

**This round ended the loop, and the reason is in its own contents:** two-thirds of
its findings were defects introduced by the *previous* round's fixes. The pattern is
now measured rather than suspected — the author's revisions land ~80% and introduce
a fresh ~20% each pass, so the MEDIUM count holds at 3–4 indefinitely while the
reviewer forecasts READY every round and does not deliver it. The author stopped the
loop on that evidence.

The four MEDIUMs were applied before the freeze:

1. **A factual error about shipped code.** `PublicInspect` — which carries
   `recentDiagnostics`, fed by handler rejection messages and live fan-out failures
   — is served on the **`Public`** routes `/inspect` and `/` (`src/server.rs:640,642`),
   i.e. tokenless on **any** bind. An earlier draft called it `AdminRead`
   (tokenless on loopback), understating the exposure the response-sensitivity audit
   must close.
2. **An unfollowable mitigation.** The console read-token residual said operators
   "must not serve the console and the app from one origin under sessions" — but the
   shipped server **always** does (`src/cli.rs:563`), and §Summary blesses same-origin
   deployments. Guidance that the system cannot obey is not a mitigation. Replaced
   with a landing-item-2 deliverable: a short-lived derived token instead of a durable
   master read key in `localStorage`.
3. **The collision recovery contradicted its own reservation.** The reservation is
   absolute (no per-database exemption), which makes an app-level rename-and-copy
   *impossible* — no manifest can declare both the colliding table and its successor.
   The rescue verb now reads **below** `ctx.db` and manifest validation, which is the
   only way the recovery is executable at all.
4. **The dev fence's escape hatch re-opened what the fence prevents.** The LLP 0030
   proxy forwards app-data, so a LAN-bound Vite re-exposes client-asserted auth to the
   LAN exactly as a direct bind would. Named: the fence protects **un-proxied
   defaults, not proxied opt-ins**.

**Five LOW items remain unfixed and are carried in the document's §Status.** The four
MEDIUM fixes above were applied *after* this review and are therefore **unreviewed** —
recorded as such in §Status, because this document's history is unambiguous about
what unreviewed author fixes are worth.

**Final tally, both documents:** across ~24 reviews, every material defect in either
RFC was found by an independent reviewer. **None was found by the author.**

## Round 13 — 2026-07-13 (ENG-24593 focused gate review)

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md`, current working-tree
revision (sha256
`437a5324317f48b7b737524bcbf8d3eea2c97d5de4541e0f2ac45eede8fc28b9`).
**Reviewer family:** Claude (Anthropic)
**Provider / runtime:** Claude Code CLI 2.1.207 headless (`claude -p`), model
`claude-fable-5` (invoked as `claude-fable-5[1m]`), effort `max`; only
Read/Grep/Glob/Bash tools allowed, editing tools disallowed, and session
persistence disabled. Fresh session
`40a1335c-14fe-4ed7-88b4-f61a3c541229`, 38 turns, in worktree
`/Users/ccheever/projects/snapback-eng-24593-auth-review`.
**Date:** 2026-07-13
**Redacted:** No credentials or secret material were supplied in the brief or
returned in the review. External Claude-family review was explicitly
authorized by the user's LLP 0005 multi-model request.
**Method:** Focused ENG-24593 review of the final unreviewed fixes and five
carried residuals. This review was explicitly informed by all prior 0039
review artifacts (not blind), LLP 0053 at the seam, and direct source checks.
The reviewer was instructed to judge at the author-ratified RFC altitude and
not accept on the author's behalf.

### Review body (verbatim)

All verification is complete. Everything I need is in hand: the four unreviewed fixes checked against code and cited LLPs, all five residuals confirmed with exact locations, and one dropped codex round-8 finding re-verified against the current tree. Here is the structured review.

---

# Review: LLP 0039 — Auth vertical slice (ENG-24593 gate review)

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md` at the current worktree revision (branch `eng-24593-auth-review`, 37d25a6), 1754 lines; `llp/0053-authorization-invalidation.rfc.md` in full for the seam; all three prior artifacts (`reviews/0039-auth-vertical-slice.{claude,codex,fable}.md`, including fable rounds 10–12 and codex round 8 in full).
**Reviewer family:** Claude (Anthropic), Fable 5, independent session for the LLP 0005 loop.
**Method:** Verified the unreviewed final revision's claims directly against shipped code (`src/storage.rs`, `src/server.rs`, `src/ephemeral.rs`, `src/manifest.rs`, `cloudflare/deploy.sh`, `cloudflare/wrangler*.jsonc`, `cloudflare/src/{coordinator.js,handler-worker.js}`, `packages/snapback-harness/workerd/handler-server.mjs`, `packages/snapback-admin-client/index.mjs`) and against the cited LLPs (0011, 0017, 0030, 0031, 0043, 0051, 0053). Judged at the author-ratified RFC altitude; §Protocol obligations deferrals were respected, not re-litigated.

## Overall assessment

The frozen document is architecturally sound and the four post-round-12 MEDIUM fixes are **substantively correct where they were applied** — but two of the four propagated incompletely, leaving the document asserting things about itself that are no longer true, and one load-bearing factual claim outside the residual list is wrong against the current tree. Specifically: the PublicInspect correction and the LAN/proxy residual are accurate to the code and to 0030's exact text; the collision-rescue redesign and the console short-lived-token deliverable are right in their home sections but left stale contradicting prose elsewhere (an acceptance row that still tests the recovery the document now proves impossible; a promised acceptance negative that does not exist). Separately, gate 2's Cloudflare "one artifact" argument is factually false at this revision — the app bundle ships in *two* worker artifacts deployed sequentially, handler first — which re-opens codex round 8's concern 1 as a first-party residual the text currently attributes only to third-party forks. All five carried LOW residuals are real and closable with bounded edits; none requires reopening a settled contract. Zero HIGH. The ephemeral field-rejection pin is verified complete against the shipped wire types. The 0053 seam is drawn correctly on both sides, including the retained-scope and handshake-duty details the polish residual concerns.

## Strengths (exact sections)

- **§Existing surfaces under sessions — the PublicInspect correction is exactly right.** `/` and `/inspect` are registered `(AppData, Public)` at `src/server.rs:1367,1369`, and `/inspect` returns the full `Json<PublicInspect>` (`src/server.rs:2374`) carrying `recentDiagnostics`. The corrected text ("tokenless on **any** bind, not merely loopback, and not gated at all") is precise, and the "worse than `AdminRead`" framing is honest about the earlier draft's error.
- **§Protected identity core — the rescue-verb reconciliation is the only executable design.** The absolute reservation genuinely forecloses any manifest that declares both the colliding table and its successor; `auth.rescueCollidingTable` reading below `ctx.db` and manifest validation is the correct and only escape, and recording the withdrawn recovery as a contradiction ("An earlier draft prescribed precisely that recovery; it was unexecutable") is the document's characteristic honesty.
- **§Built-in first provider — the console read-token deliverable replaces unfollowable advice with structure.** The analysis (localStorage-persisted token at `packages/snapback-admin-client/index.mjs:24-25,114`, one origin always, `src/cli.rs`) is code-true, the short-lived derived token is the right shape, and the surviving residual ("still a read capability for its lifetime") is stated rather than hidden.
- **§Authority resolution, mode table — the LAN/proxy residual is named with an exact citation.** The quoted 0030 warning ("can still expose the read surface and the token-gated lane to the network") appears verbatim at 0030 lines 636–640, and "the fence protects un-proxied defaults, not proxied opt-ins" is the honest scope statement round 12 asked for.
- **§Ephemeral rooms — the field-rejection pin is complete against the shipped wire types.** `PublishRequest`/`DeleteRequest` carry exactly `session_id`, `user_id`, `custom_key` as identity siblings plus a *required* (non-`Option`) `auth`; `SubscribeRequest` carries only `auth` (`src/ephemeral.rs:442-471`). The pinned rejection list `{session_id, user_id, custom_key, auth}` therefore covers every identity-deciding field; `connection_id` is addressing, guarded by the shipped ConnectionAuth token. The ENG-24566 characterization is exact: `resolved_identity` requires an authenticated identity and rejects a disagreeing claim, and the RFC is right that this closes the inconsistency but not the forgery while `request.auth` is client-supplied.
- **§Replay parity — the 0051 facts check out.** `CtxAnswerLedger.auth_fingerprint` is a deserializable `Option<String>` (`src/manifest.rs:1473`), the duplicate-settlement-only check is at `src/manifest.rs:1569-1570`, and 0051's landed D1 note ("fingerprint channel stays server-side") plus its Q7 ("the ledger's wire split is no longer open — D1 pins it") support "D1 pins that split as settled and landed."
- **§Permission dependencies / the 0053 seam** — verified against 0053's current text: outcomes-only, the incarnation and disposition-enum ownership moves mirrored on 0053's side, session-loss-deletes matching 0053's deliberate carve-out, and item 6's FROZEN characterization matching 0053 §Status exactly.
- **§Status** — the five-item residual list is accurate: every item on it is real in the text, none is already fixed, and nothing on it is mis-rated upward.

## Findings

### HIGH

None.

### MEDIUM

**M1 — correctness (factual error in a load-bearing gate argument): gate 2's Cloudflare "one artifact" claim is false at this revision; the mixed-version deploy window is a first-party channel, not only a third-party-fork residual.** §Target scope gate 2 (lines 85–93) claims "a bundle and its coordinator are **one artifact**. There is therefore no channel through this repo's deploy path by which a sessions bundle can reach a session-unaware coordinator," bounding the residual to "a third-party fork vendoring a stale coordinator." Against the current tree: the app bundle is compiled into **both** workers (`cloudflare/wrangler.jsonc:18` *and* `cloudflare/wrangler.handler.jsonc:12` alias `snapback-app`; `cloudflare/src/handler-worker.js:15-16` imports it — the comment reads "the same bundle the coordinator compiled in"); `cloudflare/deploy.sh` deploys the **handler isolate first** (lines 337–339) and the gateway+coordinator **after** (lines 349–351, plus activation-lag probes of 8×5 s and a corrective-redeploy path); and the coordinator invokes the handler **by function name** with hardcoded empty auth (`coordinator.js:2363-2371`, `authJson: JSON.stringify({})`), so the executing code is the handler's own compiled-in bundle. During any deploy that ships a sessions bundle alongside the first session-aware coordinator, requests in the window execute **new (sessions) handler code under the old session-unaware coordinator's empty auth** — precisely the unscoped-empty-auth failure this section calls "worse than impersonation," through this repo's own deploy path. This is codex round 8 concern 1's second half, which the round-7-era rewrite did not absorb and rounds 9–12 verified only against the gateway config. *Why not HIGH:* the slice binds the local target; gate 1 (`scripts/cf-check-compat`, verified present) refuses shipping a sessions bundle to a target whose capability manifest lacks session support, so no exploitable path exists until Cloudflare session support is actually built — the defect is in the argument and the residual's scoping, not in a reachable deployment today. *Resolves with (bounded edits):* (a) correct the sentence — one *tree*, not one *artifact*: the bundle ships in the gateway and handler workers, deployed sequentially, handler first; (b) name the first-party deploy-window residual beside the third-party-fork one; (c) pin the closing mechanism as part of the (already-deferred) §Protocol obligations item 8 or the companion — either the sessions bundle refuses handler invocation absent a session-mode marker asserted by the invoking coordinator (gate 3's spirit applied to the invoke seam), or gate 1 must evaluate against the **currently live** target manifest so a session-aware coordinator must be fully deployed before any sessions bundle may ship.

**M2 — coherence (an unreviewed fix asserting an acceptance row that does not exist): the console-credential deliverable is not registered in landing item 2 and its promised negative is absent from §Acceptance.** §Built-in first provider (lines 751–757) pins "the console credential change is a **landing-item-2 deliverable**" and states "§Acceptance carries the negative: an app-origin script holding whatever the console persists **cannot** bulk-read `/_snapback/api/data/{table}` under sessions." Neither propagated: landing item 2 (lines 1246–1249) still reads "`/_snapback/api/data/{table}` under `AdminSecretRead`; `/app/ensure` match-only" with no console-credential deliverable (and no response-sensitivity audit, which §Existing surfaces separately makes "a prerequisite of sessions becoming enableable"), and §Acceptance's existing-surface block (lines 1394–1398) contains no such negative — its only related row says raw-row reads "succeed with the token," which is the exact pre-fix framing. A document claiming its acceptance suite tests a mitigation it rates "comparable in confidentiality impact to … its worst security error" when the suite does not is the same defect class round 12 rated MEDIUM. *Resolves with:* (a) landing item 2 parenthetical → "…(`/_snapback/api/data/{table}` under `AdminSecretRead`; `/app/ensure` match-only; **the response-sensitivity audit; the console short-lived derived token replacing the persisted `localStorage` read key**) with the LLP 0017/0034 amendments…"; (b) add to §Acceptance (existing-surface block): "under sessions, no `AdminSecretRead`-satisfying credential is persisted in origin-readable storage on an app-serving origin, and an app-origin script holding whatever the console persists cannot bulk-read `/_snapback/api/data/{table}`; a hostile-origin read of `/inspect` and `/` under sessions returns no app-derived or identity-derived content (`recentDiagnostics` sentinel)."

**M3 — coherence (the collision-rescue fix left the document prescribing its withdrawn recovery in two places).** §Protected identity core now correctly proves app-level rename-and-copy impossible and pins `auth.rescueCollidingTable` — but the dev→sessions transition bullet (line 295) still directs operators to "the sanctioned recovery (**dev-mode rename-and-copy**, §Protected identity core)," and §Acceptance (line 1434) still tests "the collision recovery (**dev-mode rename-copy** + `--drop-orphaned-auth-tables`) succeeds end to end." An implementer following either builds the recovery the document itself proves unexecutable; the acceptance row as written can never pass. *Resolves with:* line 295 → "…while the sanctioned recovery (`auth.rescueCollidingTable`, §Protected identity core) is still reachable"; line 1434 → "the collision recovery succeeds end to end on a colliding database (`auth.rescueCollidingTable` copies the foreign rows into an operator-named app table, drops the orphan, and the staged transition then consumes; `--drop-orphaned-auth-tables` remains the destructive alternative)."

### LOW

**L1 — the 5→7 enforcement window (§Status residual 1), verified real.** Sessions become enableable at item 5; the descriptor predicate lands at item 7. In the window the shipped replay-authority guard is inert under sessions: the retained fingerprint is computed from wire body auth (`auth_fingerprint(&input.auth)`, `src/storage.rs:207`, `src/manifest.rs:1598`), which session-mode ingress rejects, so every stored fingerprint is the constant empty-tuple value and never mismatches; there is no first-delivery guard at all. The activation-gate paragraph (lines 1275–1284) argues 1–4-without-5 carefully and is silent on 5-without-7. *Resolves with* one sentence after the activation gate: "Between items 5 and 7, sessions are enableable while the descriptor predicate is unenforced: body auth is rejected, so the shipped fingerprint guard compares constant empty-tuple values and never fires, and there is no first-delivery guard. Queue-authority consistency in that window rests entirely on item 5's client barrier (`compareAndClear` strands old-session queues locally). The descriptor is a consistency input, never authentication (§Replay parity), so this is an accepted consistency gap, not a security hole — named here rather than discovered."

**L2 — diagnostics/route-table debris (§Status residual 2), six concrete instances.** (a) Diagnostics table pins `SNAPBACK_AUTH_MODE_DEV` at **404** (line 1167) while route-table prose says "a typed refusal … **not a 404**" (lines 1215–1216) — reword the prose: "return a typed refusal (`SNAPBACK_AUTH_MODE_DEV`) rather than a bare route-miss 404 — an agent probing them learns why" (keeps the table's status pin; no new semantics). (b) `app.reset` → `ConnectionRegistry` wiring owned by "landing item 4" in §Protected identity core (line 549) but by item 5 in §Session transport (line 855) and §Landing order (line 1258) — change line 549 to "item 5." (c) Dangling "(§Durable clearing)" (line 928) — replace with "(§Permission dependencies)", where the disabled-until-item-8 pin lives. (d) `auth.mintSession` parenthetical says "(dev/test/demo only, **admin token**, …)" (line 343) two sentences after pinning that all impersonation requires the `ImpersonationCapability`; align with the route table: "(dev/test/demo only, `ImpersonationCapability` in addition to the route's `AdminWrite`, audit-marked `issuedBy: admin`, refused on `prod`)." (e) §Protocol obligations item 1 lists "outbox **enqueue** and drain" among atomic-with-act sinks (line 1327), contradicting the drain-not-enqueue effect boundary — drop "enqueue and," optionally noting the enqueue side carries the fencing generation per §Session transport. (f) The mailbox route-table Policy cell (line 1210) puts the effect capability where a route policy belongs, against the document's own route-gates-vs-effect-gates distinction; mirror the `mintSession` row: Policy = "`AdminSecretRead` on the route, **`ImpersonationCapability` on the effect** — the browser-held console token satisfies the route class and must still fail the read (§Built-in first provider)." Additionally, same family: (g) §Acceptance line 1480 "the bootstrap handshake precedes any retained render or connection open" contradicts §Auth mode's deliberate offline-cold-boot exemption (lines 270–278) — qualify to "precedes any **online** interaction (first connection open, auth-bearing request, or resubscribe); offline cold boot renders retained data with staleness marked per §Auth mode"; (h) `MODE_PENDING` sits under "Startup/load-time" (line 1170) though its table row pins it request-path — annotate "(request-path; also raised as the startup diagnostic on consume failure)"; (i) the §Summary closure bullet (line 33) names two bypasses where §Existing surfaces closes three — add the direct function runner; (j) the existing-route × mode matrix enumeration (line 459) says "inspect twin," which is the *gated* twin's vocabulary — name the Public `/inspect` and `/` routes explicitly now that they are the worst channel.

**L3 — retained-scope seam polish against 0053 (§Status residual 3), three instances, all verified against 0053's current text.** (a) §Authority transitions' retained-scope caveat (lines 923–932) ends "That decision belongs with the `authorizedUntil` decision, before item 8 lands" — but 0053 §Retained and offline authorization already pins "**Retainable ⇒ `userId`-only authority dependence**" as a requirement; reword: "0053 pins the first option — retainable functions declare `userId`-only dependence — and item 8 adopts it; this caveat records why the restriction exists." (b) Landing item 8's parenthetical (lines 1272–1273) names 0053 internals (`authorizedUntil`, "24-hour default") against this document's own names-outcomes rule, and "no longer gated on an open decision" slightly overstates — 0053's Open Question 4 still asks who owns the number; reword: "(0053 pins the offline-exposure bound as a required v1 mechanism with a shipped default — the default's *owner* is 0053's open question 4 — so this item is gated on 0053's review, not on an open design decision.)" (c) 0053 assigns 0039's handshake a gating duty ("an old client that ignores dispositions is not permitted to enable session-mode retained reads — the minimum client capability is part of the handshake LLP 0039 defines") that the handshake enumeration (§Auth mode) does not carry; add to the handshake bullet: "It also carries the minimum-client-capability check 0053 assigns: a client that cannot execute dispositions is not granted session-mode retained reads (operative at item 8)."

**L4 — citation precision (§Status residual 4), verified against the cited texts; one of round 12's three nits was itself overdrawn.** (a) "an LLP 0031 D3-style sentinel test" (line 1193) in the *redaction* paragraph: 0031's D3 is the public-`/inspect` trim decision, and its sentinel (ENG-23441) is a whole-payload *source*-sentinel proving gated-vs-public payload separation — a stretched provenance for a secrets-never-in-logs test; cite the technique: "an ENG-23441-style planted-sentinel assertion (LLP 0031 D3's whole-payload source sentinel, applied here to tokens, codes, and keyring values across logs, diagnostics, and public payloads)." (b) "M1/M2 has shipped" (lines 1146, 1296; also "M1/M2 already shipped," line 1114, and "M1/M2 retained-stale-boot capability," line 136): 0043 §Status says "the **first closed-IR single-query M1/M2 slice** implemented by ENG-23965" at Draft — the behaviors 0039 relies on (retained stale boot, queued replay) did ship, but the unqualified phrasing overstates; tighten each to "0043's first M1/M2 slice (ENG-23965)." (c) The 0051 sentence (lines 1143–1146) is **substantively correct as written** — I verified 0051's D1 design prose does place the resolved auth context inside the wire-supplied ledger ("captured at first execution and re-supplied on replay," lines 246–260) while its landed note pins the fingerprint channel server-side, so an internal 0051 tension exists exactly as 0039 says; round 12's characterization ("0051's prose is not stale as characterized") was the imprecise one. Optionally sharpen rather than retract: name the concrete conflict — 0051's design bullet puts the resolved-auth entry *in* the client-supplied ledger, which 0039 explicitly forbids ("never inside the client-supplied ledger"), while both refuse on mismatch with the same `AUTH_STALE_RESULT` code — so the amendment reconciles the *carrier*, not the outcome.

**L5 — the relocate-and-poison backstop has no acceptance row (§Status residual 5), and the downgrade path's key handling is unpinned.** The mechanism's premise is verified at the current revision: `Storage::open` runs `load_schema_manifest()?.unwrap_or_default()` (`src/storage.rs:344`), so a present-but-unparseable legacy key fails closed via `?` propagation while a *missing* key boots fresh — poisoning, not mere relocation, is load-bearing, exactly as designed. But §Acceptance's mode block (lines 1427–1438) covers only gates 1 and 3, and `--allow-auth-downgrade`'s effect on the relocated/poisoned key is unstated (round 12 open question 4). *Resolves with:* one acceptance row — "after sessions activation, the legacy manifest key holds a deliberately unparseable sentinel: a pre-slice-shaped open of the database fails closed at manifest parse (no bind, no serving under legacy authority), while a capability-aware binary reads the relocated key and opens; after `--allow-auth-downgrade`, the legacy key is **restored** and a pre-slice binary can open the database again" — plus one design sentence pinning that downgrade behavior with its rationale (the audit-logged override has already revoked every durable session and returned the database to dev-mode trust, so leaving the poison would be a wedge with no security payoff; restoring the key completes the downgrade). If the author prefers leave-it-poisoned, pin that instead — either is defensible; the row must say which.

## Closure checklist (five residuals → exact edits)

| # | Residual (§Status) | Exact closing edits |
|---|---|---|
| 1 | Unnamed 5→7 enforcement window | One paragraph after the activation gate (§Landing order, after line 1284) naming the window, the inert fingerprint guard, the client-barrier-only interim, and its acceptance as a consistency (not security) gap — text in **L1** |
| 2 | Diagnostics/route-table debris | Ten bounded edits, all enumerated with locations and replacement text in **L2** (a–j): the `MODE_DEV` prose reword, item-4→5 wiring, `§Durable clearing`→`§Permission dependencies`, `mintSession` parenthetical, obligation-1 sink list, mailbox Policy cell, offline-cold-boot acceptance qualifier, `MODE_PENDING` annotation, three-surface Summary bullet, matrix naming of Public `/inspect` + `/` |
| 3 | Retained-scope seam polish vs 0053 | Three alignment sentences in **L3** (a–c): caveat adopts 0053's pinned `userId`-only rule; item-8 parenthetical restated as outcome with the default-owner caveat; handshake bullet gains the minimum-client-capability duty |
| 4 | Citation precision | Edits in **L4**: ENG-23441 sentinel citation; four "M1/M2" phrasings tightened to "first M1/M2 slice (ENG-23965)"; 0051 sentence optionally sharpened (it is not wrong) to name the ledger-carrier conflict |
| 5 | Relocate-and-poison acceptance row | One acceptance row + one downgrade-key-handling pin, text in **L5**; premise already code-verified (`src/storage.rs:344`) |

Items **M2** and **M3** must land in the same pass — they are the incomplete halves of two of the four already-applied fixes, and residuals 2/5 partially overlap them (the acceptance edits should be written once, coherently).

## Open questions

1. **Gate 2 / M1:** should the Cloudflare closing mechanism be receiver-side (sessions handler refuses invocation absent a coordinator session-mode marker on `/invoke`) or sender-side (gate 1 evaluates the *live* target manifest, forcing coordinator-precedes-bundle ordering)? The receiver-side form survives operator error and forks; the sender-side form is a one-line tooling change. Pinning one belongs with §Protocol obligations item 8's constructor work.
2. **Downgrade key handling (L5):** restore-on-downgrade is recommended above; if the author instead wants downgraded databases permanently requiring session-aware binaries, the acceptance row and the `--allow-auth-downgrade` prose need the opposite pin. Either way, say which.
3. **Console token acceptance (M2):** should the negative row also assert the *server* refuses to serve the console shell with a persisted durable token under sessions (structure), or only that the console client no longer persists one (behavior)? The former is testable without the console.
4. Does the response-sensitivity audit's registry axis get CI enforcement (a new tokenless route without a sensitivity classification fails the build)? Round 11 asked this; it remains unanswered and is what keeps the audit's conclusion true after item 2.

## Recommended next step

**Apply one focused editing pass — the three MEDIUMs and the five-item checklist — then run a single confirmation review scoped to the edited passages only, and only then consider moving the status.** The loop's own measured record (author fixes land ~80% and introduce ~20% defects; both documents' history of unreviewed fixes being wrong) is borne out again here: of the four unreviewed post-round-12 fixes, two are fully correct and two left the document contradicting itself. A confirmation review is therefore warranted, but it should be narrow — the edited sections, the gate-2 rewrite, and the acceptance rows — not a thirteenth full round; the architecture, the seam, and the factual base outside gate 2 have now been independently verified three times and do not need re-reading. Status stays **Draft (FROZEN)** until then; this review does not accept the RFC, and acceptance remains the author's call under LLP 0005.


## Round 14 — 2026-07-13 (blind confirmation of corrected exact revision)

**Family:** Anthropic Claude (Fable)
**Provider/runtime:** Claude Code CLI 2.1.207 · `claude-fable-5[1m]` · max effort
**Date:** 2026-07-13
**Redacted:** no
**Method:** cli-runner — fresh non-interactive read-only confirmation; Read/Grep/Glob only; no background tasks; prior review artifacts forbidden (the reviewer disclosed that two early broad greps surfaced a few matching review-file lines before it narrowed scope, but it did not open those artifacts)
**Session:** `203f7662-c0ef-42bd-aa26-3285d62a154c`
**Reviewed SHA-256:** `6a801ed0bee048b681a69b7aff0001a69e0a11db4e2e516c767bcb6e172c650a`
**Transcript body SHA-256:** `02c5631ed686297c23eb15f90b14dd75c6352d191477e4545d66f814d0836d55`

All verification is complete. Here is my confirmation review.

---

# Blind confirmation review — LLP 0039 (`llp/0039-auth-vertical-slice.rfc.md`), ENG-24593

## Process attestation

- **Digest:** I was instructed to review the revision with SHA-256 `6a801ed0bee048b681a69b7aff0001a69e0a11db4e2e516c767bcb6e172c650a`. Bash is unavailable in this session, so I could not recompute the hash; per instructions I verified by reading the file in full instead. I read **all 1975 lines** (three sequential reads covering 1–862, 863–1422, 1423–1975), and at the end of the run re-read four widely separated sections (lines 846–861, 1004–1015, 1145–1162, 1244–1257) — all identical to the first pass. **No content change was observed during the run.**
- **Blindness:** I did not read any file under `llp/reviews/`. Caveat, stated for honesty: two early repo-wide greps returned a few matching *lines* from `llp/reviews/*` in their result listings before I narrowed scopes. I did not open those files, and every finding and strength below is evidenced from source code and non-review LLPs only.
- I made no edits and used no background tasks.

## Verified strengths (each checked against source or the governing LLP)

**The corrected Cloudflare story is now exactly right.** The coordinator hardcodes empty auth on every handler invocation (`authJson: JSON.stringify({})`, `cloudflare/src/coordinator.js:2371`); `initializeSchema()` creates `_snapback_meta` first (line 171), then validates (173), then runs `ensureCurrentSchema()`/subscription migration (194); `validateDeploymentMetadata()` iterates only the expected keys, so unknown metadata is silently ignored and the refusal it can raise is a 409 on hash mismatch (`coordinator.js:691–716`, 409 at line 808); `deploy.sh` deploys handler first, then gateway/coordinator (lines 337→349), from one tree into two Workers. Every element of §Target scope items 2–3 and protocol obligation 8 matches the tree.

**The local relocate-and-poison backstop is grounded.** `SchemaManifest` has no `deny_unknown_fields` (src/manifest.rs:78); database open deserializes the stored manifest with `?` propagation (src/storage.rs:344) and a parse failure is exactly `SNAPBACK_SCHEMA_PARSE_FAILED` (src/storage.rs:1968) — the precise code the acceptance names. A JSON-string sentinel cannot deserialize into the struct, and `create_infra()` is IF-NOT-EXISTS/additive (storage.rs:1831+), so "a pinned actual pre-slice binary … performs no logical or durable mutation" is satisfiable as written.

**The ephemeral reconciliation is exact.** `PublishRequest`/`DeleteRequest` carry `session_id`, `user_id`, `custom_key` as siblings of a *required* `auth`; `SubscribeRequest` carries `auth` only (src/ephemeral.rs:442–471). `resolved_identity` requires an authenticated identity and rejects a disagreeing claim (ephemeral.rs:3458–3480) — and the RFC's sharpest sentence here ("closes the inconsistency, **not the forgery**, because `request.auth` is itself client-supplied") is exactly correct.

**The ownership-guard analysis is a verified code fact.** The resume and unsubscribe guards short-circuit verbatim as quoted — `if (owner.principal.is_some() || owner.user_id.is_some()) && …` (src/local.rs:2220–2221, 2294–2295) — and supersede-on-resubscribe really does use positive owner equality *plus* same-connection (local.rs:2064–2072), so the RFC's replacement-predicate pin addresses a real deletion hazard.

**The three "decorative sessions" surfaces are real, as described.** `data/{table}` is `AdminRead` (server.rs:1421) with tokenless loopback reads (admin.rs:2152–2164) behind a CORS layer that echoes any localhost origin and allowlists the admin header (server.rs:2306–2340); `/app/ensure` is Public (server.rs:1374); the direct runner classifies a query as a read and accepts body `HandlerInput.auth` (admin.rs:1119–1151, comment at 1136). `PublicInspect` is served on Public `/` and `/inspect` (server.rs:1367/1369) and `PublicDiagnostic` retains only code/severity/subsystem via exhaustive destructuring (src/diagnostic.rs:35–55); receipts are `AdminRead` with verbatim correlation echo (manifest.rs:1358–1363).

**The privilege-escalation analysis is grounded.** The console persists its token in `localStorage` (packages/snapback-admin-client/index.mjs:21–31, restored at 112–118) and calls the API at `location.origin` (admin-ui/main.ts:24–29); either admin header is accepted today with bearer precedence (admin.rs:741–761). The credential non-substitutability matrix covers all four impersonation effects consistently across the design text, the route table, obligation 7, and acceptance; host-ops today carries only `user_id` (host_ops.rs:544–548), so "`--as-role` 0024-specified and unbuilt" is right, and 0024's `devUser`/`devAdminBypass`/"emit or retain" all check out (0024:238–245).

**Landing/acceptance propagation is complete.** Collision rescue is owned by item 3 and the full ephemeral closure by item 4, each with an incompleteness clause matching its acceptance paragraph; the activation gate (items 1–5) and the item-5→7 online-only window are stated consistently in §Landing order, the handshake description, and §Acceptance.

**The 0053 seam is drawn against 0053's actual text.** FROZEN Draft with unreviewed enforcement fixes and "failed review twice" (0053:758–801); classification rejected (0053:109–111) and the resync storm as failed attempt 1 (0053:94–96); the incarnation is 0039-owned and consumed as `(incarnation, epoch)` with missing-incarnation-forces-resnapshot (0053:63, 409–429); `Retainable ⇒ userId-only` exists in both documents (0053:608–611); the three moved open questions are present in 0053 §Open Questions (733–750).

**Nearly every other citation resolves exactly**: 0011 (`roles` in the minimum shape :113, Argon2 outside-the-lock :86, transactional first login :84–85, ratified resubscribe/user-switch wipe :8/:305, "largely answered" :322, `UserDeleted` :216); 0012's ignore-unknown evolution policy (:96–101); 0030's proxy warning verbatim (:639–640); 0031's small-lock pin (:515) and app-routes-trust (:93); 0034's ENG-23426 quote verbatim (:491); 0036 ("carry live keys" :444, non-secret fail-closed :85); 0038 (Part 3 ceiling ~1,050–1,280 :164; Part 4 #6 :505–518, now `ConnectionAuth` in the registry); 0043's "first closed-IR single-query M1/M2 slice" (:250–251); 0045's durable intents; 0051 D1's wire split (:288–293, "no longer open — D1 pins it" :1122) and D4; 0017 §Security Defaults; `cf-check-compat` REFUSED; the ENG-23443 0600 keyring pattern (cli.rs:550); L9 labeled "LLP 0032 L9" in code (server.rs:223); `authRequirement` hardcoded in codegen (index.mjs:1822) with no runtime consumer; the `?connection_token=` fallback (server.rs:1136–1140); reset never touching the `ConnectionRegistry` (server.rs:2643–2653); and the profile enum with loopback-default-Dev and env-selectable demo on any bind (admin.rs:88–92, 196–202).

## Findings

No HIGH findings. I found no architectural defect, no fail-open, and no contradiction in the design decisions themselves. All findings are stale statements of *what ships today* in normative sections — the exact class this confirmation pass gates on, and the class the document's own Status claims this revision closed ("0031/0043/0051 citations say exactly what landed").

### MEDIUM 1 — §Grant bounds misdescribes both LLP 0031 and the shipped registry, and attributes a quotation 0031 does not contain

**Evidence.** llp/0039 lines 849–856 claim: 0031 "accepted process-lifetime unreaped grants … with an explicit 'revisit if grants ever carry more than two small strings' — this slice triggers it. Grants gain idle expiry (anonymous), … and per-source and global open caps … `SNAPBACK_OVERLOADED` for global capacity exhaustion (the local status mapper gains its mapping …)". Against this tree: the quoted phrase appears nowhere in `llp/0031-server-route-taxonomy.spec.md` (nor anywhere in `llp/` outside reviews); 0031 instead documents an already-bounded local registry — "The local registry is fixed-cap. At pressure it first evicts grants never used …; it may retire a used grant only after its idle lease, and refuses 429 while every used grant is current" (0031:542–549). The code agrees: `admit_slot` enforces `MAX_CONNECTION_GRANTS` (16,384) with idle-TTL retirement and a typed, reachable refusal `SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED` on the open path (src/server.rs:902–928, called at 1003). And the local status mapper *already* maps `SNAPBACK_OVERLOADED` → 503 (server.rs:3566); what is true is only that nothing local *produces* it (it is minted in `cloudflare/src/platform-errors.js:44`). Finally, mapping grant-capacity exhaustion to `SNAPBACK_OVERLOADED` silently replaces the shipped emitted code `SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED` — the kind of emitted-code change the document itself treats as an LLP 0012 compatibility event two sections later.

**Resolution.** Rewrite the paragraph against the actual baseline: the local registry is already capped with pressure eviction and idle-lease retirement and a typed capacity refusal; the slice's genuinely new work is authority binding, session-deadline expiry for bound grants, per-source throttling (`AUTH_THROTTLED`), and — if `SNAPBACK_OVERLOADED` is to replace `SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED` — an explicit adopt-or-register decision under the 0012 discipline. Delete the "two small strings" quotation or date it to the 0031 revision that contained it. (Some of this drift may be from parallel sessions landing 0031/registry work; either way the frozen text is wrong against the tree it will be implemented in.)

### MEDIUM 2 — The status-mapper claim is false twice, and it hides a wire-visible status change for a shipped code

**Evidence.** llp/0039 lines 1247–1249: "the HTTP status mapper knows none of the `AUTH_*` codes today (they fall through to 400)". Against this tree: the mapper deliberately allow-lists exactly the two shipped codes — `SNAPBACK_AUTH_STALE_RESULT` and `SNAPBACK_AUTH_USER_MISSING` → 400 (src/server.rs:3585–3586) — the same two codes the immediately preceding paragraph says "already ship and are adopted"; and unknown codes do not fall through to 400 — the default is a deliberate 500 ("the default below remains a truthful 500", server.rs:3575–3578, 3700). Consequence: the RFC's diagnostics table pins `AUTH_STALE_RESULT` at **409** (line 1228) while it ships at **400** — a wire-visible status change for an existing emitted code that the document never acknowledges, even though the adjacent sentence invokes LLP 0012 compatibility discipline as the reason for *adopting* the code in the first place.

**Resolution.** State the real baseline (two shipped codes mapped at 400; unknown codes default 500), and either keep `AUTH_STALE_RESULT` at 400 or explicitly declare the 400→409 transition as part of the 0012 registration work.

### MEDIUM 3 — "What ships today, precisely" names the wrong fingerprint algorithm and misses its two-format refusal split

**Evidence.** llp/0039 lines 1149–1152: "the server computes an **FNV-1a** fingerprint over the `(principal, session_id, user_id)` wire tuple and retains it per settled client mutation; duplicate settlement under a changed retained fingerprint is refused with the shipped `SNAPBACK_AUTH_STALE_RESULT`." Against this tree: the shipped fingerprint is a domain-separated, length-delimited **SHA-256** (`sha256:` prefix; doc comment "Stable cross-language fingerprint", src/manifest.rs:1598–1612), retained at settlement (src/storage.rs:207). FNV-1a survives only as `legacy_auth_fingerprint`, "kept only as a deletion alias" (manifest.rs:1614–1638), and a mismatch against a legacy `fnv1a:` row is refused with `SNAPBACK_CLIENT_MUTATION_LEGACY_AUTH_QUARANTINED`, not `AUTH_STALE_RESULT` (storage.rs:616–629). This matters to an implementer of protocol obligation 5, whose "legacy/null-settlement migration" must handle exactly this two-format reality.

**Resolution.** Correct the sentence to the shipped SHA-256 construction, note the FNV-1a legacy alias and its distinct quarantine refusal, and let obligation 5 name both retained formats. (The design conclusion — the opaque `authorityInstanceId` — is unaffected.)

### LOW 1 — The `KeyMode::Custom` rationale describes a fail-open that ENG-24353 already closed

**Evidence.** llp/0039 lines 1008–1012 claim "an `AllowAll` collection with custom keys lets any caller overwrite or delete another caller's key — which LLP 0013 §Scope and keys already forbids (a custom key requires generated auth …)". Against this tree: custom-key entries are **connection-owned** — `KeyMode::Custom → EntryOwner::Connection` on publish and delete, with the in-code comment "another connection cannot replace/delete it even if it guesses the key" (src/ephemeral.rs:3380–3383, 3440–3441) — and current 0013 §Scope and keys says exactly that: "the local baseline treats an arbitrary custom key as connection-owned: only the connection that created it may replace or delete it (ENG-24353)" (llp/0013:155–158). The overwrite/delete hole is closed; the surviving residuals are first-writer key squatting and ownership that derives from the connection rather than durable authority.

**Resolution.** Keep the pin (reject `Custom` under sessions until key-level authorization exists — still correct), but restate its motivation on the true residuals and cite 0013's current interim rule rather than the pre-ENG-24353 state.

### Editorial nits (no design effect)

- §Protected identity core says the existing reserved-prefix checks are "codegen: table names" — codegen also validates **index** names against `_snapback` (packages/snapback-codegen/index.mjs:384 and 417); say "table and index names" so the mirrored `_auth_*` checks cover the same scope.
- In §Existing surfaces, "Both are amendments to their owning documents" follows a four-bullet list; "both" refers to the 0017/0034 amendments but reads ambiguously.
- The validator summary "compares stored `schema_hash`/`bundle_hash`" omits the third expected key, `inputs_hash` (coordinator.js:655–660) — harmless to the argument.

## Verdict

The architecture, the composition matrix, the staged activation and poison mechanics, the two-phase revocation and custody state machines, the landing order, and the 0053 seam all survived adversarial checking, and the two source-fact corrections this revision claims (hosted initialization order; `SchemaManifest` serde) are verified correct. But three MEDIUM stale-source-fact defects remain in normative "what ships today" text — one of them a quotation its cited document does not contain, two of them concealing unacknowledged emitted-code/status compatibility events — and this is precisely the defect class an exact-revision confirmation exists to gate. The fixes are bounded text corrections that reopen no design decision, after which this document should confirm cleanly.

NOT READY


## Round 15 — 2026-07-13 (final blind confirmation of the exact gate candidate)

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md` at SHA-256
`9a2be519160ff4f1d43dc3795c842140bae175519b4c08f46acd6bf55d1ad1ad`
and `llp/0012-headless-integration-contract.spec.md` at SHA-256
`a740d9da6fe4f309caf4fc18a37b237267f3ff5a54c54a7bae2e9a71e97611ec`.
**Reviewer family:** Claude
**Provider / runtime:** Claude Code 2.1.207, requested
`claude-fable-5[1m]`, effort `max`; the recorded model usage includes
`claude-fable-5` and `claude-opus-4-8`; read-only tools.
**Method:** Fresh foreground-only session, blind final confirmation. Prior
review artifacts were forbidden. The reviewer read the candidate, governing
LLPs, and source and edited nothing.
**Session id:** `CBCC39E1-4067-42D5-903E-552BD717410B`
**Review-body SHA-256:**
`4e3687975dc65748a0af9fb96d34fced49b18b6036fb66268d617940ec060fe2`
**Redacted:** no

### Review body (verbatim)

I've completed the verification. Writing up the review now — no further tool calls needed.

---

# Final adversarial confirmation — LLP 0039 + LLP 0012 (ENG-24593)

## Verdict: **READY**

The architecture remains sound and I did not reopen it. No material blocker remains. ENG-24593 can close on this exact pair. I report readiness only — I do not accept on the author's behalf.

Four findings survive, all bounded and non-blocking: one MEDIUM specification gap and three LOW precision/traceability defects. None is a safety defect, none reopens a settled contract, and each has a one-to-two-sentence resolution.

## Scope and the limitation you asked me to state precisely

I had **no Bash access in this session, so I could not recompute either SHA-256 digest.** I therefore treat the two digests in the gate request as the runner-verified identity of the files at `llp/0039-auth-vertical-slice.rfc.md` and `llp/0012-headless-integration-contract.spec.md`, and I reviewed those two files as they exist on disk in this worktree. My review is sound only under that assumption: if the runner's digest binding is wrong, this confirmation does not apply to the intended candidate. Everything else below — every source claim — I verified by reading the files directly, which needs no shell.

I read both candidates end to end, plus LLP 0053, 0011, 0031, 0030, 0036, 0043, 0051, 0009, 0017, 0024, and the implementing source in `src/manifest.rs`, `src/local.rs`, `src/storage.rs`, `src/server.rs`, `src/admin.rs`, `src/ephemeral.rs`, `src/value_expr.rs`, `packages/snapback-codegen/index.mjs`, `cloudflare/src/coordinator.js`, and `cloudflare/deploy.sh`. I read nothing under `llp/reviews/`, and I edited nothing.

## The headline correction holds against source

The load-bearing claim of this revision is that a fresh v1 sessions artifact cannot slip past a pre-auth binary through the `/app/ensure` hash shortcut. I traced it end to end and it is correct.

The hazard is real and exactly as the RFC describes it. `LocalSnapback::ensure_app` (`src/local.rs:1373-1397`) compares the posted `schemaHash`/`bundleHash` against the loaded values and returns `"matched"` **without ever calling `validate_artifact()`**. The version check lives only inside `apply_schema` (`src/local.rs:1191`) and `load_functions` (`src/local.rs:1206`) — that is, only on the provisioning path, downstream of the shortcut. So a same-content payload really can be reported `matched` before any artifact-header validation.

The fix defeats it structurally. `validate_artifact_header` (`src/manifest.rs:2070-2086`) rejects any `schemaVersion != "snapback.v0"` (`src/manifest.rs:8`) with `SNAPBACK_STALE_{SCHEMA,FUNCTION}_ARTIFACT_VERSION`. The shipped v0 emitter produces identity strings of the form `sha256:<16 hex>` (`packages/snapback-codegen/index.mjs:865-866`), which can never equal a `snapback.v1:sessions:…`-prefixed string. So on a pre-auth predecessor holding identical v0-dev content, the posted v1 hash is unequal to the loaded v0 hash, the shortcut fails, control falls into the provisioning branch, and `apply_schema`'s **first statement** is `manifest.validate_artifact()?` — before `self.db.apply_schema()` runs any DDL. The refusal therefore lands with the database byte-for-byte unchanged. `load_functions` behaves the same way: it validates the header and returns early, before `self.functions = manifest` or `advance_app_generation()` (`src/local.rs:1205-1227`).

The attack path the acceptance models is also real, not hypothetical: `EnsureAppInput` (`src/local.rs:585-593`) does not deny unknown fields, so a v1 union payload deserializes on a predecessor with `intent`/`requestedMode` silently dropped and the v1 manifests still reaching the version check.

The separate post-activation defense is independently sound. `SchemaManifest` carries no auth field and no `deny_unknown_fields` (`src/manifest.rs:78-120`), which is precisely why a new field cannot bind an old receiver — the RFC's own argument. Relocate-and-poison works because `load_schema_manifest` maps a `serde_json::from_str` failure to `SNAPBACK_SCHEMA_PARSE_FAILED` (`src/storage.rs:1954-1976`) and `LocalDatabase::open` propagates it with `?` (`src/storage.rs:344`), so a pre-slice binary refuses to open before binding a listener. A bare JSON string at the legacy key cannot deserialize into a struct, so the proposed sentinel does exactly what the document claims.

## The other focus areas

**Domain-separated identities before hash short-circuits.** Both manifests already carry `appId` and `inputsHash` (`src/manifest.rs:92-99`, `280-285`), and codegen emits the same `inputsHash` on both halves (`index.mjs:873, 886`), so 0012's pair-consistency rule is implementable against fields that exist today. The serde defaults are the trap here — `app_id` defaults to `"local-app"` and the hashes default to `None` — and 0012 anticipates it correctly by requiring non-empty `appId`/`schemaHash`/`bundleHash`/`inputsHash` for v1 explicitly rather than relying on deserialization to enforce it.

**Public non-mutating attest vs. privileged provisioning.** The `attest` DTO returns only pair identity (`schemaVersion`, `appId`, `schemaHash`, `bundleHash`, `inputsHash`), all of which are already public through `PublicSchemaManifest` on the tokenless `/` and `/inspect` routes, so the branch opens no new read channel and provides no enumeration oracle. The privilege gate evaluated against `(requested, active, desired)` mode closes the staging hole correctly — and 0012's blanket "the `provision` branch requires `AdminWrite`" is the stricter of the two statements, so an implementation following the Spec satisfies the RFC.

**Optional additive capability facts.** `supportedArtifactVersions` and `supportedAuthModes` are registered as additive optional v0 fields with "absent or empty means unsupported," mandatory emission for auth-aware targets, and an explicit prohibition on inferring them from the target profile. That is fail-closed in the direction that matters: the Cloudflare coordinator, which hardcodes `authJson: JSON.stringify({})` (`cloudflare/src/coordinator.js:2371`), reports neither fact and is therefore refused a sessions bundle by the sender-side gate. The registration composes cleanly with the existing server-declared manifest and its drift gate.

**The LLP 0053 seam.** It holds. 0053 independently confirms that the incarnation is 0039's and that 0053 merely consumes it (`llp/0053:416-424`), and confirms that session revocation is an authority transition rather than one of its authorization events (`llp/0053:313-319`) — which is exactly what makes 0039's "session loss deletes, and this document owns that decision" correct rather than a stale attribution. 0053 contains no reference to the authority descriptor at all, which independently corroborates 0039's claim that item 6 is independent of item 7. Items 1–5 and 7 depend on no 0053 deliverable.

**The five previously-low residuals** are all closed in the current text and none of the closures introduced debris: the item-5→7 window is pinned online-only with queued replay disabled and a matching acceptance row; `MODE_DEV` is a typed 404 with the handshake exemption stated consistently in all three places it appears; the six route-registry axes are listed identically in §Authority resolution and §Route table; `Retainable ⇒ userId-only` is categorical and matches 0053's own rule; and the 0031/0043/0051 provenance now distinguishes code facts from document statements correctly.

**Source-fact audit.** Every code-grounded claim I checked is accurate, including the ones a previous round found stale: the 16,384-entry grant cap and its 429 code (`src/server.rs:1105, 922, 3550`); both shipped auth codes at 400 with unknown codes defaulting to 500 (`src/server.rs:3585-3586, 3699-3700`); the tagged SHA-256 fingerprint with FNV as a deletion-only quarantined alias (`src/manifest.rs:1598-1638`, `src/storage.rs:615-629`); the live-subscription ownership guard's short-circuit on empty owners versus supersede's positive-equality-plus-same-connection gate (`src/local.rs:2220-2222, 2064-2072`); the ephemeral sibling identity fields and `resolved_identity`'s closes-the-inconsistency-not-the-forgery status (`src/ephemeral.rs:442-471, 3458-3480`); `_auth_*` being unreserved today because both checks match only `_snapback` (`index.mjs:384, 417`; `src/storage.rs:3906`); and all four Cloudflare facts — the empty auth object, the key-iterating validator that fails open on unknown metadata, the metadata-table-before-validation ordering, and handler-first-then-gateway deploy (`coordinator.js:169-197, 691-715`; `deploy.sh:337-351`).

---

## Findings

### 1. MEDIUM (non-blocking) — the `(v1, dev)` cell of the version × auth-mode matrix is undefined

**Evidence.** LLP 0012 defines identity namespaces only for v1-*sessions* (`snapback.v1:sessions:schema|function|inputs:sha256:<digest>`) and reserves the `snapback.v1:` prefix for exactly those three values. But its receiver rule says an auth-aware receiver "accepts a v0-dev pair and a v1 pair when v1 is explicitly supported," and its rejection list enumerates only "v0-sessions, mixed schema/function versions, absent required halves on first sessions deployment, and unknown versions." A v1 pair declaring `auth.mode: "dev"` is in neither list. LLP 0039's protocol obligation 3 matrix has the same shape: "v0-dev, v1-sessions, v0-sessions, mixed and unknown versions, a missing initial half, unsupported target facts, insufficient privilege, malformed/cross-variant intent, and matching-hash negatives" — no v1-dev case. And `dev` is a *supported* auth mode (`supportedAuthModes: ["dev", "sessions"]`), so the "unsupported auth modes" rejection does not catch it either.

**Failure trace.** A third-party or hand-built emitter produces `schemaVersion: "snapback.v1"` with `auth.mode: "dev"`. The auth-aware receiver runs its preflight: artifact version is in `supportedArtifactVersions` → pass. Effective mode is `dev`, which is in `supportedAuthModes` → pass. Pair versions match → pass. Nothing rejects it, so the receiver accepts a v1 artifact whose identity-string encoding the Spec never defines — the `snapback.v1:sessions:` namespace does not apply, and no `snapback.v1:dev:` namespace exists. The receiver must then compare hashes it has no canonical form for.

This is not a privilege escalation: the artifact declares `dev` explicitly, dev-mode fences still apply, and a pre-auth predecessor rejects it anyway (its check is `!= "snapback.v0"`, which catches every v1 artifact regardless of mode). The defect is an undefined cell in the exact matrix this gate exists to pin, and an implementer will hit it the moment they write the preflight.

**Bounded resolution.** One clause in LLP 0012's compatibility exception: "`snapback.v1` is reserved for sessions deployments; a v1 pair declaring `dev` mode is rejected as an unsupported version/mode pair." Add the `(v1, dev)` negative to 0039's protocol-obligation-3 matrix and to 0012's Validation Requirements list. The safe default is already implied by the reserved-prefix sentence — it just is not stated as a rule.

### 2. LOW — the predecessor no-change proof is silently conditional on the predecessor's server profile

**Evidence.** `ensure_app`'s schema branch is a three-way: `matched` / `else if provisioning_allowed { apply_schema()? }` / `else { "gated" }` (`src/local.rs:1373-1390`). `validate_artifact()` — the non-v0 refusal — is reachable **only** through the middle arm. `allows_provisioning()` is `!matches!(self, Self::Prod)` (`src/admin.rs:105-106`). LLP 0039's acceptance says a complete v1 payload "is refused by its existing non-v0 artifact check in both cases" (fresh and identical-content-provisioned) but never pins the predecessor's profile.

**Failure trace.** The acceptance suite instantiates the pinned pre-auth predecessor with `SNAPBACK_PROFILE=prod` (or on a non-loopback bind, where `resolve_profile` fails closed to `Prod`). The v1 sessions payload arrives. Hashes differ (disjoint namespaces), so the shortcut is skipped — but `provisioning_allowed` is false, so the branch falls to `"gated"`: **HTTP 200, no error, no version diagnostic, no mutation.** A test asserting "no request-attributable change" passes; a test asserting the non-v0 artifact refusal fired does not — or worse, a weakly-written test goes green while the mechanism under proof never executed. The safety property survives on both profiles (no mutation either way), so this is a proof-precision defect, not a hole.

**Bounded resolution.** One clause in 0039's acceptance: run the pinned predecessor under a provisioning-allowed profile (`dev`/`demo`/`test`, which is also the loopback default) so the refusal is the artifact-version check rather than the profile gate, and assert the emitted `SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION` code — not merely the absence of mutation.

### 3. LOW — `MODE_PENDING` versus the new `{ intent: "provision" }` branch is unspecified

**Evidence.** LLP 0039 states that during `MODE_PENDING` "app-data is refused but the **admin/host-ops schema-apply surface remains available**… (Ordinary `/app/ensure` is app-data and is refused…)", and that the operator's recovery is to "fix the schema and re-stage, or unstage explicitly." That sentence predates the intent-union split. LLP 0012 now routes staging through `/app/ensure` `{ intent: "provision" }` ("Any request that would provision or stage sessions… uses this branch"), and `/app/ensure` is registered `AppData` in the route registry (`src/server.rs:1374`). Whether the *privileged* provision branch of an app-data route is subject to the `MODE_PENDING` app-data refusal is stated nowhere.

**Failure trace.** A consume failure quarantines the desired mode; the server boots in the still-active mode with app-data refused. The operator fixes the schema and re-stages via `/app/ensure` `{ intent: "provision", requestedMode: "sessions" }` with `AdminWrite`. Implementer A treats `/app/ensure` as app-data and returns `SNAPBACK_AUTH_MODE_PENDING` — the documented recovery path is closed, and the operator must discover the host-ops schema-apply surface instead. Implementer B exempts the privileged branch and the re-stage succeeds. Both readings are defensible from the text; both are safe; they are not the same product.

**Bounded resolution.** One sentence in 0039's transition section stating whether the `AdminWrite` `provision` branch is exempt from the `MODE_PENDING` refusal, and naming explicitly which surface performs a re-stage during `MODE_PENDING`.

### 4. LOW — 0039's cross-reference to LLP 0053's §Status does not resolve against the committed 0053

**Evidence.** LLP 0039 landing item 6 states: "**0053 is currently FROZEN at Draft: its ENG-24592 gate reviews returned NOT READY on the prior enforcement text, and the resulting composite-protocol revision awaits focused confirmation (see its §Status).**" The committed `llp/0053-authorization-invalidation.rfc.md` contains no occurrence of "ENG-24592," "NOT READY," or "composite" anywhere in the document. Its §Status (dated 2026-07-12) describes a round-4 freeze whose two material enforcement fixes were transcribed from a reviewer's prescribed resolutions and are themselves *unreviewed*, and states "the next action on this document is a review of these fixes."

**Failure trace.** An implementer picking up item 6 follows 0039's "(see its §Status)" pointer expecting to find an ENG-24592 gate outcome and a composite-protocol revision awaiting confirmation. They find instead a round-4 freeze with two unreviewed transcriptions. The provenance does not reconcile, and the implementer cannot tell whether they are looking at the revision 0039 describes or a stale one.

The direction of the error is safe: 0039 still blocks item 6 until 0053 reaches Accepted, and the substantive characterization ("0053's architecture is settled, but its enforcement primitives have repeatedly failed review") is true of the committed 0053 either way. This costs traceability, not correctness. Note that I could not distinguish "0039 describes a 0053 revision that has not landed in this worktree" from "0039's provenance sentence is inaccurate," because the review artifacts that would settle it are under `llp/reviews/`, which I was instructed not to read.

**Bounded resolution.** Either land the 0053 status revision 0039 describes, or restate 0039's sentence to match 0053's actual §Status (FROZEN at Draft; enforcement fixes transcribed but unreviewed; next action is a review of those fixes). The item-6 blocking rule needs no change.

---

## Closing assessment

**Architecture:** sound. Nothing I found requires reopening it, and I did not propose an alternative.

**Material blocker:** none. The first-install discriminator — the HIGH that the previous confirmation round found — is genuinely closed, and closed against the *actual* predecessor code path rather than an assumed one. The relocate-and-poison defense remains correctly scoped as the separate post-activation reopen/rollback protection, and the two defenses do not depend on each other. The public attestation branch is genuinely non-mutating and opens no new read surface. The capability-fact registration is additive and fails closed on every target that does not emit it. The 0053 seam is drawn correctly against 0053's actual text, and items 1–5 and 7 depend on no 0053 deliverable — the landing-independence claim survives.

**ENG-24593 can close.** The four findings above are editorial and specification-completion items, not defects in the settled core: two are one-clause additions to a matrix and an acceptance row, one is a single sentence about an interaction the split introduced, and one is a cross-reference repair. They can be folded into this revision or carried as named residuals without re-reviewing the architecture. My recommendation is to fold in Finding 1 (it lives in the exact contract this gate exists to pin, and an implementer must resolve it before writing the preflight) and Finding 2 (it makes the headline proof actually prove what it claims), and to treat Findings 3 and 4 as bounded follow-ups.

The author decides acceptance; this is a readiness report only.


## Round 16 — 2026-07-13 (focused exact confirmation after bounded closure)

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md` at SHA-256
`8ba5becada849cb1d074b17a5858134de807abe103d3f086047cfac751b893fc`
and `llp/0012-headless-integration-contract.spec.md` at SHA-256
`ade9da47881828342fd591ff4d1bb1c0bff643c2f67b9fb086a987b56bf51170`.
**Reviewer family:** Claude
**Provider / runtime:** Claude Code 2.1.207, requested
`claude-fable-5[1m]`, effort `max`; recorded model usage was
`claude-fable-5`; read-only tools.
**Method:** Fresh foreground-only session, blind focused confirmation. Prior
review artifacts were forbidden. The reviewer read the candidate, governing
LLPs, and source and edited nothing.
**Session id:** `639F4449-8BF1-43CE-AB36-89F21028836B`
**Review-body SHA-256:**
`6156cf7ff64960ffdea541e687ca13d39eddf6ab35598449e63e619af4cf4231`
**Redacted:** no

### Review body (verbatim)

# Verdict: READY

All four bounded post-review corrections are confirmed as written, grounded in the governing corpus and the shipped source. No blocking findings. ENG-24593 can close from the review side; per the no-self-acceptance rule I report readiness only — the status transitions out of Draft/FROZEN remain the author's call.

**Protocol statement.** I cannot run Bash, so I did not compute hashes; the SHA-256 values for the immutable pair (`8ba5be…93fc` for LLP 0039, `ade9da…1170` for LLP 0012) are **runner-supplied and runner-verified**, and I reviewed the working-tree bytes at those paths. Files I read: `llp/0039-auth-vertical-slice.rfc.md` (all 2,166 lines), `llp/0012-headless-integration-contract.spec.md` (all 780 lines), `llp/0053-authorization-invalidation.rfc.md` (all 892 lines), and targeted source context in `src/manifest.rs`, `src/local.rs`, `src/server.rs`, `src/admin.rs`, and `packages/snapback-codegen/index.mjs`. Nothing under `llp/reviews/` was opened (one repo-wide filename search listed paths there; no contents were read), and I edited nothing.

## Closure 1 — closed tuple set, v1-dev rejected before hashes/effects: CONFIRMED

LLP 0012 states the closed set normatively with an explicit four-row accept/reject table — `(v0, dev)` accept, `(v0, sessions)` reject, `(v1, dev)` **reject**, `(v1, sessions)` accept — and pins "every other tuple … is rejected before hash comparison or any durable/runtime effect" (`llp/0012:126-138`). The same rule recurs, with v1-dev named in every negative list, at the receiver bullets (`:166-172`), the ingress preflight ordering — intent/branch authorization → closed tuple → pair consistency → target support, "only then may it report `matched`, run DDL, persist a desired mode, replace functions, or seed" (`:181-189`) — the Versioning hard-stops (`:646-658`), and validation requirements (`:706-709`). The capability arrays are explicitly non-Cartesian at both registration sites (`:260-262`, `:327-331`). LLP 0039 mirrors it identically: the closed set with v1-dev named (`llp/0039:134-139`), the non-Cartesian arrays (`:165-168`), protocol obligation 3's matrix (`:1533-1536`), and acceptance (`:1706-1712`). I found no counter-statement in either document that would let a hash match, capability advertisement, or legacy form readmit v1-dev.

## Closure 2 — predecessor proof in a provisioning-allowed profile, exact diagnostic: CONFIRMED

Both documents pin the actual, unmodified pre-auth predecessor running in its **provisioning-allowed `dev` profile** and asserting exactly `SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION` in addition to the no-mutation proof (`llp/0012:173-175`, `:710-720`; `llp/0039:148-152`, `:1537-1542`, `:1693-1706`). Source verifies every link in that chain:

- The predecessor's validator accepts only v0: `SNAPBACK_SCHEMA_VERSION = "snapback.v0"` (`src/manifest.rs:8`), and `validate_artifact_header` refuses any other version with the format-built code `SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION` (`src/manifest.rs:2070-2086`).
- Validation precedes effects: `apply_schema` calls `validate_artifact()?` before DDL (`src/local.rs:1190-1195`); `load_functions` validates before replacing the generation (`src/local.rs:1205-1210`); in `ensure_app` the schema half errors first, so the full v1 payload yields the schema-version code with functions and seed never reached (`src/local.rs:1373-1442`).
- The hazard the disjoint `snapback.v1:` identities defeat is real: `ensure_app` reports `"matched"` on raw `schemaHash`/`bundleHash` equality **without** ever validating (`src/local.rs:1377`, `:1396`), and today's framed-SHA-256 domains (`snapback-codegen/schema-content-hash/v1` etc., `packages/snapback-codegen/index.mjs:850-866`) are exactly the "existing length-framed encoding" the v1 domains extend.
- The profile pin is load-bearing, not decorative: `allows_provisioning()` is `!Prod` (`src/admin.rs:105-106`), and in a non-provisioning profile every half returns `"gated"` without validating — a `prod`-profile run would pass the no-mutation assertion while never producing the diagnostic. The correction closes a genuine hole in the earlier acceptance wording.

## Closure 3 — MODE_PENDING sole privileged recovery branch: CONFIRMED

Both documents say the same thing at every site: during `MODE_PENDING`, ordinary app-data and Public `{ intent: "attest" }` are refused with `SNAPBACK_AUTH_MODE_PENDING`; the **sole** schema-apply exception is `{ intent: "provision" }` under `AdminWrite` or pre-bind startup authority, which may correct or re-stage the candidate pair but still runs branch authorization and the complete closed-tuple/pair/capability preflight before hashes or effects; there is no generic admin/host-ops bypass and no fallback from a denied ordinary request (`llp/0039:337-341`, `:394-401`, diagnostics row `:1310`, route table `:1368-1369`, obligation 3 `:1545-1547`, acceptance `:1683-1687`; `llp/0012:241-248`, `:656-658`, `:725-728`). The surfaces that still serve — health, identity, the `GET /auth/session` handshake — are discovery/diagnosis endpoints, not app-data or schema-apply, so they don't dilute "sole"; `--clear-desired-auth-mode` remains the distinct pre-bind operator unstage in both documents.

## Closure 4 — LLP 0053 seam ownership: CONFIRMED

Landing item 6 now states that item 5 supplies exactly the `AuthCoordinator`, disposition execution, serialized clear barrier, and durable incarnation, that "LLP 0053 supplies and owns its own item-6 authorization-invalidation fence," and that "this document asserts no queue-fence keying to item-5 custody or generation" (`llp/0039:1436-1447`, restated in Status `:1911-1913` and Changelog `:1956-1958`). Each named item-5 deliverable is supported by 0053's actual text: the serialized coordinator clear barrier (`llp/0053:594-599`), the consumed incarnation paired as `(incarnation, epoch)` (`llp/0053:416-424`), and the identical `retain < quarantine < delete` disposition enum whose producers/escalation 0053 owns (`llp/0053:448-452`, `:511-517`) against 0039's ownership of the enum itself (`llp/0039:1168-1182`). The disclaimer matches 0053's reality — its fence witnesses are `(incarnation, epoch)`/commit-version, never session custody or generation. A fence-vocabulary sweep of 0039 confirms the only queue-fence mention is the disclaimer itself; every other fence reference is either 0039-owned machinery (loopback fence, revocation markers, custody fencing token) or an outcome-level reference 0053 directly supports ("durable client fence," the handshake's "minimum disposition/fence-aware client protocol" ↔ `llp/0053:580-583`). LLP 0012 carries no 0053 vocabulary at all — the partition is clean.

## Non-blocking observations

- LLP 0053 itself still has an internal tension (§Client fences describes an `(incarnation, epoch)` fence while its §Status/§Changelog record the unreviewed round-4 move to commit-version witnesses). That is exactly the flux 0039's corrected seam is designed to be immune to — it names no fence internals — and it is gated behind ENG-24592/item 6, not this confirmation.
- 0039 asserts "LLP 0053 remains Draft/FROZEN until ENG-24592 closes"; 0053's own Status confirms Draft/FROZEN with "the next action … is a review of these fixes." I verified the corpus state, not the Linear issue number itself; a wrong issue ID would be a cosmetic fix, not a readiness blocker.
- Both Status sections accurately record "one focused exact confirmation pending" and claim no acceptance on a reviewer's behalf — consistent with this being that confirmation.

**Bottom line:** the four bounded corrections are internally consistent across both documents, consistent with LLP 0053's actual text, and grounded in shipped source at every point where they claim a source fact. **READY** — ENG-24593 can close once the author records this confirmation and makes their own acceptance/status decision.
