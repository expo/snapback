# caps: `crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs` is over the 1,500-line cap and the oversize baseline is exceeded by one

**Status:** Open
**Systems:** Snapback 1 (`crates/snapback-tools`), `scripts/caps.mjs` baseline
**Date:** 2026-09-04
**Related:** rules/RULES.md (the cap); every LLP 1012/1013 lane report since landing 5 names it as the one pre-existing violation

## What happened

`node scripts/caps.mjs` at the repo root reports one violation on main: the Snapback 1 file
above at 1,504 lines by caps' count (1,503 by `wc -l`), and "Baseline allows 204 oversize
files; there are 205". No Snapback 2 file is over the cap. The extra oversize file entered
the baseline count from outside the LLP 1012 program (the count moved 206 → 205 when the
evaluator split landed, then the split of `owner.rs` removed another, and the Snapback 1 file
remains). Every lane gate that runs `caps` has reported it since 2026-09-04 ~11:00.

## Resolution wanted

Trim the four lines (or split the binary) in Snapback 1, or re-baseline `scripts/caps.mjs`
with a ruling; either way `caps` should exit 0 on main so lane gates stop carrying a known
red.
