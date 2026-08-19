---
title: Secrets and deployment config
id: operating.secrets-and-config
order: 1
audience: agent-first
capabilities: [operating.secrets-config]
authorities: [llp/0036-app-secrets-and-config.rfc.md, llp/0184-agent-accessible-control-plane.rfc.md, crates/snapback-cli/src/cli.rs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, demos/all-aboard/snapback/functions.mjs, demos/all-aboard/tests/acceptance/egress.mjs]
examples: [demos/all-aboard, crates/snapback/tests/config_set_cli_v0.rs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-06
reviewed-authorities-digest: sha256:c00bd2ab8122d44b8578bf83a5b38c5361a65dfab0d8fd1a5c9d7054002b1b94
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
`set`, `unset`, and `verify`, plus the read-only `plan` dry-run.

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

### The callable routes

The repo kit's `configApi` helper above is a thin wrapper. Consumers outside
this repository call the routes directly. Every one is admin-gated
(`x-snapback-admin-token`), and the three value-carrying writes additionally
require a loopback bind — a non-loopback plaintext bind refuses with
`SNAPBACK_CONFIG_TRANSIT_RULE`, and an SSH tunnel to the instance is the
blessed remote path.

| Operation | Request | Body |
| --- | --- | --- |
| status | `GET /_snapback/api/config/status` | — |
| plan | `GET /_snapback/api/config/plan?entry=<name>` | — |
| set | `POST /_snapback/api/config/set` | `{ "entry": "<name>", "value": "<string>" }` |
| set (pool) | `POST /_snapback/api/config/set` | `{ "entry": "<name>", "values": ["a", "b"], "append": true }` |
| unset | `POST /_snapback/api/config/unset` | `{ "entry": "<name>" }` |
| verify | `POST /_snapback/api/config/verify` | `{ "entry": "<name>" }` |

`plan` is a read-only dry-run: it reports the write locus, apply boundary,
and whether this transport would accept a value write, without writing
anything (the `entry` query parameter is optional).

Exactly one of `value` or `values` must be present: sending both, neither, or
the plausible-but-wrong `{ entry, member }` spelling refuses with
`SNAPBACK_CONFIG_VALUE_INVALID` ("provide exactly one of value or values").
Values are strings; a nested object is a deserialization error, not a config
diagnostic. `append: true` adds pool members, `append: false` (the default)
replaces the entry.

The write responses carry the new generation and set-state; they never carry
value bytes, and neither does `status`, the diagnostics ring, or any log
line. Pass values in the request body — never in argv, where a process list
would leak them.

## CLI and MCP projections for status/plan/verify

`config.status`, `config.plan`, and `config.verify` never carry a secret
value, so they are direct CLI and control-MCP tools (LLP 0184 Phase 2 P1).
`config.unset` is direct CLI and control-MCP too because it carries only an
entry name. `config.set` is deliberately CLI-only: MCP JSON-RPC has no defined
equivalent of the process-scoped stdin/fd secret carrier.

```sh
snapback config status --ready-file .snapback/dev.ready.json
snapback config plan --ready-file .snapback/dev.ready.json --entry caltrainFeed
snapback config verify --ready-file .snapback/dev.ready.json caltrainFeed
snapback config unset --ready-file .snapback/dev.ready.json --entry caltrainFeed
```

or, through `snapback mcp-control`: `snapback_config_status`,
`snapback_config_plan` (optional `entry`), and `snapback_config_verify`
(required `entry`), plus `snapback_config_unset` (required `entry`). Every
result is the operation's typed, value-free envelope; a missing/unset entry is
reported as declared state, not fabricated success.

## Set an agent-held value without exposing it

Start by detecting the gap and checking whether this target accepts value
writes:

```sh
snapback config status --ready-file .snapback/dev.ready.json
snapback config plan --ready-file .snapback/dev.ready.json --entry caltrainFeed
```

If a human holds the value, send them to
`http://127.0.0.1:<port>/_snapback/admin/setup`. The browser setup page accepts
the value directly; it does not hand the value back to the agent, and there is
no speculative agent-facing acquisition operation. Afterward, the agent uses
`config status` and `config verify` to observe completion.

If the agent already lawfully holds the value, send its exact UTF-8 bytes on
stdin. Keep the value in a shell-local variable populated by the credential
source without echoing it; do not paste a literal into this command:

```sh
printf '%s' "$AGENT_HELD_VALUE" |
  snapback config set --ready-file .snapback/dev.ready.json \
    --entry caltrainFeed --value-stdin
```

`printf '%s'` is the carrier adapter, not a place to type the value. Do not
export the variable, enable shell tracing, or use `echo`: exported state is
needlessly inherited, tracing prints expansions, and `echo` can add or rewrite
bytes. The CLI preserves the carrier bytes exactly, including whitespace and
line endings, and caps the CLI value at 1 MiB.

An inherited descriptor avoids even a shell expansion. Open an owner-only
secret source, pass its descriptor number, then close it:

```sh
exec 9<./operator-owned-secret
snapback config set --ready-file .snapback/dev.ready.json \
  --entry caltrainFeed --value-fd 9
exec 9<&-
```

For a pooled entry, add one member with the same carrier plus `--append`.

A heredoc is usually the wrong carrier. Its body may be retained by shell
history or terminal capture, and the newline before the delimiter becomes part
of the value because Snapback does not trim secret bytes. Use a pipe from the
credential-owning process or an inherited descriptor unless that final newline
is deliberately part of the credential.

There is intentionally no `snapback config set ... --value <secret>` spelling.
Argv is visible to process inspection, commonly retained in shell history, and
often quoted in parser diagnostics. Config-set parse failures are therefore
collapsed to a stable value-free usage diagnostic instead of replaying argv.
There is also no `snapback_config_set` MCP tool: defining one would make the
ordinary JSON-RPC parameter/result channel a secret carrier.

Complete the flow with value-free observation:

```sh
snapback config status --ready-file .snapback/dev.ready.json
snapback config verify --ready-file .snapback/dev.ready.json caltrainFeed
```

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
`SNAPBACK_CONFIG_*` diagnostics. Besides actions, the declared push seam
(`definePushSeam`) may also name entries in `uses`; that grant feeds the
engine-owned send lane, never a handler handle, and unknown names fail at
codegen with `CONFIG_USES_UNKNOWN` just as for actions.

## Anti-patterns

- **Do not put values in `defineConfig`.** It declares names and operator
  help only.
- **Do not pass secrets as function arguments or store them in app tables.**
  Use an action's granted handle.
- **Do not log or return `.expose()`.** Redaction protects the handle, not a
  copied plaintext string.
- **Do not treat `app.reset` as credential rotation.** Use `set`/`unset`
  and verification on the deployment config surface.
