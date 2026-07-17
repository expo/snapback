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
reviewed: 2026-07-16
reviewed-commit: de78f0d44076bb9bebbb81b4d67178ab5b64b053
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

## Served request operations

The endpoint serves eight request spellings:

| Request operation | Purpose |
| --- | --- |
| `app.inspect` | Full runtime/artifact/capability projection. |
| `app.reset` | Coordinated destructive reset, optionally with seed. |
| `schema.load` | Load a generated schema manifest. |
| `functions.load` | Load a generated function/config/cron manifest. |
| `function.run` | Run a query/live query, mutation, or action with its kind-specific gate. |
| `function.explain` | Explain a supported kind; currently `mutationDryRun` is implemented. |
| `auth.mintSession` | Dev/test session mint requiring the process-bound impersonation capability. |
| `auth.rescueCollidingTable` | Operator-only pre-auth catalog collision recovery. |

`host.start`, `host.stop`, and `host.restart` are CLI-only lifecycle
verbs—a running server cannot safely own starting/stopping itself.
`schema.reload`, `functions.reload`, and `acceptance.run` are pinned but
unbuilt and fail as `SNAPBACK_HOST_OP_UNIMPLEMENTED`.

## The exact 13 registry identities

The HTTP request names above expand into these 13 audited operation identities:

1. `host_ops.app.inspect`
2. `host_ops.function.explain`
3. `host_ops.function.explain.impersonated`
4. `host_ops.app.reset`
5. `host_ops.schema.load`
6. `host_ops.functions.load`
7. `host_ops.auth.mintSession`
8. `host_ops.auth.rescueCollidingTable`
9. `host_ops.function.run.query`
10. `host_ops.function.run.mutation`
11. `host_ops.function.run.action`
12. `host_ops.function.run.unknown`
13. `host_ops.function.run.impersonated`

Query/explain reads, durable writes, credential-producing operations, and
dev impersonation therefore keep distinct `RoutePolicy`, authority, effect,
and response-sensitivity classifications even though they share one carrier.

## Respect admin, secret-read, and impersonation gates

The admin credential authenticates the transport; it does not silently invent
an app caller. In sessions mode, sensitive query/explain results additionally
require the bounded admin-secret-read lease. An impersonated branch requires
the process-bound capability and is unavailable in production. Destructive
reset runs through the authorization-stream coordinator and fails closed if
that projection is unavailable.

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
