# complete battery red: card-game-authority-scope

**Status:** Open
**Reopened by battery run:** `local.20261007T045641Z.4e0c6567f5a3`
**Closure:** `determinate PASS`
**Closed at revision:** `8f56e50f6d78cad0378c07114505a0eac5752580`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `card-game-authority-scope`
**Failure signature:** `sha256:75a8bed3077f45daba033056d60424c94304d24f878b1c06fc66e28ddcd3c9c3`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20261007T045641Z.4e0c6567f5a3`
**Last processed run:** `local.20261007T045641Z.4e0c6567f5a3`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `4e0c6567f5a3dbd2d65326db080f59f8c1394fab`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `card-game-authority-scope` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `card-game-authority-scope` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/card-game/tests/acceptance/authority-scope.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
