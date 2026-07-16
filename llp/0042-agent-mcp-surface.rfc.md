# LLP 0042: Agent MCP surface

**Type:** RFC
**Status:** Draft
**Systems:** Developer experience, Tooling, API, Runtime, Auth, Security, Client integration, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-07-16 (ENG-24920 companion amendment); 2026-07-07 (cross-family review revisions, ratified by Charlie — see
`reviews/0042-agent-mcp-surface.claude.md`: 0024's pinned tool names and five
authority modes adopted, lifecycle asymmetry stated, catalog bound to 0024's
entry shape, destructive-tool posture added; initial same day)
**Related:** LLP 0000, LLP 0010, LLP 0011, LLP 0012, LLP 0017, LLP 0019, LLP 0024, LLP 0031, LLP 0037, LLP 0038, LLP 0039, LLP 0041

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

## Open Questions

- Should the MCP server be shipped inside the `snapback` CLI package or as a
  separate `@snapback/mcp` package?
- Static generated catalogs versus served-by-the-running-app is an open
  question 0024 already carries — this slice inherits rather than re-opens it,
  and will land whichever 0024 decides (or force the decision if it must land
  first).
- Which tools should be enabled by default in multi-root workspaces, and how
  does `snapback_stop` name its target server safely?

## Status

Draft. This RFC is the first buildable MCP slice under LLP 0024.
