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

The endpoint serves thirty-six request spellings (`SERVED_HOST_OPS` in
`src/host_ops.rs`):

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
| `branch.create.v1` | Create a managed operator in-app branch (allowed functions, TTL, egress policy). |
| `branch.execute.v1` | Execute an allowed function inside a branch under a caller-retained replay-stable request id. |
| `branch.list.v1` | List managed branches. |
| `branch.reap.v1` | Reap expired managed branches. |
| `branch.inspect.v1` | Inspect one managed branch. |
| `branch.drop.v1` | Drop one managed branch. |
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

`snapback session mint --email <address> --ready-file <path>` projects
`auth.mintSession` through the same target and authority handling and prints only
the resulting `hostOpsResult` JSON.

The six `branch.*.v1` operations are the closed operator surface for managed
in-app branches
([LLP 0162 §3](repo:llp/0162-agent-safe-storage-profile.rfc.md)). Each
accepts its closed v1 body only under `input` (with `schemaVersion: 1`),
refuses legacy sibling fields, and is registered AdminWrite; paths and
grants are server-owned.

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

## The exact 47 registry identities

The HTTP request names above expand into these 47 audited operation
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
11. `host_ops.branch.create.v1`
12. `host_ops.branch.execute.v1`
13. `host_ops.branch.list.v1`
14. `host_ops.branch.reap.v1`
15. `host_ops.branch.inspect.v1`
16. `host_ops.branch.drop.v1`
17. `host_ops.auth.mintSession`
18. `host_ops.auth.rescueCollidingTable`
19. `host_ops.function.run.query`
20. `host_ops.function.run.mutation`
21. `host_ops.function.run.action`
22. `host_ops.function.run.unknown`
23. `host_ops.function.run.impersonated`
24. `host_ops.asset.put`
25. `host_ops.asset.ensureSeedFixture`
26. `host_ops.asset.inspect`
27. `host_ops.asset.list`
28. `host_ops.asset.retry`
29. `host_ops.asset.gcSweep`
30. `host_ops.asset.delete`
31. `host_ops.asset.rotateSigningKey`
32. `host_ops.asset.exportCut`
33. `host_ops.asset.importCut`
34. `host_ops.telemetry.stats`
35. `host_ops.telemetry.events`
36. `host_ops.telemetry.export`
37. `host_ops.errors.issues`
38. `host_ops.errors.issue`
39. `host_ops.errors.transition`
40. `host_ops.debug.networkProfileGet`
41. `host_ops.debug.networkProfileSet`
42. `host_ops.schema.reload`
43. `host_ops.functions.reload`
44. `host_ops.acceptance.run`
45. `host_ops.host.start`
46. `host_ops.host.stop`
47. `host_ops.host.restart`

> **Hand-count drift note (2026-08-06).** These counts are hand-maintained
> and have now drifted twice (28/39 → corrected to 30/41; then the six
> `branch.*.v1` operations landed while the page still said thirty/41).
> This correction to 36/47 is the second repair; the structural fix is
> generating these tables from the control catalog (LLP 0184 Phase 1 items
> 4–5, tracked in
> `issues/20260805-llp0184-phase1-served-catalog-and-guide-tables-deferred.md`).
> If you find these counts disagreeing with `SERVED_HOST_OPS` in
> `src/host_ops.rs` again, fix the generator ticket, not just the numbers.

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
