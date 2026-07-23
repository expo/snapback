# Extend the SNAPBACK_* diagnostic contract down into the compile/tooling layer

**Status:** Resolved (2026-07-23 — classes mapped to owning fixes/issues below; both static promotions verified; principle landed in guide)
**Severity:** P2
**Systems:** Contract Compiler, Codegen, Dev Server, DX
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-19
**Related:** diaries 0002, 0008, 0009, 0011, 0015;
issues/closed/20260718-contract-block-claim-grammar-and-parse-error-location.md
**Linear:** ENG-25267 (umbrella); ENG-25271 (parse location); ENG-25272
(static promotion); ENG-25273 (swallowed setup causes); completed references
ENG-22416, ENG-22443, and ENG-22538
**Marker:** dx, diagnostics, authoring-time, umbrella

Stable, structured runtime diagnostic codes are the single most praised
Snapback feature across all fifteen demo diaries — acceptance suites assert on
codes instead of scraping prose. The authoring-time layer (compilers, codegen,
dev servers, surface boot) does not yet meet that bar. Recurring evidence:

1. **Misleading diagnostics cause architectural workarounds.** Diary 0008's
   `event_unknown_action` misread led the author to inline 219 lines into one
   component, believing children could not call parent actions — the compiler
   supported prop-threaded actions all along (since improved per diaries
   0009/0010, kept here as the canonical example of the cost).
2. **Parse errors anchor far from the offender.** Diary 0015's contract-block
   claim error pointed ~13 lines below the offending line (tracked separately
   in the related issue above).
3. **Error loci garbled, per-tick re-spam.** Diary 0009: overlay reported
   `app.contract:389:37` for a 289-line file, no code frame; diary 0011:
   render-expression errors re-report every evaluation (~1/s per broken node).
4. **Runtime error-shaped cells for statically knowable failures.** Diary
   0015: binding an unconfigured JS query in multi-live Contract mode
   compiled clean and surfaced `SNAPBACK_CONTRACT_QUERY_UNCONFIGURED` as an
   error-shaped cell at runtime; the rows-array contract for point-read JS
   queries likewise failed only at runtime, blaming the wrong kind. Both
   deserve compile-time or boot-time hard errors.
5. **Swallowed errors hiding distinct causes.** Diary 0002: four distinct
   setup mistakes all failed with the same generic
   `Could not locate appRouteModules`; the real cause was only recoverable
   via a scratch `ssrLoadModule` script.

This is an umbrella: some items live in upstream Exact (parse anchoring,
overlay loci), some in Snapback codegen/adapter (unconfigured-query and
rows-contract promotion, swallowed registry errors). File or link concrete
sub-issues per item and record them here.

**Done when:**

- Each numbered class above has a concrete sub-issue (here, upstream Exact,
  or Linear) linked from this file, or a note that it is already fixed with
  the fixing reference.
- The two statically knowable runtime failures (unconfigured live query in
  multi-live mode; JS-query rows-array contract) fail at compile or boot time
  with a stable diagnostic naming the fix.
- A stated principle lands in the guide or an LLP: authoring-time failures
  carry the same stable-code, right-location, one-report discipline as
  runtime `SNAPBACK_*` diagnostics.

## Resolution / per-class status (2026-07-23, audited against origin/main)

1. **Misleading `event_unknown_action` architectural misread** — mooted/fixed;
   the compiler supported prop-threaded actions all along and diaries 0009/0010
   record the improved diagnostics. Kept as the canonical cost example.
2. **Parse errors anchor far from the offender** — ENG-25271 (Done), fixed in
   exact `f7f0a3041` (parser anchoring + diagnostic-codes tests); see also
   issues/closed/20260718-contract-block-claim-grammar-and-parse-error-location.md.
3. **Overlay loci garbled / per-tick re-spam** — filed as **ENG-25396**
   (repo:exact, child of ENG-25267): out-of-range spans must be
   clamped/validated with a code frame, render-expression errors report once
   per generation. The one class with no landed fix; it now has an owning
   issue.
4. **Statically knowable failures surfaced at runtime** — fixed:
   unconfigured live query in multi-live Contract mode refuses at
   construction with `SNAPBACK_CONTRACT_LIVEQUERY_NOT_LIVE`
   (packages/snapback-contract/index.mjs; test in
   multi-live-poll-reconcile.test.mjs; see
   issues/closed/20260718-refuse-non-live-query-bindings-in-multi-live-contract-surfaces.md),
   and the JS-query rows-array contract is a codegen-time
   `FUNCTION_JS_QUERY_STATIC_RESULT_NOT_ROWS` with sourceSpan
   (packages/snapback-codegen/index.mjs; test in
   contract-binding-reads.test.mjs). Both = ENG-25272, commit c5d67b0a.
5. **Swallowed route-registry setup causes** — ENG-25273 (Done), fixed in
   exact `f7f0a3041` (cause preservation + routeRegistrySourceSpan).

**Principle landed:** guide/operating/diagnostics.md:22-27 states the
authoring-time contract (stable code, authored offender location, first
actionable cause preserved, one report per generation, no deferral of
boot-knowable failures into error-shaped cells), backed by LLP 0010.
