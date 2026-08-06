# `main` is red on the client bundle ratchet: react-external profiles grew ~35%

**Status:** Resolved in the wave-drift pass — prospective G2 rollover retained
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 4
**Systems:** Packaging, Testing
**Date:** 2026-08-06
**Related:** `issues/closed/20260804-bundle-closure-growth-review.md` (the
2026-08-05 ruling that blessed the previous rollover),
`issues/20260805-static-capability-composition.md` (the remediation lane that
ruling commissioned), `issues/20260803-first-npm-latest-promotion.md`
(precondition 1), `issues/20260806-main-red-agent-safe-leaf-set-drift.md`
(the other red gate, now fixed)

## Summary

`scripts/client-bundle-metrology.mjs --check` fails on `main` with
`SNAPBACK_CLIENT_BUNDLE_RATCHET_FAILED`. Measured at `167a9e080` with deps
installed and node pinned to 24.18.0 (`.node-version`):

| profile | minified | gzip | brotli |
| --- | --- | --- | --- |
| `external-react-application` | 50114 → **67830** (+35%) | 15841 → 21759 | 13908 → 19242 |
| `react-external` | 49943 → **67655** (+35%) | 15781 → 21701 | 13865 → 19165 |
| `public-subpath-rqs-store` | 34851 → 35584 (+2%) | 12233 → 12530 | 10811 → 11092 |
| `public-subpath-rqs-store-default` | 53835 → 54608 (+1%) | 16393 → 16748 | 14444 → 14803 |
| `public-subpath-assets` | 13860 → 14038 | 5564 → 5586 | 4814 → 4852 |
| `public-subpath-outbox-shared` | 16352 → 16530 | 5841 → 5911 | 5236 → 5288 |
| `public-subpath-rqs-store-expo` | 36669 → 36867 | 12468 → 12564 | 11023 → 11092 |
| `public-subpath-rqs-store-file` | 35156 → 35357 | 12151 → 12239 | 10770 → 10830 |
| `resolved-public-subpath-assets` | 13864 → 14047 | 5555 → 5589 | 4817 → 4841 |
| `public-subpath-rqs-registered` | — | 10649 → 10650 | 9383 → 9387 |

Two clusters, and they want different answers. The `react-external` /
`external-react-application` pair is a **~35% step change** — 17.7 kB minified,
5.9 kB gzip each. Everything else is 1–2% drift.

## The question

`issues/closed/20260804-bundle-closure-growth-review.md` established that
client bundle growth needs an explicit size disposition ("Charlie size review
required"), and Charlie ruled on 2026-08-05: verdict (a) **BLESSED** — the
Full/root growth is spec-governed feature mass, "the rollover stands" — while
commissioning the static-capability-composition remediation lane.

What is not determinable from the record is whether **today's** react-external
step is part of that blessed growth or new growth on top of it. The closed
ticket's cited figures (~149 kB minified / 41 kB gzip root-family, ~136 kB
minified compatibility-surface) are a different scale and different profiles
from the 17.7 kB react-external step measured here, and none of its numbers
match the current values. So this needs a disposition rather than an
assumption either way:

- **If it is the blessed growth**, the rollover simply was not minted for these
  profiles and the baseline should be rolled forward — mechanical.
- **If it is new growth**, a 35% step on the React-external profiles is exactly
  what the ratchet exists to catch, and it wants attribution before it is
  absorbed.

**Do not roll the baseline forward to make the gate green without answering
this.** That is the same failure the agent-safe leaf-set gate just had: a
threshold quietly moved to match reality, defeating the check.

## Why it is blocking

- `scripts/verify-local-proof` fails on `main` (`[snapback-verify] FAIL
  client-bundle-metrology`), so the npm capstone's precondition 1 — a green
  local proof on the `candidateSourceSha` — remains unmeetable even after the
  leaf-set gate was fixed in `6783f7ab8`.
- The wave 3 close needs a green named commit (2026-08-06 amendment) and
  cannot have one until this is dispositioned.

## Reproduction

A fresh worktree needs three things the documented path does not make obvious;
all three produced misleading failures before the real one surfaced:

1. `bun install --frozen-lockfile` — without it the gate dies with
   `ERR_MODULE_NOT_FOUND: esbuild`, which looks like a broken script.
2. node pinned to **24.18.0** per `.node-version` (`export PATH="$HOME/.volta/bin:$PATH"`);
   an ambient node 25.x runs the gate under an unpinned toolchain.
3. `scripts/bootstrap-ibex-runtime` cannot complete in one pass on a cold
   worktree — its link probe has a hard 900 s ceiling
   (`DEFAULT_RUNTIME_LINK_TIMEOUT_MS` in `scripts/runtime-link-smoke.mjs`, no
   env override) and a cold workspace build exceeds it, yielding
   `SNAPBACK_IBEX_RUNTIME_LINK_TIMEOUT`. Run bootstrap once to initialize the
   submodule and install the Hermes artifacts, then `cargo build --locked
   --bin snapback` to completion, then bootstrap again — the probe is then
   incremental (~2 min). Note the probe passes its own `--target-dir`, so
   `CARGO_TARGET_DIR` does not warm it.

## Disposition — 2026-08-06

This is **new growth**, not unminted coverage from the 2026-08-05 Move-3
ruling. Commit `c7a8b90312ac979830df6948023689af169166a3` added LLP 0179 S1's
admitted surface descriptor and `useSurface` implementation. Module
attribution and the exact changed-profile set agree: the material step occurs
only in `react-external` and `external-react-application`, the two workloads
that select the new React surface capability. The smaller 1–2% rows remain
under their existing tolerances and ceilings.

The fix-forward declares `llp-0179-conversation-surface.v1` and mints
`baseline.conversation-surface.v1.json` prospectively for exactly those two
profiles. It binds the complete immutable predecessors, records the exact
landing and governing LLPs, and runs the client, React surface, Expo provider,
and generated-descriptor behavior train before freezing. No historical
receipt or unrelated ceiling is edited. The static-capability-composition
lane commissioned by the prior size ruling remains open; this rollover does
not claim that remediation is complete.
