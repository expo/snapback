# 0137 G1 guide-gap: packaged consumers have no persisted runtime-readiness receipt and runtime-qualify is undocumented

**Date:** 2026-08-01
**Source:** LLP 0137 Stage 1 (G1 package qualification), external-consumer smoke arm
**Finding record:** `demos/improvement-sweep/arms/g1-public-package-qualification/findings/0137-g1-f4-no-packaged-runtime-readiness-receipt.json`

## Observation

The repo-side discipline persists a digest-bound
`<binary>.runtime-readiness.json` receipt that doctor and the proof rungs
re-verify (LLP 0010). The public package has neither half:

- `@expo/snapback-runtime-darwin-arm64@0.1.7` ships only `package.json`,
  `bin/snapback`, and the Hermes framework — no receipt;
- `bin/snapback runtime-qualify` works and prints a valid
  `snapback.runtime-qualify.v1` result (`restricted-no-eval-handler-vm`,
  `ok: true`, build stamp `fdd49db8…`), but persists nothing and appears
  nowhere in `guide/` (grep over `guide/**/*.md` finds no mention).

The G1 checklist item "report … runtime-readiness … identities" was
satisfiable only from live command output.

## Proposed fix

1. Document `snapback runtime-qualify` on `guide/operating/diagnostics.md`
   as the packaged runtime-readiness identity (CI-checked snippet).
2. Have doctor (or `runtime-qualify --persist`) write the digest-bound
   receipt under the app's managed `.snapback/` state — not inside
   read-only `node_modules` — so consumers can retain readiness evidence.

Keep doctor's live six-boundary qualification authoritative; a receipt
complements it, never replaces it.

## Acceptance witness

An external consumer can produce and re-verify a digest-bound readiness
receipt via a guide-documented command.
