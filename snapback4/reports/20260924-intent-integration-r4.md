LLP 3000.013 integration, round 4 — first 0.4.1 candidate — 2026-09-24

Branch `sb4-intent/integration`, worktree `~/sb4-intent/lane-i`.

Merges, in order:

| Source | Merge commit | Conflicts and verification |
|---|---|---|
| Fetched `origin/main`, `e8196704a` | `4bc740c0a` | No conflicts. Carries the published 0.4.0 versions, fence policy, transactional `_effect_keys` creation and publication evidence. Post-merge `cargo build --workspace` passed. |
| `sb4-intent/h-check`, `de2673a5b` | `85848ae30` | Journal-only conflict: preserve the complete publication journal as a byte-for-byte prefix, then append H's entry unchanged. Code, tests and guide merged cleanly. Post-merge workspace build passed. |

Both merges use `--no-ff`. Read H's external final report and its committed
journal qualification record before merging; H has no separate committed
report file. Its two feature commits are `537a59e11` and `de2673a5b`.

Lane H changes, file by file relative to `snapback4/`:

| File | Behavior preserved |
|---|---|
| `crates/snapback4/src/scale/windows.rs` | Prove the relationship between calendar key, lane range and exact endpoint filters before using the edge-bucket explanation. |
| `crates/snapback4/src/scale.rs` | Precise window and unswept-expiry reasons; retain structural classes and conservative numeric allowances. |
| `crates/snapback4/src/scale/writes.rs` | Apply the expiry-backlog explanation to cap enforcement. |
| `crates/snapback4/src/verbs.rs` | Compact default notes with `why` pointers; verbose explanations once per code/card; detailed grouped notes retained in verbose/JSON; no empty rewrite labels. |
| `crates/snapback4/src/main.rs` | Update verbose help. |
| `crates/snapback4-lang/src/guide/bounds.rs` | Explain edge density, sweep backlog limits and opt-in note details. |
| `crates/snapback4/tests/scale_windows_expiry.rs` | Window recognition/fallback, authorization, measured history versus edge density, expiry backlog and text/JSON coverage. Add the integration regression below. |
| `crates/snapback4/tests/scale_intent.rs` | Pin the intended edge-hour explanation without a filter rewrite. |
| `crates/snapback4/tests/check.rs` | Expect compact default notes and opt-in repeated/grouped details. |
| `crates/snapback4/tests/check_notes.rs` | Compare default, verbose, why and JSON note detail. |
| `JOURNAL.md` | Preserve H's record and append one round-4 integration entry. |

Review Low closed in `scale_windows_expiry.rs`:

`window_on_another_time_column_keeps_generic_growth_and_rewrite` compiles an
explicit 25-lane merge using `by byCreatedHour: hour(createdAt), likeCount,
publishedAt, id`, with exact window comparisons against `.publishedAt`.
It requires `Class::Grows`, the generic `posts skipped by ...` reason naming
`.publishedAt`, the existing filter-pinning rewrite, and no `two edge` claim.
Changing only those filter references to `.createdAt` supplies the positive
control: an edge-hour explanation, no rewrite, and the same numeric allowance.

The negative control temporarily removed exactly ` || name != &key.column`
from `scale/windows.rs`. The new test failed on the incorrect edge-hour reason
and empty rewrite. Restored the file byte-for-byte before affected tests and
the full suite. This is an intentional failed mutation test, not a remaining
product or suite failure. Reproduce the passing regression with:

```sh
cargo test -p snapback4 --test scale_windows_expiry \
  window_on_another_time_column_keeps_generic_growth_and_rewrite
```

One imported annotation issue was also fixed: `crates/snapback4-core/src/store.rs`
used the nonexistent `#5.3-effects-keyed-once` anchor on LLP 3000.013, which
reference validation rejects. Changed only the anchor to the existing section `#5.3`; transactional
once-key behavior is unchanged. The initial reference failure is inherited
from fetched main, not H. Final reference validation passes: 504 LLP documents,
9,234 references, zero errors and zero unchecked references.

Qualification:

- **158 focused tests passed**: 98 CLI tests (check 68, notes 1, scale 17,
  scale intent 6, windows/expiry 6), 57 guide tests and 3 complete target tests.
- The complete Clique target still compiles without diagnostics and runs
  Following, planned Global, Trending, derived totals, search and history.
  Its digest completes in two chunks, K=64, zero retries, 312,580 B peak heap
  and 823 B retained count heap; seek bounds, source authorization, restart
  and once suppression remain asserted.
- Full suite: **`== 0 failure(s) in 304 s`**, exit 0. All 1,088 client tests passed, 10 skipped. No integration, baseline or environmental suite failure. No intermittent client failure occurred, so no isolated client rerun was needed.
- WASM rebuilt by the full suite: **1,744,842 B raw / 484,967 B gzip**, 8 B raw and 38 B gzip smaller than round 3. The 486,000 B ratchet is unchanged, leaving 1,033 B headroom; recorded in `metrics/wasm-budget.json`. This is a whole-artifact measurement after importing main, without independent component attribution.
- Frozen Bun install, whitespace and changed-source line budgets pass.
  Publication and H journal entries are preserved exactly.

No design deviation or new open problem. The known expiry limitation remains
explicit: a one-second maintenance cadence cannot bound backlog age when a
pass deletes at most 2,000 rows; H's 2,001-row regression remains passing.
No runtime, authorization, disclosure or meter behavior was changed by this
qualification. Package versions remain the inherited 0.4.0 publication
versions; this is a candidate code integration, without a release bump,
push, package publication or deployment.

Evidence under `~/sb4-intent/`: `integration-r4-build-main.log`,
`integration-r4-build-h.log`, `integration-r4-cross-column.log`,
`integration-r4-cross-column-mutant.log`, `integration-r4-affected.log`,
`integration-r4-guide.log`, `integration-r4-target.log`, `integration-r4-bun.log`,
`integration-r4-ref-check.log` (inherited annotation failure),
`integration-r4-ref-check-final.log`, and `integration-r4-suite.log`.
