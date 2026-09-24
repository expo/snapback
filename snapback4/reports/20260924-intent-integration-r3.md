LLP 3000.013 integration, round 3 — 2026-09-24

Merged `sb4-intent/a-planner` at `b67661952` into `sb4-intent/integration`
with `--no-ff`, merge commit `925966117`, from integration `4503ce02e`.
Read A's external r8 report and committed aggregate-safety report first.
Nothing pushed or published.

Conflicts were limited to the RFC revision header and append-only journal.
The RFC retains its complete review history plus the aggregate safety revision;
the journal preserves the prior integration as a byte-for-byte prefix and
then appends A's entry unchanged. Code and guide text merged cleanly.
The post-merge `cargo build --workspace` passed.

File-by-file changes (relative to `snapback4/`, except the RFC):

| File | Result |
|---|---|
| `crates/snapback4-lang/src/bind/intent_aggregates.rs` | Infer seek order only from endpoints proved present and non-failing, using each program/helper's required parameters. Keep unsafe sibling bounds residual and skip inferred ordering when intrinsic id is pinned. No engine/IR change. |
| `crates/snapback4-lang/tests/intent_aggregate_safety.rs` | Five new tests cover division/overflow guards, nullable narrowing, named-id plans, one-sided seek work and helper parameter isolation for count/sum/exists. |
| `crates/snapback4-lang/tests/intent/aggregate_plans.rs` | Add the direct one-sided seek-planning regression. |
| `crates/snapback4-lang/src/guide/reads.rs` | Preserve A's safety explanation. Adapt the existing `recentTotal` example to required `start: time, end: time` parameters so it demonstrates supported inferred seeks. |
| `../llp/3000.013-quarry-states-intent.rfc.md` | Preserve prior review provisions and add the endpoint/sibling/id safety requirements under §5.1. |
| `reports/20260924-intent-lane-a-aggregate-safety.md` | Preserve A's detailed findings, tests and verification. |
| `metrics/wasm-budget.json` | Record unchanged size and artifact hash; retain the 486,000 B ratchet. |
| `JOURNAL.md` | Preserve A's entry and append one integration-round-3 entry after qualification. |
| `reports/20260924-intent-integration-r3.md` | This merge and qualification record. |

The first focused guide run found one integration example failure:
`every_card_compiles_clean`, reads card block 1, `E_QUARRY_BOUND` at
`schema.q:410:16`. Its `count(messages where .roomId = roomId and
.at >= now - 1d and .at <= now)` uses arithmetic outside the new conservative
endpoint proof and fell through to an unbounded bucket lane. Classification:
**integration documentation mismatch**, not a baseline or environmental
failure. Reproduce on merge commit `925966117` with
`cargo test -p snapback4-lang --test guide every_card_compiles_clean`.
The corrected example takes required endpoints; all 57 guide tests pass.
No inference proof, admission rule or engine bound was weakened to retain
the old example. This is the only integration-specific source adjustment.

Verified forms and behavior:

- `count(t where d != 0 and .at > 10 / d)` preserves the guard at zero;
  safe sibling `.at < 100` bounds cannot make it eager. Sum and exists agree.
- `count(t where x != null and .at > x)` preserves nullable narrowing.
- `count(t[id = x] where .at > 10)` keeps `byId`, with no extra index and
  at most one row examined; count/sum/exists match explicit `by .id`.
- `count(t where .at > start)` seeks past 97 excluded rows in a 100-row
  fixture and examines at most three matches; sum and exists are covered.
- The complete target, including Following, compiles without diagnostics
  and passes all three end-to-end tests. Its digest's required period endpoints
  still produce the `(conversationId, tombstone, at, id)` range seek without
  `by .at`; the 5,000-row skip under examined=20 remains covered.

Focused verification: **74 tests passed** — guide 57, aggregate safety 5,
existing aggregate/cursor followup 5, aggregate planner unit tests 4, and target
simulator tests 3. The target digest remains two chunks, K=64, zero retries,
312,580 B peak heap and 823 B retained count heap. Authorization, restart and
once-only effects remain asserted.

WASM rebuild: **1,744,850 B raw / 485,005 B gzip**, unchanged. Its SHA-256 is
`4d20f09fbb499d191d5710e3a9cf1ee66545b9277c321a7c5499e8cc2548d212`, identical
before and after the merge and rebuild. Neither core nor device source changed.
The 486,000 B ratchet retains 995 B headroom; runtime meter ceilings are unchanged.

Full suite: **`== 0 failure(s) in 273 s`**, exit 0. All 1,088 client tests passed, 10 skipped. No full-suite failures: integration, baseline and environmental counts are all zero. No intermittent client failure occurred, so no isolated client rerun was needed.

`ref-check --verbose` reports zero errors and zero unchecked references.
Whitespace checks pass; every changed source file remains below 1,500 lines.
No design deviation, new diagnostic, authorization/disclosure relaxation or
new open problem. The conservative endpoint proof and resulting guide-example
adjustment are explicit above. No baseline test expectation changed this round.

Logs under `~/sb4-intent/`: `integration-r3-build.log`,
`integration-r3-lang.log` (initial guide failure),
`integration-r3-lang-final.log`, `integration-r3-unit.log`,
`integration-r3-target.log`, `integration-r3-bun.log`,
`integration-r3-wasm.log`, `integration-r3-wasm-before.sha256`,
`integration-r3-wasm-identity.log`, `integration-r3-suite.log`,
and `integration-r3-ref-check.log`.
