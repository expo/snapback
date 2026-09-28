# Lane EQ round 2 — normalized shape-progress cursors

Date: 2026-09-28. Branch: `sb4-intent/eq-equality-prefix`. Starting round-1
commit: `6cf1a1099`. The first repository command was `git fetch origin &&
git merge origin/main`. Merge `c296e5f92` preserves both sides of the RFC
revision-line and journal-append conflicts. `merge-preservation.log.gz` verifies
that every line from each parent's journal remains in order, and every RFC
revision entry remains present. The other merge changes were automatic.
The fetched main parent is `80036b4664d0059a91ba5b19223a9e7e9fc6b70d`.

Read both prior prompts, reports and EQ journal entries, the full round-0
reviews and Astra's full round-1 NOT READY review. Grok's round-1 file had
only progress text and no verdict at startup; it was not awaited.

Both requested findings are addressed. No planner rule changed. No push,
publication, tool installation, shared-path change or budget increase.
`scripts/test.sh` was not run, as instructed. Round 1's full-suite record
stands; this report does not replace it with an inferred green full run.

## Fix and tests that reject the old behavior

**Medium: converted inclusive cursor makes an extra empty retry.** In
`engine/read.rs`, a validated legacy position inside the normalized prefix
now receives the current suffix descriptor and evaluated prefix scope before
being re-encoded for `record_shape_cursor`. Scanning and shape-progress
detection therefore use the same logical position. Its table, index, order,
variant, generation and original prefix have already passed the existing
checks. Out-of-scope filter-reject cuts keep their existing behavior.

`selected-prefix-shape-first.json` and `selected-prefix-shape-last.json`
are actual engine-minted baseline tokens. The generator temporarily removes
only the selected-index call to `selected_prefix`, restoring the pre-EQ
compiler path. It seeds one item at `lane = 0` and 9,000 details, and executes
the review's shaped query with the default 8,192-row ceiling. It checks the
old full-key descriptor and empty prefix, obtains the engine's inclusive
unfinished-row cursor, and confirms the baseline's first follow refuses
`E_SHAPE_EXCEEDS_METER` before saving the token. The planner was restored
byte-for-byte in a `finally` block. No cursor field was fabricated or altered
to produce these two fixtures.

The normal regressions assert the old descriptor, mint a different current
token for the same unfinished row, and require the same immediate refusal
from either token, separately for `first` and `last`. They never rewrite the
saved fixtures. Before the runtime fix, both tests failed with exactly the
extra empty page, `cut: meter`, and another cursor reported by Astra;
afterward both pass. See `mint-baseline-shapes.log.gz`, `regressions-before.log.gz`
and the final tests. The fixture README contains the regeneration command;
`fixtures.json` records the saved files' SHA-256 hashes.

**Low: current-format prefix rejection was untested.** The existing baseline
continuation test now decodes the freshly engine-minted `new_token`, changes
each normalized prefix component in turn, re-encodes it canonically, and
requires exactly `E_INPUT`. This runs across both directions, with/without
an original prefix, and argument/literal equalities: 16 altered current-token
checks in addition to the old-token controls.

Temporarily replacing the prefix condition with the review's
`cursor_prefix == prefix.len() || scope.prefix == prefix[..cursor_prefix]`
makes the strengthened test fail because the invalid token is accepted.
`mutation-current-prefix.log.gz` records that failure. The runtime source was
restored byte-for-byte before implementing the shape fix.

## Qualification

Final command arguments, exit statuses and exact per-target summaries are
in `tests.json`; each named command has its own complete log. All commands
use Cargo's `--no-fail-fast`. Builds use Rust 1.97.0, eight Cargo jobs/test
threads, disabled incremental/debug information, the packaged SQLite flags,
and a 65,536 fd limit, as in the existing worktree environment.

- Final EQ compiler/cursor tests: **14 passed** (5 + 3 + 6).
- Whole guide: **92 passed**. The selected-prefix suite still directly
  asserts the original builder's schema/IR compatibility and normalized
  history prefix.
- Core corpus/disclosure/meter/positional decoder: **68 passed**.
- Server continuation/shape module: **67 passed**.
- Device continuation/shape module, memory and SQLite: **134 passed**.
- Device codec: **11 passed**.

Total: **294 affected tests + 92 whole-guide tests = 386 passed, zero failed
or ignored** in the final corrected invocations. Module-filtered commands
leave unrelated tests unrun; they are not whole-package or whole-suite claims.
Reference audit and staged whitespace checks pass; changed Rust source files
remain below 1,500 lines. Logs are compressed without text edits, with their
uncompressed sizes and SHA-256 hashes in `logs.json`.

The earlier implementation also passed the 14 EQ tests, whole 92-test guide,
and 68 core corpus/disclosure/meter/positional-decoder tests before the
semantically equivalent wasm-size adjustment. The final tests use the shared
suffix constructor in the committed implementation.

The runtime change is confined to legacy cursor shape-progress detection;
the planner and history fixtures are unchanged. Round 1's 462 paired
process/wasm observations and React witness remain historical evidence, not
rerun evidence for this round. Native Expo remains unqualified on this Linux
host; no full §7.1 or RFC-wide completion claim is added.

The exact historical round-1 full-suite summary remains:

```text
== 1 failure(s) in 1856 s
   cargo test
```

That was the lane-owned positional Scan decoder failure, subsequently fixed
and covered by the passing lane-source tests. See the round-1 report for
its complete ledger and existing client skips. The supervisor's landing
suite is next.

## Failure ledger

- **Ours, deliberate regression reproduction:** `regressions-before.log.gz`
  reports 1 passed / 2 failed. Both new direction tests expose the round-1
  shape-progress bug. Both pass with the fix.
- **Ours, deliberate mutation:** `mutation-current-prefix.log.gz` reports
  0 passed / 1 failed, at the newly added current-token prefix check. The
  intentionally weakened prefix check was restored.
- **Ours, corrected test setup:** `mint-baseline-shapes-initial.log.gz` reports
  0 passed / 2 failed. Reusing the page helper supplied undeclared argument
  `k` to `feed`. The corrected shape-specific context supplies only `c`;
  `mint-baseline-shapes.log.gz` then passes 2/2 and mints both fixtures.
- **Ours, corrected intermediate wasm overrun:** `wasm-fixed.log.gz` exits 1
  at 2,021,073 B raw / 586,301 B gzip, **108 B over** the unchanged budget.
  Replacing the new `Vec<CursorColumn>::drain` path with the existing suffix
  constructor removes that overrun while retaining the fix. Final build
  passes; the failed artifact is not the qualified one.
- **Ours, corrected setup/audit mistakes:** exploratory reads named the
  nonexistent `ROUND1.md`, simulator `query.rs`, flat
  `merge_continuation.rs`, and an absent optional report `.gitignore`. The first merge
  preservation assertion assumed that main only appended to the entire
  journal; main had also inserted prior SS entries earlier. A line-preserving
  ordered-subsequence check verifies both full parent journals instead.
  The revision-line merge script initially duplicated the accepted revision;
  later inspection also caught its treatment of internal semicolons. The
  corrected merge preserves complete entries and was amended locally; the
  final audit checks complete entries and balanced parentheses.
- **Ours, corrected Cargo target names:** `final-sim-continuation.log.gz` and
  `final-device-continuation-codec.log.gz` exit 101 before running any test.
  `merge_continuation` is a module, not a standalone target; the corrected
  commands filter that module within `clique` and `device`, and run `codec`
  separately. Both failed commands remain in `tests.json`.
- **Ours, integration:** the initial merge exited 1 for two concurrent documentation
  conflicts, resolved with both sides retained. No product test ran during
  that conflict state.

**Baseline test failures: zero. Environmental test failures: zero.** Native
Expo is an unchanged unrun qualification gap, not a passed or failed test.
Existing wasm build warnings are retained in the logs.

## Wasm

Official `scripts/build-wasm.sh`, Rust 1.97.0 / wasm-bindgen 0.2.127,
no wasm-opt on PATH, GNU file-input `gzip -9`, same worktree/toolchain:

| Artifact | Raw bytes | gzip bytes |
| --- | ---: | ---: |
| Merged round-1 baseline | 2,020,387 | 586,133 |
| Final round-2 fix | 2,020,770 | 586,142 |
| Growth | **383** | **9** |

Unchanged budget **586,193 B**, headroom **51 B**. The growth pays for
normalizing the recorded cursor descriptor/scope and encoding before shape
comparison; this is a whole-artifact delta, not per-instruction attribution.
The baseline rebuild is byte-identical to round 1. `wasm.json` identifies
both hashes, sizes and the delta. Final SHA-256:
`8d88256858e583b936a5aa0bf1ee170aa94d252afe4d1369f16c0c460b55557b`.
No ceiling, package version, dependency manifest or publication changed.

## Orientation and documentation

Applied `llp-orient` read-only from the initialized
`/home/ccheever/projects/snapback/vendor/llp/skills/llp-orient/SKILL.md`.
Scope: direct cursor conversion, returned-shape progress and cursor tests.
Governing constraints: LLP 3000 §2/§7; LLP 2000.000 §6;
LLP 3000.028 §3.2/§7.1/§7.6; LLP 3000.007 §14 ruling 35 and §20.22.7.
Read the current reads/sync guide forms, fence, NOT-DOING and journal.
The existing no-progress refusal is the intended behavior; no new design
decision or capability is needed. The relevant `@ref` remains valid.
LLP 3000.028's Revised line and implementation paragraph record the fix;
this round appends one journal entry. Hand-off: no new LLP; native Expo
qualification remains with the wider program.
