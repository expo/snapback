# LLP 0194: Generated API reference surface

**Type:** RFC
**Status:** Review
**Systems:** Guide, Documentation, Client packages, Types, Build
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r8, round-6 fixes: export parity split value-space vs type-space (non-runtime registry kinds exempt from the runtime check); acceptance 2 requires bootstrap removal/conversion + CI duplicate-ownership rejection once the ctx declaration lands.) 2026-08-08 (r7, author-merge: Charlie's action-economy revision
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
   `/llms.txt`. The oversized flat projection remains an explicit
   fallback, not the primary reference carrier
   (`issues/20260806-guide-flat-projection-oversize.md`).
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
- OQ2: Which published package/module owns the `ctx` declaration file.
  The requirement for a declaration source is decided here; only its
  placement and compatibility rollout remain open. (Verify-config needs
  no OQ: its `verify.d.mts` export exists and is `.d.mts`-traversable
  by the Design-2 registry builder.)
- OQ3: Whether doc comments in `.d.mts` are complete enough to render
  useful prose, and whether improving them (which rotates artifact
  identity — the doc-comment lesson) batches with releases.
- OQ4: Versioning — the served reference is build-bound, which is
  correct; whether the public docs surface (LLP 0195) pins per-release
  snapshots is that RFC's question, and reference entries for symbols
  newer than the published closure carry the guide's fence treatment.
