# LLP 0015: Demo Application Suite

**Type:** Plan
**Status:** Draft
**Systems:** Demo apps, Reference apps, Contract/Exact, Client integration, Developer experience, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-26
**Revised:** 2026-06-26
**Related:** LLP 0000, LLP 0004, LLP 0005, LLP 0008, LLP 0010, LLP 0012, Exact 0160, Exact 0158, Exact 0200, Exact 0216, Exact 0263, Exact 0265

## Summary

Snapback needs runnable demo applications that both show the product and work
out its hard capabilities. They should not be throwaway examples. Each demo is a
small reference app with deterministic data, machine-checkable acceptance
criteria, and one shared Snapback backend contract consumed by one or more
client surfaces.

The first demo is a todo list. It is intentionally boring at the product level
and load-bearing at the integration level: schema, generated functions, live
query, mutation, reset/seed, diagnostics, and eventually a real Contract/Exact
surface over the same Snapback artifacts. If todo cannot be created, run,
inspected, and repaired by an agent with very little ceremony, the larger
Snapback story is not credible.

The graceful answer to the Exact repository problem is: do not make the Snapback
core repo silently depend on a local `../exact` checkout, and do not require an
Exact git submodule for ordinary Snapback development. Treat Exact as an
optional external toolchain capability. The Contract/Exact demo surface should
resolve Exact through an explicit, capability-probed resolver: environment
variable, untracked local config, sibling checkout, optional submodule, or
published packages. Missing Exact support is a structured capability gap, not a
mysterious build failure.

## Scope

This Plan owns:

- the demo application corpus shape;
- the first todo demo requirements;
- how demos double as acceptance fixtures;
- how Contract/Exact, React/Expo, and headless surfaces share one Snapback app;
- how this repository locates an external Exact checkout when needed;
- CI and local-doctor expectations for demos.

It does not own:

- Snapback's schema, handler, sync, auth, or runtime semantics;
- the Contract language, compiler, or Design Mode semantics;
- the Exact repository's package layout;
- the final CLI names for demo commands;
- production-scale benchmarks for each reference app.

Those remain with LLP 0004, LLP 0008, LLP 0010, LLP 0012, and the Exact LLPs
linked above.

## Motivation

LLP 0010 already says the first acceptance app is todo, and LLP 0005/0012 say
Snapback should validate one generated backend contract through Contract/Exact
and React/Expo surfaces. What is still missing is the operational plan: where
these apps live, what is shared versus surface-specific, how an agent runs them,
and how Snapback handles the fact that the primary client target lives in a peer
repository.

The Valet record makes this worth spelling out. Repeated demos copied bridge
code, Vite aliases, Snapback boot helpers, query-boundary priming, and browser
packaging. That is the wrong lesson to teach agents. A Snapback demo should
exercise the generated integration path, not ask every demo to rediscover it.

## Demo Model

Each demo has one canonical Snapback backend and zero or more client surfaces.
The backend owns schema, functions, seed data, fixtures, expected capabilities,
and acceptance checks. Surfaces are consumers of generated Snapback artifacts.

The first repository layout should be:

```text
demos/
  todo/
    README.md
    demo.snapback.json
    snapback/
      schema.ts
      functions/
        todos.ts
      seed.json
    surfaces/
      headless/
      contract/
      react/
    tests/
      acceptance/
```

Physical names can change while implementation is young, but the logical split
should not: backend facts are shared, surface glue is isolated, and tests assert
that surfaces consume the same generated schema/function/capability/diagnostic
artifacts rather than private backend semantics.

`demo.snapback.json` should be the local manifest for a demo. It should include:

- demo id and title;
- Snapback systems exercised;
- artifact schema version and target profile;
- required target capabilities;
- surfaces and their requirement level: `required`, `optional`,
  `expected_missing`, or `blocked`;
- seed/reset profile;
- acceptance checks;
- generated artifact inputs hash or staleness policy;
- expected external toolchain requirements, including Exact capabilities for
  Contract surfaces;
- expected diagnostic codes for missing capabilities and known gaps;
- stable command metadata once CLI names settle.

Generated artifacts should be deterministic and inspectable. Whether they are
committed, generated on demand, or snapshotted for tests is still an LLP 0010
open question; the demo manifest should make the chosen behavior explicit per
demo.

## Surface Classes

### Headless

The headless surface is mandatory for early demos. It proves the backend
contract without a UI framework: schema load, generated function references,
query, mutation, live subscription, reset/seed, and diagnostics.

Headless is not the product showcase. It is the fastest acceptance fixture and
the best way to keep Snapback core runnable without Exact installed.

### Contract/Exact

Contract/Exact is the primary product surface. The todo demo should become a
real Contract app as soon as the Exact-side manifest-backed data binding path
from Exact 0263/0265 is available enough to mount a live component against
Snapback.

The target Contract todo surface must:

- be authored as `.contract` source with a `contract` block;
- use stable `testId` handles for meaningful nodes;
- consume generated Snapback query and mutation descriptors;
- render loading, empty, ready, error, and pending-mutation states when the
  underlying capability exists;
- call Snapback mutations from Contract actions without hand-written private
  bridge code;
- validate through Exact's agent API or equivalent structured tree, not DOM
  scraping alone;
- surface Snapback diagnostics and capability gaps in the same facts reported by
  local doctor output.

Until the Exact data-binding capability exists, the Contract surface may be
present as a skipped or expected-failing fixture, but it must not be called
complete. A mock Contract view that receives plain props can be useful as a
temporary compiler fixture; it is not the Snapback+Contract demo.

### React/Expo

React/Expo remains the secondary surface. It should consume the same generated
Snapback app and capability manifest as Contract/Exact. A React surface may ship
before the Contract surface if it unblocks local validation, but it must not
become the hidden source of truth for the demo.

## Phase Gates

The demo suite should be staged so early work can go green without weakening the
Contract/Exact goal.

### Phase 0: Headless Core

The required surface is headless. The demo proves the local Snapback backend:
schema load, generated artifacts, query, mutation, live subscription, reset,
seed, and diagnostics. Exact is not required. A Contract surface may exist only
as `expected_missing` or `blocked`, with an explicit diagnostic.

### Phase 1: First Visual Surface

The first visual surface can be Contract/Exact if the required Exact capability
exists; otherwise React/Expo may be used to prove that generated client bindings
can drive a real UI. The surface must still consume generated Snapback artifacts
and capability manifests. It must not introduce a private todo store or direct
table-write path.

### Phase 2: Contract/Exact Surface

The Contract/Exact todo surface becomes required once the Exact resolver reports
the minimum Contract compiler, data-binding, and agent-API capabilities. This
phase proves that a `.contract` component can mount against the generated
Snapback descriptors, verify through the structured Exact tree, and surface the
same diagnostics as `doctor`.

### Phase 3: Cross-Surface Integration

At least two surfaces consume the same generated Snapback app. The acceptance
check must include a mutation from one surface updating a live query in another,
plus one shared capability-gap or diagnostic case visible to both.

## Exact Dependency Policy

Snapback core must clone, build, test, and run the headless todo fixture without
Exact installed. Contract/Exact demos are optional capabilities in ordinary
Snapback development and required capabilities only in the Contract integration
lane.

The resolver for Exact should probe in this order:

1. `SNAPBACK_EXACT_ROOT`, an explicit path supplied by the developer, agent, or
   CI job.
2. An untracked local config file under `.snapback/`, for example
   `.snapback/local.json`.
3. A sibling checkout at `../exact`, matching the relative links already used by
   this LLP corpus.
4. An optional `vendor/exact` submodule, if the project later chooses to add one
   for hermetic CI or release snapshots.
5. Published Exact packages, once the required Contract compiler, runtime,
   agent API, and data-binding packages are available that way.

The resolver must not commit absolute local paths, and it must not treat a path
as valid just because it exists. It should probe capabilities and report a
structured result:

- source kind: environment, local config, sibling checkout, submodule, package,
  or missing;
- resolved path or package ids;
- git commit or package versions when available;
- Contract compiler availability;
- Contract data-binding capability version;
- Exact agent API availability;
- Design Mode availability when a demo requires it;
- diagnostics for missing or incompatible capabilities.

This is capability-based resolution, not directory-based resolution. A stale
peer checkout can exist at `../exact`; the demo must still fail or skip with a
clear diagnostic if the required Exact capability is absent.

Each Contract surface should declare its Exact requirements in the demo
manifest. At minimum:

- required Contract compiler package or command;
- required Snapback data-binding capability and schema version;
- required agent API or structured-tree operation set;
- whether Design Mode is required, optional, or out of scope;
- supported Exact version range or pinned integration revision;
- mismatch policy: hard failure, warning, or explicit skip.

The default mismatch policy for a required Contract surface is hard failure.
Warnings are allowed only for explicitly optional capabilities.

### Peer Checkout Versus Submodule

The preferred local-development mode is a peer checkout plus
`SNAPBACK_EXACT_ROOT` or the default `../exact` discovery. That keeps Snapback
usable as its own repository and avoids making every core change pay the cost of
Exact's moving toolchain.

An optional Exact submodule is acceptable only if a specific need appears:
hermetic CI, release snapshots, or a reproducible external demo. If added, it
should be one resolver input, not the only supported path, and ordinary core
tests should still pass when it is uninitialized.

CI should have two lanes:

- **core lane:** no Exact checkout; runs Snapback tests, ref-check, headless demo
  acceptance, and asserts that Contract surfaces report an explicit
  `ExactMissing`-style capability gap instead of failing opaquely;
- **integration lane:** checks out Exact at a pinned commit or package version,
  sets `SNAPBACK_EXACT_ROOT`, and runs Contract/Exact demo acceptance.

The pin belongs in demo or CI metadata, not as an absolute path. The integration
lane should fail on capability/version mismatch even if the checkout is present.

## Todo Demo Requirements

The todo demo is the floor app. Its product surface should stay deliberately
small:

- list todos for the current user;
- create a todo;
- toggle completion;
- edit title or delete a todo once basic create/toggle is stable;
- show empty, loading, error, ready, and pending states where supported;
- reset to a deterministic seed;
- run as at least two clients or simulated clients for realtime checks.

For V0, the required todo surface is headless, or React if the first UI adapter
lands before Contract/Exact. The Contract/Exact surface is required only at
Phase 2. Before then, it may be an expected-missing fixture, but the demo
manifest must say so explicitly.

The backend must exercise:

- source-authored schema;
- generated schema manifest;
- generated function manifest and function references;
- one syncable-live query;
- one ordinary callable query that is honestly reported as not syncable, if the
  demo needs to prove the capability distinction;
- one mutation path through `ctx.db`;
- user-scoped data once auth context exists;
- server-owned system fields;
- deterministic reset and seed;
- structured diagnostics for at least one invalid schema and one unsupported
  query;
- a mutation conflict diagnostic once read-set validation is implemented.

The Contract surface must use the same backend. It should not own a separate
todo store, fake query cache, or ad hoc bridge. If a surface needs a temporary
adapter because a generated package does not exist yet, the demo manifest should
mark that as a capability gap or temporary exception.

## Commands And Local Doctor

The exact command names are not fixed, but the demo suite needs command
equivalents for:

- list demos and surfaces;
- run `doctor` for a demo and emit JSON;
- reset and seed a demo;
- start the local Snapback target for a demo;
- run a demo surface;
- run acceptance checks for one demo and surface;
- explain missing capabilities and version mismatches.

Illustrative commands:

```bash
snapback demo list
snapback demo doctor todo --json
snapback demo reset todo
snapback demo run todo --surface contract
snapback demo test todo --surface headless
SNAPBACK_EXACT_ROOT=../exact snapback demo test todo --surface contract
```

`doctor` should be the normal place an agent learns whether Contract/Exact is
available. A missing peer checkout should produce a machine-readable diagnostic,
not instructions buried in a log.

## Acceptance Rules

A demo is complete only when its required checks pass on its required surfaces.
Optional surfaces can skip, but the skip reason must be explicit and asserted by
the test harness. Silent skips are failures.

A skip is valid only when all of the following are true:

- the surface is marked `optional`, `expected_missing`, or `blocked` in the demo
  manifest;
- the emitted diagnostic code matches the manifest's expected missing-capability
  code;
- no required phase depends on that surface;
- the skip is reported in machine-readable test output.

A required surface that is missing its toolchain, version, or capability is a
failure, not a skip.

Every demo acceptance profile should state:

- data shape and seed size;
- required target capabilities;
- surfaces required for this phase;
- local-store expectations;
- mutation and subscription behavior;
- diagnostics expected on invalid input;
- capability gaps that are acceptable in this phase;
- what the demo is not claiming.

This keeps the line clear between "demo shape" and "scale claim." A todo demo
can prove that the authoring loop works; it does not prove Snapback can carry
Partiful-scale traffic.

## Demo Ladder

The demo ladder follows LLP 0010's acceptance ladder. The early order should be:

1. todo: single-table CRUD, live query, reset, diagnostics;
2. messaging: retained local history, reconnect, live delivery;
3. kanban: multi-row optimistic reorder and realtime collaboration;
4. card game: authorization-aware partial sync where clients see different
   subsets of the same state;
5. party: RSVP live update, multi-table reads, notification stub when available;
6. asset slice: upload metadata and processed-media state once assets exist.

Each new demo should start headless, then add the highest-value product surface.
For app UI, the default surface is Contract/Exact unless the needed Exact or
Contract capability is missing and recorded as a temporary exception.

## Open Questions

- Should the physical top-level directory be `demos/`, `examples/`, or
  `reference-apps/`?
- Which CLI names become stable product commands?
- Which generated artifacts should be committed versus generated on demand?
- What is the minimum Exact capability set that makes the Contract todo surface
  required instead of optional?
- Should Snapback ever add `vendor/exact` as an optional submodule, or should CI
  always clone Exact as a sibling checkout?
- Where should the Exact integration commit/package pin live: demo manifest,
  CI config, lockfile, or all three with one source of truth?

## Status

Draft. The first demo directory has landed: [`demos/todo/`](../demos/todo) with a
required headless surface and an optional, **working** Contract/Exact surface over
one generated Snapback backend (shared codegen/client/bridge in
[`demos/_kit/`](../demos/_kit)). The Contract/Exact todo surface runs against real
generated Snapback artifacts — it compiles the `.contract` against the generated
descriptors with the real Exact compiler, mounts against the live local server,
and proves a Contract-driven mutation is server-authoritative and visible to the
headless surface. The build record is
[`diaries/0001-todo-demo.diary.md`](../diaries/0001-todo-demo.diary.md).

Open items this Plan still tracks, surfaced by that build: there is no published
typed client/manifest package (wire shapes were derived from `src/manifest.rs`),
no `@expo/snapback/contract` adapter (the bridge is currently demo-local in
`demos/_kit/`), and the integration is Online-class (no local handler replay).
This Plan should be revised again when a typed client package and the real
Contract adapter land, and when a second demo (messaging or kanban) exercises the
cross-surface realtime path.
