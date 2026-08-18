# LLP 0024: Agent operating surface

**Type:** Spec
**Status:** Draft
**Systems:** Developer experience, Runtime, API, Tooling, Testing, Auth, Security, Client integration
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-27
**Revised:** 2026-08-10 (operational readiness core fact amendment: server-owned
`OperationalReadinessV1` evaluated against a launcher-declared closed
activation target, served as `app.readiness.v1` plus the authenticated
`app.inspect` splice, projected by the application-ready receipt and the
native CLI-only `host.wait`; see §Dated amendment: operational readiness
core fact). 2026-08-10 (ruled remediation apply amendment: a read-only
generation-fenced host operation plus CLI/MCP projections consumes one exact
LLP 0146 carrier item and returns a repaired identifier). 2026-08-08 (native machine-mode amendment: the native CLI adopts
the frozen app-data exit taxonomy, makes requested JSON failure-safe through
`hostOpsResult`, makes bare invocation discovery-only, and exports versioned
Guide search and command-inventory projections); 2026-08-08 (catalog projection repair: `host.restart` names the
ready-file-bearing CLI spelling, `auth.mintSession` records its shipped
session-mint CLI projection, and failed host-operation envelopes acquire
catalog-derived Guide/CLI `next[]` entries); 2026-08-06 (LLP 0184 Phase 2 residue: `host.restart` is built as
the native `snapback restart` CLI plus the existing `snapback_restart` MCP
composition; both prove a concrete admin credential through the live
AdminRead host-ops route before the nonce-verified stop and return one request
id/envelope); 2026-08-06 (LLP 0184 Phase 2 residue: add the built AdminRead
`cron.list` host operation and its direct GET, CLI, and MCP projections over
the LLP 0028-owned in-memory scheduler inspection state); 2026-08-04 (LLP 0167 OQ2 ruling author-ratified: the `debug.*`
runtime-perturbation family is decided, with built
`debug.networkProfileGet` / `debug.networkProfileSet` host operations, CLI
verbs, and control-plane MCP projections); 2026-08-01 (shared app-data result core amendment: the
Rust-owned `AppDataResultCoreV1` + committed schema, the
`appCliCallResult` wrapper-to-core mapping, the frozen per-kind mapping
table, the forward-skew fallback rules by wire locus with residues #8/#10
frozen — unknown codes never exit 8, envelope-absent is exit 7 — and the
MCP-catalog parity obligation; see §Dated amendment: shared app-data
result core); 2026-07-23 (dated pointer note: the provisioning/project-lifecycle contract's proposed home is LLP 0089; this Spec's scope exclusion stands); 2026-07-16 (ENG-24920 companion amendment); 2026-07-15 (ENG-25001: make LLP 0024 the explicit host-operation DTO owner, require the credential authority descriptor, and distinguish ordinary from startup-recovery rescue output); 2026-07-13 (ENG-24596 final audit: preserve frozen LLP 0039's narrower dev/test-only collision-rescue profile while mint remains dev/demo/test); 2026-07-13 (ENG-24596: add the built `auth.mintSession` and `auth.rescueCollidingTable` host operations, including their independent authority axes, activation fence, and exact result projections; earlier: ENG-24561 centralized operation profile and AdminRead/AdminWrite requirements across dedicated and multiplexed transports; provisioning and dev-user impersonation fail closed in prod, and host-ops reports the active profile. Earlier: 2026-07-01 LLP 0032 R4: implementation-status banner added — pinned contract, not built surface)
**Related:** LLP 0000, LLP 0003, LLP 0004, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0017, LLP 0019, LLP 0020, LLP 0023, LLP 0057

> **Implementation status (2026-07-02 — the LLP 0032 P6 first slice is
> built).** The `snapback` CLI and the host-ops HTTP endpoint
> (`POST /_snapback/api/host-ops`, per-operation admin-gated and registered in the
> LLP 0031 route registry) exist and share one `hostOpsResult` envelope
> (`crates/snapback/src/host_ops.rs` is the source of truth; the committed
> `schemas/host-ops.result.schema.json` is generated from it per LLP 0037).
> Per-verb status:
>
> - **Built:** `host.start` (CLI `snapback start`, foreground; structured
>   readiness is the `--ready-file` descriptor —
>   `schemas/host-ready.schema.json` — per LLP 0030's out-of-band
>   handshake), `host.stop` (CLI, via the readiness descriptor; signals the
>   pid only after the descriptor's `startupNonce` matches the live `/health`
>   identity, refusing stale or unverifiable descriptors — ENG-23366),
>   `host.restart` (native `snapback restart` plus `snapback_restart`; one
>   credential-proven stop/start composition, request id, and envelope),
>   `app.inspect`, `app.reset` (with optional seed), `schema.load`,
>   `functions.load`, `function.run` (queries and mutations; never actions)
>   — each as CLI verb + HTTP operation, tested in `crates/snapback/tests/host_ops_v0.rs`.
> - **Built in ENG-24596:** `auth.rescueCollidingTable`, and
>   `auth.mintSession` behind its deliberate sessions-mode activation fence.
>   Both use the shared HTTP `hostOpsResult` projection, require `AdminWrite`
>   plus the independent process-bound `ImpersonationCapability`, and use
>   closed generated DTOs. Mint is available only in dev/demo/test; rescue is
>   narrower and available only in dev/test. Rescue remains reachable in
>   `dev`; mint fails closed there until item 4 activates
>   `sessions`. LLP 0057 owns their exact provider and rescue semantics.
> - **Built (2026-07-23 reconciliation):** `function.explain` is served at
>   `AdminRead` (only its unbuilt explanation *kinds* return
>   `SNAPBACK_EXPLAIN_KIND_UNIMPLEMENTED`), and the **control-plane MCP
>   projection shipped** as `snapback mcp-control` (LLP 0042's 2026-07-23
>   implementation checkpoint; LLP 0079 SC-1b).
> - **Built under the proposed LLP 0167 OQ2 ruling (2026-08-04; the author may
>   veto the namespace):** `debug.networkProfileGet` (`AdminRead`) and
>   `debug.networkProfileSet` (`AdminWrite`) return the shared envelope and
>   terminate at the same network-profile activation gate as the dedicated
>   admin routes.
> - **Pinned, not built:** `schema.reload`, `functions.reload`,
>   `acceptance.run` — requested over HTTP they return
>   the structured `SNAPBACK_HOST_OP_UNIMPLEMENTED` envelope (`host.*` over
>   HTTP returns `SNAPBACK_HOST_OP_CLI_ONLY`). As of ENG-25388 these
>   operations are registered in the HTTP operation registry at their
>   authority classes (write-class; explain read-class), so the honest
>   envelope is actually reachable over HTTP behind the admin gate — truly
>   unknown operations still fail closed at `AdminWrite` with
>   `SNAPBACK_HOST_OP_UNKNOWN`.
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

**OQ2 ruling (proposed 2026-08-04, author-ratified 2026-08-04):** runtime
perturbation operations form a new `debug.*` family. The first two members are
the rows below; future D6/fault-injection operations may join the family only
through their own reviewed table amendments.

| Operation id | Purpose | Required v0 result data |
| --- | --- | --- |
| `host.start` | Start or attach to the canonical local Snapback server. | `runtimeState`, `capabilityManifest`, bound URL, process id, readiness. |
| `host.stop` | Stop a local server owned by this app/root. | stopped process id, previous bound URL, final diagnostics. |
| `host.restart` | Stop then start using one request id. | previous and new `runtimeState`, restart reason. |
| `host.wait` | Block until the local server reaches host or application readiness (CLI-only; LLP 0224). | `level`, waited time, bound URL, `startupNonce`; at application level the receipt path and the live `operationalReadiness` fact. |
| `app.reset` | Deterministically clear local app state and optionally apply a seed. | reset scope, seed id/path/hash, resulting database version. |
| `schema.load` | Load a schema manifest/source into the local server. | schema hash, load time, schema diagnostics. |
| `schema.reload` | Re-run schema discovery/codegen and load the resulting schema. | previous/new schema hashes, stale-artifact diagnostics. |
| `functions.load` | Load generated function bundle/manifest into the local server. | bundle hash, function count, unsupported dependency diagnostics. |
| `functions.reload` | Re-run function discovery/bundling and load the result. | previous/new bundle hashes, stale-artifact diagnostics. |
| `app.inspect` | Inspect loaded schema, functions, capabilities, runtime state, subscriptions, clients, and recent diagnostics. | `runtimeState`, `schemaManifest`, `functionManifest`, `capabilityManifest`, diagnostics; on the authenticated host-ops projection additionally `operationalReadiness` (LLP 0224). |
| `app.readiness.v1` | Declare the closed expected activation target and evaluate the server-owned operational-readiness fact (read-only without input). | `operationalReadiness` (the `snapback.operational-readiness.v1` fact: `ready`, unsatisfied conditions, observed LLP 0058 settlement facts, artifact and capability digests, recorded network profile). |
| `cron.list` | List declared cron jobs and current operator-safe scheduler posture without running work. | `cron` with declared identity/schedule, activation, next nominal/due, in-flight boolean, last-run/outcome, and consecutive failures; never run ids, handler diagnostics/results, jitter seeds, or recent-run payloads. |
| `function.run` | Run one generated query or mutation by function id. | return value or mutation commit facts, read/write summaries when available, diagnostics. |
| `function.explain` | Explain query plans, permission decisions, capability gaps, or mutation denial/dry-run facts without committing. | explanation kind, decision, read/write predictions where available, diagnostics. |
| `acceptance.run` | Run the local acceptance suite or a named profile. | profile id, passed/failed/skipped counts, diagnostics, artifact paths. |
| `auth.mintSession` | Provision the canonical email identity/user if needed and issue a session credential for an operator-selected address. | the closed credential payload: `tokenType`, `token`, `refreshAfter`, public `session`, and required top-level `authorityDescriptor`; the nested session exposes no identity subject, digest, generation, or authority-instance id. |
| `auth.rescueCollidingTable` | Transactionally move one legacy auth-reserved table to an ordinary app-table name. | ordinary service: exactly `source`, `target`, `copiedRowCount`, `copiedExplicitIndexCount`, `manifestUpdated`, and `catalogCollisionCleared`; startup-recovery service adds exactly `restartRequired: true`; never rows. |
| `debug.networkProfileGet` | Read the active process-local network condition profile. | The active profile plus activation provenance, exactly the `GET /_snapback/api/debug/network-profile` response shape. |
| `debug.networkProfileSet` | Activate a built-in name or inline process-local network condition profile. | The newly active profile plus activation provenance, or the activation gate's refusal diagnostic. |

This document owns the host-operation `data` DTOs. LLP 0057 owns the provider
semantics that populate them; it does not remove or reinterpret fields here.

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
| `servicePrincipal` | Actor principal with scoped grant and optional effective principal. | Sessions-mode generated app-data calls only; hosted use remains gated below. |

Every `function.run`, `function.explain` permission check, mutation dry-run,
direct admin write, reset, or acceptance profile that mutates state must record
the authority tuple. Local dev impersonation must set `localDevOnly: true` and
emit or retain an audit/diagnostic fact that the operation did not prove hosted
authorization.

Hosted app-data MCP mutation tools are gated on `servicePrincipal`. The scoped
token slice now exists for eligible local and trusted-local sessions targets,
but hosted projections must still reject those calls with a structured
capability/auth diagnostic until the deployment and audit gates in the dated
amendment below land. They must not silently reinterpret `devUser` as hosted
authority.

The environment half of this authority tuple is operation-level policy, not a
property of one route. Every alias and transport asks the same centralized
profile policy before executing the operation core: provisioning/reset and any
`function.run` or `function.explain` carrying a caller-selected `userId` require
a non-production profile. A host-ops result reports the active profile in its
target metadata rather than hard-coding local development (ENG-24561).

The admin half is likewise operation-level policy. `function.explain` and
query/live-query `function.run`, and `debug.networkProfileGet` require
`AdminRead`; full `app.inspect`, reset,
manifest loads, and mutation/action `function.run` require `AdminWrite`.
`debug.networkProfileSet` also requires `AdminWrite`, while its environment
profile requirement is deliberately `Any`: every request must reach LLP 0167's
finer activation gate so `SNAPBACK_NETWORK_PROFILE_FORBIDDEN` and the other
network-profile refusal codes remain identical across transports.
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
| `snapback cron list` | `cron.list` |
| `snapback run <function-id> --args-json <json>` | `function.run` |
| `snapback explain <function-id> --args-json <json> --kind <kind>` | `function.explain` |
| `snapback acceptance run [profile]` | `acceptance.run` |
| `snapback network-profile get` | `debug.networkProfileGet` (OQ2 ruling, ratified 2026-08-04) |
| `snapback network-profile set <name-or-inline-json>` | `debug.networkProfileSet` (OQ2 ruling, ratified 2026-08-04) |

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
| `snapback_cron_list` | `cron.list` |
| `snapback_run_function` | `function.run` |
| `snapback_explain` | `function.explain` |
| `snapback_acceptance_run` | `acceptance.run` |
| `snapback_network_profile_get` | `debug.networkProfileGet` (OQ2 ruling, ratified 2026-08-04) |
| `snapback_network_profile_set` | `debug.networkProfileSet` (OQ2 ruling, ratified 2026-08-04) |

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
app-data MCP until the dated deployment and audit gates below land.

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

## Dated amendment: agent principals and roles (2026-07-16)

`servicePrincipal` is admitted only for generated app-data calls through the
app-data gate in an eligible local or trusted-local sessions deployment. Host
operations (including `function.run`), provisioning, and lifecycle verbs do
not resolve scoped tokens. Hosted use remains refused until LLP 0060's
target-authored deployment contract lands; hosted mutations additionally
require LLP 0019 F8's durable audit log.

The MCP/CLI authority matrix preserves dev `devUser` and `devAdminBypass` and
adds sessions-mode app-data `servicePrincipal`; one does not displace the
other. Bare `--as-role <role>` must resolve to exactly one app-global
membership declaration; ambiguous roles are refused, while
`--as-role <declaration>:<role>` is declaration-qualified. Scoped declarations
require `--as-membership <declaration>:<resource>:<role>`, which is row-seeding
sugar, not ambient authority. `--as-agent` selects a synthetic
dev-impersonation agent principal and never authenticates as a durable
production agent.

## Dated note: provisioning contract home (2026-07-23)

The hosted-control-plane and project-lifecycle operations this Spec's scope
section excludes — create-app, push-schema/permissions/code, version
selection and rollback — now have a proposed contract home in
[LLP 0089](./0089-agent-provisioning-surface.rfc.md) (Draft, authored under
LLP 0086 §CC-1, resolving that plan's open question 4). This Spec's scope is
**not** extended: it remains the operating surface for an app on a running
server, and its exclusion of hosted control planes, billing, tenants, and
project lifecycle stands. LLP 0089 reuses this Spec's result-envelope shape
and projection-consistency rule, and the hosted-authority prerequisites in
the 2026-07-16 amendment above (LLP 0060's deployment contract, LLP 0019
F8's audit log, the LLP 0011 service-principal work) bind LLP 0089's hosted
half unchanged.

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

## Dated amendment: versioned seed operations (2026-07-27)

LLP 0109 adds four local NonProd operations:
`app.seed.ensure.v1`, `app.seed.preview.v1`,
`app.seed.reset-install.v1`, and `app.seed.clear.v1`. All four require
AdminWrite before body-specific inspection. Their closed request lives only
under `HostOpsRequest.input`; understood failures use this Spec's HTTP-200
`hostOpsResult` envelope and carry the same diagnostic as the corresponding
direct route. Successful `data` is the Rust-owned LLP 0109 result without a
host-specific reinterpretation.

## Dated amendment: shared app-data result core (2026-08-01)

The canonical shared result this Spec promises ("one shared result
envelope across CLI/HTTP/MCP") gains its frozen app-data form, per LLP
0062 §2 and the recommissioned app-CLI program (ticket
`issues/20260801-0062-04-shared-result-core.md`; ENG-25406 lineage).

**The core.** `AppDataResultCoreV1` is a Rust-owned serialized DTO
(`crates/snapback/src/app_data_result.rs`, committed schema
`schemas/app-data.result-core.schema.json`, LLP 0037 ownership: the Rust
type is the shape authority; engines construct conforming documents and
the drift gate holds the committed schema equal to the type). Closed
members: `artifactKind: "appDataResultCore"`, `formatVersion:
"snapback.app-data-result.v1"`, `kind` (`query | mutation | action |
live-snapshot` — the per-kind mapping below), `outcome` (`ok |
app-refusal | refused | failed | transport-failed | timeout | unknown |
not-dispatched`), `value`, `facts`, `appRefusal {appCode, details?}`
(the LLP 0108 declared-refusal channel, typed end to end),
`diagnostics[]` (the public projection — `code`, `severity`,
`subsystem` — plus wire `locus`, optional `httpStatus`, the
`unrecognized` marker, and allowlisted `fields` only; free-text
`message`/`details` never pass), `attribution` (the server-derived block
verbatim, never synthesized or reshaped — LLP 0055 §Audit), `mutation`
(`clientMutationId`, `underlying`), and the **reserved** `taggedValues`
extension point (declared for LLP 0004's anticipated exact-64-bit/
decimal/binary negotiation; v1 emitters never set it and v1 validation
refuses it).

**Wrapper-to-core mapping.** `appCliCallResult`
(`snapback.app-cli-call-result.v1`) is the engine's presentation
wrapper, not a second envelope: it embeds the core **verbatim** and adds
only `engine {name, version}` and the server-derived active `envelope`
identity — absent, not null, on dev targets, which hold none. Parity
distinguishes core parity (byte-identical across HTTP, headless client,
CLI, and the future MCP catalog) from wrapper identity (engine-owned).
The MCP catalog carries the same core when it lands; that obligation is
stated here and does not block the app-CLI phase.

**Per-kind mapping (frozen).** query → `value` = rows; mutation →
`value` = the mutation result with protocol facts under `facts`
(`changedCount`, receipts, active identity) and `mutation` carrying the
durable `clientMutationId`; action → `value` = the action value, an
`ok: false` run mapping to outcome `failed` (exit 5) or, when the
refusal is a declared `ctx.refuse`, to `app-refusal` (also exit 5,
typed); one-shot live query → `kind: "live-snapshot"` with `value` =
the snapshot rows.

**Exit taxonomy.** LLP 0062 §2 owns the frozen table (0–11, exit 1
reserved for engine-internal failure, signal deaths outside the
taxonomy); the mapping from outcomes and diagnostics to exits is
implemented once in the engine's shared module
(`packages/snapback-app-cli/result-core.mjs`) and consumed by every
projection — a projection never re-derives it. Never-renumber applies:
changing a number is a compatibility event.

**Forward skew (LLP 0062 residues #8 and #10, frozen).** An
unknown-but-syntactically-valid server diagnostic code is preserved
verbatim, marked `unrecognized`, and never rewritten — recognition is
presentation, never a third compatibility gate. Its exit falls back by
**wire locus and result kind**, never to exit 8: non-2xx request locus →
3 when auth-shaped (401/403 or `SNAPBACK_AUTH_*`), 6 on 5xx, else 5;
HTTP-200 result locus → 5; live terminal → 3 when auth-shaped, else 5;
broker → 5. The envelope-less sessions target that requires redeploy is
frozen as exit 7 with sub-cause `envelope-absent`
(`SNAPBACK_APP_CLI_ENVELOPE_ABSENT`) — an identity-establishment
failure, explicitly not exit 8.

`SNAPBACK_APP_CLI_*` is registered in LLP 0012's shared diagnostic
dialect by that Spec's dated registration of the same day; changing an
emitted code is a compatibility event there.

## Dated amendment: cron inspection projection (2026-08-06)

LLP 0028 owns cron definitions and scheduler state. This Spec owns the
operator transport shape: `cron.list` is an `AdminRead`/
`AdminCredential`/`OperatorMetadata` host operation, projected through
`POST /_snapback/api/host-ops`, the direct `GET /_snapback/api/cron` alias,
`snapback cron list`, and `snapback_cron_list`. Every projection reads the
same loaded-manifest and in-memory scheduler inspection facts; none infers
inspection by calling `cron.tick` or `cron.runOne`, and none creates a new
ledger or persistence rule. The host-operation result carries the narrow LLP
0028 DTO under `data.cron`; the direct GET returns that DTO itself.

## Dated amendment: native machine mode (2026-08-08)

The native `snapback` projection adopts LLP 0062's already-frozen exit
taxonomy unchanged: success 0; usage 2; auth refusal 3; function not found 4;
function/operation failure 5; transport failure 6; artifact identity mismatch
7; version mismatch 8; timeout 9; script error 10; resource exceeded 11. Exit 1
remains reserved for an engine-internal failure and gains no public semantic
class. New diagnostics may join a class, but no class may be renumbered.

When a caller requests a JSON mode (`--json` or the native `--format json`
spelling), every pre-operation or projection failure returns one
`hostOpsResult` failure envelope with the stable diagnostic under
`diagnostics[]`; prose is not a second machine-mode failure grammar. Native
operation envelopes map their first diagnostic through the same table instead
of collapsing `ok: false` to exit 1. CLI argument diagnostics carry
`details.command` so an agent can select the precise help surface.

Bare `snapback` is discovery-only root help. Foreground native serving is
explicitly `snapback start`; the managed authoring loop remains `snapback dev`.
The binary's `--version` is the crate version carried by `BinaryIdentity`, and
the hidden `command-inventory` projection exposes the Clap-owned tree as
`snapback.native-command-inventory.v1` for composed package help. Guide JSON is
total as `snapback.guide-search.v1`: channels, exact-symbol, fuzzy section, and
zero-match outcomes share one envelope, with the existing exact lookup nested
as its result rather than leaked as an alternate top-level grammar.

CLI-only offline/store/auth and build/runtime probes either use
`hostOpsResult` where that is their natural operation result or carry an
explicit family `schemaVersion`. Admin console/link JSON likewise preserves
the fragment-bearing URL; attached links may publish an owner-only readiness
record that is removed when their observation lifecycle ends.

## Dated amendment: catalog-bound CLI and refusal acquisition paths (2026-08-08)

The built lifecycle and auth projections are recorded exactly as
`snapback restart --ready-file <path>` and `snapback session mint --email
<address>`. The latter remains CLI-only because its successful result is a
session credential; no ordinary MCP result projection is implied. A
`SNAPBACK_HOST_OP_CLI_ONLY` diagnostic obtains its command from the embedded
ControlCatalog row (with the ready-file spelling as the restart fallback), so
refusal prose cannot drift from the command the build advertises.

For any `ok: false` `hostOpsResult`, `next[]` contains the operation's
catalog-owned Guide acquisition path and, when non-null, its exact CLI
projection. This is the existing LLP 0024 result carrier used for contextual
next actions, not a new diagnostic `details.remediations` shape; the broader
LLP 0146 OQ6 ruling remains open.

## Dated amendment: remediation apply (2026-08-10)

`remediation.apply` is a served `AdminRead` host operation projected through
`POST /_snapback/api/host-ops`, `snapback remediation apply --input <file|->`,
and `snapback_remediation_apply`. Its closed input carries
`schemaVersion: "snapback.remediation-apply.v1"`, the carrier's exact
`artifactHash`, and one exact item from
`diagnostic.details.remediationSet.items`. The core re-resolves the owning
artifact and replacement while holding the same `LocalSnapback` generation
lock. Hash mismatch or a replacement no longer served returns
`SNAPBACK_REMEDIATION_ARTIFACT_STALE`; an approval-required/non-machine item
returns `SNAPBACK_REMEDIATION_APPROVAL_REQUIRED`.

Success returns only a typed repaired identifier. The operation never invokes
a function, creates an alias, regenerates artifacts, or writes application or
deployment state. A caller explicitly retries its original operation with the
returned value. The prior 2026-08-08 sentence saying OQ6 remained open is a
historical statement superseded by this amendment and LLP 0094's 2026-08-10
ruling record.

## Dated amendment: operational readiness core fact (2026-08-10)

Per LLP 0224 Phase 1 (accepted 2026-08-10), the surface gains one core fact
and thin projections of it.

**The core.** `OperationalReadinessV1` (`crates/snapback/src/operational_readiness.rs`;
committed schema `schemas/operational-readiness.schema.json`; LLP 0037
ownership — the Rust types are the source of truth and
`crates/snapback/tests/artifact_schemas_v0.rs` is the drift gate) is the server-owned
evaluation of the launch-settlement predicate against a closed,
launcher-declared `ExpectedActivationTargetV1`
(`schemas/expected-activation-target.schema.json`). It reports `ready`,
the complete unsatisfied-condition set, the observed LLP 0058 settlement
facts, the capability-manifest digest, artifact identities, and the
recorded (never gating, LLP 0167) network-profile name. A fresh process is
undeclared and fails closed with the `expected-target-undeclared`
condition.

**Operation `app.readiness.v1`** joins the served table on the
authenticated admin tier — `AdminWrite` because declaring the target
mutates process-local state, with `ResponseSensitivity::OperatorMetadata`
and no sessions secret-read overlay (like `cron.list`, the fact carries
identities, digests, and condition names — no application rows and no
credentials, so the ordinary sessions admin carrier suffices): with
`input.expectedTarget` it validates and stores the declared target —
refusing an `obligationsDigest` mismatch
(`SNAPBACK_APP_READINESS_OBLIGATIONS_DIGEST_MISMATCH`), a non-idempotent
seed declaration (`SNAPBACK_APP_READINESS_SEED_NOT_IDEMPOTENT`), and an
unresolved-migration declaration
(`SNAPBACK_APP_READINESS_MIGRATION_UNRESOLVED`) without moving target
authority — then evaluates and returns `data.operationalReadiness`;
without input it is a read-only evaluation. `app.inspect` splices the same
fresh fact into `data.operationalReadiness` on the host-ops path only; the
public `GET /inspect` projection is unchanged (the fact is not public
surface — LLP 0224's conservative authenticated fail-closed posture,
author-reviewed and retained 2026-08-10).

**Projections.** The `snapback.application-ready.v1` receipt file
(`schemas/application-ready.schema.json`, published at the deterministic
`<ready-file>.application-ready` sibling) and the native CLI-only
`host.wait` (`snapback wait --level host|application`) are projections of
the core fact and carry no independent authority; at application level
`wait` requires the live evaluation to be positive for the receipt's
bound target, never trusting file digests alone.

## Status

Draft. This Spec is the first operating-surface pin for agents. It deliberately
keeps hosted/service-principal authority and full-fidelity mutation dry-run as
gated follow-up work rather than hiding those gaps behind local impersonation.
