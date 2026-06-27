# LLP 0021: Contract/Exact integration hardening

**Type:** Plan
**Status:** Draft
**Systems:** Contract/Exact, Client integration, Developer experience, Testing, Packaging, Admin console, Runtime
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-27
**Revised:** 2026-06-27 (review passes: Codex draft, independent Claude review, GPT-5 close-out, and a Claude re-review that corrected `ContractDataManifest` ownership to Exact 0263 — Snapback owns the projection, not the schema — and resolved the Valet LLP 0088 ownership (Valet retired; this Plan is the successor home); plus LLP 0012 race-handling, the LLP 0020 gate, Exact descriptor-module/provider-lifecycle constraints, diary-evidenced binding constraints, and provider-conformance discovery evidence)
**Related:** LLP 0005, LLP 0012, LLP 0016, LLP 0017, LLP 0020, Diary 0001, Diary 0002, Diary 0003, Valet LLP 0088 (retired prior-art), Exact 0263, Exact 0265, Exact 0268

## Summary

The Snapback diaries show that Contract is expressive enough for real Snapback
surfaces, but the integration path is still too hand-rolled. The todo demo and
admin console copied bridge code, descriptor sidecars, runtime links, Vite
aliases, native-shell recipes, and diagnostic workarounds that should become
adapter or tooling product.

This Plan turns those findings into a focused Contract/Exact integration
program:

- ship a first-class Snapback Contract adapter instead of demo-local bridge
  code;
- define and generate the Snapback-to-Contract data manifest and descriptors
  from the same typed artifacts as the headless client;
- package the browser/native/static build recipe so demos do not rediscover it;
- surface Exact and Contract failures as structured diagnostics rather than
  minified runtime errors, module-resolution failures, or generic native JSON
  decode errors;
- keep Snapback core usable without Exact installed.

LLP 0005 explains the relationship between Snapback, Contract/Exact, and
React/Expo. LLP 0012 specifies the shared headless integration facts. LLP 0016
is the umbrella diary-driven change program. LLP 0020 hardens the core authoring
surface that this adapter consumes. This Plan owns the Snapback-side adapter and
tooling sequence — the work the retired **Valet LLP 0088 ("Snapback Contract
Integration")** previously owned. With Valet retired, this Plan is its successor
home: 0088's reviewed design (`@expo/snapback/contract`, `openSnapbackContractRuntime`)
is prior-art to mine into this Plan and LLP 0012 rather than re-derive, and the
Exact 0265 references to 0088 repoint here.

## Motivation

The diary evidence is consistent:

- the todo Contract surface needed a custom bridge for boundary hydration,
  optimistic writes, runtime links, and provider wiring because no
  `@expo/snapback/contract` adapter existed;
- the Contract surface resolved Exact TypeScript source only under `bun`, while
  the headless surface did not need that toolchain;
- headless Contract mounting emitted native-host log noise;
- the admin Contract surface initially hit opaque iterable-boundary errors
  before the row-collection model was understood;
- static native export required a non-obvious route registry,
  `@exact/router/types`, programmatic `configFile: false` builds, and a
  subdirectory entry;
- separately, serving the web build under a subpath such as `/_snapback/admin/`
  required a post-build basePath rewrite, because `exactVitePlugin` emits
  root-absolute asset URLs with no basePath support;
- the native Exact shell and browser dev server were easy to confuse because
  the wrong server shape produced a generic decode error instead of a capability
  diagnostic.

Diary 0003 corrected an important false lead: the admin-console polish gap was
mostly fluency, not a Contract language ceiling. Tabs, conditional rendering,
dynamic grids, form state, async results, and reusable components all worked
once the labs were read (data-driven styling had already worked first try). The
remaining problem is integration ergonomics: packaging, adapters, diagnostics,
and recipes.

## Scope

This Plan owns:

- the Snapback Contract adapter package or package-equivalent;
- generated Contract descriptors and data manifests on the Snapback side;
- runtime-link and provider wiring between Snapback and Contract;
- browser, headless, static web, and native Exact packaging recipes for
  Snapback surfaces;
- structured diagnostics for missing Exact capabilities, wrong server shape,
  stale generated artifacts, adapter version mismatch, and bridge failures;
- acceptance gates that delete demo-local glue.

It does not own:

- Contract language syntax, compiler semantics, or renderer internals;
- Exact native shell protocol details beyond the Snapback integration contract;
- the core `ctx.db`, typed artifact, read-set, and realtime work in LLP 0020;
- React/Expo adapter design except where shared generated artifacts must remain
  framework-neutral.

When work belongs in Exact rather than Snapback, this Plan should record the
dependency and keep Snapback's behavior capability-based.

## Design Principles

### The adapter is product, not sample code

If a second demo copies hydration, provider, runtime-link, seed, Vite alias,
descriptor, or native-envelope glue, the adapter has not shipped. Demo-local
code is allowed as a prototype only while its target package or preset is being
designed.

### Contract gets a rich path, not private backend semantics

Contract/Exact is the primary Snapback client surface, but it must consume the
same generated Snapback facts as headless and React/Expo clients. Any Contract
need that changes backend semantics must graduate through the shared headless
contract in LLP 0012 or the core authoring plan in LLP 0020, following the
graduation rule in LLP 0005 §Boundaries: a Contract-motivated need enters core
only when React/Expo or doctor/agent tooling also needs it, when it protects a
shared backend invariant, or when more than one reference-app family needs it.

### Online and Parity must be reported honestly

The first adapter can be Online: it can speak to the live Snapback server and
offer optimistic UI. It must not report Parity until local handler execution,
offline queueing, deterministic replay, and rebase-on-reconnect exist.

### Exact should be optional for core Snapback work

Core server tests, generated artifact tests, and headless clients must not
require Exact. Missing or stale Exact capabilities should produce structured
diagnostics for Contract surfaces, not break ordinary Snapback development.

## Change Program

### Phase 0: Codify the current bridge and recipe

Before replacing the demo bridge, write down what it currently does and where
it lives.

Required changes:

- inventory demo-local Contract glue in `demos/_kit/`, demo Contract surfaces,
  and `admin-ui/`;
- describe the current lifecycle: reset/seed, initial subscription snapshot,
  boundary hydration, runtime links, mutation invocation, optimistic state,
  reconciliation, and diagnostics;
- document the proven static/native build recipe from the admin console,
  including the route registry, subdirectory entry, programmatic build, native
  artifacts, and current basePath rewrite;
- define a structured capability diagnostic for the wrong server shape:
  browser HTML served to a native Exact request, or native envelope requested
  from a browser-only dev server.

Acceptance gate:

- a maintainer can tell which files are prototype adapter code and which are
  product code;
- browser versus native launch commands are distinct in docs or scripts;
- the wrong server shape fails with a Snapback/Exact capability diagnostic, not
  only a generic JSON decode failure.

### Phase 1: Specify `ContractDataManifest`

The Contract adapter needs a written shared-boundary artifact before it can be a
stable package. This phase presupposes the typed generated artifacts from
LLP 0020 Phase 1: the `ContractDataManifest` binds to generated Snapback function
references, so those references must already be typed and generated upstream.

Required changes:

- tie each Contract query/mutation binding to generated Snapback function
  references, not route strings;
- generate the Contract-facing TypeScript seam Exact 0263 expects: a provider
  manifest module for project checks and adapter boot, plus per-query and
  per-mutation descriptor modules that Contract imports as ordinary `query` and
  `mutation` symbols; raw JSON manifests are an internal input, not the Contract
  import surface;
- treat the `ContractDataManifest` shape as **Exact-owned**: Exact 0263 §4.2
  defines it as the Contract-facing schema the compiler binds against
  (`manifestVersion`, promoted to `exact-contracts.json` per Exact 0263 decision
  7). Snapback does not define or fork this shape; it owns the **projection** —
  codegen that emits the Exact-shaped provider-manifest and per-binding descriptor
  modules from Snapback's native, LLP 0012-pinned manifest, carrying back only the
  Contract-specific binding facts (row shapes, syncability classes, read/write
  summaries, required capabilities) that already live in the shared artifacts;
- keep the `artifactKind`/`schemaVersion` discipline on Snapback's **native**
  manifest, which is already pinned in LLP 0012; the projected
  `ContractDataManifest` carries Exact's `manifestVersion`. Snapback-emitted
  staleness and version-mismatch diagnostics still register under LLP 0012's
  stable code families — the discipline LLP 0017 followed for its admin facts;
- align the binding shape with Exact's own Contract+Snapback data-binding work in
  Exact 0263 and Exact 0265 so the two sides do not diverge;
- include an `inputsHash` or equivalent freshness marker shared with the
  Snapback schema/function artifacts, using one canonical hash for a given scope
  and clearly separating codegen-input freshness from handler `bundleHash`, per
  LLP 0012's two-hashes warning;
- preserve row-shape honesty: direct table-shaped queries may expose table row
  aliases, projected or computed queries need query-result aliases, and unknown
  shapes stay renderable only with an explicit degraded-type diagnostic;
- account for Contract's static field access: templates do `cell.text`, not
  dynamic `row[col]`, so a dynamic grid must be flattened into named cells at the
  boundary; make that row-shaping an explicit manifest concern rather than
  leaving each surface to rediscover it;
- define mismatch diagnostics between Contract descriptors, generated Snapback
  artifacts, and adapter versions, with codes registered under LLP 0012's stable
  diagnostic-code families.

Acceptance gate:

- a generated `ContractDataManifest` is produced from the Snapback artifacts and
  validated by the demo bridge or a test harness — surface adoption follows in
  Phase 4 — replacing ad hoc descriptor sidecars where possible;
- Contract project checks resolve the generated descriptor modules without
  hand-written `.contract-meta.ts` sidecars for ordinary generated queries and
  mutations;
- a deliberately stale Contract data manifest produces a structured diagnostic;
- field mistakes in generated row shapes fail before a browser smoke test when
  Contract analysis can see the shape.

### Phase 2: Ship the Snapback Contract adapter

This is the main replacement for demo-local bridge code.

Required changes:

- create an `@expo/snapback/contract`-style package or an explicitly named
  equivalent;
- expose a headless-safe provider and runtime-link factory for Contract queries
  and mutations;
- hydrate Contract boundaries from Snapback's authoritative initial
  subscription/query result;
- own Contract provider lifecycle: create subscriptions from manifest id plus
  args, allow provider/runtime dedupe, dispose on component unmount, reset, and
  HMR teardown, and prevent stale runtime links from surviving remounts;
- own mutation invocation, pending mutation state, optimistic Online behavior,
  authoritative reconciliation, and error state, treating optimistic state as a
  display convenience only — visibility and authorization stay
  server-authoritative;
- inherit the LLP 0012 reference-adapter race handling rather than re-deriving it
  per surface: queue deltas that arrive before the subscribe response and apply
  only those newer than its version, buffer messages received before auth, force
  a full resync on reconnect, return an empty array (not `undefined`) on
  subscription error, treat unsubscribe as a full stop, and expose a single
  combined pending-mutation count;
- generate the runtime-link surface from the function manifest so a binding
  exposes the full declared query/mutation set, not a hand-wired subset — the
  todo diary's read-only checkbox, where only `listTodos`/`createTodo` were
  bridged, is the silent failure mode to eliminate;
- surface Snapback diagnostics and capability gaps in Contract-friendly shapes;
- expose row sync state and capability class honestly;
- provide a quiet headless mode or coordinate with Exact so missing native-host
  dispatch warnings do not pollute structured test output;
- keep browser/native entry points free of local-server-only imports.

Acceptance gate:

- the todo Contract surface deletes its demo-local bridge and imports the
  adapter;
- a Contract action mutates Snapback and the headless client observes the
  change through the same live server;
- a rejected mutation rolls back or supersedes optimistic Contract state by
  re-publishing the affected query cells and surfacing the provider diagnostic;
- the adapter passes the **Exact-owned** Contract DataProvider conformance suite
  (Exact 0263 §6 S4) for the capabilities it claims — initial snapshot,
  mutation-to-query invalidation, diagnostics, row sync state when available, and
  clean subscription disposal — rather than a Snapback-local harness that could
  drift from Exact's provider contract;
- the adapter reports Online rather than Parity until the Parity conditions in
  LLP 0012 exist;
- missing Snapback or Exact capabilities produce structured diagnostics;
- bundle inspection or an equivalent test proves the browser/native adapter
  entry point does not import server-only code.

### Phase 3: Package the build and launch recipe

The static/native path should become a preset or tool, not a diary workaround.

Required changes:

- provide a Snapback Contract build preset or script that installs the
  Contract and Exact Vite plugins in the correct order;
- make the route-registry and subdirectory-entry requirements generated or
  checked with clear diagnostics;
- centralize web basePath handling, either by upstream Exact support or a
  Snapback-owned rewrite that app code does not copy;
- support a dev-serve loop with the same plugins where possible, or report why
  a surface is rebuild-only;
- make package/capability resolution prefer installed packages and explicit
  version probes over absolute source aliases;
- keep the browser, native, and static-served Snapback admin paths distinct in
  commands and diagnostics.

Acceptance gate:

- a new Contract Snapback surface can be created without writing a custom Vite
  alias block or post-build rewrite in app code;
- the admin Contract surface builds to web and native artifacts through the
  preset;
- a missing route registry, wrong router import, root-level entry, stale Exact
  package, or unsupported basePath fails with a specific diagnostic;
- ordinary Snapback core tests still pass without Exact installed.

### Phase 4: Move admin and demo surfaces onto the adapter

After the package and preset exist, existing surfaces should stop carrying
copied integration code.

Required changes:

- confirm the todo Contract surface — already moved onto the adapter in Phase 2 —
  also consumes the generated `ContractDataManifest` and descriptor modules, not
  just the adapter package;
- migrate `admin-ui/` to the build preset and generated runtime-link pattern;
- remove or retire duplicate bridge code from `demos/_kit/` once no surface
  imports it;
- keep the embedded vanilla-JS admin console as the always-works baseline from
  LLP 0017;
- record any remaining glue in demo/admin diaries until the count reaches zero.

Acceptance gate:

- todo and admin Contract surfaces both consume the adapter;
- the shared glue inventory shrinks rather than grows in the next diary;
- the admin console still loads from the Snapback server without a runtime Vite
  dependency;
- native Exact artifact generation remains testable or reports a structured
  skip when Exact is unavailable.

### Phase 5: Feed Exact-side ergonomics back upstream

Some diary findings belong in Exact/Contract, but Snapback should track them
because they directly affect its primary surface.

Exact-side changes to request or mirror:

- clearer diagnostics when a Contract query binding receives a non-iterable
  shape or an `async ready` block cannot iterate its result;
- a clearer compiler diagnostic when component-level `use ... from` is parsed as
  a behavior instantiation (the `expected "=" in behavior instantiation` error
  the admin console hit), so the import-versus-instantiation distinction is
  legible;
- documented static/native minimal recipe aligned with Exact LLP 0268;
- web basePath support in `exactVitePlugin` or a documented extension point;
- a dev-serve path for the same plugin set used in production builds;
- quiet headless/native-host behavior for Contract mounting;
- raw textarea or Facet-backed textarea path that is easy to use in static
  Snapback surfaces;
- theme-token access that does not force every minimal Snapback surface to
  hand-copy Facet palette values.

Acceptance gate:

- Snapback no longer needs diary-only knowledge to build a Contract static/native
  surface;
- the next Contract build failure points at an actionable capability or recipe
  problem;
- Contract-language expressiveness is not confused with adapter/tooling
  friction in future diaries.

## Diagnostics To Standardize

The adapter and tooling should emit structured diagnostics for at least:

- missing or stale `ContractDataManifest`;
- generated artifact version mismatch;
- missing Snapback server or wrong server origin;
- browser-only dev server loaded by native Exact shell;
- native envelope requested from a server that only serves HTML;
- missing Exact capability or unsupported Exact package version;
- Contract data binding result not shaped as a row collection;
- generated descriptor module missing, stale, or inconsistent with the provider
  manifest;
- runtime link missing, mutation not declared in `mutates`, or read/write
  declaration mismatch;
- basePath or static asset URL mismatch;
- native-host dispatch unavailable during headless tests when not silenced.

Each diagnostic should include the target surface: headless, browser, static web,
native Exact, or packaged admin. These codes register under LLP 0012's stable
diagnostic-code families rather than a parallel namespace, so changing an emitted
code remains the compatibility event LLP 0012 defines.

## Non-Goals

- Do not redefine Contract syntax or Exact native manifest semantics inside
  Snapback.
- Do not make Exact a dependency of Snapback core server tests.
- Do not claim local-first Parity from the first Contract adapter.
- Do not solve React/Expo bindings here except by preserving the shared
  generated artifact contract.
- Do not delete the embedded admin console baseline until the Contract/Exact
  path can fail gracefully without blocking ordinary inspection.

## Open Questions

- What is the package name: `@expo/snapback/contract`, `@snapback/contract`, or
  another namespace?
- Exact 0263 (§4.2, decision 7) already specifies `ContractDataManifest` as the
  Exact-owned Contract-facing schema, so the live question is not "who owns the
  shape" but how Snapback's native LLP 0012 manifest **maps onto** it. Resolve the
  mapping before freezing Phase 1.
- Valet is retired, so this Plan is the successor home for the Snapback-side
  adapter that Valet LLP 0088 owned; its reviewed design (package API,
  `openSnapbackContractRuntime`, scoped install, generated runtime callables) is
  prior-art to mine into LLP 0012 and this Plan. The residual fork: does that
  adapter design surface extend LLP 0012, or warrant a dedicated Snapback adapter
  RFC? Default to extending LLP 0012 unless the API outgrows it.
- On an adapter or artifact version mismatch, does the adapter continue with a
  warning or hard-stop the connection? LLP 0012 §Versioning asks each consumer to
  pick deliberately and report it either way rather than failing opaquely.
- Does basePath support belong upstream in `exactVitePlugin`, in a Snapback
  build preset, or both?
- Should the first dev loop be a true Vite dev server with native-envelope
  support, or a faster rebuild-and-serve command with good diagnostics?
- Which quiet-headless fix belongs in Exact runtime versus the Snapback adapter?
- How much theme and Facet setup should the adapter own versus leaving to app
  surfaces?

## Status

Draft. Phase 0 now has an implementation foothold:
[`docs/contract-exact-integration.md`](../docs/contract-exact-integration.md)
inventories the current demo/admin glue, lifecycle, launch shapes, and
static/native recipe; Snapback emits structured `SNAPBACK_CAPABILITY_EXACT_*`
diagnostics when a native Exact shell requests artifacts from the embedded
browser-only admin console or from a stale/browser-only dist.

Phase 1 also has an implementation foothold:
[`demos/_kit/codegen.mjs`](../demos/_kit/codegen.mjs) now projects Snapback demo
artifacts into generated Contract binding modules under
`snapback/generated/contract/`, including runtime links and per-binding
descriptor sidecars. Both todo demos import generated Contract modules without
ordinary demo-local sidecars, and the adapter now emits structured
`SNAPBACK_STALE_CONTRACT_DATA_*` / `SNAPBACK_STALE_CONTRACT_DESCRIPTOR_SET`
diagnostics for manifest/hash and descriptor-index mismatches.

Phase 2 now has a package-equivalent foothold:
[`packages/snapback-contract/`](../packages/snapback-contract) owns the shared
Contract runtime adapter that previously lived in `demos/_kit/`: boundary
hydration, manifest-derived runtime links, optimistic mutations, authoritative
reconciliation, provider wiring, row sync state, pending mutation counts, and
Online capability reporting. Todo v2 ([`demos/todo-v2/`](../demos/todo-v2))
exercises both footholds by asserting manifest-derived runtime links include its
extra `setPriority` mutation. The build notes are recorded in
[`diaries/0004-todo-v2.diary.md`](../diaries/0004-todo-v2.diary.md).

Phase 3 now has a static/native build-preset foothold:
[`packages/snapback-contract/build-preset.mjs`](../packages/snapback-contract/build-preset.mjs)
owns the programmatic Exact/Contract Vite build recipe, plugin ordering,
route-registry and subdirectory-entry preflights, `mac` static native target,
and Snapback admin base-path rewrite. [`admin-ui/build.mjs`](../admin-ui/build.mjs)
is now only an admin-specific invocation of that preset, and `./build.sh` still
emits the browser and native Exact artifacts under `admin-ui/dist/`.

Phase 4 now has its first surface-migration footholds. The todo demos consume
generated Contract modules from `snapback/generated/contract/`, and the admin
surface now projects its system-app bindings from
[`admin-ui/contract-bindings.mjs`](../admin-ui/contract-bindings.mjs) into
[`admin-ui/generated/contract/`](../admin-ui/generated/contract). `app.contract`
imports those generated query/mutation modules, `main.ts` configures the
generated runtime links, and `admin-ui/build.mjs` regenerates the modules before
calling the build preset. The old `admin-ui/data/` hand-written binding sidecars
are no longer part of the admin Contract surface.

The admin surface also now consumes package-owned system-surface bridge
machinery:
[`createSnapbackSystemContractSurface`](../packages/snapback-contract/index.mjs)
owns Contract boundary creation, query-link generation, command tracking,
publish helpers, flush, and dispose. [`admin-ui/admin-boundary.mjs`](../admin-ui/admin-boundary.mjs)
is reduced to the admin-specific resource/command declarations and privileged
`/_snapback/api/*` shaping, and
[`admin-ui/tests/contract-bindings.mjs`](../admin-ui/tests/contract-bindings.mjs)
guards that the generated admin binding list and bridge links stay in sync.

Provider conformance discovery is now wired but does not close the Phase 2 gate.
[`packages/snapback-contract/exact-conformance.mjs`](../packages/snapback-contract/exact-conformance.mjs)
resolves the local Exact checkout, inspects `exact-verify.json` for the Exact
0263 `data-provider-conformance` check, and searches known suite paths. As of
2026-06-27, the local Exact checkout has runtime DataProvider primitives and the
`contract-data-bindings` mock-boundary fixture, but no registered reusable
provider conformance suite. The Snapback adapter should keep reporting
`SNAPBACK_CAPABILITY_EXACT_PROVIDER_CONFORMANCE_MISSING` rather than treating
its local todo/provider acceptance as Exact conformance.

This Plan should be revised again after the first Contract surface imports the
Exact-owned provider conformance suite or the probe reports it runnable, after
Exact project checks can validate generated descriptor module contents rather
than only Snapback's artifact index, and after the remaining admin-specific
client/view-model shaping is either
consolidated into a documented admin client package or deliberately kept as the
system-app exception.
