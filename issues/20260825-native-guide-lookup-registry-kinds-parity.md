# Native Guide lookup lacks environment and diagnostic-site-kind parity

- Status: Open
- Date: 2026-08-25
- Systems: Native CLI, MCP, Guide reference, Diagnostics
- Related: LLP 0193, LLP 0194,
  `packages/snapback-cli/reference-lookup.mjs`,
  `crates/snapback-server/src/guide_reference.rs`

## Problem

The JavaScript Guide wrapper resolves both top-level vocabularies in
`guide/reference/diagnostics-registry.json`, but native lookup only consults
`diagnostics` at `crates/snapback-server/src/guide_reference.rs` around the
exact-lookup branch currently near line 483. The concrete regression after the
registry-classification lane lands is that native
`snapback guide SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` returns `Resource not
found`. It was previously found only because the environment variable was
mis-typed as a diagnostic; the generated registry now correctly publishes it
only under `environment`. The equivalent native MCP resource
`snapback-guide://symbol/SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` fails the same
way. The JavaScript CLI lookup is correct.

The native formatter currently groups every diagnostic site under `Emitting
sites:` near line 606. Concretely, native output prints received and reserved
sites under `Emitting sites:` instead of `Received sites:` and `Reserved
sites:`. The JavaScript wrapper already labels emitting, received, reserved,
and environment sites separately. A dual-role name such as
`SNAPBACK_ACCEPTED_SOCKET_LIMIT` also needs one combined exact result containing
the diagnostic record and its environment binding sites instead of allowing
diagnostic precedence to hide the binding.

Schema note: `snapback-diagnostics-registry.v1` now carries an optional `kind`
on entries in the existing diagnostic `sites` array (`emission` when absent,
otherwise currently `received` or `reserved`). This is deliberate v1
kind-mixing, not a new top-level array or schema-version bump. The native reader
must consume `sites[].kind` instead of continuing to treat every v1 site as an
emission.

## Required Rust change

Keep this work in the Rust-capable native lane:

1. In `guide_reference::lookup`, fetch both `diagnostics[query]` and
   `environment[query]` before returning. Return `match: "environment"` for an
   environment-only hit and `match: "diagnostic-environment"` with both
   records for a dual-role hit. Preserve `diagnostic_for_distribution` for the
   diagnostic half so public packages still omit repository-only diagnostic
   sites; environment sites remain part of the environment record, matching
   the JavaScript wrapper.
2. Add native budget helpers for environment-only and combined results. They
   must paginate site arrays under the existing byte budget and `--slice`
   contract, returning `environment-slice` or
   `diagnostic-environment-slice`, with `nextSlice`/`nextCommand`. Combined
   pagination must cover diagnostic and environment sites deterministically so
   no site kind disappears at a page boundary.
3. In the native v1 registry reader and `format_lookup`, preserve and group
   diagnostic `sites[].kind`: missing or
   `"emission"` → `Emitting sites:`, `"received"` → `Received sites:`, and
   `"reserved"` → `Reserved sites:`. Render a separate `Environment sites:`
   section with each environment site's own kind. A combined result must render
   both halves.

## Parity tests to add

- Extend `crates/snapback-server/src/guide_reference.rs` tests to assert that
  `SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` is an identity-bound environment hit,
  `SNAPBACK_ACCEPTED_SOCKET_LIMIT` is a bounded combined hit, and forced-small
  environment/combined fixtures paginate without losing either site's owner or
  kind.
- Add formatter assertions that `SNAPBACK_INVALID_FLOAT` is shown under
  `Received sites:` and `SNAPBACK_IBEX_CLI_UNAVAILABLE` under `Reserved sites:`,
  never `Emitting sites:`; assert the combined socket-limit result also renders
  `Environment sites:`.
- Extend the native MCP acceptance coverage in
  `crates/snapback/tests/guide_mcp_v1.rs` so reading
  `snapback-guide://symbol/SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` succeeds and a
  read of `snapback-guide://symbol/SNAPBACK_ACCEPTED_SOCKET_LIMIT` contains both
  registry roles. Keep the JavaScript assertions in
  `packages/snapback-cli/reference-lookup.test.mjs` as the other side of the
  parity contract.

Until this lands, the closed environment-registry tickets explicitly record
the JS/native divergence rather than claiming native lookup parity.
