# LLP 0042: Agent MCP surface

**Type:** RFC
**Status:** Draft
**Systems:** Developer experience, Tooling, API, Runtime, Auth, Security, Client integration, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-08-04 (proposed LLP 0167 OQ2 projection, subject to author
veto: the control-plane server gains thin network-profile get/set tools while
the resource-only Rust `snapback mcp` command remains unchanged); 2026-07-23 (agent-verb scope amendment, LLP 0079 SC-1a: diagnostics reading lands as an `app.inspect`/`snapback_inspect` extension with a non-deferrable bounded recent-invocations minimum; `snapback_acceptance_run` joins the slice exposed-but-unimplemented-honest with its runner deferred; client-surface driving/screenshots recorded as an Exact-side seam; the packaging and catalog-delivery open questions are decided for the first implementation — see the dated amendment); 2026-07-16 (ENG-24920 companion amendment); 2026-07-07 (cross-family review revisions, ratified by Charlie — see
`reviews/0042-agent-mcp-surface.claude.md`: 0024's pinned tool names and five
authority modes adopted, lifecycle asymmetry stated, catalog bound to 0024's
entry shape, destructive-tool posture added; initial same day)
**Related:** LLP 0000, LLP 0010, LLP 0011, LLP 0012, LLP 0017, LLP 0019, LLP 0024, LLP 0031, LLP 0037, LLP 0038, LLP 0039, LLP 0041, LLP 0167

## Summary

This RFC defines the first implementation slice for Snapback's MCP offering.
[LLP 0024](./0024-agent-operating-surface.spec.md) already specifies the shared
host-ops and generated app-data shape — including the pinned control-plane tool
names and authority modes; this RFC selects the first built subset and adopts
0024's pinned vocabulary verbatim rather than restating it. (0024 is itself
`Draft`; landing this slice effectively ratifies the pinned tables it builds
on.)

The first MCP slice is:

- a local control-plane MCP server over existing host-ops;
- generated read-only app-data tools for queries;
- explicit authority tuples for mutations, with mutations disabled for hosted
  targets until service-principal auth exists;
- shared JSON envelopes, not MCP-specific diagnostics;
- no hidden authority beyond the CLI/HTTP surfaces.

## Motivation

Snapback is agent-first in practice: diagnostics, LLPs, stable codes, and demos
are built for agent loops. But the actual agent operating surface is incomplete.
Agents still have to shell out and infer which command to run. Competitors with
MCP or structured docs have a lower first-contact cost for agents.

The MCP surface should expose the same truth Snapback already has, not create a
second API dialect.

## Design

### Control-plane server

The first MCP server starts in a project root and exposes 0024's pinned
control-plane tools:

- `snapback_start`
- `snapback_stop`
- `snapback_restart`
- `snapback_inspect`
- `snapback_reset`
- `snapback_load_schema`
- `snapback_load_functions`
- `snapback_run_function`
- `snapback_acceptance_run` — added 2026-07-23 (LLP 0079 SC-1a); exposed
  with the honest unimplemented posture below until `acceptance.run` is
  built server-side.
- `snapback_network_profile_get` → `debug.networkProfileGet` — proposed LLP
  0167 OQ2 ruling (proposed 2026-08-04, author-ratified 2026-08-04).
- `snapback_network_profile_set` → `debug.networkProfileSet` — same proposed
  ruling; the tool never reimplements activation validation or authority.

The served operations (`app.inspect`, `app.reset`, `schema.load`,
`functions.load`, `function.run`) project 1:1 over the host-ops HTTP surface.
The lifecycle tools do **not**: `host.start`/`host.stop`/`host.restart` are
CLI-only by design — a running server cannot start itself over its own HTTP
surface — so the MCP server embeds the same process-lifecycle logic the CLI
uses (spawn with `--ready-file`, `HostReadyDescriptor` consumption,
`startupNonce`-verified stop), rather than proxying HTTP.

Unimplemented LLP 0024 operations such as `function.explain` may be exposed only
if they return the same structured unimplemented diagnostic
(`SNAPBACK_HOST_OP_UNIMPLEMENTED`) as HTTP/CLI.

Tools declare MCP annotations honestly: `snapback_inspect` is read-only;
`snapback_reset` is destructive and, per 0024, records its authority tuple;
`snapback_stop` in a multi-root workspace must resolve which project's server
it targets before acting (see Open Questions).

### App-data catalog

Codegen emits an MCP catalog from the generated function manifest, using
0024's pinned entry shape: deterministic `snapback_fn_<functionId>` tool names
with sanitization and collision hashing, `catalogKind: "appDataMcpCatalog"`,
and per-entry `outputSchema`, `dryRunSupported`, and `authorityRequired`
alongside the function id, kind, argument schema, capability gaps,
syncability class, and source file/hash when available.

The first catalog exposes query tools by default. Mutation tools exist only
when the caller provides an explicit authority tuple and the target profile
allows that authority.

### Authority

Every app-data tool call carries one of 0024's five authority modes, by their
pinned ids:

- `none` — no app user context; non-sensitive inspect/health only;
- `unauthenticated`;
- `devUser` — local/dev only, `localDevOnly: true`, audit fact emitted;
- `devAdminBypass` — requires an explicit recorded `reason`;
- `servicePrincipal` — sessions-mode generated app-data calls only; the session
  core is [LLP 0039](./0039-auth-vertical-slice.rfc.md), and hosted use remains
  gated by the dated amendment below.

The local slice allows `none`, `unauthenticated`, `devUser`, and
`devAdminBypass`; eligible local and trusted-local sessions targets additionally
allow `servicePrincipal` for generated app-data calls. Hosted
service-principal mutation calls remain rejected with a structured
capability/auth diagnostic until the deployment and audit gates below land.

One security fact stated plainly: the MCP server authenticates to the admin
surface with the auto-minted local admin token, which makes a wired-in MCP
client standing admin authority over the local instance. That is acceptable
under the trusted-local posture only because it is the same authority the CLI
already grants; it must be re-derived, not inherited, for any hosted
projection.

### Result shape

The MCP response includes the shared host-ops or function-run envelope in
structured content. Display text may summarize it, but tests assert on the
structured envelope.

MCP tool failures are reserved for transport or server failures that prevented
Snapback from returning an envelope.

## Non-goals

- Hosted MCP control planes.
- Service-principal token issuance.
- Mutation dry-run facts beyond the unimplemented diagnostic.
- Natural-language schema or function synthesis.
- Replacing CLI and HTTP projections.

## Acceptance

- An MCP client can start or attach to a local Snapback server, inspect it, load
  schema/functions, run a query, and reset state.
- The MCP tools return the same operation ids and diagnostic codes as CLI/HTTP.
- The generated catalog contains at least one query tool **and one mutation
  tool** with JSON schemas derived from the args validators (0024's own
  acceptance bar), built from the function manifest, not from route or filename
  guesses.
- A mutation without explicit authority is rejected with a structured
  diagnostic carrying a machine-readable `next` hint (0024's requirement).
- `snapback_reset` records the authority tuple; `devAdminBypass` calls without
  a `reason` are rejected.
- Hosted service-principal authority is rejected honestly until the dated
  deployment and audit gates below land.

## Dated amendment: service-principal projection (2026-07-16)

The app-data MCP projection is additive: dev host operations retain
`devUser`/`devAdminBypass`; sessions-mode generated app-data tools may use
`servicePrincipal` only through the app-data gate. `function.run`, lifecycle,
and provisioning tools never resolve a scoped token. Hosted service principals
remain refused pending LLP 0060, and hosted mutations additionally await LLP
0019 F8's durable audit log. CLI/MCP copy the server attribution block verbatim
and cannot synthesize attribution authority.

Role simulation follows LLP 0024: `--as-role` names exactly one declaration,
`--as-membership` seeds a row, and `--as-agent` is synthetic dev
impersonation. These are development tools, not production bearer lanes.

## Dated amendment: agent-verb scope (2026-07-23, LLP 0079 SC-1a)

[LLP 0078](./0078-serverpod-lessons.research.md) R3 found this RFC's slice
missing three agent verbs a competitor ships today. This amendment resolves
each, and records two implementation decisions SC-1b needs pinned.

### Diagnostics reading — an `app.inspect` extension, not a new operation

**Decision:** the log/diagnostics verb lands as an extension of the
already-selected `snapback_inspect` → `app.inspect`, not as a new operation.
Rationale: LLP 0024's pinned purpose for `app.inspect` already includes
"recent diagnostics", so no new tool name or operation id is needed — and
LLP 0024 owns that vocabulary, so a new operation would require a 0024 table
amendment this path avoids.

**Non-deferrable minimum** (LLP 0079 SC-1b's acceptance loop depends on it):
`app.inspect`'s `data` gains `recentInvocations` — a bounded, in-memory,
most-recent-first ring of recent operations (function runs and artifact
loads), each entry carrying the operation or function id, outcome (`ok` or
the failing diagnostic code), start time, duration, and the LLP 0012
diagnostics emitted. The bound is fixed per server process (default 128
entries) and entries are evicted oldest-first; the projection is identical
over HTTP host-ops and MCP. Durable retention, filtering, and log querying
are explicitly deferred — a general diagnostics-retention design under
LLP 0010's machine-readable-diagnostics umbrella — with the ring buffer as
the honest first slice.

### Acceptance-suite execution — exposed, runner deferred

**Decision:** `snapback_acceptance_run` (`acceptance.run`, already pinned in
LLP 0024's table) joins this slice's tool list as an exposed tool. Its
server-side runner is **deferred with a named reason**: the acceptance
runner's design — profile discovery, artifact paths, and how app test code
is sandboxed while it drives the server — is its own work item and must not
be improvised inside the MCP slice. Until it is built, the tool returns the
structured `SNAPBACK_HOST_OP_UNIMPLEMENTED` envelope, exactly as the HTTP
projection already does for pinned-but-unbuilt operations. Per LLP 0079,
SC-1b's callable-loop acceptance therefore excludes suite execution.

### Client-surface driving and screenshots — an Exact-side seam

**Decision:** Snapback ships no MCP tool that drives or screenshots a client
surface; this is an **Exact-side seam**, recorded here so the gap is a
documented boundary rather than silence. What Snapback exposes for an
Exact-side driving tool to consume:

- the `HostReadyDescriptor` ready-file (server URL, pid, database target,
  admin-token carrier) for discovering the running backend;
- the machine-readable dev-loop event stream (`snapback.dev.v1` states from
  the packaged dev loop, LLP 0041);
- the generated app-data catalog and shared result envelopes, so a driving
  agent can correlate what it sees on screen with backend state;
- structured LLP 0012 diagnostics.

The Exact side owns launching, driving, and capturing the client surface.
Nothing in this seam grants the driving tool authority beyond what the
consumed surfaces already gate.

### Implementation decisions recorded for SC-1b (2026-07-23)

- **Packaging:** the control-plane MCP server ships inside the
  `@snapback/cli` package as a `snapback mcp-control` command implemented in
  JS, reusing the CLI's existing process-lifecycle helpers (`--ready-file`
  spawn, `HostReadyDescriptor` consumption and target validation,
  nonce-verified stop) directly rather than duplicating them. It speaks
  newline-delimited JSON-RPC over stdio, matching the in-repo precedent of
  the read-only guide projection; the Rust `snapback mcp` command remains
  the guide server, unchanged. A separate `@snapback/mcp` package remains
  possible later without changing the tool contract.
- **Catalog delivery:** the app-data catalog is **derived deterministically
  at server start** from the codegen-emitted artifacts (the function
  manifest plus the per-operation args-schema artifacts), using 0024's
  pinned entry shape. No separate committed catalog artifact is added, and
  served-by-the-running-app delivery stays open in LLP 0024; this slice's
  derivation is a pure function of codegen output, so either future answer
  can absorb it.

## Dated amendment: network-profile control tools (2026-08-04, proposed)

This amendment records LLP 0167 OQ2's **proposed** ruling; Charlie may veto the
`debug.*` namespace. The shipped JS control-plane server (`snapback
mcp-control`) projects `snapback_network_profile_get` and
`snapback_network_profile_set` one-to-one over the two host operations. Tool
results carry the server-produced `hostOpsResult` envelope verbatim, including
request ids and activation refusals. Set accepts the same built-in-name or
inline-profile value as the operation body and terminates at the same activation
gate as admin PUT; MCP adds no validation or authority path.

The Rust `snapback mcp` command remains the read-only, resource-first Guide MCP
server and exposes no tools. These control tools belong to `mcp-control`, the
control-plane surface this RFC selected and shipped; this amendment does not
force tools into the resource-only server.

## Open Questions

- ~~Should the MCP server be shipped inside the `snapback` CLI package or as
  a separate `@snapback/mcp` package?~~ Decided for the first
  implementation — see the 2026-07-23 amendment (inside `@snapback/cli`).
- ~~Static generated catalogs versus served-by-the-running-app~~ — the
  first implementation derives the catalog from codegen output at server
  start (2026-07-23 amendment); LLP 0024's underlying question stays open.
- Which tools should be enabled by default in multi-root workspaces, and how
  does `snapback_stop` name its target server safely? The first slice binds
  one project root per server process (the root it is started in), which
  makes `snapback_stop` unambiguous there; true multi-root behavior remains
  open.

## Status

Draft. This RFC is the first buildable MCP slice under LLP 0024. The
2026-07-23 agent-verb amendment (LLP 0079 SC-1a) widens the slice per
LLP 0078 R3.

**Implementation checkpoint (2026-07-23, LLP 0079 SC-1b).** The control-plane
server shipped as decided above: `snapback mcp-control` in `@snapback/cli`
(`packages/snapback-cli/mcp-control.mjs`), newline-delimited JSON-RPC 2.0
stdio, all nine tools. Lifecycle tools reuse the CLI's ready-file
spawn/validate/nonce-stop helpers; served ops POST
`/_snapback/api/host-ops` with the `x-snapback-admin-token` header (and the
process-bound impersonation capability header for caller-selected-user
operations), returning the shared envelope verbatim — `ok: false` envelopes
are successful tool results. The app-data catalog is derived at server start
from `generated/functions.manifest.json` plus the per-operation args-schema
artifacts (0024's pinned entry shape; queries by default, mutations only
with an explicit authority tuple; `devAdminBypass` without `reason`
refused with a `next` hint). `app.inspect` now carries the SC-1a
`recentInvocations` ring (128 entries, recorded at the host-ops handler so
HTTP and MCP project identically; `crates/snapback/src/host_ops.rs`, `crates/snapback/src/server.rs`).
`snapback_acceptance_run` **proxies** the pinned
`SNAPBACK_HOST_OP_UNIMPLEMENTED` envelope over HTTP: ENG-25388 (resolved
2026-07-23, same day) registered the pinned-unbuilt operations in the HTTP
operation registry at their LLP 0024 authority classes, so the honest
envelope is server-stamped rather than mirrored in-process, and truly
unknown operations still fail closed at `AdminWrite`. The acceptance test
(`packages/snapback-cli/mcp-control.test.mjs`) drives the full loop through
MCP alone and runs in the local proof.
