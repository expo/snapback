# LLP 0184 Phase 1 items 4 and 5 deferred: served catalog endpoint and generated Guide tables

**Status:** Closed

LLP 0184 Phase 1 (`llp/0184-agent-accessible-control-plane.rfc.md`, "### Phase 1
— catalog and parity gate") lists six items. Items 1-3 and 6 landed on main
(`650121612`): the `ControlCatalogV1`/`ControlCatalogInstanceV1` JSON Schema,
the compiler joining LLP 0031/0024/CLI/MCP/hosted-adapter facts
(`scripts/generate-control-catalog.mjs`), the hosted-adapter manifest join
against Phase 0's audited `cloudflare/gateway-paths.inventory.json` fixture,
and a 97-row fully-classified catalog with `surfaceAccess`/`operability` on
every in-domain operation.

Two items were explicitly deferred by the implementing agent and never built:

- **Item 4:** Serve the build catalog and instance availability projection
  with identity (the two-identity model in §Design/1 — build catalog with
  `schemaVersion`/`catalogDigest`, instance projection with startup
  nonce/target/profile/enabled-capabilities). No HTTP endpoint or CLI/MCP
  `controls list`/`controls describe` search-and-describe surface exists yet;
  the catalog is currently only a checked-in generated JSON file
  (`control-catalog/generated/control-catalog.v1.json`), not something an
  agent can query live against a running instance.
- **Item 5:** Generate the mechanical Guide tables from the catalog (§Design/5,
  §3 rule 9 — "Guide inventories, generated tables, and counts come from the
  catalog"). The Guide still has hand-maintained prose counts/tables in
  places this rule says should be generated.

**Why:** the implementing agent (codex, dispatched during the Phase 0/1
LLP 0184 execution push on 2026-08-05) ran low on budget partway through a
large phase and explicitly prioritized items 1-3+6 (schema, compiler,
domain-boundary CI, backfill) over 4-5, reporting the gap honestly rather than
claiming completeness.

**How to apply:** Phase 2 (projecting the shipped long tail) does not
strictly require the served endpoint or generated tables to start, but LLP
0184's own Acceptance criteria require both before the RFC is
Implemented. Pick this up either as part of a Phase 1 follow-up pass or
folded into Phase 2's tooling work — whichever lands first should close this
ticket.

## Resolution — 2026-08-06

Implemented by commit `2715951cf` (`feat(control-plane): serve and discover
the control catalog`); the issue move is recorded by the follow-up
`docs(issues): close LLP 0184 catalog discovery deferral` commit.

The native binary now embeds and serves the exact 109-entry build catalog,
serves a digest-bound instance snapshot through `AdminRead` SystemApi routes,
and supports offline `controls list`/`controls describe`. `mcp-control`
re-serves catalog and Guide resources by invoking the co-installed native
binary, reports explicit unavailability when that binary is missing, and
refuses a build/instance digest mismatch. Guide host-operation counts and the
full control inventory are generated from the catalog; catalog generation and
`scripts/check-guide.mjs` fail when those blocks drift.
