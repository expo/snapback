---
title: External API exposure
id: backend.external-api
order: 19
audience: agent-first
capabilities: [api.external-exposure]
authorities: [llp/0204-app-external-surfaces.rfc.md, llp/0031-server-route-taxonomy.spec.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, crates/snapback-engine/src/manifest.rs, crates/snapback-types/src/api_envelope.rs, crates/snapback-engine/src/ask.rs, crates/snapback-server/src/server.rs, crates/snapback-server/src/server/effects.rs, crates/snapback-server/src/server/oauth.rs, crates/snapback-kernel/src/storage/ask_spend.rs, crates/snapback-kernel/src/storage/pending_effects.rs, crates/snapback-kernel/src/storage/capability_links.rs, crates/snapback-kernel/src/storage/auth_integrations.rs, crates/snapback-kernel/src/storage/auth_agent_credentials.rs, crates/snapback-sync/src/auth/invocation.rs, crates/snapback-services/src/telemetry.rs, crates/snapback-services/src/telemetry_query.rs]
examples: [packages/snapback-codegen/auth-artifacts.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-09
reviewed-authorities-digest: sha256:5221bd4e16f07945a6e3b1826e5cff01d29c79b612e3f97068f4cd57c14eb45a
---

# External API exposure

> **Local target only.** This deliberately partial page covers the shipped
> exposure core, `/api/v1` family, generated projections, integration records,
> OAuth facade, remote MCP, read-only `ask` v1 budget ledger, capability links,
> durable user watches, and approval-gated effects.
> General billing-grade metering remains incomplete. Loss-tolerant per-caller telemetry attribution and console visibility
> are shipped, but are not a non-shedding usage ledger. Hosted targets refuse the facade and granted external lanes until the LLP 0039
> deployment-security contract lands.

Every function is private to the app's own clients until the schema declares
otherwise. The `api` block makes external exposure a per-function, opt-in
fact that governs callability with an integration credential, disclosure,
and documentation as one thing.

## Declare exposure

The block rides `defineSchema` options beside `auth`. It is meaningful only
under `auth.mode: 'sessions'`, and `enabled: true` additionally requires an
explicit `auth.agents.mode` declaration (`'disabled'` is a valid choice —
it means no new credentialed onboarding):

```js source=packages/snapback-codegen/auth-artifacts.test.mjs
  api: {
    enabled: true,
    functions: { listTodos: { expose: true, since: 'v1' } },
    origins: ['https://example.com:8443'],
  },
```

- `expose` defaults to **false**; a fresh app exposes nothing. Unknown
  function names in `api.functions` are authoring and activation errors.
- `since` is an optional additive-only stamp (no deprecation machinery
  exists yet; that waits for the first real deprecation).
- `approval` is optional and valid only on an exposed mutation or action.
  `'required'` gates every caller; `'external'` keeps direct first-party
  sessions immediate while external/service/link callers require approval.
- `api.budgets.ask` is accepted independently and becomes enforcement
  authority only when `api.ask.enabled` is true. An enabled ask declaration
  without every required budget line is refused at generation and activation.
- `oauth.enabled` requires `api.enabled`. The current facade is bearer-only,
  so `oauth.bearer: true` is an explicit acknowledgment of that weaker
  custody posture; omitting it refuses activation. `oauth.bundles` maps
  human-sized scope names to exposed function names, which activation
  compiles to the existing exact function/kind/basis grant scopes.
- The exposure fact compiles onto each function
  (`functions.manifest.json#apiExposure`) and rides the api envelope, so
  every projection derives the same set.

## What exposure gates

A service principal (agent/integration credential) invoking an unexposed
function is refused with `SNAPBACK_API_EXPOSURE_DENIED` at the
authorization gate — on the bare finite routes, live subscriptions and
reruns, and nested code-mode calls alike. Grant scopes still apply;
exposure never widens LLP 0058/0172 authorization.

**The honest limit:** an anonymous caller on the bare routes is
indistinguishable from a first-party anonymous caller, so `expose: false`
removes advertisement, projections, and credentialed callability — it
cannot remove bare-route anonymous reachability while the function's own
auth admits anonymous callers.

## Approval-gated effects

Declare the gate beside exposure:

```js fragment reason="approval policy excerpt; function names are app-specific"
api: {
  enabled: true,
  functions: {
    createTodo: { expose: true, approval: 'external' },
    deleteTodo: { expose: true, approval: 'required' },
  },
}
```

An approval-gated mutation/action does not execute on initial admission. Bare
HTTP, `/api/v1`, remote MCP, and capability-link invocation all return the same
`SNAPBACK_EFFECT_APPROVAL_PENDING` result with HTTP-style status 202, a `pfx_`
effect id, `/effects/{id}/approve` pointer, expiry, and prospective-effect
preview. V1 previews are always `kind: 'disclosed'`: they contain the canonical
args digest and the function's declared write set. They are not dry-run output
and must not be presented as verified simulation.

Signed-in app users see currently approvable intents at `GET /effects` and
decide them with `POST /effects/{id}/approve` or `/deny`. Non-link effects use
the app's current function policy to resolve approvers. A link-originated
effect is visible and approvable only by the link minter. An
`authorityCreating` function additionally requires the ordinary operation-
bound step-up proof in the approval body.

Approval rechecks expiry, current generation, function identity and kind,
exposure and gate, args binding, the original caller's current authority, the
approver's current function policy, and link/minter lineage where present.
Only then does the normal mutation/action path execute under the original
caller attribution with a separate approver fact. Denial, expiry, stale
binding, and execution outcome settle into the bounded effect journal.

Mutating capability links may have more than one use when the target function
is approval-gated or the mint request sets `approval: true`; each possessor use
creates a separate minter-approved effect. Generic dry-run previews, proactive
expiry sweeping, and granted-function links are not shipped in v1.

## Build an Expo/web capability-link flow

Use [Capability links for Expo and web](../recipes/capability-links.md) for the
complete shipped anonymous-set journey: signed-in mint, secret URL handling,
crawler-safe inert GET, explicit invoke, Expo Linking and web parsing,
single-use/multi-use behavior, expiry, replay, revocation, and the boundary
before granted-operation, guest-session, upload-custody, or account-claim
authority. Do not infer those unshipped authority classes from this page's
external API surface.

## The `/api/v1` family

External callers use `POST /api/v1/query/{name}`,
`/api/v1/mutation/{name}`, `/api/v1/action/{name}` — the same handlers as
the bare finite routes with external-lane semantics:

- Requests must **omit** `expectedGeneration`
  (`SNAPBACK_API_GENERATION_PIN_UNSUPPORTED`); the server serves the
  current generation and the envelope digest carries change detection.
- The family refuses every invocation unless the app enabled its API
  (`SNAPBACK_API_NOT_ENABLED`) and the function is exposed — for all
  authority classes, anonymous included.
- There is no `/api/v1` authorized-lease mint; live data for third parties
  is documented re-polling in v1.

```sh reason="basic bearer invocation example using the documented environment placeholders"
curl -X POST "$APP_BASE_URL/api/v1/query/listTodos" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $APP_API_TOKEN" \
  --data '{"args":{}}'
```

## Disclosure

With `api.enabled`, `disclosure` defaults to `'exposed-only'`: `GET
/inspect` and the served api envelope both filter their function inventory
to the exposed set (redacting one but not the other would protect
nothing). `disclosure: 'full'` is the explicit opt-in that keeps today's
full-inventory posture; disclosure never changes callability.

## Browser callers

`api.origins` grants exact-origin (scheme+host+port, no wildcards) CORS on
the `/api/v1` family only, for bearer transport. No declaration means no
CORS beyond loopback dev behavior.

## Generated projections

Served alongside the envelope, all derived from the same exposed set:

- `GET /app-api/openapi.json` — OpenAPI 3.1, one operation per exposed
  function, request schemas from the envelope.
- `GET /app-api/agent-skill` — a digest-pinned, pointer-heavy skill
  document teaching discovery, authority acquisition, and invocation.
- `scripts/generate-app-api-md.mjs` — the `API.md` reference projection;
  exposure-aware envelopes render `/api/v1` paths.

Exposed queries whose result contract declares a large row bound
(`maxItems > 100`) without a cursor argument get the
`SNAPBACK_API_PAGINATION_RECOMMENDED` lint at generation time.

## Read-only near-data `ask`

`POST /api/v1/ask` runs a host-managed model loop over the current exposed
**query** catalog. Mutations and actions are never offered as tools in v1,
regardless of the caller's broader grant. The same tool is advertised by the
remote MCP server when enabled; MCP v1 always waits for the synchronous final
envelope and does not stream.

Enable it with a complete budget declaration:

```js fragment reason="ask declaration shape; values are application policy, not recommended universal limits"
api: {
  enabled: true,
  ask: {
    enabled: true,
    billing: 'caller-key',
    model: { provider: 'openai-compatible', model: 'provider-model-id' },
  },
  budgets: { ask: {
    perRequest: { maxTokens: 2000, maxSteps: 8, maxWallMs: 30000 },
    perPrincipalDay: { maxTokens: 20000 },
    perIntegrationDay: { maxTokens: 10000 },
    appMonthly: { maxTokens: 500000 },
    resultVolume: {
      maxBytes: 262144,
      maxRows: 500,
      perPrincipalDayBytes: 2097152,
    },
  } },
}
```

The single v1 provider class is `openai-compatible`. That exact value uses
the OpenAI-compatible `/v1/chat/completions` endpoint; a deployment/test may
declare `openai-compatible:https://provider.example/v1`. Plain HTTP is
accepted only for a loopback test provider. Provider network use still
requires the LLP 0009 guarded-egress switch `SNAPBACK_OUTBOUND_ACTIONS=1`.
The earlier LLP 0204 D5 reference to LLP 0070 for this gate is a mis-cite; the
implemented authority is LLP 0009 plus the LLP 0036 target secret seam.

With `billing: 'app'`, `model.secret` names an LLP 0036 config entry. Its value
is runtime-only and never appears in the manifest, database, or response. With
`billing: 'caller-key'`, send the provider credential only in
`X-Snapback-Ask-Provider-Key`; it receives an invocation-lifetime redactor and
is neither persisted nor logged.

App-paid asks require the distinguished `snapback:ask:data-egress` consent
scope (ordinary signed-in sessions count as their own granted principal).
Caller-key asks require at least one granted read scope. Anonymous and
declared-client lanes are refused with `SNAPBACK_API_ASK_AUTHORITY_REQUIRED`
and an authority-acquisition escalation.

```sh
curl -X POST "$APP_BASE_URL/api/v1/ask" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $APP_API_TOKEN" \
  -H "X-Snapback-Ask-Provider-Key: $APP_PROVIDER_KEY" \
  --data '{"task":"Summarize the open incidents","stream":false}'
```

Admission transactionally reserves the complete per-request token and result-
byte maxima in `_snapback_ask_spend`; settlement releases that reservation and
charges actual observed usage. A crash can therefore strand capacity only in
the conservative direction. Provider usage fields are authoritative when
present; otherwise the host estimates bytes/4 and marks `estimated: true`.
Token, step, wall-time, query-result byte/row, principal-day, optional
integration-day, and app-month limits all fail with typed diagnostics.

The final envelope names provider/model, token accounting, current durable
spend, and `provenanceNotProof.calls`. Each call has the function name plus
domain-separated per-run HMAC commitments of arguments and result. These
receipts record host-observed provenance; they do not prove that the model's
answer was derived from those values. `resultSchema` is optional. When given,
the host validates the final tool arguments and permits two repair turns
before `SNAPBACK_API_ASK_RESULT_SCHEMA_MISMATCH`.

`stream` defaults to true on HTTP. The request runs as a platform-managed
attempt and settles the existing private transcript; `stream: false` returns
only the synchronous final envelope. The current v1 provider adapter does not
publish intermediate model tokens as live chunks.

## OAuth 2.1 compatibility facade

Apps that explicitly enable `api.oauth` publish local, no-store discovery at
`GET /.well-known/oauth-authorization-server` and
`GET /.well-known/oauth-protected-resource`. A generic client dynamically
registers at `POST /auth/oauth/register`, then uses authorization code with
required PKCE S256 through `GET|POST /auth/oauth/authorize` and
`POST /auth/oauth/token`.

<!-- since: 0.1.16 -->

The paved terminal client is
`snapback-app --server <app-url> login`. It performs discovery, DCR, loopback
or paste completion, PKCE exchange, and owner-only short-lived bearer custody;
see [Log in through the external OAuth facade](../clients/app-cli.md#log-in-through-the-external-oauth-facade)
for its scope-default heuristic and no-browser path. The native proof-of-
possession alternative remains `snapback-app pair`.

Dynamic registration creates the same delegation-only integration principal
and record as the native registration path, under the active
`auth.agents.mode`. It returns no client secret and creates neither an
installation nor authority. V1 DCR is creation-only: it exposes no
re-registration/update contract, so an existing client record — including a
suspended or revoked one — cannot be mutated through this endpoint. The
consent page resolves requested bundle names
to exact canonical scopes; approval uses the ordinary grant approval and
operation-bound step-up machinery. Authorization codes are single-use and
expire after 60 seconds.

Facade access tokens are ordinary grant-bound scoped tokens with a 15-minute
bearer lifetime. V1 intentionally issues no refresh token: after expiry, an
MCP or other OAuth client repeats authorization. `POST /auth/oauth/revoke`
releases the presented carrier and may also revoke its installation grant.
Suspension, integration retirement, user grant revocation, and scoped-token
release therefore close the same underlying authority rather than a parallel
OAuth authority model.

## Caller usage visibility

Function and live-subscription telemetry carries a closed caller lane:
`anonymous`, `declared`, `integration`, or `first-party`. Declared callers are
keyed only by the digest shown in the operator-only declared-client listing;
their raw e-mail-bearing declaration never enters telemetry. Integrations use
their registration record ID.

`GET /_snapback/api/telemetry/stats` accepts optional `callerKey` and `lane`
filters plus `groupByCaller=true`. The operator-only declared-client and
integration listings include a recent 24-hour usage count from the same
bounded rollup, beside the existing suspension controls. These counts inherit
telemetry retention, folding, and shedding. They are useful for visibility,
not billing, audit, entitlements, or proof that an invocation did not happen.
