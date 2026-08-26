# Drift-gate bypass: local-store-publication cannot be repaired because its own regeneration path is blocked

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 2
**Confidence:** 5
**Systems:** Pre-push gates, Capability publication, Generated records, Local persistent store
**Date:** 2026-08-12
**Drift gate:** `local-store-publication`
**Failure signature:** `sha256:3daaf301d85d6913e43803ee7a20710d5ad4932924e9f3125bd6530baa7db90c`
**Last observed:** `ad53ab3d97c07bee4446f03187164167c2c0d034`
**Bypass:** `SNAPBACK_DRIFT_GATES_BYPASS=1`, author-authorized 2026-08-12
**Related:** `issues/20260811-record-inventory-local-store-publication.md` (the
same mechanism, Impact 5 / Urgency 5, already open),
`issues/20260811-record-inventory-summary.md`, LLP 0232 D-2, LLP 0189 D-4

## What happened

Landing the Ibex diagnostic-noise fix (`crates/snapback/src/runtime.rs`, `crates/snapback/src/local.rs`) was
refused by the `local-store-publication` pre-push gate. The refusal was
**correct and correctly attributed**: the gate ran an attribution check, proved
baseline `ad9125a54fdd` passes, and reported that the pushed revision introduced
the staleness. A `crates/snapback/src/` change legitimately rotates the source digest that
`crates/snapback/src/local-persistent-store-publication.v1.json` pins.

The gate named its own repair:

```
regenerate: scripts/finalize-local-persistent-store-publication
```

**That repair cannot run on current main.** `finalize` chains into
`tests/acceptance/triage-graph-move1-v1.mjs --check`, which verifies every file
in the retained receipt's source list. It aborts on:

```
packages/snapback-client/index.mjs: retained receipt source drifted from the working tree
  actual   04af72c36fa767de8d384a790e4a89ced30392bdb15b67d5ef8bd338560ceed7
  expected dc65d6bc7d8308b5dc86d41577383591f1e84710fab20ddeb77ca5ca68397ce6
```

## This second staleness is pre-existing and unrelated

Verified, not assumed:

- The landing lane touches **no** file under `packages/` (its only
  `snapback-client` matches are `guide/reference/expo-snapback-client--*.md`
  projection pages).
- `packages/snapback-client/index.mjs` is **byte-identical** between the lane's
  HEAD and `origin/main` — both hash `04af72c3…`, while the retained receipt
  expects `dc65d6bc…`.
- The drift entered on `68acbda1c fix(release): close package acceptance
  regressions`.

So the gate demands a repair whose script is blocked by a *different*,
pre-existing stale receipt that the landing lane did not cause and cannot
reasonably be asked to own.

## Why a bypass rather than a re-mint

The documented repair is the four-step re-mint chain (`triage-graph-move1` →
`fleet-observatory-move1` → `local-store-carrier-exit` → `finalize`, each
2–8 minutes). It was rejected for this landing because it would mint **new dated
qualification evidence unrelated to a diagnostics fix**, carry those receipts in
this lane's commit, and race any concurrent session doing the same. Minting
qualification evidence as a side effect of an unrelated landing is worse than
recording the debt honestly.

The author authorized `SNAPBACK_DRIFT_GATES_BYPASS=1` for this push on
2026-08-12 after being shown the above. Recording it here keeps the bypass loud,
per the repository rule that a deliberate bypass must be exact and visible.

## What is actually owed

- `crates/snapback/src/local-persistent-store-publication.v1.json` and its `.anchor.v1.json` are
  now stale with respect to `crates/snapback/src/` on main and must be refreshed by whoever next
  runs the re-mint chain.
- The `triage-graph-move1` retained receipt must be re-minted against current
  `packages/snapback-client/index.mjs` before `finalize` can run at all.
- The main backstop (`node scripts/drift-prone-gates.mjs backstop`) is expected
  to file its own ticket if the drift remains; this ticket should be reconciled
  with that one rather than duplicated.

## The design defect underneath

A repair path that can be blocked by an unrelated stale record turns a
correctly-attributed, single-record refusal into an unbounded obligation on
whoever happens to push next. `finalize` should either re-mint the receipts it
depends on, or fail with a diagnosis that names the blocking receipt as a
separate owner's debt instead of presenting itself as the available repair.

`issues/20260811-record-inventory-local-store-publication.md` already argues
that dated pathnames should not be part of this control plane. This incident is
the concrete cost of that design: the calendar-shaped coupling is what makes one
lane's small `crates/snapback/src/` edit depend on another lane's unrelated receipt being fresh.
