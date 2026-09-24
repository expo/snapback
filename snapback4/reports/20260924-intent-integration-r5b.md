LLP 3000.013 integration, round 5 part b — 2026-09-24

Merged `sb4-intent/h-check` at reviewed head `63cb318c5` with `--no-ff` into
`sb4-intent/integration`: merge commit `6877a67e5`. Read both external final
reports and H's complete committed rounds 1–2 journal reports before merging.
Those journal reports include the imported file-by-file map, engineering
decisions and lane regression evidence; H has no separate committed report.

Only `JOURNAL.md` conflicted. Kept the complete part-a record and both H entries
unchanged, verifying every entry against each parent. The bounds and indexes
cards merged automatically; every previous paragraph remains unchanged with
H's new explanation added. All H implementation and test files match the
reviewed head byte-for-byte. No integration code fix or new test was necessary.

The imported compiler metadata, parser spans and printer retain authored
expressions, grouping, comments, duration spellings and fallback precedence.
The CLI certificate quotes that text and labels planner indexes by columns,
for example `index (org, at), chosen by the planner`. Two-column `(org, id)`
labels retain `id`. Verbose output and JSON cost plans retain canonical index
names. Existing Quarry forms, numeric certificate allowances, authorization,
disclosure, durability and runtime meters are unchanged.

Verification on the merged tree:

| Command | Result |
|---|---|
| `cargo build --workspace` | Passed; only the existing unused vendor trait warning. |
| `cargo test -p snapback4 --test check --test check_cost_source --test scale` | 68 check, 8 source/cost and 17 scale tests passed: **93 passed, zero failed**. |
| `cargo test -p snapback4-lang --test guide` | **67 passed, zero failed**, including F's published examples and the part-a cross-author unrepost regression. |
| `node --test --test-name-pattern='write authority: check --cost' packages/snapback4/test/write-authority.test.mjs` | **1 passed, zero failed**; validates H's intentionally updated source-display assertion. |
| `./ref-check --verbose` | 505 LLP documents, 9,235 references, zero errors and zero unchecked. |

Total affected tests: **161 passed, zero failed or skipped**. No introduced,
baseline or environmental failure occurred, and no intermittent failure
required an isolated rerun. Whitespace checks pass; the largest changed source
is `parser.rs`, 1,174 lines. README remains unchanged at 296/300 lines.

Integration-only files are this report and the appended dated `JOURNAL.md`
entry. No new form, refusal code, design deviation or open integration problem.
The complete Clique target fixture is unchanged; its dedicated integration
target was not rerun in this part. The requested scale target still checks
Clique operation classes, and guide tests execute current intent forms.

`scripts/test.sh` was **not run**: the full suite remains explicitly deferred,
so this part has no new full-suite summary. WASM rebuilding and the remaining
round-5 lanes and cross-lane qualification are also deferred. No version bump,
push or publication.

Logs: `~/sb4-intent/integration-r5b-{build,cli,guide,cost-js,ref-check}.log`.
