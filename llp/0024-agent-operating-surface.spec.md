# LLP 0024: Agent operating surface

**Type:** Spec
**Status:** Draft
**Systems:** Developer experience, Runtime, API, Tooling, Testing, Auth, Security, Client integration
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-27
**Revised:** 2026-07-13 (ENG-24596 final audit: preserve frozen LLP 0039's narrower dev/test-only collision-rescue profile while mint remains dev/demo/test); 2026-07-13 (ENG-24596: add the built `auth.mintSession` and `auth.rescueCollidingTable` host operations, including their independent authority axes, activation fence, and exact result projections; earlier: ENG-24561 centralized operation profile and AdminRead/AdminWrite requirements across dedicated and multiplexed transports; provisioning and dev-user impersonation fail closed in prod, and host-ops reports the active profile. Earlier: 2026-07-01 LLP 0032 R4: implementation-status banner added — pinned contract, not built surface)
**Related:** LLP 0000, LLP 0003, LLP 0004, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0017, LLP 0019, LLP 0020, LLP 0023, LLP 0057

> **Implementation status (2026-07-02 — the LLP 0032 P6 first slice is
> built).** The `snapback` CLI and the host-ops HTTP endpoint
> (`POST /_snapback/api/host-ops`, per-operation admin-gated and registered in the
> LLP 0031 route registry) exist and share one `hostOpsResult` envelope
> (`src/host_ops.rs` is the source of truth; the committed
> `schemas/host-ops.result.schema.json` is generated from it per LLP 0037).
> Per-verb status:
>
> - **Built:** `host.start` (CLI `snapback start`, foreground; structured
>   readiness is the `--ready-file` descriptor —
>   `schemas/host-ready.schema.json` — per LLP 0030's out-of-band
>   handshake), `host.stop` (CLI, via the readiness descriptor; signals the
>   pid only after the descriptor's `startupNonce` matches the live `/health`
>   identity, refusing stale or unverifiable descriptors — ENG-23366),
>   `app.inspect`, `app.reset` (with optional seed), `schema.load`,
>   `functions.load`, `function.run` (queries and mutations; never actions)
>   — each as CLI verb + HTTP operation, tested in `tests/host_ops_v0.rs`.
> - **Built in ENG-24596:** `auth.rescueCollidingTable`, and
>   `auth.mintSession` behind its deliberate sessions-mode activation fence.
>   Both use the shared HTTP `hostOpsResult` projection, require `AdminWrite`
>   plus the independent process-bound `ImpersonationCapability`, and use
>   closed generated DTOs. Mint is available only in dev/demo/test; rescue is
>   narrower and available only in dev/test. Rescue remains reachable in
>   `dev`; mint fails closed there until item 4 activates
>   `sessions`. LLP 0057 owns their exact provider and rescue semantics.
> - **Pinned, not built:** `host.restart`, `schema.reload`,
>   `functions.reload`, `function.explain`, `acceptance.run` — requested
>   over HTTP they return a structured `SNAPBACK_HOST_OP_UNIMPLEMENTED`
>   envelope (`host.*` over HTTP returns `SNAPBACK_HOST_OP_CLI_ONLY`); the
>   MCP projection is not built.
>
> Read the rest of the tables as pinned contract; the list above is the
> built surface.

## Summary

Snapback's first agent-facing operating surface is one host-ops core projected
through CLI, HTTP, and MCP. The projections may feel native to their transport,
but they must call the same operations and return the same structured result
envelope. MCP is not a new diagnostic dialect.

This Spec pins the v0 operation ids, CLI verbs, control-plane MCP tools, shared
JSON result envelope, and the generated app-data MCP catalog derived from the
LLP 0012 function manifest. It turns the agentic-readiness finding in
[LLP 0019](./0019-agentic-readiness.research.md) into a concrete contract for
the local implementation.

Two MCP surfaces exist:

- **Control-plane MCP** operates a local Snapback server by projecting the
  host-ops core.
- **Generated app-data MCP** projects an app's generated functions as candidate
  tools under explicit authority.

Those surfaces must stay separate. Control-plane tools manage the server and
inspect runtime state. App-data tools invoke application queries and mutations
through generated function references. Neither surface grants hidden authority.

## Scope

This Spec owns:

- v0 host-ops operation ids and required arguments/results;
- the canonical JSON result envelope shared by CLI, HTTP, and MCP;
- CLI verb names and common flags for authority, JSON output, and target
  selection;
- the HTTP projection boundary under the admin API namespace from LLP 0017;
- control-plane MCP tool names and their mapping to host-ops operations;
- generated app-data MCP catalog construction from the LLP 0012 function
  manifest;
- local authority modes and hosted gating for security-sensitive operations;
- the reserved dry-run and explain-denial shape for mutation safety.

It does not own:

- app-facing schema, handler, or `ctx.db` syntax, owned by LLP 0004;
- mutation execution and read-set validation semantics, owned by LLP 0003;
- sandbox/runtime isolation, owned by LLP 0009;
- the full auth and service-principal token model, owned by LLP 0011;
- the shared manifest and diagnostic artifact families, owned by LLP 0012;
- the admin console UI composition, owned by LLP 0017;
- hosted control planes, billing, tenants, or project lifecycle.

## Design Principles

- **One core, thin projections.** CLI, HTTP, and MCP are transport adapters over
  the same host-ops core. A behavior difference between projections is a bug
  unless this Spec names it as transport-only.
- **JSON first, humans second.** The structured result envelope is canonical.
  Human-readable CLI summaries are rendered from it.
- **Diagnostics stay shared.** All operation diagnostics use the LLP 0012 v0
  diagnostic schema and code families. Projection-specific failures are limited
  to transport problems that prevented the core operation from running.
- **Explicit authority.** Running a query, mutation, direct reset, or admin
  bypass requires an explicit authority tuple. Local dev impersonation is
  labeled local/dev-only; hosted mutation authority waits for the LLP 0011
  service-principal/scoped-token design.
- **Generated functions are not routes.** App-data tools call generated function
  ids from the function manifest. They must not infer app semantics from file
  names, route strings, or table names.
- **Explain before commit.** The surface must reserve a first-class place for
  dry-run and denial explanations so agents can move from
  propose-and-rollback toward propose-check-commit.

## Core Operation IDs

The v0 host-ops core uses these operation ids. The ids are the stable names used
inside result envelopes, logs, HTTP requests, and MCP metadata.

| Operation id | Purpose | Required v0 result data |
| --- | --- | --- |
| `host.start` | Start or attach to the canonical local Snapback server. | `runtimeState`, `capabilityManifest`, bound URL, process id, readiness. |
| `host.stop` | Stop a local server owned by this app/root. | stopped process id, previous bound URL, final diagnostics. |
| `host.restart` | Stop then start using one request id. | previous and new `runtimeState`, restart reason. |
| `app.reset` | Deterministically clear local app state and optionally apply a seed. | reset scope, seed id/path/hash, resulting database version. |
| `schema.load` | Load a schema manifest/source into the local server. | schema hash, load time, schema diagnostics. |
| `schema.reload` | Re-run schema discovery/codegen and load the resulting schema. | previous/new schema hashes, stale-artifact diagnostics. |
| `functions.load` | Load generated function bundle/manifest into the local server. | bundle hash, function count, unsupported dependency diagnostics. |
| `functions.reload` | Re-run function discovery/bundling and load the result. | previous/new bundle hashes, stale-artifact diagnostics. |
| `app.inspect` | Inspect loaded schema, functions, capabilities, runtime state, subscriptions, clients, and recent diagnostics. | `runtimeState`, `schemaManifest`, `functionManifest`, `capabilityManifest`, diagnostics. |
| `function.run` | Run one generated query or mutation by function id. | return value or mutation commit facts, read/write summaries when available, diagnostics. |
| `function.explain` | Explain query plans, permission decisions, capability gaps, or mutation denial/dry-run facts without committing. | explanation kind, decision, read/write predictions where available, diagnostics. |
| `acceptance.run` | Run the local acceptance suite or a named profile. | profile id, passed/failed/skipped counts, diagnostics, artifact paths. |
| `auth.mintSession` | Provision the canonical email identity/user if needed and issue a session credential for an operator-selected address. | flat credential payload: `tokenType`, `token`, `refreshAfter`, and public `session`; no identity subject, digest, generation, or authority-instance id. |
| `auth.rescueCollidingTable` | Transactionally move one legacy auth-reserved table to an ordinary app-table name. | exactly `source`, `target`, `copiedRowCount`, `copiedExplicitIndexCount`, `manifestUpdated`, and `catalogCollisionCleared`; never rows. |

`host.restart` may be implemented as a composition of `host.stop` and
`host.start`, but it must return one envelope with one request id so an agent can
reason about the whole restart attempt.

`schema.reload` and `functions.reload` are not aliases for load with the same
inputs. A reload means "discover from the configured app root again, regenerate
the relevant artifacts when needed, then load." The result must state which
inputs changed and whether stale generated artifacts were detected.

`function.run` accepts queries and mutations. It never accepts raw JavaScript.
The function id must come from the loaded LLP 0012 `functionManifest`.

`function.explain` is the common explanation operation. The v0 explanation kinds
are:

- `queryPlan`;
- `permissionAllow`;
- `permissionDeny`;
- `capabilityGap`;
- `mutationDryRun`.

`mutationDryRun` is reserved by v0 even if the first implementation reports
`CAPABILITY_*` diagnostics until the buffered mutation path can execute and
discard writes with the same fidelity as a real commit.

## Result Envelope

Every successful core invocation returns exactly one JSON envelope. "Successful"
means the core operation ran and returned structured facts; `ok: false` is still
a successful envelope when the app operation failed in a Snapback-understood
way.

```json
{
  "schemaVersion": "snapback.v0",
  "resultKind": "hostOpsResult",
  "requestId": "01J...",
  "operation": "function.run",
  "ok": false,
  "target": {
    "appId": "todo",
    "appRoot": "/path/to/app",
    "targetProfile": "local.ibex.sqlite",
    "serverUrl": "http://127.0.0.1:4287"
  },
  "authority": {
    "mode": "devUser",
    "actorPrincipal": null,
    "effectivePrincipal": { "userId": "u_123", "roles": [] },
    "localDevOnly": true,
    "adminBypass": false,
    "scope": null,
    "reason": "acceptance fixture"
  },
  "artifacts": {
    "schemaHash": "sha256:...",
    "bundleHash": "sha256:...",
    "databaseVersion": 42
  },
  "data": {},
  "diagnostics": [],
  "next": []
}
```

Required envelope fields:

- `schemaVersion`: `snapback.v0` for the first implementation, matching the
  LLP 0012 artifact version floor;
- `resultKind`: `hostOpsResult`;
- `requestId`: stable id generated or accepted by the host-ops core;
- `operation`: one of the operation ids in this Spec;
- `ok`: true only when the requested operation completed without error or fatal
  diagnostic;
- `target`: app/server facts sufficient for an agent to know what it operated;
- `authority`: the authority tuple applied or `null` for operations that do not
  need one;
- `artifacts`: hashes, versions, or loaded artifact references relevant to the
  operation;
- `data`: operation-specific structured payload;
- `diagnostics`: an array of LLP 0012 diagnostic objects;
- `next`: optional machine-readable follow-up hints.

`diagnostics[]` is the only diagnostic channel. The envelope must not add
projection-specific error fields such as `mcpError`, `cliError`, or
`httpError`. A CLI exit code, HTTP status, or MCP tool-call failure is a
transport projection over `ok`, diagnostic severity, and whether the envelope
could be produced at all.

`data` is intentionally operation-specific, but the following result keys are
reserved when applicable:

- `runtimeState`;
- `schemaManifest`;
- `functionManifest`;
- `capabilityManifest`;
- `acceptanceReport`;
- `functionResult`;
- `mutationCommit`;
- `explanation`;
- `dryRun`;
- `audit`.

## Authority Tuple

The v0 authority modes are:

| Mode | Meaning | Hosted status |
| --- | --- | --- |
| `none` | No app user context is needed. | Allowed for non-sensitive inspect/health only. |
| `unauthenticated` | Run as a guest/unauthenticated app principal. | Allowed where the app exposes that path. |
| `devUser` | Local dev impersonation as a user id and optional roles. | Local/dev only. |
| `devAdminBypass` | Local admin bypass with an explicit reason. | Local/dev only, never implicit. |
| `servicePrincipal` | Actor principal with scoped grant and optional effective principal. | Reserved until LLP 0011 pins scoped tokens. |

Every `function.run`, `function.explain` permission check, mutation dry-run,
direct admin write, reset, or acceptance profile that mutates state must record
the authority tuple. Local dev impersonation must set `localDevOnly: true` and
emit or retain an audit/diagnostic fact that the operation did not prove hosted
authorization.

Hosted app-data MCP mutation tools are gated on `servicePrincipal`. Until
LLP 0011 defines scoped tokens, hosted projections must reject those calls with a
structured capability/auth diagnostic. They must not silently reinterpret
`devUser` as hosted authority.

The environment half of this authority tuple is operation-level policy, not a
property of one route. Every alias and transport asks the same centralized
profile policy before executing the operation core: provisioning/reset and any
`function.run` or `function.explain` carrying a caller-selected `userId` require
a non-production profile. A host-ops result reports the active profile in its
target metadata rather than hard-coding local development (ENG-24561).

The admin half is likewise operation-level policy. `function.explain` and
query/live-query `function.run` require `AdminRead`; full `app.inspect`, reset,
manifest loads, and mutation/action `function.run` require `AdminWrite`.
Anonymous identity inspection uses the typed root `/inspect` projection.
Unknown operations fail closed at `AdminWrite`. The multiplexed endpoint and
dedicated aliases resolve this table against the same installed function kind,
so selecting a transport cannot change the token requirement (ENG-24561).

The two LLP 0057 operator operations add a second, independent effect gate.
`auth.mintSession` and `auth.rescueCollidingTable` require all of:

1. their exact operation profile — dev/demo/test for `auth.mintSession`, but
   dev/test only for `auth.rescueCollidingTable`;
2. the ordinary `AdminWrite` credential; and
3. the process-bound `ImpersonationCapability` carried only in
   `x-snapback-impersonation-capability`.

None of those authorities substitutes for another. The session bearer, admin
token, console credential, secret-read lease, or raw keyring material cannot
satisfy the impersonation comparison. Both operations use closed `args` and the
normal envelope. `auth.mintSession` returns `CredentialSecret`, applies
`Cache-Control: no-store`, and is unavailable in active `dev` until item 4;
its success envelope records `authority.reason: "issuedBy: admin"`.
`auth.rescueCollidingTable` returns only operator metadata and remains available
in `dev` so an operator can repair a dormant collision without enabling
sessions. Stored-manifest collisions that prevent normal open use LLP 0057's
separate loopback recovery posture and still require restart after rescue.

## CLI Projection

The v0 CLI command is `snapback`. All commands that can return structured data
accept `--json`; CI and agents should use it by default. Human summaries are
rendered from the same envelope.

Common flags:

- `--app-root <path>`: app root; defaults to the current directory;
- `--server <url>`: attach to an existing Snapback server;
- `--target-profile <id>`: target profile, defaulting to
  `local.ibex.sqlite` for v0;
- `--request-id <id>`: caller-supplied request id for traceability;
- `--json`: print the result envelope as JSON;
- `--timeout <duration>`: operation timeout.

Authority flags:

- `--unauthenticated`;
- `--as-user <userId>`;
- `--as-role <role>` repeatable, only with `--as-user`;
- `--dev-impersonation`: required with `--as-user` or `--as-role` until a real
  auth provider/session token is available;
- `--admin-bypass`;
- `--reason <text>`: required with `--admin-bypass`;
- `--service-principal <token-ref>`: reserved for the scoped-token design in
  LLP 0011.

The CLI verbs map to operation ids as follows:

| CLI | Operation id |
| --- | --- |
| `snapback start` | `host.start` |
| `snapback stop` | `host.stop` |
| `snapback restart` | `host.restart` |
| `snapback reset [--seed <path>]` | `app.reset` |
| `snapback load schema <path>` | `schema.load` |
| `snapback reload schema` | `schema.reload` |
| `snapback load functions <path-or-entry>` | `functions.load` |
| `snapback reload functions` | `functions.reload` |
| `snapback inspect` | `app.inspect` |
| `snapback run <function-id> --args-json <json>` | `function.run` |
| `snapback explain <function-id> --args-json <json> --kind <kind>` | `function.explain` |
| `snapback acceptance run [profile]` | `acceptance.run` |

`snapback run` must require a generated function id or generated reference. A
human-friendly exported name may be accepted only when it resolves uniquely
against the loaded `functionManifest`, and the result must still report the
canonical function id.

## HTTP Projection

HTTP lives under the admin namespace reserved by LLP 0017. The canonical v0
entry point is:

```text
POST /_snapback/api/host-ops
```

The request body is:

```json
{
  "schemaVersion": "snapback.v0",
  "requestId": "01J...",
  "operation": "app.inspect",
  "args": {},
  "authority": null
}
```

The response body is the result envelope. Existing local routes such as
`/health`, `/inspect`, `/admin/schema`, `/admin/functions`, `/admin/reset`, and
`/admin/seed` may remain v0 aliases while the implementation moves, but they are
compatibility routes. New agent tooling should target
`/_snapback/api/host-ops`.

HTTP status codes are projection-level hints:

- `200` when an envelope was produced, including `ok: false` app-level failures;
- `400` for malformed requests that cannot identify an operation;
- `401`/`403` for transport/admin API authentication failures before the
  host-ops core can run;
- `404` for a missing Snapback admin API;
- `500` only when the server failed before it could construct an envelope.

Whenever possible, the server should return an envelope with `ok: false` and
LLP 0012 diagnostics rather than relying on HTTP status alone.

## Control-Plane MCP Projection

The control-plane MCP server exposes these tools. Each tool calls one host-ops
operation and returns the same result envelope as JSON.

| MCP tool | Operation id |
| --- | --- |
| `snapback_start` | `host.start` |
| `snapback_stop` | `host.stop` |
| `snapback_restart` | `host.restart` |
| `snapback_reset` | `app.reset` |
| `snapback_load_schema` | `schema.load` |
| `snapback_reload_schema` | `schema.reload` |
| `snapback_load_functions` | `functions.load` |
| `snapback_reload_functions` | `functions.reload` |
| `snapback_inspect` | `app.inspect` |
| `snapback_run_function` | `function.run` |
| `snapback_explain` | `function.explain` |
| `snapback_acceptance_run` | `acceptance.run` |

The MCP tool schemas should mirror the core `args` and `authority` structures.
MCP display text may summarize diagnostics, but the structured content must
include the envelope. MCP tool failures should be reserved for transport,
protocol, or server-crash cases where no envelope exists.

The control-plane MCP server may start a local server or attach to one. It must
not expose generated app functions as ad hoc tools. Those live in the generated
app-data MCP catalog below, with separate authority.

## Generated App-Data MCP Catalog

The app-data MCP catalog is generated from the loaded LLP 0012
`functionManifest`. It is a projection of generated functions, not a hand-written
API surface.

The catalog root includes:

- `schemaVersion: "snapback.v0"`;
- `catalogKind: "appDataMcpCatalog"`;
- `appId`;
- `bundleHash`;
- `functionManifestHash` or equivalent artifact hash;
- generated-at time;
- target profile and capability summary;
- the default authority policy for local and hosted targets.

Each generated function becomes a candidate MCP tool entry with:

- `toolName`: deterministic and derived from the generated function id;
- `functionId`: the canonical id from the function manifest;
- `title`: exported name or generated reference label;
- `description`: kind, auth requirement, capabilities, syncability class, and
  read/write summaries;
- `inputSchema`: JSON Schema derived from the args validator;
- `outputSchema`: generated type reference or `unknown` with a diagnostic if the
  return shape is not known;
- `kind`: `query`, `mutation`, and later `action`;
- `requiredCapabilities`;
- `authorityRequired`;
- `dryRunSupported`;
- `sourceSpan` when available;
- `bundleHash`.

The first deterministic tool-name rule is:

```text
snapback_fn_<functionId>
```

where `<functionId>` is sanitized to lowercase ASCII letters, digits, and
underscores. If sanitization collides, codegen must append a stable short hash
from the original function id and emit a diagnostic. The function id remains the
authoritative identity; the tool name is transport packaging.

A catalog entry does not imply permission to call the function. The caller must
provide an authority tuple. Queries may run as `unauthenticated`, `devUser`, or
`servicePrincipal` only when the app auth rules allow the requested behavior.
Mutations follow the same rule and are additionally disabled for hosted
app-data MCP until service-principal scoped tokens exist.

Generated app-data MCP calls return the `function.run` or `function.explain`
result envelope. They do not define an MCP-specific result shape.

## Dry-Run and Explain-Denial

Mutation dry-run is the follow-up shape for safe agent operation. The surface is
reserved in v0 even if the first implementation returns a missing-capability
diagnostic.

`function.explain` with `kind: "mutationDryRun"` should eventually execute the
same generated mutation through the same handler, `ctx.db`, auth, validator, and
read-set capture path as a real `function.run`, then discard buffered writes
instead of committing them. The result's `data.dryRun` object should include:

- `wouldCommit`: boolean;
- `denied`: boolean;
- `denialReason`: structured permission/capability reason when denied;
- `predictedWrites`: table/id/field summaries safe to expose;
- `readSet`: read dependencies captured during execution;
- `writeSet`: buffered writes captured during execution;
- `readSetValidation`: `valid`, `stale`, `notChecked`, or `unsupported`;
- `deterministicInputs`: runtime-provided time/id facts used;
- `sideEffects`: always empty for v0 queries/mutations; future actions need a
  separate contract;
- `diagnostics`.

If a real `function.run` mutation is denied, its envelope should include a
`next` hint pointing at `function.explain` with `kind: "permissionDeny"` or
`kind: "mutationDryRun"` when that would add useful detail.

Dry-run must not be a lower-fidelity evaluator. Until it can reuse the real
mutation path, Snapback should report it as unavailable with a structured
capability diagnostic rather than pretending the explanation is authoritative.

## Acceptance Requirements

Before this Spec moves beyond `Draft`, the first implementation should prove:

- CLI, HTTP, and control-plane MCP call the same operation ids and return the
  same result envelope for `app.inspect`;
- `snapback run` and `snapback_run_function` invoke a generated query by
  function id and report the same diagnostics and return value;
- a generated app-data MCP catalog is emitted from a function manifest and
  contains one query and one mutation tool with JSON schemas derived from args
  validators;
- mutation app-data MCP calls require an explicit authority tuple and reject
  hosted/local-misclassified authority with an LLP 0012 diagnostic;
- CLI `--as-user --dev-impersonation` and `--admin-bypass --reason` are visibly
  represented in the authority tuple;
- an unsupported dry-run reports a structured capability diagnostic, and a
  denied mutation result contains a machine-readable `next` explanation hint;
- HTTP legacy routes either delegate to the same host-ops core or are documented
  compatibility aliases;
- no projection returns a distinct diagnostic shape for the same core failure.

## Open Questions

- Which source-of-truth schema file should define `hostOpsResult` so Rust,
  TypeScript, CLI, HTTP, and MCP codegen cannot drift?
- Should `/_snapback/api/host-ops` stay as one operation endpoint, or should
  public docs also expose per-operation REST-ish aliases after the core is
  stable?
- How much of `next` should be generated by the host-ops core versus by
  projection adapters that know the user's local tool context?
- What is the exact LLP 0011 scoped-token shape for hosted app-data MCP,
  including token TTL, actor/effective principal fields, audit storage, and
  revocation?
- Should app-data MCP catalogs be served by the running app server, emitted as
  static generated files, or both?
- Which mutation dry-run facts can be safely returned in hosted environments
  without leaking sensitive row data through predicted writes?

## Status

Draft. This Spec is the first operating-surface pin for agents. It deliberately
keeps hosted/service-principal authority and full-fidelity mutation dry-run as
gated follow-up work rather than hiding those gaps behind local impersonation.
