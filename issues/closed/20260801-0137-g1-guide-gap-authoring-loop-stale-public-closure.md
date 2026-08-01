# 0137 G1 guide-gap: the-authoring-loop still hedges the public React path that 0.1.7 shipped

**Date:** 2026-08-01
**Source:** LLP 0137 Stage 1 (G1 package qualification), external-consumer smoke arm
**Finding record:** `demos/improvement-sweep/arms/g1-public-package-qualification/findings/0137-g1-f2-guide-authoring-loop-stale-public-closure.json`

## Observation

`guide/getting-started/the-authoring-loop.md` (reviewed 2026-07-28) still
says `@expo/snapback-vite`, the current React starter, the versioned-seed
integration, and the Linux run "still need one newly versioned public
closure before this page can call the React command a public-registry
path", and opens the packaging story with the historical
`@ccheever/snapback-*` alias lineage for "0.1.x".

The G1 arm disproved the hedge from a clean external directory: the public
`@expo/snapback-*` 0.1.7 closure (ledger
`terminal-package-publication-0.1.7-fdd49db8.json`) carried the complete
React path — `snapback new --template react`, `bun install`,
`snapback generate`, strict typecheck, `vite build`, `snapback dev`
lifecycle, template live acceptance, real handler execution, clean stop.
Evidence: `demos/improvement-sweep/arms/g1-public-package-qualification/`.

## Why it matters

The guide is the sanctioned documentation for external consumers. The stale
hedge steers them away from the paved path that works, and the
alias-history lead risks someone installing the wrong scope.

## Proposed fix

Refresh the paragraph: 0.1.7 `@expo/snapback-*` is the public-registry
React path (cite the ledger and the G1 capsule); demote the `@ccheever`
alias story to a clearly-labeled lineage note; update `reviewed:` metadata.

## Acceptance witness

Page claims match a rerun of the G1 external smoke against the pinned
closure version the page names.

---

**RESOLVED 2026-08-01 (fix-wave docs sweep).** guide/getting-started/the-authoring-loop.md now names the 0.1.7 @expo/snapback-* closure as the public-registry React path, citing the publication ledger and the G1 qualification arm, and demotes the alias lineage; the stale hedge is gone. The general do-not-infer caution is kept in a version-honest form.
