# Guide gap: first-backend page front-loads legacy handler modules

**Status:** Open
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
