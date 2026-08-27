---
title: Host operations
id: operating.host-ops
order: 2
audience: agent-first
capabilities: [operating.host-ops]
authorities: [llp/0024-agent-operating-surface.spec.md, crates/snapback-cli/src/cli.rs, crates/snapback-engine/src/host_ops.rs, crates/snapback-server/src/server.rs, crates/snapback-server/src/admin_secret_read.rs, packages/snapback-cli/mcp-control.mjs, crates/snapback/tests/host_ops_v0.rs]
examples: [demos/todo]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:e276d9f43b744ac2d28a8c7ee4a09cf25f08bf77f6f2a92d9c4a63efa65fd3dd
---

# Host operations

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Host operations give CLIs and agent tools one typed operating surface. The
in-process implementation and `POST /_snapback/api/host-ops` return the same
`hostOpsResult` envelope; operation variants are classified in the route
registry instead of inheriting one overly broad HTTP policy.

## Send one operation, receive one envelope

A request names `operation` plus its typed fields:

```json source=crates/snapback/tests/host_ops_v0.rs
        json!({
            "operation": "function.run",
            "function": "createTodo",
            "args": { "title": "from host-ops" },
            "userId": "user_ada",
        }),
```

Every response contains `schemaVersion`, `resultKind: "hostOpsResult"`,
`requestId`, `operation`, `ok`, `target`, optional `authority`,
`artifacts`, `data`, `diagnostics[]`, and `next[]`. A known-but-unbuilt
operation returns `ok: false` with a structured diagnostic, never a fake 404
or empty success.

`artifacts.databaseVersion` contains an integer only when the durable cursor
decodes as an exact portable value. If storage cannot supply a trustworthy
cursor, the envelope becomes `ok: false`, serializes that value as `null`, and
carries the storage diagnostic; tooling must not substitute zero.

## Served request operations

<!-- BEGIN GENERATED CONTROL CATALOG: HOST OPS SERVED -->
The endpoint serves **50 request spellings**. This count and table are generated from the build catalog's LLP 0024 allowlist projection:

| Request operation | Purpose |
| --- | --- |
| `app.inspect` | Inspect the running app |
| `app.readiness.v1` | Evaluate declared application readiness |
| `app.reset` | Reset local app state |
| `app.seed.clear.v1` | Clear the versioned seed installation |
| `app.seed.ensure.v1` | Ensure the versioned seed installation |
| `app.seed.preview.v1` | Preview a versioned seed installation |
| `app.seed.reset-install.v1` | Reset and install the versioned seed |
| `asset.delete` | Delete one asset |
| `asset.ensureSeedFixture` | Ensure the asset seed fixture |
| `asset.exportCut` | Export a consistent asset cut |
| `asset.gcSweep` | Sweep reclaimable asset storage |
| `asset.importCut` | Import a consistent asset cut |
| `asset.inspect` | Inspect one asset |
| `asset.list` | List assets by availability |
| `asset.put` | Upload one asset |
| `asset.retry` | Retry pending asset work |
| `asset.rotateSigningKey` | Rotate the asset delivery signing key |
| `auth.integrationResume` | Resume an authentication integration through host ops |
| `auth.integrationRetire` | Retire an authentication integration through host ops |
| `auth.integrationSuspend` | Suspend an authentication integration through host ops |
| `auth.mintSession` | Mint a local test session |
| `auth.rehearsal.exercise` | Exercise an authentication rehearsal grant |
| `auth.rehearsal.mint` | Mint an authentication rehearsal grant |
| `auth.rehearsal.revoke` | Revoke an authentication rehearsal grant |
| `auth.rehearsal.status` | Read authentication rehearsal status |
| `auth.rescueCollidingTable` | Rescue a table colliding with sessions mode |
| `branch.create.v1` | Create a backend branch |
| `branch.drop.v1` | Drop a backend branch |
| `branch.execute.v1` | Execute against a backend branch |
| `branch.inspect.v1` | Inspect a backend branch |
| `branch.list.v1` | List backend branches |
| `branch.reap.v1` | Reap expired backend branches |
| `cron.list` | List cron jobs |
| `data.patch.apply` | Apply a bounded row patch |
| `data.patch.preview` | Preview a bounded row patch |
| `debug.live.forceResync` | Force a live subscription resync |
| `debug.networkProfileGet` | Read the active network profile |
| `debug.networkProfileSet` | Set a simulated network profile |
| `errors.issue` | Inspect one error issue |
| `errors.issues` | List error issues |
| `errors.transition` | Transition an error issue |
| `function.explain` | Explain a generated function |
| `function.run` | Run one generated function |
| `functions.load` | Load the generated function manifest |
| `host.stop` | Stop the local Snapback server |
| `remediation.apply` | Apply a generation-fenced remediation |
| `schema.load` | Load the generated schema manifest |
| `telemetry.events` | Read a bounded telemetry event page |
| `telemetry.export` | Export bounded telemetry |
| `telemetry.stats` | Read aggregate telemetry health |
<!-- END GENERATED CONTROL CATALOG: HOST OPS SERVED -->

## Mint a session over HTTP

`auth.mintSession` is the non-production host operation for a trusted
server-side identity broker. Prefer the paved CLI projection,
`snapback session mint --email <address> --ready-file <path>`, when the broker
can invoke it. When the broker must use HTTP, the exact endpoint is
`POST /_snapback/api/host-ops` with `content-type: application/json`, the
AdminWrite token in `x-snapback-admin-token`, and the process-bound
impersonation capability in `x-snapback-impersonation-capability`:

```sh
curl --fail-with-body \
  -H 'content-type: application/json' \
  -H "x-snapback-admin-token: $SNAPBACK_ADMIN_TOKEN" \
  -H "x-snapback-impersonation-capability: $SNAPBACK_IMPERSONATION_CAPABILITY" \
  --data '{"operation":"auth.mintSession","args":{"email":"person@example.test"}}' \
  "$SNAPBACK_ORIGIN/_snapback/api/host-ops"
```

The body is closed: it contains `operation: "auth.mintSession"`, an optional
string `requestId`, and `args` with exactly one required string member,
`email`. Any extra member refuses, including `role` inside `args`, `input`, or
a stray top-level `userId`. The stable refusal is
`SNAPBACK_AUTH_REQUEST_INVALID`; its safe `details` name
`operation: "auth.mintSession"`, carry the closed
`expectedArgumentContract`, and point `guideAnchor` back to this section.
They never echo the submitted email or request bytes.

HTTP returns 200 once a `hostOpsResult` envelope exists. Read the outcome from
the envelope's `ok` and `diagnostics[]`, not from the transport status. On
success, `diagnostics` is empty and `data` has exactly these five members:

```json fragment reason="Credential values, identifiers, and timestamps are runtime-owned per mint."
{
  "token": "sbs_…",
  "tokenType": "Bearer",
  "session": {
    "id": "ses_…",
    "userId": "usr_…",
    "provider": "email-code",
    "createdAt": 1786300000000,
    "expiresAt": 1786303600000,
    "absoluteExpiresAt": 1786904800000
  },
  "refreshAfter": 1786301800000,
  "authorityDescriptor": {
    "descriptorVersion": 1,
    "authorityInstanceId": "aut_…",
    "sessionGeneration": 1
  }
}
```

Minting is available only after Sessions mode is settled and active, on a
non-production server profile, and when all three independent authorities are
present: the AdminWrite token, the process-bound impersonation capability, and
active sessions mode. It is for local dev, test, and demo identity brokerage,
not hosted production identity. Responses are `cache-control: no-store,
private`. Keep both request authorities and the returned `sbs_…` bearer in
trusted server custody; never put them in a browser/native app bundle, logs, or
an app-visible environment variable.

`snapback session mint --email <address> --ready-file <path>` projects
`auth.mintSession` through the same target and authority handling and prints only
the resulting `hostOpsResult` JSON.

`snapback debug force-resync` projects `debug.live.forceResync`: a
non-production debug perturbation forcing exactly one live subscription
through the normal `resync_required` recovery path, changing no application
data. `--connection-id` and `--subscription-id` name the one subscription;
`--reason` is recorded in the printed receipt; `--clear-retained` makes the
client also discard retained rows rather than keep them until the fresh
snapshot lands; `--startup-nonce` defaults from the `--ready-file`
descriptor and must be given explicitly only when targeting `--url`
directly. The MCP projection is `snapback_live_force_resync`.

The six `branch.*.v1` operations are the closed operator surface for managed
in-app branches
([LLP 0162 §3](repo:llp/0162-agent-safe-storage-profile.rfc.md)). Each
accepts its closed v1 body only under `input` (with `schemaVersion: 1`),
refuses legacy sibling fields, and is registered AdminWrite; paths and
grants are server-owned.

`host.start` and `host.restart` are CLI-owned lifecycle compositions; over HTTP
their registered identities fail as `SNAPBACK_HOST_OP_CLI_ONLY`. The
authenticated `host.stop` operation is served at `AdminWrite`: it validates an
expected startup nonce against its own boot identity, then requests its own
graceful shutdown. Direct `snapback stop` and both restart projections use that
same operation. No stop request or stop-observation receipt contains a PID, and no CLI/MCP
lifecycle path signals `descriptor.pid` (the `host.start` result and restart's
nested `current` receipt do report the successor's own PID). Native callers and MCP attached to an
external server use that PID only for a signal-0 existence probe and OS
process-table start-time comparison. When MCP owns the exact server child, it
instead requires the descriptor PID to match the child handle and observes the
process gone by asynchronously reaping that child.

## Restart with one credential-bound receipt

```sh fragment reason="The ready descriptor is a runtime-owned capability path."
snapback restart --ready-file .snapback/dev.ready.json \
  --reason "reload native dependency"
```

Both `snapback restart` and `snapback_restart` compose stop then start under
one request id and one `host.restart` envelope, and both require a concrete
administrator token. Native `snapback stop` and `snapback restart` call
authenticated `host.stop` with only the descriptor's startup nonce; the live
server compares that fence with itself and requests its own graceful shutdown.
Native callers and MCP attached to an external server accept only the exact
typed result for that operation, target, declared lifecycle authority, and
self-stop claim, then require the descriptor PID to be live with a captured OS
process-table start time and matching health `startupNonce` before the request.
Afterward they record URL health loss and poll until signal-0 returns `ESRCH` or
the PID reappears with a different start time. Only that identity-bound
original-process-gone fact grants success. For a server child MCP itself
started, MCP sends the same managed-token-authenticated `host.stop` directly,
requires the descriptor PID to match its exact child handle, and grants success
only after Node reaps that child. Neither ownership mode treats URL loss as the
process-gone observation.

A ready descriptor and its `sbdev_` sidecar are discovery and app-plane
dev-identity carriers, not lifecycle authority. Ordinary local servers usually
advertise an owner-only auto-minted admin-token file, so the CLI can resolve the
credential without an explicit `--token`. That is credential discovery, not a
credential-free nonce-bound stop. If no valid credential carrier exists,
direct stop refuses with `SNAPBACK_HOST_STOP_ADMIN_CREDENTIAL_REQUIRED` and
restart with `SNAPBACK_HOST_RESTART_ADMIN_CREDENTIAL_REQUIRED`; keep the
caller-owned dev loop in the foreground and use Ctrl-C, or provide the
administrator credential and retry.

The CLI/MCP lifecycle stop receipt has `authority: null` and exactly three data
facts:

- `credentialedHostOpResultAccepted: true`: the lifecycle caller presented the
  resolved administrator credential to the configured URL and accepted the
  exact typed success result and declared lifecycle authority;
- `configuredUrlStoppedAnswering`: whether later `/health` requests at that URL
  failed across three consecutive probes; this fact does not grant success; and
- `processIdentityVerified`: whether the ownership-appropriate process-gone
  observation succeeded. For native/attached targets, `true` means the captured
  descriptor PID/start-time identity later returned signal-0 `ESRCH` or the PID
  had a different OS start time after reuse. For a manager-owned MCP target, it
  means Node reaped the exact child handle whose PID matched the descriptor. It
  does not authenticate which process answered HTTP or validated the credential.

The receipt contains no server self-stop claim, PID, stopped PID, echoed nonce,
or `verifiedBy` field. Top-level `ok` is true if and only if
`processIdentityVerified` is true. A same-UID local process can reproduce the
0600 descriptor/token inputs and forge the result, so the receipt does not
attest the HTTP responder's identity. Closing a forged listener while the live
descriptor-named process remains does not satisfy the exit observation and
returns `ok: false`. A descriptor-named identity that remains live produces
`SNAPBACK_HOST_STOP_TIMEOUT` (or `SNAPBACK_HOST_RESTART_STOP_TIMEOUT` for
restart), regardless of the URL-health fact.

For an authorized restart, the start leg accepts only a successor descriptor
with the same database and `serverProfile` plus a new startup nonce, then
proves the administrator credential against that successor too. The successor
is never spawned until the predecessor's identity-bound exit observation is
true. Credentials never enter child argv or the receipt. The fresh-spawn leg
has no prior server credential to hold.

`schema.reload`, `functions.reload`, and `acceptance.run` are pinned but
unbuilt and fail as `SNAPBACK_HOST_OP_UNIMPLEMENTED`. All three families are
registered at AdminWrite so an authenticated request reaches that structured
envelope; unknown names stay unregistered and fail closed before dispatch.

## Registered operation identities

<!-- BEGIN GENERATED CONTROL CATALOG: HOST OPS REGISTERED -->
The request spellings above expand into **62 registered operation identities**. This inventory is generated from each catalog row's LLP 0031 registry projection:

1. `host_ops.acceptance.run`
2. `host_ops.app.inspect`
3. `host_ops.app.readiness.v1`
4. `host_ops.app.reset`
5. `host_ops.app.seed.clear.v1`
6. `host_ops.app.seed.ensure.v1`
7. `host_ops.app.seed.preview.v1`
8. `host_ops.app.seed.reset-install.v1`
9. `host_ops.asset.delete`
10. `host_ops.asset.ensureSeedFixture`
11. `host_ops.asset.exportCut`
12. `host_ops.asset.gcSweep`
13. `host_ops.asset.importCut`
14. `host_ops.asset.inspect`
15. `host_ops.asset.list`
16. `host_ops.asset.put`
17. `host_ops.asset.retry`
18. `host_ops.asset.rotateSigningKey`
19. `host_ops.auth.integrationResume`
20. `host_ops.auth.integrationRetire`
21. `host_ops.auth.integrationSuspend`
22. `host_ops.auth.mintSession`
23. `host_ops.auth.rehearsal.exercise`
24. `host_ops.auth.rehearsal.mint`
25. `host_ops.auth.rehearsal.revoke`
26. `host_ops.auth.rehearsal.status`
27. `host_ops.auth.rescueCollidingTable`
28. `host_ops.branch.create.v1`
29. `host_ops.branch.drop.v1`
30. `host_ops.branch.execute.v1`
31. `host_ops.branch.inspect.v1`
32. `host_ops.branch.list.v1`
33. `host_ops.branch.reap.v1`
34. `host_ops.cron.list`
35. `host_ops.data.patch.apply`
36. `host_ops.data.patch.apply.impersonated`
37. `host_ops.data.patch.preview`
38. `host_ops.data.patch.preview.impersonated`
39. `host_ops.debug.live.forceResync`
40. `host_ops.debug.networkProfileGet`
41. `host_ops.debug.networkProfileSet`
42. `host_ops.errors.issue`
43. `host_ops.errors.issues`
44. `host_ops.errors.transition`
45. `host_ops.function.explain`
46. `host_ops.function.explain.impersonated`
47. `host_ops.function.run.query`
48. `host_ops.function.run.mutation`
49. `host_ops.function.run.action`
50. `host_ops.function.run.unknown`
51. `host_ops.function.run.impersonated`
52. `host_ops.functions.load`
53. `host_ops.functions.reload`
54. `host_ops.host.restart`
55. `host_ops.host.start`
56. `host_ops.host.stop`
57. `host_ops.remediation.apply`
58. `host_ops.schema.load`
59. `host_ops.schema.reload`
60. `host_ops.telemetry.events`
61. `host_ops.telemetry.export`
62. `host_ops.telemetry.stats`
<!-- END GENERATED CONTROL CATALOG: HOST OPS REGISTERED -->

Query/explain reads, durable writes, credential-producing operations, and
dev impersonation therefore keep distinct `RoutePolicy`, authority, effect,
and response-sensitivity classifications even though they share one carrier.

## Direct CLI/MCP projections beyond host-ops (LLP 0184 Phase 2 P1)

Some agent-relevant reads live on their own `SystemApi` routes rather than
the `/_snapback/api/host-ops` multiplexer above. Each now has a direct CLI
command and a control-MCP tool:

| Operation | CLI | MCP tool |
| --- | --- | --- |
| `data.scan` | `snapback data scan <table> [--limit N] [--offset N]` | `snapback_data_scan` |
| `jobs.list` | `snapback jobs list` | `snapback_jobs_list` |
| `jobs.show` | `snapback jobs show <id>` | `snapback_jobs_show` |

`data.scan` projects `DataQuery` exactly as shipped — `table`, `limit`,
`offset` — and **has no cursor**: the route does not have one. Offset paging
is not stable under concurrent writes; a row can shift between pages between
two calls issued moments apart. Prefer a narrow `--limit`, and treat a scan
as a snapshot-ish sample rather than a guaranteed-complete enumeration under
write load. A stable/snapshot-bound cursor would be a new storage semantic
and is out of this projection's scope.

```sh
snapback data scan messages --limit 20 --ready-file .snapback/dev.ready.json
```

Both `data.scan` and the CLI's `secret-read-mint` mint a scoped,
row/byte-budgeted secret-read lease automatically from the local readiness
descriptor when one is not supplied — never by reading an arbitrary URL for
credentials. `jobs.list`/`jobs.show` are the read-only half of LLP 0070's
one-off job surface; draining jobs is a separate, mutating operation this
slice does not add.

Three `host-ops` asset operations also gained MCP tools this phase — the CLI
paths (`snapback assets list|inspect|retry`) were already shipped:

| Operation | MCP tool |
| --- | --- |
| `asset.list` | `snapback_asset_list` |
| `asset.inspect` | `snapback_asset_inspect` |
| `asset.retry` | `snapback_asset_retry` |

The mutating asset operations also have direct MCP tools:
`snapback_asset_delete`, `snapback_asset_gc_sweep`,
`snapback_asset_rotate_signing_key`, `snapback_asset_export_cut`, and
`snapback_asset_import_cut`. Only `asset.put` and `asset.ensureSeedFixture`
stay CLI-only — see `snapback assets --help`.

## Respect admin, secret-read, and impersonation gates

The admin credential authenticates the transport; it does not silently invent
an app caller. In sessions mode, sensitive query/explain results additionally
require the bounded admin-secret-read lease. An impersonated branch requires
the process-bound capability and is unavailable in production. Destructive
reset, versioned reset-install, and versioned clear run through the same
authorization-stream coordinator and fail closed if that projection is
unavailable. Every `app.seed.*.v1` operation is AdminWrite + NonProd,
including preview. Its Rust-owned body belongs only under `input`; legacy
`seed`/`schema`/`functions` siblings are refused.

The partial local `servicePrincipal`/scoped-token slice is admitted only by
generated app-data calls. Host operations—including `function.run`—do not
resolve scoped tokens into authority; use the operation's explicit admin or
dev-impersonation gate instead.

## Mint a scoped secret-read lease

Sensitive raw reads — telemetry events and export, error-issue detail,
admin-credentialed inspect projections, receipts — require a short-lived,
budgeted secret-read lease in addition to the admin credential. Commands
addressed by `--ready-file` mint one automatically. When a command targets
`--url` directly, or another tool needs an explicit lease, mint one from the
readiness descriptor:

```sh
snapback secret-read-mint --ready-file .snapback/dev.ready.json --telemetry-events
```

This is deliberately a ready-file-only operation: the proof root is local
operator authority and can never be discovered from a URL. The printed JSON
carries the `sbrl_` bearer in its `lease` field; pass it as
`--secret-read-lease` on `snapback telemetry events|export` and
`snapback errors issue`, or as the `x-snapback-secret-read-lease` header on
a raw HTTP request.

Scope flags select what the lease can read, and every scope must be named
explicitly: `--table <name>`, `--function <name>`, and
`--explain-function <name>` (each repeatable), plus the boolean scopes
`--telemetry-events`, `--telemetry-export`, `--errors-issue`,
`--admin-inspect`, and `--receipts`. Budget flags bound the lease:
`--ttl-seconds` (default 60), `--row-budget` (default 500), and
`--byte-budget` (default 1,048,576).

## Controlled mutations: config, cron, jobs, connections

These operations sit beside the host-ops multiplexer — each is its own
admin-gated `POST /_snapback/api/...` route, not a `host-ops` request — but
now have the same direct CLI and control-MCP shape (LLP 0184 §P2's
"controlled mutations" projections). Each is `AdminWrite` and every CLI form
below accepts the same `--url`/`--ready-file`/`--token` target flags as
`snapback inspect`.

`config.unset` removes one config entry's stored value. It carries only the
entry identifier — no secret value crosses the wire, so it needs no secret
carrier (unlike `config.set`, which stays CLI-only pending a defined MCP
secret carrier):

```sh
snapback config unset --entry stripe.secretKey --ready-file .snapback/dev.ready.json
```

or `snapback_config_unset` (`{ "entry": "stripe.secretKey" }`) through
`snapback mcp-control`.

`cron.tick` force-claims and runs every currently-due cron job; `cron.runOne`
force-runs one named job regardless of its schedule:

```sh
snapback cron tick --ready-file .snapback/dev.ready.json
snapback cron run nightly-digest --ready-file .snapback/dev.ready.json
```

or `snapback_cron_tick` / `snapback_cron_run` (`{ "name": "nightly-digest" }`).

`jobs.drain` claims and runs due one-off jobs under an injected clock — the
deterministic seam that lets acceptance suites drive due-ness without
sleeping, instead of the wall clock `cron.tick` uses:

```sh
snapback jobs drain --ready-file .snapback/dev.ready.json --now-ms 1700000000000 --max-waves 3
```

or `snapback_jobs_drain` (`{ "nowMs": 1700000000000, "maxWaves": 3 }`, both
optional — absent `nowMs` means wall clock).

`connection.disconnect` is an explicit **debug perturbation** of one live
connection — force-closing a connection for local recovery/repair testing.
It is never application disconnect authority: the underlying route accepts
no request body, so `reason` is recorded in the CLI/MCP receipt for the
caller's own audit trail, not acknowledged by the server.

```sh
snapback connections disconnect conn_01h8x2 --reason "stuck presence repair" --ready-file .snapback/dev.ready.json
```

or `snapback_connection_disconnect` (`{ "connectionId": "conn_01h8x2", "reason": "stuck presence repair" }`).

## Anti-patterns

- **Do not call internal Rust methods from tooling.** Use the envelope so CLI
  and HTTP behavior stay identical.
- **Do not treat all host ops as AdminWrite.** The registry's kind-specific
  policy is part of the security boundary.
- **Do not interpret an unimplemented diagnostic as an absent operation.**
  Pinned future verbs fail explicitly.
- **Do not place credentials in request ids, logs, or `next[]`.** Credential
  operations use their dedicated response-sensitivity path.
