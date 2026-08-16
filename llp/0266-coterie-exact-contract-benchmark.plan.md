# LLP 0266: Coterie Exact/Contract social-messenger benchmark

**Type:** Plan
**Status:** Draft
**Systems:** Benchmarks, Demos, Exact, Contract, Native clients, Provider adapters, Social messenger
**Author:** Codex / Charlie Cheever
**Date:** 2026-08-15
**Revised:** 2026-08-16
**Related:** LLP 0000, LLP 0005, LLP 0064, LLP 0137, LLP 0189, LLP 0201, `benchmarks/briefs/social-messenger.md`, `benchmarks/tools/social-messenger/CONTRACT.md`

## Summary

Coterie is the Exact/Contract sibling of Clique: a single-source social-
messenger application for web, macOS, and iOS that exercises the same
observable product workload while remaining replaceable at the backend
boundary. Its default backend is a deterministic in-memory provider, so the
client can be built and driven before Snapback or another backend is attached.

Coterie is deliberately a separate product and benchmark lane. LLP 0201 fixes
Clique as the canonical React Native/Expo client, and changing that client
stack in place would make existing Clique evidence incomparable. Coterie may
reuse the social-messenger brief, fixtures, semantic automation IDs, and visual
tokens without inheriting Clique's name or implementation framework.

## Goals

1. Port the frozen Clique presentation contract to Contract components without
   React, React Native, or Expo.
2. Preserve the `sm-*` semantic identifiers and observable screen vocabulary
   in `benchmarks/tools/social-messenger/CONTRACT.md` so the same choreography
   can be adapted without coordinate-based selectors.
3. Run one Contract source tree through Exact's web, macOS, and iOS hosts.
4. Keep all backend-specific behavior behind Exact's public
   `ContractDataProvider` seam and generated bindings.
5. Ship a backendless local provider and deterministic fixture state as the
   baseline for UI work and client-side benchmark measurements.

## Non-goals

- Renaming or replacing Clique, its accepted Expo baseline, or its existing
  evidence.
- Claiming backend parity from the backendless provider. Persistence, auth,
  multi-client reactivity, offline recovery, authority, and scale remain
  provider-specific evidence.
- Introducing a Coterie-private Snapback protocol or a provider API above
  Exact's public data seam.
- Pixel-identical output across web, AppKit, and UIKit. Equivalent structure,
  interactions, semantics, and design tokens are the portable contract.

## Decisions

### D1. Identity and benchmark lineage

The product and repository name is **Coterie**. Benchmark records identify it
as the `social-messenger` family with an `exact-contract` client profile and a
`clique-feature-parity` workload. Reports must say "Coterie" for the client and
"Clique" only for the canonical Expo comparator; "Clique Contract" is not a
name or alias.

### D2. Repository placement

The runnable application lives at `demos/coterie/`. That directory owns its
Contract source, Exact project files, provider declaration, generated provider
artifacts, deterministic backendless provider, and tests. Shared benchmark
authorities remain where they are:

- product workload: `benchmarks/briefs/social-messenger.md`
- semantic interaction IDs: `benchmarks/tools/social-messenger/CONTRACT.md`
- fixture identities and media: `benchmarks/fixtures/social-messenger/`
- Clique React Native reference kit: `benchmarks/tools/social-messenger/ui/`

The Contract port may copy values from the reference kit, but it must not make
the existing React Native package depend on Exact or change the frozen Clique
surface.

### D3. Presentation-port rule

The port preserves meaning, not implementation syntax. Contract components
take plain typed values and callback actions; they do not import provider
clients, query handles, navigation objects, or backend-specific types. The port
preserves the reference kit's spacing, radii, type scale, palette roles,
component states, and `sm-*` identifiers. Platform-native controls and text
metrics may differ.

Coterie receives its own deterministic vector mark and product wordmark. The
Clique raster icon is a visual reference, not a source asset to recolor or
rename.

### D4. Backend boundary

Contract components import only binding functions generated from one
`ProviderNativeDeclaration`. At boot, the application configures those links
with a conforming `ContractDataProvider`:

```text
Contract views -> generated Coterie bindings -> ContractDataProvider
                                             -> in-memory fixtures (default)
                                             -> Snapback adapter (later)
                                             -> another conforming adapter
```

The default provider uses Exact's paved row-level boundary and satisfies the
provider conformance suite. Backend adapters own persistence, live delivery,
mutation authority, connection state, receipts, and ephemeral delivery. UI
code must not infer those facts or build a second offline queue above the seam.

### D5. Backendless semantics

"Backendless" means deterministic local process state, not a fake claim of
durability. The stage-1 shell supports immediate queries and mutations for the
screens and interactions it actually exposes, resets from committed fixtures,
and advertises only capabilities it implements. Screens or controls whose
semantics require unfinished backend behavior stay absent and are staged by D6
rather than rendered as inert or misleading affordances. Restarting the app may
reset data. Multi-client sync, server authority, durable auth, and offline
recovery are explicitly absent until supplied by an adapter.

### D6. Feature and evidence progression

Coterie follows LLP 0201's M1-M8 observable order, but its evidence is a
separate lane:

1. **Shell:** Exact scaffold, Coterie identity, design tokens, reusable Contract
   components, deterministic fixtures, and provider seam.
2. **Backendless feature surface:** all brief screens and user-triggered state
   transitions are present with the frozen semantic IDs.
3. **Host proof:** Contract compilation plus real web, macOS, and iOS semantic
   tree/interaction evidence. Each platform is claimed only from its own run.
4. **Provider lanes:** Snapback and other adapters run the same provider
   conformance suite and adapted social-messenger choreography.
5. **Benchmark comparison:** records distinguish client/runtime measurements
   from backend/provider measurements and bind claims to scoped qualification
   digests under LLP 0189.

## Acceptance criteria

- `demos/coterie` contains no React-authored application UI and no React Native
  or Expo dependency. Exact's current shared web scaffold may retain React and
  React DOM as internal toolchain dependencies until Exact removes that need.
- A backendless run renders and navigates the stage-1 routes enumerated in
  `demos/coterie/README.md` on web and compiles the same Contract route graph
  into Exact's native startup artifact; this is not a claim that every brief
  screen or interaction has landed.
- Reusable presentation components use plain values/callbacks and preserve the
  frozen `sm-*` IDs relevant to their states.
- The Coterie provider declaration deterministically generates its binding
  surface, and generation drift is checked in CI/test scripts.
- The backendless provider passes Exact provider conformance for every
  capability it declares.
- A diary records Contract/Exact ergonomics separately from future Snapback
  adapter observations.
- The affected LLP and guide reference checks pass before landing.

## Open questions

1. Should Coterie's provider declaration expose the complete M1-M8 domain in
   the first shell, or grow milestone by milestone while keeping compatibility
   tokens explicit? This plan favors milestone growth until the first provider
   lane needs a frozen full declaration.
2. Should adapted Clique choreography remain one parameterized runner or live
   as a Coterie-specific driver that imports the same ID authority? Decide when
   the first real-host automation is added; do not fork the IDs themselves.
3. Which backend follows Snapback as the second provider conformance lane?
   Choose for a meaningfully different delivery model, not brand coverage.

## Revision history

- 2026-08-15: initial Draft; establishes identity, placement, presentation
  portability, provider seam, backendless semantics, and separate evidence.
- 2026-08-16: renumbered this plan to LLP 0266 after the prior number
  collided on main; narrowed D5 to the interactions the stage-1 shell actually
  exposes.
