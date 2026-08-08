# LLP 0194: Generated API reference surface

**Type:** RFC
**Status:** Review
**Systems:** Guide, Documentation, Client packages, Types, Build
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations; 0196 N=1 caveat. 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration, OQ2-contingency marking). 2026-08-08 (r2) — r2 also resolves the OQ2 hand-written-interim contradiction (named exclusion until a declaration file lands). 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
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
   `/_snapback/guide/reference/...`, indexed by
   `snapback guide <query>` and the MCP resources, listed in
   `/llms.txt`. Build-bound headers like every guide response.
4. **Joins:** intent pages link into reference anchors ("full signature:
   reference/…#liveQuery"); diagnostics and D7 remediations (LLP 0193)
   may cite reference anchors as their fix pointer.
5. **Scope and completeness rule:** the reference includes exactly the
   surfaces that have machine-readable declaration sources, and its
   completeness claim is scoped to that set. Order:
   `@expo/snapback-client` (headless surface — the largest excursion
   source), `snapback-react` hooks and fact types, `snapback-expo`.
   The `ctx` handler surface and the CLI verify/config contracts have
   no declaration source today; they JOIN the reference when their
   declaration sources land (OQ2 proposes both: a `ctx` declaration
   file and a verify-config types/schema export) and are ordered
   immediately after the initial package scope — until then they are
   named exclusions, not hand-written pages, so the no-hand-written
   rule and the completeness claim stay true together.

## What this kills

Retained-record attributions: headless args nesting (diary 0069 residue
3), `createAssetClient` root-export discovery (diary 0068), the sessions
client-construction option pair (0068 residue 4, hit by two lanes) —
all in the initial declaration-sourced scope. Contingent on OQ2's
declaration files landing: `ctx.db` verbs via binary strings (0069
residue 2) and the verify-config contract (0068 and 0069 residue 5) —
the two most expensive named excursions sit behind that exclusion,
which is the strongest argument for scheduling OQ2 early. Diary 0069 calls orientation "the
dominant term" in the remaining gap; the signature-shaped items above
are the subset of its residue list this RFC removes. (No quantitative
fraction is claimed; the diaries do not decompose the bucket.)

## Open questions

- OQ1: Page granularity, size budgets, and the flat-projection
  interaction — the flat guide is already past its one-request size
  premise (`issues/20260806-guide-flat-projection-oversize.md`); the
  reference is therefore EXCLUDED from `flat.md` unless that ticket's
  diet/tier design lands first, and per-module splitting rules are
  needed regardless.
- OQ2: Declaration sources for the two contingent surfaces. The `ctx`
  handler surface (db verbs, assets, refuse) joins only via a published
  declaration file (which also gives consumers editor types); the
  verify-config contract joins only via a published machine-readable
  source (a types export or schema from `@expo/snapback-cli`'s verify
  module). No hand-written interim sections: until each source lands,
  its surface remains a named exclusion per Design 5, documented in the
  intent guide as today. The two most expensive measured excursions sit
  behind these exclusions, so Design 5 orders them immediately after
  the initial package scope rather than leaving them unscheduled.
- OQ3: Whether doc comments in `.d.mts` are complete enough to render
  useful prose, and whether improving them (which rotates artifact
  identity — the doc-comment lesson) batches with releases.
- OQ4: Versioning — the reference is inherently build-bound (served),
  which is correct; whether the public docs surface (LLP 0195) pins
  per-release snapshots is that RFC's question.
