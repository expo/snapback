---
title: External API exposure
id: backend.external-api
order: 19
audience: agent-first
capabilities: [api.external-exposure]
authorities: [llp/0204-app-external-surfaces.rfc.md, llp/0031-server-route-taxonomy.spec.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, src/manifest.rs, src/api_envelope.rs, src/server.rs, src/auth/invocation.rs]
examples: [packages/snapback-codegen/auth-artifacts.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-09
reviewed-commit: c85902cd15e1a0c25a63cfba69558db2e34fca42
---

# External API exposure

> **Local target only**, and deliberately partial: the exposure core,
> `/api/v1` family, and generated projections are shipped; integration
> records, the OAuth facade, and per-integration budgets land with LLP 0204
> S2. Hosted targets refuse granted external lanes until the LLP 0039
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
- `budgets` is refused until LLP 0204 S2 lands (the diagnostic says so).
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

```sh
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
