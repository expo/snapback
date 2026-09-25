# Lane Q intermediate test failure ledger

2026-09-25. Intermediate suite: `== 2 failure(s) in 417 s`.

Stages: cargo test and client tests. All introduced deterministic failures below were fixed; the final fixed-source run is recorded in the [lane report](20260925-lane-q-expiring-counts.md). No assertions or tests were removed. The original interrupted ENOSPC run had no completed summary (environmental).

The shared baseline log reported `== 1 failure(s) in 276 s`, with legacy-capability, word-fixture, authoring-census and why-output failures. Those four failures did not recur here; this lane did not alter their expectations to obtain a pass.

## Rust failures — ours

| Test | Cause and correction |
| --- | --- |
| `a_capped_maintained_point_is_unavailable` | The intended optimization removes live-population cost. Exhaust the meter with expired backlog instead; still assert no partial number. |
| `a_capped_maintained_scan_is_unavailable_without_a_cursor` | The intended optimization removes live-population cost. Exhaust the meter with expired backlog instead; still assert no partial number. |
| `every_card_compiles_clean` | Added guide block changed the block count and last-block position. Update the count and select the compatibility example by declaration. |
| `hidden_rows_expiry_rule_probes_and_live_aggregates_are_not_constant` | Old cost wording named live rows. Assert unswept expired contributions. |
| `language_following_uses_the_declaration` | Added guide block changed the block count and last-block position. Update the count and select the compatibility example by declaration. |
| `language_timeline_registers_delivers_and_removes_without_helpers` | Added guide block changed the block count and last-block position. Update the count and select the compatibility example by declaration. |
| `maintained_columns_compose_with_mapped_timeline_tables` | Added guide block changed the block count and last-block position. Update the count and select the compatibility example by declaration. |
| `maintained_columns_on_mapped_tables_leave_timeline_state_identical` | Added guide block changed the block count and last-block position. Update the count and select the compatibility example by declaration. |
| `maintained_columns_refuse_timeline_owned_sources_in_the_binder` | Added guide block changed the block count and last-block position. Update the count and select the compatibility example by declaration. |
| `round2::witness_fetch_budget_memory` | Null expiry now sorts last. Use an early live deadline/clock to preserve the early-witness heap assertion. |
| `round2::witness_fetch_budget_sqlite` | Null expiry now sorts last. Use an early live deadline/clock to preserve the early-witness heap assertion. |
| `trending::w12r1a_exhausted_count_projection_is_unavailable` | The intended optimization removes live-population cost. Exhaust the meter with expired backlog instead; still assert no partial number. |

## Client failures

The 47 generated-wire review cases shared one failed fixture-export compilation: this run overlapped an in-progress memory adoption edit that called a crate-private heap-release method. That call was corrected before the targeted upgrade checks; the final suite uses fixed source. Four codec-census failures came from changing the spelling of an allowlisted SQLite decoder statement; the original statement is retained and its decoded schema is made mutable afterward.

Six other failures were timing-sensitive on the shared host: process/readiness timeouts and a restore job advancing before its parked-state assertion. No production/client-test code changed for those six. The second run serialized client files using the existing harness option; the final successful run used the normal parallel harness. The seventh, `unavailable server list responses end retention in both clients`, recurred under serial execution. A new deterministic test then proved a pre-existing 0.4.1 client bug (absent from the older baseline log): loading did not evict a remembered server answer. The one-branch production fix evicts it, and all 23 page-authority/page-ready/residency tests pass. Repetition also exposed an independent readiness-fixture race: its offline `ping` query did not reconnect, so it sometimes asserted an HTTP loading response while still offline. The fixture now awaits sync before those assertions; 10/10 repeated runs pass. This is classified as baseline code, not an environmental failure.

| Test | Attribution |
| --- | --- |
| census kills parse, encoded, MQ components and container regressions | Ours — exact decoder allowlist spelling. |
| data and doctor inspect persisted state despite destructive or broken source edits | Environmental — shared-host timing; unchanged test rerun. |
| legacy pointer deployments upgrade through deploy, never implicit serving | Environmental — shared-host timing; unchanged test rerun. |
| pre-admission journal: committed admission dedupes a surviving journal (retired receipt) | Environmental — shared-host timing; unchanged test rerun. |
| representation exceptions require the exact sqlite decoder and are consumed once | Ours — exact decoder allowlist spelling. |
| required pointer and ledger failures happen before database activation | Environmental — shared-host timing; unchanged test rerun. |
| serving edited release schema or programs refuses without adopting them | Environmental — shared-host timing; unchanged test rerun. |
| sqlite exceptions cannot move into a web function or lose their cfg | Ours — exact decoder allowlist spelling. |
| stopped full-release restore preserves its recovery point and stays separate from the original | Environmental — shared-host timing; unchanged test rerun. |
| unavailable server list responses end retention in both clients | Baseline — pre-existing remembered-answer bug, reproduced independently and fixed for the no-stale-answer contract. |
| wasm review mixed-readable generated pages snapshot=false | Ours — transient fixture-export compile error. |
| wasm review mixed-readable generated pages snapshot=true | Ours — transient fixture-export compile error. |
| wasm review renewal cold horizon=false split=false | Ours — transient fixture-export compile error. |
| wasm review renewal cold horizon=false split=true | Ours — transient fixture-export compile error. |
| wasm review renewal cold horizon=true split=false | Ours — transient fixture-export compile error. |
| wasm review renewal cold horizon=true split=true | Ours — transient fixture-export compile error. |
| wasm review renewal gap horizon=false split=false | Ours — transient fixture-export compile error. |
| wasm review renewal gap horizon=false split=true | Ours — transient fixture-export compile error. |
| wasm review renewal gap horizon=true split=false | Ours — transient fixture-export compile error. |
| wasm review renewal gap horizon=true split=true | Ours — transient fixture-export compile error. |
| wasm review renewal revoke horizon=false split=false | Ours — transient fixture-export compile error. |
| wasm review renewal revoke horizon=false split=true | Ours — transient fixture-export compile error. |
| wasm review renewal revoke horizon=true split=false | Ours — transient fixture-export compile error. |
| wasm review renewal revoke horizon=true split=true | Ours — transient fixture-export compile error. |
| wasm review renewal unlimited horizon=true split=true | Ours — transient fixture-export compile error. |
| wasm review same-commit later horizon=false split=false retained=false | Ours — transient fixture-export compile error. |
| wasm review same-commit later horizon=false split=false retained=true | Ours — transient fixture-export compile error. |
| wasm review same-commit later horizon=false split=true retained=false | Ours — transient fixture-export compile error. |
| wasm review same-commit later horizon=false split=true retained=true | Ours — transient fixture-export compile error. |
| wasm review same-commit later horizon=true split=false retained=false | Ours — transient fixture-export compile error. |
| wasm review same-commit later horizon=true split=false retained=true | Ours — transient fixture-export compile error. |
| wasm review same-commit later horizon=true split=true retained=false | Ours — transient fixture-export compile error. |
| wasm review same-commit later horizon=true split=true retained=true | Ours — transient fixture-export compile error. |
| wasm review same-commit rejoin horizon=false split=false retained=false | Ours — transient fixture-export compile error. |
| wasm review same-commit rejoin horizon=false split=false retained=true | Ours — transient fixture-export compile error. |
| wasm review same-commit rejoin horizon=false split=true retained=false | Ours — transient fixture-export compile error. |
| wasm review same-commit rejoin horizon=false split=true retained=true | Ours — transient fixture-export compile error. |
| wasm review same-commit rejoin horizon=true split=false retained=false | Ours — transient fixture-export compile error. |
| wasm review same-commit rejoin horizon=true split=false retained=true | Ours — transient fixture-export compile error. |
| wasm review same-commit rejoin horizon=true split=true retained=false | Ours — transient fixture-export compile error. |
| wasm review same-commit rejoin horizon=true split=true retained=true | Ours — transient fixture-export compile error. |
| wasm review same-commit renew horizon=false split=false retained=false | Ours — transient fixture-export compile error. |
| wasm review same-commit renew horizon=false split=false retained=true | Ours — transient fixture-export compile error. |
| wasm review same-commit renew horizon=false split=true retained=false | Ours — transient fixture-export compile error. |
| wasm review same-commit renew horizon=false split=true retained=true | Ours — transient fixture-export compile error. |
| wasm review same-commit renew horizon=true split=false retained=false | Ours — transient fixture-export compile error. |
| wasm review same-commit renew horizon=true split=false retained=true | Ours — transient fixture-export compile error. |
| wasm review same-commit renew horizon=true split=true retained=false | Ours — transient fixture-export compile error. |
| wasm review same-commit renew horizon=true split=true retained=true | Ours — transient fixture-export compile error. |
| wasm review same-commit twice horizon=false split=false retained=false | Ours — transient fixture-export compile error. |
| wasm review same-commit twice horizon=false split=false retained=true | Ours — transient fixture-export compile error. |
| wasm review same-commit twice horizon=false split=true retained=false | Ours — transient fixture-export compile error. |
| wasm review same-commit twice horizon=false split=true retained=true | Ours — transient fixture-export compile error. |
| wasm review same-commit twice horizon=true split=false retained=false | Ours — transient fixture-export compile error. |
| wasm review same-commit twice horizon=true split=false retained=true | Ours — transient fixture-export compile error. |
| wasm review same-commit twice horizon=true split=true retained=false | Ours — transient fixture-export compile error. |
| wasm review same-commit twice horizon=true split=true retained=true | Ours — transient fixture-export compile error. |
| web-reachable typed JSON calls all use the codec funnel | Ours — exact decoder allowlist spelling. |

## Second completed suite

`== 1 failure(s) in 1295 s` — client tests only. Every Rust execution and
doctest passed. The sole client failure was
`unavailable server list responses end retention in both clients`, the
pre-existing cache/recovery issues described above. The six host-timing
failures from the first run did not recur. Both corrections landed before the
final full-suite rerun; no failure was waived.

## Final completed suite

**`== 0 failure(s) in 265 s`**, exit 0. No final failures.
The final source stayed fixed throughout the run, using
`CARGO_BUILD_JOBS=8 SNAPBACK4_RUST_TEST_PROCESSES=8` and normal parallel client
files. All 882 Rust executions, including doctests, passed; the main client
process reported 1,479 tests, 1,469 passes, zero failures and ten existing
explicit skips. Separate client shards also passed. No new skips, assertion
removals or failure waivers. The exact log is
`~/sb4-intent/lane-q-test-complete.log`.
