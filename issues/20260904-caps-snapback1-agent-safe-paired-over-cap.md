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

A complete committed-source census at `2ba58d435` resolves attribution: program
base `b4b203316` has exactly 204 oversize files, within its 204 allowance. The
candidate has 206; the only added oversize files are
`snapback2/packages/compiler/src/quarry-program-checks.ts` (2,384) and
`snapback2/packages/snapback2/tests/client.test.ts` (1,523). The earlier
`registry.rs` overage has been repaired. The two printed Snapback 1 paths
already belong to the allowed base count. Thus this candidate has no inherited
caps failure: its remaining overflow is entirely the two active Snapback 2
repairs. This historical Snapback 1 cleanup ticket must not be used to excuse
that introduced failure.

## Final architecture census and closure — 2026-09-07

At `776d5dee7`, the tool again printed the unchanged 1,504-line S1 path while
reporting 205 oversized files. A full committed-source comparison against
`origin/main` `4506a2eda` found 204 upstream and exactly one introduced overage:
`offline-store.test.ts`, 1,642 lines versus 1,415. The printed S1 path was not
the cause. The earlier inherited-failure inference in the run's closing evidence
was incorrect and is explicitly corrected in its review record.

The test-only split at `1322bbfbc` preserves all 42 top-level tests and moves the
four public-state/refusal tests byte-for-byte. The files now count 1,490 and 199
lines. The separate range-store blank-line correction also respects the canonical
counter's trailing empty line. `node scripts/caps.mjs` now passes all seven
categories: 204/204 oversized files, working set 58/59, foundation 12/12. This
closes the architecture's introduced cap failures without changing the baseline.
The historical S1 cleanup request remains independent; there is no current
caps failure to attribute to those allowed baseline files.
