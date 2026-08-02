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

---

**2026-08-01 (fix-wave docs sweep) — ask 1 done, ask 2 still open.**
`snapback runtime-qualify` is now documented at
`guide/operating/diagnostics.md` §"Report the runtime's own readiness
identity": what it prints (`snapback.runtime-qualify.v1`, the
`restricted-no-eval-handler-vm` profile, `ok`, the build stamp), why it is
the identity to quote, and that it creates the same VM every JS handler uses
so a Hermes/glue skew fails there rather than at first invocation. The page
also states honestly that the result is **printed, not persisted**, that
packaged installs carry no receipt, and links back to this ticket for that
half.

Remaining: ask 2 — `runtime-qualify --persist` (or doctor) writing the
digest-bound receipt under the app's managed `.snapback/` state, never inside
read-only `node_modules`. That is code, not documentation; this ticket stays
open for it.

---

**Resolved 2026-08-01.** The packaged CLI now owns
`runtime-qualify --persist` and `runtime-qualify --verify`. The live command
writes the existing `snapback.runtime-readiness.v1` schema to
`.snapback/runtime-readiness.json`; verification recomputes the selected
binary and packaged Hermes artifact digests, and neither path writes into the
runtime package. Package tests pin issuance, re-verification, and framework
drift; the guide documents the two-command journey.
