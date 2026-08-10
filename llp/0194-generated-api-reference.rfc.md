# LLP 0194: Generated API reference surface

**Type:** RFC
**Status:** Implemented
**Systems:** Guide, Documentation, Client packages, Types, Build
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
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
(public projection), diaries 0068-0069

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
