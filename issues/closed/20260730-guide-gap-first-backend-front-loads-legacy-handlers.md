# Guide gap: first-backend page front-loads legacy handler modules

**Status:** Resolved (2026-07-31)
**Date:** 2026-07-30
**Systems:** guide, backend authoring, inline handlers, getting started

## Gap

The current query and mutation pages correctly teach LLP 0108's direct
self-contained inline-handler form, and current demos use it successfully.
`guide/getting-started/your-first-backend.md` still presents
`handlers.mjs` as one of the files an author writes and describes JS operation
logic as living in that bundled module.

During the seven-app current-main rerun, four ordinary apps were migrated from
`source` / `exportName` / global registry wiring to direct handlers. Agents that
started at the intent-indexed query/mutation pages found the paved form; agents
that followed the first-backend narrative first were led toward the compatible
but legacy split.

## Resolution criteria

- Make the direct self-contained handler the primary JS example and file-tree
  shape on the first-backend page.
- Present `handlers.mjs` and `source` / `exportName` as the legacy compatibility
  path, including when it remains useful.
- Link to the inline syntax/capture limits and result-contract recipes.
- Add a guide check or executable snippet that prevents the getting-started
  narrative from drifting behind the current maintained authoring example.

## Resolution (2026-07-31, LLP 0115 CV-13)

`guide/getting-started/your-first-backend.md` was rewritten around the inline
form as the primary path:

- The file tree is now three authored files (`schema.mjs`, `functions.mjs`,
  `seed.json`); `handlers.mjs` appears only via a pointer to the legacy
  section. "Define functions" presents style 2 as inline JS handlers
  (`handler:` colocated with `args`/`result`/`reads`/`writes`), with a
  transcluded-verified inline mutation + live query excerpt from
  `packages/snapback-codegen/inline-result-contracts.test.mjs` — the codegen
  package's inline-handler conformance test, first in that package's CI
  `test` script. Because the snippet is transcluded from a CI-exercised
  source (guide/conventions.md snippet class), the getting-started narrative
  now breaks structurally if the paved inline form drifts — satisfying the
  drift-prevention criterion via the snippet-source/page-composition repair
  LLP 0122 identified (no LLP 0061 mechanism change needed).
- A new "Inside a JS handler" section carries the `ctx` surface, the inline
  v1 self-containment/capture limits, and the result-contract vocabulary,
  linking to `guide/backend/queries.md` and `guide/backend/mutations.md`
  (the paved signal-desk examples) and to LLP 0108.
- The `source` / `exportName` + `handlers.mjs` split moved to a
  clearly-labeled "Legacy compatibility: bundled handler modules" section at
  the end of the page, naming when it remains useful (existing apps; logic
  needing imported/sibling helpers inline v1 refuses) and the
  no-mixed-discriminants rule (`SNAPBACK_FUNCTION_HANDLER_FORM_INVALID`).
  A new anti-pattern bullet says not to start new JS functions on the split.
- Cross-links updated: `guide/index.md` map entry ("inline JS handlers") and
  `guide/getting-started/the-authoring-loop.md` edit-step file list
  (legacy-form apps also edit `handlers.mjs`). The capability-index rows
  citing the page (backend.schema/seed/provisioning) required no change;
  backend.functions already cites `backend/queries.md`.
- `node scripts/check-guide.mjs` green (44 pages, 106 snippets); `./ref-check`
  green. LLP 0115 CV-13 board row updated to Landed.
