# snapback2 loop budget: core tests 38 s (budget 30 s) and first `doctor` sample 0.75 s (budget 0.5 s) at ee82e5aae

**Filed:** 2026-09-04 · **Status:** open · **Class:** fix-forward (LLP 0189 D-1; RULES.md loop budgets)

`node scripts/measure.mjs --check` on main at `ee82e5aae` (after the LLP 1006 asset lanes and
the LLP 1012 local-first program both landed) fails two budget steps. Machine load was ~5
(a few network-bound reviewer processes from another session); an earlier run at load ~12
on `122896b50` showed the same two steps red (61 s and 0.57 s), so this is not only load.

| step | budget | 2026-09-03 (9c9bf7cb1) | 2026-09-04 (ee82e5aae) |
|---|---|---|---|
| `core_test_s` ("Test what you just changed") | 30 s | 26.7 s (28.5–30.3 s across three runs) | **38.25 s** |
| `boot_s` sample 1 (`snapback2 doctor` boot-to-ready) | 0.5 s | 0.386 s (0.43 s; one 4.78 s outlier) | **0.752 s** |
| `boot_s` sample 2 | 0.5 s | 0.024 s | 0.033 s |

Everything else is green (warm build 15.6 s, incremental 1.57 s, check 0.52 s, init→dev
0.93 s, template tests 0.94 s / 23.8 s).

## Likely causes (unverified)
- The core test step was already at the budget's edge on 2026-09-03 (30.26 s on
  `8c8c5029d`). Since then the workspace gained the LLP 1006 asset tests (core 203 → 207,
  `snapback2` crate 398 → 462) and the LLP 1012 twin/outbox/resume tests.
- The first-sample doctor boot rose ~0.35 s; the second sample did not, so it is a
  first-open cost (binary size, dyld, first store open), not steady-state boot.

## What would close it
- Profile the core test step (`scripts/measure.mjs:178`) and either split the slow tests out
  of the "what you just changed" step per LLP 1002's intent, or re-baseline the budget with
  an author ruling in RULES.md.
- Measure `doctor` first-sample cost on a quiet machine three times; if reproducible, find
  the added first-open work (compare the binary's size and startup between `9c9bf7cb1` and
  `ee82e5aae`).

The measurement line for `ee82e5aae` is appended to `snapback2/metrics/loop.jsonl` in the
same commit as this ticket.
