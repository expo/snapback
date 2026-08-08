# LLP 0194: Generated API reference surface

**Type:** RFC
**Status:** Draft
**Systems:** Guide, Documentation, Client packages, Types, Build
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Related:** LLP 0061 (guide design — intent-indexed by choice), LLP 0186
(measurement evidence), diaries 0068-0069

## Summary

Across five measurement runs, every remaining package-source excursion
shares one shape: a **signature or contract question** — headless
`query`/`liveQuery` call shapes, hook fact types, the `ctx.db` verb set
(extracted from runtime binary strings in run 5), the verify-config
contract, client constructor option pairs. The guide is deliberately
intent-indexed (LLP 0061) and should stay that way; what is missing is
the complementary layer: a **complete, generated, build-bound API
reference** derived from the packages' own `.d.mts` declarations — the
types agents consistently praise — so that no signature question ever
requires opening `node_modules`.

## Design

1. **Source of truth:** the published packages' `.d.mts` files plus doc
   comments. No hand-written reference pages — generation only, so it
   cannot drift (the closure-drift lesson, LLP 0186 W0).
2. **Generation:** a build step (TypeScript compiler API, the
   export-parity test's traversal as the seed) emitting one markdown
   page per package under `guide/reference/<package>.md`, with stable
   per-symbol anchors. Runs in the same pipeline as
   `generate-guide-manifest`; output is committed generated artifact,
   checked like the flat guide.
3. **Serving:** joins the guide manifest — served at
   `/_snapback/guide/reference/...`, present in `flat.md`, indexed by
   `snapback guide <query>` and the MCP resources, listed in
   `/llms.txt`. Build-bound headers like every guide response.
4. **Joins:** intent pages link into reference anchors ("full signature:
   reference/…#liveQuery"); diagnostics and D7 remediations (LLP 0193)
   may cite reference anchors as their fix pointer.
5. **Scope order:** `@expo/snapback-client` (headless surface — the
   largest excursion source), `snapback-react` hooks and fact types,
   `snapback-expo`, the `ctx` handler surface (which needs a declaration
   source — see OQ2), CLI verify/config contracts.

## What this kills

Run-attributed: headless args nesting (0068, 0069×2), hook state shapes
(0066), `createAssetClient` discovery (0068), verify-config contract
(0068, 0069), constructor option pairs (0069×2), `ctx.db` verbs (0069,
via binary strings). Roughly a third of the residual orientation bucket
in diary 0069's decomposition.

## Open questions

- OQ1: Page granularity and size budgets — per-package pages may exceed
  the flat-guide size discipline; per-module splitting rules needed.
- OQ2: The `ctx` handler surface (db verbs, assets, refuse) is a runtime
  contract, not a package `.d.mts` — it needs either a published
  declaration file (preferable: consumers get editor types too) or a
  hand-fenced reference section until one exists.
- OQ3: Whether doc comments in `.d.mts` are complete enough to render
  useful prose, and whether improving them (which rotates artifact
  identity — the doc-comment lesson) batches with releases.
- OQ4: Versioning — the reference is inherently build-bound (served),
  which is correct; whether the public docs surface (LLP 0195) pins
  per-release snapshots is that RFC's question.
