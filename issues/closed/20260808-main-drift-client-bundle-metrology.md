# main drift: client-bundle-metrology has a stale committed record

**Status:** Resolved 2026-08-10 — no longer reproduces at `1952d6f8c` under the pinned toolchain (see "Resolution")
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-08
**Drift gate:** `client-bundle-metrology`
**Causal landing:** `145fc2b6ad965cd715414aac45f5930db8e9969f` (docs(reviews): derived-fork requalification round 3 — mutually blind dual READY at C 03f9d147c)
**Detected at:** `145fc2b6ad965cd715414aac45f5930db8e9969f`
**Attribution:** `record-epoch-not-green`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `client-bundle-metrology` independently of path selection on
`main` and found the committed record stale. The first-parent record-epoch
attribution names the landing above; this ticket is keyed by gate and remains
idempotent while open.

## Stale record

- `tests/fixtures/client-bundle-metrology/current.v1.json and its active profile/baseline ledgers`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node scripts/client-bundle-metrology.mjs --check
```

Regenerate/reconcile:

```sh
node scripts/client-bundle-metrology.mjs --write-current
```

For an explicitly reviewed bundle rollover:

```sh
node scripts/client-bundle-metrology.mjs --write-rollover-baseline
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.

## Standing disposition policy (2026-08-10)

Charlie ruled a standing disposition for flagged client-bundle growth on
2026-08-10, recorded at
[LLP 0145 §Phase A → "2026-08-10 author ruling — standing disposition for
flagged growth"](../../llp/0145-client-bundle-architecture.research.md):
growth attributed to a landed, receipted feature takes an **automatic blessed
rollover** (declared prospective successor ledger, no author sitting); anything
else goes to **attribution review**, where the presumption is repair rather
than a new ceiling. It replaces the per-instance rulings of 2026-08-04/05. A
future occurrence of this gate that *is* over ceiling with landed, receipted
attribution can therefore be rolled over by its operator without escalation.

It does not apply to this ticket's own symptom, because there is no growth to
disposition here — see below.

## Resolution (2026-08-10) — no longer reproduces

`node scripts/client-bundle-metrology.mjs --check` passes at `1952d6f8c`
(`origin/main` at the time of writing) under the pinned Node 24.18.0 receipt
toolchain: **56 profiles, no frozen ceiling regressions**, full behavior train
green. The committed record is not stale, so neither `--write-current` nor
`--write-rollover-baseline` has anything to reconcile, and no rollover is
minted.

Two notes for the next occurrence:

- The detection was `record-epoch-not-green`, i.e. the backstop found the
  committed record stale at `145fc2b6a`; a fleet landing reconciled it
  afterwards. This is the same shape as
  `issues/closed/20260807-main-drift-client-bundle-metrology.md`.
- Toolchain confirmation matters before believing a red here. Running the same
  `--check` under a non-pinned Node (v25.9.0) fails immediately in the
  environment assertion — `expected runtime node v24.18.0` — which looks like a
  metrology failure but is not one. See
  `issues/closed/20260806-drift-hook-inherits-pusher-toolchain.md`.

Closing; the scheduled backstop re-arms detection.
