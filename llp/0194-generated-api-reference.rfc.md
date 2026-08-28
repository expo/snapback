# LLP 0194: Generated API reference surface

**Type:** RFC
**Status:** Implemented
**Systems:** Guide, Documentation, Client packages, Types, Build
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-28 (module-local projection-identity amendment: retain one
global registry identity, add a semantic source digest per module, and stop
embedding the global digest in every generated module page so an unrelated
package-module edit no longer restamps all 57 Markdown leaves.)
**Revised:** 2026-08-10 (flipped to Implemented: acceptance 1–4 landed at
dd4126140; item 5 completed when the LLP 0195 public projection deployed —
https://snapback.expo.app serves the generated reference pages and
`/guide/reference/registry.json` with the same registry identities. Closure
recorded in `issues/closed/20260808-llp0194-symbol-registry-execution.md`.)
**Revised:** 2026-08-09 (authored symbol lifecycle facts — the registry
gains `replaces`/`removedIn`/replacement-identity fields authored at the
change site, and publication refuses an undeclared removal; see the
dated amendment. Adopted from the LLP 0207 dissolution.)
**Revised:** 2026-08-09 (reconciled the reference carrier with LLP 0061's
tiered projections and the closed oversize disposition.)
**Revised:** 2026-08-08 (Accepted by Charlie Cheever — author ruling in session; final review binding per llp/reviews/0193-*.run.md close-out: 0194 dual-READY at r8, the others accepted with the enumerated r9 tail.) 2026-08-08 (r8, round-6 fixes: export parity split value-space vs type-space (non-runtime registry kinds exempt from the runtime check); acceptance 2 requires bootstrap removal/conversion + CI duplicate-ownership rejection once the ctx declaration lands.) 2026-08-08 (r7, author-merge: Charlie's action-economy revision
— a canonical machine-readable symbol registry becomes the authority behind
Markdown, CLI, and MCP projections; a published `ctx` declaration source is
required with hand-fenced prose permitted only as a temporary bootstrap
[author decision, reversing the loop's no-interim rule]; Acceptance section
added — merged onto the r6 review spine, keeping the round-verified facts:
verify-config's declaration source already exists and sits in the initial
scope; no numeric orientation fraction is claimed.) 2026-08-08 (r5, this
document: verify-config moved to the INITIAL scope — its verify.d.mts
declaration source already exists and is published (round-4 find); OQ2
narrows to the ctx declaration file.) 2026-08-08 (r4/r3/r1 — see
llp/reviews/0193-*.run.md for the full round ledger.)
**Related:** LLP 0061 (guide design — intent-indexed by choice), LLP 0186
(measurement evidence), LLP 0193 (diagnostic remediations), LLP 0195
(public projection), LLP 0326 (adjacent diagnostic-coordinate churn),
diaries 0068-0069

## Summary

Across five measurement runs, every remaining package-source excursion
shares one shape: a **signature or contract question** — headless
`query`/`liveQuery` call shapes, hook fact types, the `ctx.db` verb set
(extracted from runtime binary strings in run 5), the verify-config
contract, client constructor option pairs. The guide is deliberately
intent-indexed (LLP 0061) and should stay that way; what is missing is
the complementary layer: a **complete, generated, build-bound API
reference** derived from the packages' own declarations — the types
agents consistently praise — so that no signature question ever requires
opening `node_modules`. The authority is a queryable symbol registry,
not a pile of Markdown pages; Markdown is one projection for humans and
broad retrieval.

## Design

1. **Declaration sources:** the published packages' `.d.mts` files plus
   doc comments, checked against the runtime export map. The handler
   `ctx` surface gains a published declaration source too; a hand-fenced
   prose section is permitted only as a temporary bootstrap and is not
   the target design.
2. **Canonical symbol registry:** a build step using the TypeScript
   compiler API and the export-parity traversal emits one build-bound
   registry. Each symbol records package/module, runtime export names,
   complete signature, overload/member structure, doc text, source
   provenance, stable identity, and closure applicability. No projection
   independently parses or rewrites the public API.
3. **Generated projections:** the registry emits size-bounded Markdown
   under `guide/reference/` with stable per-symbol anchors, plus a
   compact index. Output is a committed generated artifact in the same
   pipeline as `generate-guide-manifest`, checked like the flat guide.
4. **Budgeted exact lookup:** `snapback guide <exact-symbol>` and the
   docs-only MCP surface can return one symbol or bounded module slice
   directly from the registry, without forcing a package-sized Markdown
   read. Results carry the same guide/build identity and explicit
   truncation markers.
5. **Serving:** the Markdown, compact index, and registry resources join
   the guide manifest — served under `/_snapback/guide/reference/`,
   indexed by `snapback guide <query>` and MCP, and listed in
   `/llms.txt`. The roughly 2.5 MiB whole-corpus flat remains an explicit
   bulk fallback after the bounded entry artifacts and per-section flats, not
   the primary reference carrier
   (`issues/closed/20260806-guide-flat-projection-oversize.md`).
6. **Joins:** intent pages link into reference anchors ("full signature:
   reference/…#liveQuery"); diagnostics and D7 remediations (LLP 0193)
   may cite reference or exact-symbol targets as their fix pointer.
7. **Scope order:** `@expo/snapback-client` (headless surface — the
   largest excursion source), `snapback-react` hooks and fact types,
   `snapback-expo`, and the verify-config contract — whose declaration
   source already exists and is published (`@expo/snapback-cli/verify` →
   `verify.d.mts`, landed 2026-08-04; its measured excursions were pure
   discoverability), so it sits in the initial declaration-sourced
   scope. The `ctx` handler surface joins when its declaration source
   lands (OQ2 owns placement), ordered immediately after.

## What this kills

Retained-record attributions: headless args nesting (diary 0069 residue
3), `createAssetClient` root-export discovery (diary 0068), the sessions
client-construction option pair (0068 residue 4, hit by two lanes), and
the verify-config contract (0068 and 0069 residue 5) — all in the
initial scope. Contingent on OQ2's `ctx` declaration landing: `ctx.db`
verbs via binary strings (0069 residue 2) — the most expensive named
excursion, the strongest argument for scheduling OQ2 early. Diary 0069
did not retain a numeric phase decomposition, so this is a qualitative,
enumerated target set rather than a claimed fraction of the remaining
gap.

## Acceptance

1. Registry/runtime export parity: value-space declared symbols must
   exist at runtime under their applicable export conditions, and every
   public runtime export must have a registry entry; type-space-only
   symbols (hook fact types, contract interfaces) appear in the
   registry with an explicit non-runtime kind and are exempt from the
   runtime check.
2. The `ctx` handler surface is available to consumers as declarations
   and in the same registry as package APIs, the hand-fenced bootstrap
   prose is removed or converted to a generated projection, and CI
   rejects duplicate symbol ownership from the moment the declaration
   source lands. While the bootstrap lives, it passes check-guide like
   any page and its retirement trigger is OQ2's declaration landing;
   ctx fix-pointers use the 0193 text+anchor floor until then.
3. A cold signature-task suite covering headless args nesting,
   constructor custody pairs, verify-config, hook facts, and `ctx.db`
   completes with zero package-source reads and zero binary-string
   excavation.
4. Exact-symbol lookup returns a bounded, identity-bearing result; a
   request exceeding its budget names what was elided and how to request
   the next slice.
5. Markdown, CLI, MCP, diagnostics, and the public LLP 0195 projection
   resolve the same stable symbol identities.

## Open questions

- OQ1: Initial registry and projection size budgets. Per-package
  Markdown may exceed the flat-guide discipline; module/symbol slicing
  must be measured.
- OQ2: RULED (author, 2026-08-08): `@expo/snapback-codegen/ctx` owns
  the `ctx` declaration file, per the execution lane's proposal
  (issues/20260808-llp0194-symbol-registry-execution.md); the
  types-only export condition is acceptable. Implementation follows. (Verify-config needs
  no OQ: its `verify.d.mts` export exists and is `.d.mts`-traversable
  by the Design-2 registry builder.)
- OQ3: Whether doc comments in `.d.mts` are complete enough to render
  useful prose, and whether improving them (which rotates artifact
  identity — the doc-comment lesson) batches with releases.
- OQ4: Versioning — the served reference is build-bound, which is
  correct; whether the public docs surface (LLP 0195) pins per-release
  snapshots is that RFC's question, and reference entries for symbols
  newer than the published closure carry the guide's fence treatment.

## Amendment (2026-08-09): authored symbol lifecycle facts

Adopted from the LLP 0207 super-refine close-out (that Plan was withdrawn
and dissolved to its owners; the dual-family review record under
`llp/reviews/0207-*` is the provenance, including why the alternatives
were rejected). The publish-often posture (LLP 0041) makes this
time-critical in one specific way: a rename or removal whose facts are
not recorded *at the change site* is unrecoverable later — successive
registry snapshots cannot distinguish a rename from a
remove-plus-add — and the published history is still short enough that
starting now costs almost nothing.

1. **Lifecycle fields on the registry (Design 2).** A symbol change
   records `replaces`, `removedIn`, and the replacement's stable
   identity, authored where the change is made (declaration source or
   registry-adjacent metadata, decided at implementation). The registry
   carries these fields like any other symbol fact; projections render
   them (reference pages, exact lookup) without independent parsing.
2. **Publication enforcement.** The publication pipeline generates a
   release-over-release symbol diff from the authored facts and
   **refuses an undeclared removal** — an extension of the existing
   qualification checks, not a new gate family. The diff is a safety
   net behind the authored facts, never a rename-inference mechanism.
3. **Consumer projections deliberately not commissioned.** Typed
   codegen tombstones (old names failing typecheck carrying migration
   text) and a `whatsnew` release-diff verb were evaluated in the 0207
   loop and deferred behind two gates that have not fired: a
   feasibility spike (plain `@deprecated` is advisory and fails
   nothing) and naturalistic demand evidence (no verified stale-name
   episode exists; see LLP 0186's failure-to-recovery trace amendment,
   which is the instrument that would observe one). Recording the facts
   now is what keeps those projections buildable later without
   archaeology.

**Implementation record (2026-08-09).** Points 1 and 2 landed as the
schema-validated authored sidecar and initial working-tree seed at
`guide/reference/lifecycle.json`, `guide/reference/lifecycle.schema.json`, and
`guide/reference/published-symbols.json`; shared validation and undeclared-
removal enforcement live in `scripts/symbol-lifecycle.mjs`, the registry and
bounded Markdown projections are generated by
`scripts/generate-symbol-registry.mjs`, exact lookup projects the embedded
facts from `packages/snapback-cli/reference-lookup.mjs`, and successful
publication refresh is wired through `scripts/snapback-publish-core.mjs` and
`scripts/snapback-publish.mjs`. No tombstone or `whatsnew` consumer projection
was added.

## Amendment (2026-08-28): module-local projection identities

### Problem

Design 2 correctly requires one canonical registry, but the implementation
uses one global `buildIdentity.sourceDigest` for two different jobs:

1. identity of the whole machine-readable registry; and
2. identity printed into every module-scoped Markdown page.

The generator computes that digest over every in-scope manifest, declaration
target, runtime target, lifecycle authority, publication-closure record, and
generator support file. It then prints the same digest into all 57 generated
Markdown pages under `guide/reference/`. A runtime or declaration edit in one
module therefore rewrites every unrelated module page even when its symbols,
signatures, sources, and rendered text are byte-for-byte unchanged.

The history shows the fan-out. In the 30 days ending 2026-08-28, the global
registry has 393 commits. Long-lived unrelated leaves such as
`expo-snapback-client--assets.md` and `expo-snapback-react.md` have 342 and 343
commits respectively; many newer leaves have changed on nearly every registry
generation since they were introduced. This is different from LLP 0326's
diagnostic-coordinate problem: the registry really is global, but its global
identity does not need to be copied into every local projection.

### Decision

Keep the canonical registry global and add a second, module-local identity.

The registry's top-level `buildIdentity.sourceDigest` remains the digest of the
complete registry input closure. `registry.json`, the compact index, exact
lookup, MCP/CLI serving, and the guide manifest continue to use it when they
need to identify the whole joined API surface.

Each module record additionally carries:

```json
{
  "projectionIdentity": {
    "sourceDigest": "sha256:..."
  }
}
```

The module digest covers exactly the semantic inputs capable of changing that
module page:

- the generator/projection algorithm version and shared rendering support;
- the package manifest and the selected export entry;
- the public declaration target and every declaration source reached by the
  module's rendered symbols;
- applicable runtime export target bytes and conditions, because the page
  claims build-bound runtime parity;
- lifecycle facts filtered to identities in that module, including removed
  symbols; and
- any module-scoped closure fact actually rendered on the page.

Input enumeration is emitted in the registry and tested; the digest may not
silently omit a transitive declaration merely because it is re-exported from
the selected `.d.mts` file.

A generated module page prints its module projection identity and a link to the
global registry. It no longer prints the global registry digest. The compact
index continues to print the global identity because it summarizes all modules.
Stable symbol identities and anchors do not change.

The served join remains exact: the registry carries both global and per-module
identities, and the guide manifest carries each page's content hash. A consumer
can prove that a leaf belongs to a registry build without making the leaf's
bytes depend on every sibling module.

Advance the machine-readable registry schema to
`snapback-symbol-registry.v2`. Current consumers accept v2; retained historical
v1 snapshots remain readable. This is an additive identity refinement, not a
rename of any symbol or route.

### Intended and unintended fan-out

After this amendment:

- changing one module's declaration or runtime target changes the global
  registry, compact index, that module's page, and the normal global guide
  manifest/flat projections;
- unrelated module Markdown pages remain byte-identical;
- changing shared rendering code or LLP 0194 may still change every leaf,
  because every leaf's meaning genuinely depends on that authority; and
- changing the currently global `lifecycle.json` may still rotate generated
  frontmatter authority digests on unrelated leaves even though the rendered
  lifecycle facts are filtered. That is a known, narrower guide-freshness
  exception, not a reason to retain the much larger per-build fan-out. If it
  becomes material, LLP 0061 should gain a checked module-scoped authority
  digest or lifecycle shards rather than letting this generator invent a
  private freshness grammar.

The amendment does not promise that `registry.json` is local; it is the
canonical global join and should change when its source closure changes. The
goal is review locality for the 57 module leaves.

### Acceptance

1. A fixture changes one symbol in module A and proves that `registry.json`,
   `index.md`, and module A's page change while an unrelated module B page is
   byte-identical.
2. Module A's projection digest and the global registry digest rotate; module
   B's projection digest does not.
3. A runtime-export-only change in module A either fails parity or rotates only
   A's module identity among leaf pages.
4. Re-exported declaration sources participate in the module input census and
   a mutation to one rotates every module that actually renders a symbol from
   it.
5. Lifecycle facts remain attached to the same stable symbol identities and
   removed-symbol sections; no undeclared-removal enforcement is weakened.
6. Exact lookup, CLI/MCP serving, public routes, stable anchors, and module page
   budgets retain their LLP 0194 acceptance behavior under registry schema v2.
7. The generator's check mode rejects stale global or local identities and
   orphaned module pages; `check-inventories` validates the chained guide
   manifest after regeneration.

### Non-goals

- No split into independently authored registries.
- No uncommitted generated reference surface.
- No change to symbol identity, lifecycle policy, page slicing, or lookup
  budgets.
- No claim to solve LLP 0326's diagnostic coordinate churn.
- No custom exception to the Guide's reviewed-authority semantics. The narrow
  global lifecycle-authority remainder is explicit until LLP 0061 owns a
  general representation.
