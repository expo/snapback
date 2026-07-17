---
title: Secrets and deployment config
id: operating.secrets-and-config
order: 1
audience: agent-first
capabilities: [operating.secrets-config]
authorities: [llp/0036-app-secrets-and-config.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, demos/all-aboard/snapback/functions.mjs, demos/all-aboard/tests/acceptance/egress.mjs]
examples: [demos/all-aboard]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-16
reviewed-commit: 1af150e0a1acffb372b7ac64fe32b61f1bf64db2
---

# Secrets and deployment config

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Snapback config is deployment state, separate from app rows. Apps declare
secret entries in source; operators set values through the setup/admin
surface; only actions explicitly naming an entry in `uses` receive a
redacting handle.

## Declare names and acquisition help, never values

`defineConfig` puts public metadata in the generated function manifest:

```js source=demos/all-aboard/snapback/functions.mjs
export const appConfig = defineConfig({
  caltrainFeed: {
    description: '511.org Open Data API key',
    purpose: 'Fetches Caltrain StopMonitoring predictions for live departure boards',
    required: false,
    pool: true,
```

The v1 entry inventory is: `description`, `purpose`, `required`
(default true), `pool`, optional action `probe`, `howToGet`, and
`acquisition` metadata for the setup wizard. V1 values are secret; defaults
and non-secret values are deliberately rejected.

Values never belong in source, manifests, seed data, LLPs, or demo diaries.

## Set and inspect config

Use `/_snapback/admin/setup` for the browser wizard or the admin-gated config
API/host operations for automation. The core operations are `status`,
`set`, `unset`, and `verify`.

`status` reports declaration, set state, member count, source, generation,
and verification—never value bytes:

```js source=demos/all-aboard/tests/acceptance/egress.mjs
  await suite.check('config.status reports names and states, never values', async () => {
    const { status, body, raw } = await configApi(on, 'GET', 'status');
    assertEqual(status, 200, 'status is readable');
    const entry = body.entries.find((e) => e.name === 'feedKeys');
    assert(entry, 'feedKeys is declared');
```

`set` replaces a scalar/pool or appends a pool member; `unset` removes the
deployment value. `verify` invokes the entry's declared action probe and
records only its outcome. Config survives `app.reset` because reset owns app
data, not deployment custody.

## Read through a granted handle

An action names entries in `uses`, then reads `ctx.secrets.get(name)` for the
entry or `ctx.secrets.rotating(name)` for round-robin pool selection. Handle
stringification, interpolation, JSON, and
debug formatting redact. `.expose()` is the narrow, explicit materialization
for building an outbound request; keep the returned string local and
short-lived.

The acceptance proves accidental materialization stays redacted:

```js source=demos/all-aboard/tests/acceptance/egress.mjs
    assertEqual(config.stringified, JSON.stringify(REDACTED), 'JSON.stringify redacts');
    assertEqual(config.template, REDACTED, 'template literal redacts');
    assertEqual(config.concatenated, `prefix:${REDACTED}`, 'string concat redacts');
    assert(!config.stringified.includes('key-'), 'no key material in stringified form');
```

Queries and mutations have no `ctx.secrets`; actions cannot access an entry
outside `uses`. Missing and undeclared entries fail with stable
`SNAPBACK_CONFIG_*` diagnostics.

## Anti-patterns

- **Do not put values in `defineConfig`.** It declares names and operator
  help only.
- **Do not pass secrets as function arguments or store them in app tables.**
  Use an action's granted handle.
- **Do not log or return `.expose()`.** Redaction protects the handle, not a
  copied plaintext string.
- **Do not treat `app.reset` as credential rotation.** Use `set`/`unset`
  and verification on the deployment config surface.
