# caps: two Snapback 1 files exceed the 1,500-line cap

**Status:** Open
**Systems:** Snapback 1 (`crates/snapback-tools`, `packages/snapback-contract`), `scripts/caps.mjs` baseline
**Date:** 2026-09-04
**Related:** rules/RULES.md (the cap); every LLP 1012/1013 lane report since landing 5 names it as the one pre-existing violation

## What happened

`node scripts/caps.mjs` at the repo root reports one violation on main: the Snapback 1 file
above at 1,504 lines by caps' count (1,503 by `wc -l`), and "Baseline allows 204 oversize
files; there are 205". The check's printed paths do not constitute a complete
oversize-file census: it prints the smallest overflow paths. The extra oversize file entered
the baseline count from outside the LLP 1012 program (the count moved 206 → 205 when the
evaluator split landed, then the split of `owner.rs` removed another, and the Snapback 1 file
remains). Every lane gate that runs `caps` has reported it since 2026-09-04 ~11:00.

## Resolution wanted

Bring both files below the source cap through the affected Snapback 1 work. Do not
increase the oversize baseline to absorb them.

## 2026-09-07 verification

The LLP 1018.000 integration at `e93236bfbc024b43412f3e3856c961f046bfd6c1`
reports 206 oversize files against the 204 baseline:

- `crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs`: 1,504 lines.
- `packages/snapback-contract/agent-authority-contract.test.mjs`: 1,508 lines.

These are the check's counts, including its trailing empty line. Both files are
byte-unchanged from the program base `b4b203316ba628d9364b0b7f081a8fd79f877c3c`
and the integrated upstream `624a06dfc`. The
working-set and foundation counts pass at 59 and 12 respectively. This is an
inherited-file record, not a passing `caps` result or a complete attribution of
the baseline overflow.

A subsequent changed-file census during the same LLP run found introduced
Snapback 2 overages in `registry.rs`, `quarry-program-checks.ts`, and
`client.test.ts`. Those belong to the active LLP implementation and are being
fixed there. The earlier inference that the two printed Snapback 1 paths
accounted for the entire failure was incorrect. This ticket retains only the
Snapback 1 work described above.
