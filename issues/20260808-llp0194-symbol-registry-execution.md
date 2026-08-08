# LLP 0194 execution: canonical symbol registry + generated API reference

**Status:** Open — CLAIMED (orchestrating session 86767887, 2026-08-08)
**Impact:** 5
**Urgency:** 4
**Ease:** 2
**Confidence:** 4
**Systems:** Guide, Documentation, Client packages, Types, Build, CLI
**Date:** 2026-08-08
**Related:** LLP 0194 (governing RFC, Review at r8/r9), LLP 0198 P1,
diaries 0068/0069, issues/20260808-ctx-db-verbs-undocumented.md,
issues/20260808-headless-args-shape-guide-snippet.md,
issues/20260808-verify-config-authoring-guide-anchor.md

Execute LLP 0194's design: (1) a build-bound canonical symbol registry
emitted by a TypeScript-compiler-API build step over the published
packages' `.d.mts` declarations (`@expo/snapback-client`,
`snapback-react`, `snapback-expo`, `@expo/snapback-cli/verify`), with
value-space runtime export parity + type-space non-runtime kinds
(Acceptance 1 as revised in r8); (2) generated size-bounded Markdown
under `guide/reference/` + compact index, committed in the
`generate-guide-manifest` pipeline and checked like the flat guide;
(3) budgeted exact-symbol lookup via `snapback guide <exact-symbol>`
and the docs-only MCP surface; (4) serving under
`/_snapback/guide/reference/` + `/llms.txt` listing; (5) the cold
signature-task acceptance suite (zero package-source reads / zero
binary-string excavation). OQ2 (ctx declaration placement): lane
proposes, orchestrator ratifies, author can override.
