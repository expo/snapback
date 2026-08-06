---
title: Host operations
id: operating.host-ops
order: 2
audience: agent-first
capabilities: [operating.host-ops]
authorities: [llp/0024-agent-operating-surface.spec.md, src/cli.rs, src/host_ops.rs, src/server.rs, tests/host_ops_v0.rs]
examples: [demos/todo]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-06
reviewed-commit: acbb7b922a060788fd09f3f98211eb9ce35f23f4
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

```json source=tests/host_ops_v0.rs
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
The endpoint serves **40 request spellings**. This count and table are generated from the build catalog's LLP 0024 allowlist projection:

| Request operation | Purpose |
| --- | --- |
| `app.inspect` | Inspect the running app |
| `app.reset` | Reset local app state |
| `app.seed.clear.v1` | app.seed.clear.v1 |
| `app.seed.ensure.v1` | app.seed.ensure.v1 |
| `app.seed.preview.v1` | app.seed.preview.v1 |
| `app.seed.reset-install.v1` | app.seed.reset-install.v1 |
| `asset.delete` | Delete one asset |
| `asset.ensureSeedFixture` | asset.ensureSeedFixture |
| `asset.exportCut` | Export a consistent asset cut |
| `asset.gcSweep` | Run asset reclamation and publication maintenance |
| `asset.importCut` | Validate or apply an exported asset cut |
| `asset.inspect` | Inspect one asset |
| `asset.list` | List assets by availability state |
| `asset.put` | asset.put |
| `asset.retry` | Re-drive pending asset work |
| `asset.rotateSigningKey` | Rotate the asset delivery signing key |
| `auth.mintSession` | auth.mintSession |
| `auth.rescueCollidingTable` | auth.rescueCollidingTable |
| `branch.create.v1` | branch.create.v1 |
| `branch.drop.v1` | branch.drop.v1 |
| `branch.execute.v1` | branch.execute.v1 |
| `branch.inspect.v1` | branch.inspect.v1 |
| `branch.list.v1` | branch.list.v1 |
| `branch.reap.v1` | branch.reap.v1 |
| `cron.list` | List cron jobs |
| `data.patch.apply` | Apply one previewed bounded direct row patch |
| `data.patch.preview` | Preview one bounded direct row patch |
| `debug.live.forceResync` | Force one live subscription to resync (debug perturbation) |
| `debug.networkProfileGet` | Read the active network condition profile |
| `debug.networkProfileSet` | Set the active network condition profile |
| `errors.issue` | Inspect one error issue |
| `errors.issues` | List error issues |
| `errors.transition` | Transition error issue state |
| `function.explain` | function.explain |
| `function.run` | Run one generated function |
| `functions.load` | Load the generated function manifest |
| `schema.load` | Load the generated schema manifest |
| `telemetry.events` | Read a bounded telemetry event page |
| `telemetry.export` | Export one bounded telemetry page |
| `telemetry.stats` | Read aggregate telemetry health |
<!-- END GENERATED CONTROL CATALOG: HOST OPS SERVED -->

`snapback session mint --email <address> --ready-file <path>` projects
`auth.mintSession` through the same target and authority handling and prints only
the resulting `hostOpsResult` JSON.

The six `branch.*.v1` operations are the closed operator surface for managed
in-app branches
([LLP 0162 §3](repo:llp/0162-agent-safe-storage-profile.rfc.md)). Each
accepts its closed v1 body only under `input` (with `schemaVersion: 1`),
refuses legacy sibling fields, and is registered AdminWrite; paths and
grants are server-owned.

`host.start` and `host.stop` are CLI-only lifecycle verbs—a running server
cannot safely own starting/stopping itself; over HTTP they fail as
`SNAPBACK_HOST_OP_CLI_ONLY`. `host.restart` has native CLI and MCP
projections, but its registered HTTP identity deliberately returns the same
CLI-only refusal.

## Restart with one credential-bound receipt

```sh fragment reason="The ready descriptor is a runtime-owned capability path."
snapback restart --ready-file .snapback/dev.ready.json \
  --reason "reload native dependency"
```

Both `snapback restart` and `snapback_restart` compose stop then start under
one request id and one `host.restart` envelope. Before any process signal,
they resolve a concrete administrator token and prove it through
`app.inspect` on the AdminRead-gated host-ops route; a missing or refused
credential leaves the old server running. The stop leg independently checks
the descriptor's startup nonce, and the start leg accepts only a successor
descriptor with the same database and a new startup nonce. Credentials never
enter child argv or the receipt. The fresh-spawn leg has no prior server
credential to hold.

`schema.reload`, `functions.reload`, and `acceptance.run` are pinned but
unbuilt and fail as `SNAPBACK_HOST_OP_UNIMPLEMENTED`. All three families are
registered at AdminWrite so an authenticated request reaches that structured
envelope; unknown names stay unregistered and fail closed before dispatch.

## Registered operation identities

<!-- BEGIN GENERATED CONTROL CATALOG: HOST OPS REGISTERED -->
The request spellings above expand into **53 registered operation identities**. This inventory is generated from each catalog row's LLP 0031 registry projection:

1. `host_ops.acceptance.run`
2. `host_ops.app.inspect`
3. `host_ops.app.reset`
4. `host_ops.app.seed.clear.v1`
5. `host_ops.app.seed.ensure.v1`
6. `host_ops.app.seed.preview.v1`
7. `host_ops.app.seed.reset-install.v1`
8. `host_ops.asset.delete`
9. `host_ops.asset.ensureSeedFixture`
10. `host_ops.asset.exportCut`
11. `host_ops.asset.gcSweep`
12. `host_ops.asset.importCut`
13. `host_ops.asset.inspect`
14. `host_ops.asset.list`
15. `host_ops.asset.put`
16. `host_ops.asset.retry`
17. `host_ops.asset.rotateSigningKey`
18. `host_ops.auth.mintSession`
19. `host_ops.auth.rescueCollidingTable`
20. `host_ops.branch.create.v1`
21. `host_ops.branch.drop.v1`
22. `host_ops.branch.execute.v1`
23. `host_ops.branch.inspect.v1`
24. `host_ops.branch.list.v1`
25. `host_ops.branch.reap.v1`
26. `host_ops.cron.list`
27. `host_ops.data.patch.apply`
28. `host_ops.data.patch.apply.impersonated`
29. `host_ops.data.patch.preview`
30. `host_ops.data.patch.preview.impersonated`
31. `host_ops.debug.live.forceResync`
32. `host_ops.debug.networkProfileGet`
33. `host_ops.debug.networkProfileSet`
34. `host_ops.errors.issue`
35. `host_ops.errors.issues`
36. `host_ops.errors.transition`
37. `host_ops.function.explain`
38. `host_ops.function.explain.impersonated`
39. `host_ops.function.run.query`
40. `host_ops.function.run.mutation`
41. `host_ops.function.run.action`
42. `host_ops.function.run.unknown`
43. `host_ops.function.run.impersonated`
44. `host_ops.functions.load`
45. `host_ops.functions.reload`
46. `host_ops.host.restart`
47. `host_ops.host.start`
48. `host_ops.host.stop`
49. `host_ops.schema.load`
50. `host_ops.schema.reload`
51. `host_ops.telemetry.events`
52. `host_ops.telemetry.export`
53. `host_ops.telemetry.stats`
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

The remaining asset operations (`put`, `gcSweep`, `delete`,
`rotateSigningKey`, `exportCut`, `importCut`, `ensureSeedFixture`) stay
CLI-only for now — see `snapback assets --help`.

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

## Controlled mutations: config, cron, jobs, connections

These operations sit beside the host-ops multiplexer — each is its own
admin-gated `POST /_snapback/api/...` route, not a `host-ops` request — but
now have the same direct CLI and control-MCP shape (LLP 0184 §P2's
"controlled mutations" projections). Each is `AdminWrite` and every CLI form
below accepts the same `--url`/`--ready-file`/`--token` target flags as
`host inspect`.

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
