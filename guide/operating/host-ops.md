---
title: Host operations
id: operating.host-ops
order: 2
audience: agent-first
capabilities: [operating.host-ops]
authorities: [llp/0024-agent-operating-surface.spec.md, src/host_ops.rs, src/server.rs, tests/host_ops_v0.rs]
examples: [demos/todo]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-03
reviewed-commit: 6e5d69d1037c6042fb9338221dfb489e00f5f78a
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

The endpoint serves thirty request spellings:

| Request operation | Purpose |
| --- | --- |
| `app.inspect` | Full runtime/artifact/capability projection. |
| `app.reset` | Coordinated destructive reset, optionally with seed. |
| `app.seed.ensure.v1` | Install a generated versioned seed or observe its current match. |
| `app.seed.preview.v1` | Classify a versioned install/reset/clear without writing. |
| `app.seed.reset-install.v1` | Coordinated destructive reset plus versioned install. |
| `app.seed.clear.v1` | Coordinated destructive clear with an idempotent receipt. |
| `schema.load` | Load a generated schema manifest. |
| `functions.load` | Load a generated function/config/cron manifest. |
| `function.run` | Run a query/live query, mutation, or action with its kind-specific gate. |
| `function.explain` | Explain a supported kind; currently `mutationDryRun` is implemented. |
| `auth.mintSession` | Dev/test session mint requiring the process-bound impersonation capability. |
| `auth.rescueCollidingTable` | Operator-only pre-auth catalog collision recovery. |
| `asset.put` | Put asset bytes/metadata through the same machinery as the asset routes. |
| `asset.ensureSeedFixture` | Install or observe a deterministic seed-fixture asset. |
| `asset.inspect` | Inspect one asset record. |
| `asset.list` | List asset records. |
| `asset.retry` | Retry a failed asset processing step. |
| `asset.gcSweep` | Deterministic receipted GC sweep with an injected clock. |
| `asset.delete` | Delete one asset through the authorized deletion path. |
| `asset.rotateSigningKey` | Rotate the delivery signing key, invalidating outstanding signed URLs. |
| `asset.exportCut` | Export a consistent asset cut to an absolute directory. |
| `asset.importCut` | Import a previously exported consistent asset cut. |
| `telemetry.stats` | Aggregated telemetry statistics (structural metadata). |
| `telemetry.events` | Bounded filtered raw telemetry events (secret-read lease). |
| `telemetry.export` | Bounded NDJSON telemetry export (secret-read lease). |
| `errors.issues` | Structural error-issue listing. |
| `errors.issue` | Raw detail for one error issue (secret-read lease). |
| `errors.transition` | Resolve/ignore state transition for one issue. |
| `debug.networkProfileGet` | Return the active network condition profile and its activation provenance. |
| `debug.networkProfileSet` | Activate a built-in named profile or an inline profile through the shared activation gate. |

`host.start` and `host.stop` are CLI-only lifecycle verbs today—a running
server cannot safely own starting/stopping itself; over HTTP they fail as
`SNAPBACK_HOST_OP_CLI_ONLY`, and the `snapback` CLI is their working
projection. `host.restart` also fails as `SNAPBACK_HOST_OP_CLI_ONLY` over
HTTP, but has no CLI command yet; its only current projection is the
composed `snapback_restart` MCP tool, which spawns `host.stop` then
`host.start` under one request id and envelope (a `snapback restart` CLI
command is planned but not shipped).
`schema.reload`, `functions.reload`, and `acceptance.run` are pinned but
unbuilt and fail as `SNAPBACK_HOST_OP_UNIMPLEMENTED`. All three families are
registered at AdminWrite so an authenticated request reaches that structured
envelope; unknown names stay unregistered and fail closed before dispatch.

## The exact 41 registry identities

The HTTP request names above expand into these 41 audited operation
identities (the last six are the registered CLI-only and pinned-unbuilt
verbs):

1. `host_ops.app.inspect`
2. `host_ops.function.explain`
3. `host_ops.function.explain.impersonated`
4. `host_ops.app.reset`
5. `host_ops.app.seed.ensure.v1`
6. `host_ops.app.seed.preview.v1`
7. `host_ops.app.seed.reset-install.v1`
8. `host_ops.app.seed.clear.v1`
9. `host_ops.schema.load`
10. `host_ops.functions.load`
11. `host_ops.auth.mintSession`
12. `host_ops.auth.rescueCollidingTable`
13. `host_ops.function.run.query`
14. `host_ops.function.run.mutation`
15. `host_ops.function.run.action`
16. `host_ops.function.run.unknown`
17. `host_ops.function.run.impersonated`
18. `host_ops.asset.put`
19. `host_ops.asset.ensureSeedFixture`
20. `host_ops.asset.inspect`
21. `host_ops.asset.list`
22. `host_ops.asset.retry`
23. `host_ops.asset.gcSweep`
24. `host_ops.asset.delete`
25. `host_ops.asset.rotateSigningKey`
26. `host_ops.asset.exportCut`
27. `host_ops.asset.importCut`
28. `host_ops.telemetry.stats`
29. `host_ops.telemetry.events`
30. `host_ops.telemetry.export`
31. `host_ops.errors.issues`
32. `host_ops.errors.issue`
33. `host_ops.errors.transition`
34. `host_ops.debug.networkProfileGet`
35. `host_ops.debug.networkProfileSet`
36. `host_ops.schema.reload`
37. `host_ops.functions.reload`
38. `host_ops.acceptance.run`
39. `host_ops.host.start`
40. `host_ops.host.stop`
41. `host_ops.host.restart`

Query/explain reads, durable writes, credential-producing operations, and
dev impersonation therefore keep distinct `RoutePolicy`, authority, effect,
and response-sensitivity classifications even though they share one carrier.

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

## Anti-patterns

- **Do not call internal Rust methods from tooling.** Use the envelope so CLI
  and HTTP behavior stay identical.
- **Do not treat all host ops as AdminWrite.** The registry's kind-specific
  policy is part of the security boundary.
- **Do not interpret an unimplemented diagnostic as an absent operation.**
  Pinned future verbs fail explicitly.
- **Do not place credentials in request ids, logs, or `next[]`.** Credential
  operations use their dedicated response-sensitivity path.
