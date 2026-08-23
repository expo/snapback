# LLP 0276 Phase 0 move rows conflict with live repository contracts

**Status:** Open
**Severity:** P1
**Systems:** Project, CI, Packaging, Governance, Demos
**Date:** 2026-08-17
**Governing:** LLP 0276, especially “Repository root”, “What moves, what dies”,
and Phase 0
**Related:** `.eas/workflows/qualified-package-staging.yml`;
`visibility-governance.config.json`;
`packages/snapback-codegen/visibility-governance.mjs`;
`scripts/demo-catalog.mjs`

## Problem

The reviewed Phase 0 survey found three rows in LLP 0276's “What moves, what
dies” table whose premises do not match the live repository. Lane P0-A left
these paths in place. The RFC needs an explicit amendment so the program does
not silently diverge from its accepted architecture record.

## R1 — root Expo/EAS files stay

Root `app.json` is the `snapback-ci` project owned by `expo`, with project ID
`6a83ec05-e0f3-4ced-a8d8-50c67e46f5cd`. It anchors
`.eas/workflows/qualified-package-staging.yml`; that workflow is checked by
`tests/ci_workflows_v0.mjs:547`, and LLP 0041 names the separate
`@expo/snapback-ci` staging project at lines 178 and 666. Root `eas.json`
supplies its `>= 21.2.0` EAS CLI floor.

`website/app.json` already exists for a different project: `snapback`, owned by
`ccheever`, project ID `d6c81653-6146-4fc3-ab26-4c58e98e5b83`. Moving the root
pair into `website/` would both remove the root workflow anchor and collide
with a different manifest. Amend the table and root-layout prose to retain
root `app.json` and `eas.json` as load-bearing CI configuration.

## R2 — both visibility-governance files stay

The G1 closure receipt path is a published-package constant at
`packages/snapback-codegen/visibility-governance.mjs:48`. The observer reads
the receipt on both sides of a revision range with `parseRevisionJson` at
lines 3497–3498, so a path-only move would break continuity across revisions.
LLP 0234 line 1540 and LLP 0264 line 753 also name this receipt contract.

The config currently has a root-relative consumer at
`scripts/check-visibility-governance.mjs:43,111`. Although its working-tree
read can be mechanically updated, observer/reconciler replay of pre-move
revisions has not been proven safe. Amend the Phase 0 row to keep both
`visibility-governance.config.json` and
`visibility-governance-g1-closure.json` at the root unless a dedicated,
transition-aware migration later changes the contract.

## R3 — undeclared demo research directories stay

The current declaration rule is location-independent: `scripts/demo-catalog.mjs:21`
declares a demo when `demos/<directory>/demo.snapback.json` exists. The survey
reproduced 20 undeclared directories. A `demos/_research/` location rule cannot
replace that rule while four directories cannot safely move:

- `demos/competitive-checkpoint` and `demos/zero-bakeoff` contain governed
  backend roots named at `visibility-governance.config.json:12,15`; governance
  artifacts are read from git revisions through `backendGovernancePath` and
  `parseRevisionJson`.
- `demos/expo-local-first-carrier` is imported directly by inventory-gated
  tests at `packages/snapback-client/rqs-store-sqlite.test.mjs:8` and
  `packages/snapback-expo/expo-sqlite-carrier.test.mjs:21-22,173,247`.
- `demos/coterie` is an active program governed by LLP 0266 and LLPs
  0277–0281, with current open follow-ups under `issues/`.

A partial move would add path churn without enabling the proposed declaration
rule. Amend the move table to leave the research directories and the
`demo.snapback.json` declaration rule unchanged; any future classification or
relocation should be a separately reviewed migration with its consumers.

## Completion

- LLP 0276's target-root prose and “What moves, what dies” table record R1,
  R2, and R3 explicitly.
- The Phase 0 description no longer implies that these refused rows landed.
- Any replacement move proposal names a transition plan for revision-anchored
  governance reads and all executable path consumers.

---

## Resolution (2026-08-23)

**Closed — all three refusals stood and were ratified as keeps.** The r5
acceptance ratified the Phase 2 decision memo's C13–C15 corrections; the
rearchitecture landed (LLP 0276 "Implemented, structurally", `18cb34fab`)
without moving any of the three rows. Verified 2026-08-23: root `app.json`,
`eas.json`, `visibility-governance.config.json`, and
`visibility-governance-g1-closure.json` remain at root; no `demos/_research/`
exists; the `demo.snapback.json` declaration rule is unchanged.
