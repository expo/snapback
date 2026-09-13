# Snapback 4: CLI help and guide cards drift from the implementation

Status: Closed
Severity: minor
Priority: P2
Area: ergonomics
Observed: 2026-09-13
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Review provenance: Snapback4 comprehensive-review synthesis (2026-09-13 child review)

## Problem and reproduction

Several CLI/guide surfaces disagree with the code they describe (all
verified by reading the cited lines; no open snapback4 ticket covers
help/guide drift — searched issues/ titles and bodies):

1. `HELP` omits the `types` verb: [main.rs](../../snapback4/crates/snapback4/src/main.rs):14-29
   lists init/check/dev/deploy/rollback/serve/run/test/why/guide/data/doctor/device,
   but the dispatcher at main.rs:49 handles `"types" => verbs::types(...)`.
   `snapback4 types --help` works; `--help` never mentions it.
2. The `guide` no-card error (main.rs) lists only
   `rules, sync, writes, reads, shapes, bounds, types, personas, refusals, programs`,
   omitting real cards such as expire/assets/jobs/feeds
   ([guide.rs](../../snapback4/crates/snapback4-lang/src/guide.rs):131,147,165,187).
3. `CODES` ([guide.rs](../../snapback4/crates/snapback4-lang/src/guide.rs):331) omits
   codes `explain_code` understands (:360-366 and neighbors): `E_SYNC`,
   `E_QUARRY_TYPE/UNKNOWN/AMBIGUOUS/UNSUPPORTED`, `E_UNBOUND_LOOP`,
   `E_EMIT_IN_QUERY`, `E_OP_RESERVED`, `NOT_FOUND` — so `why` cannot
   discover refusals the engine actually raises.
4. `run` defaults to `--as alice` ([verbs.rs](../../snapback4/crates/snapback4/src/verbs.rs):237)
   while a job run silently ignores `--as` and executes as the system
   (:245-258); `data --limit garbage` silently becomes 50 (:307
   `unwrap_or(50)` on parse failure).

## Implementation locations

- [crates/snapback4/src/main.rs](../../snapback4/crates/snapback4/src/main.rs) (`HELP`, `guide` error)
- [crates/snapback4-lang/src/guide.rs](../../snapback4/crates/snapback4-lang/src/guide.rs) (`CODES`, `explain_code`, cards)
- [crates/snapback4/src/verbs.rs](../../snapback4/crates/snapback4/src/verbs.rs) (`run`, `data`)

## Suggestion

Generate the verb list and card list from the same tables the dispatcher
and `card()` use (a test can assert HELP names every dispatched verb and
the error names every card); add the missing codes to `CODES`; refuse an
unparseable `--limit` instead of defaulting; warn when `--as` is passed
for a job run. Also confirm `data` bypassing rules/persona
(verbs.rs:294-324) is intentional admin-tool behavior and document it.

## Resolution — 2026-09-13

The newer 0.2.3 baseline had already removed two obsolete paths from this
report: the unknown-card output is derived from `guide::KEYWORDS`, and
`guide::CODES` contains every diagnostic code listed above. No language-card
change was needed.

The CLI help now includes `types`, describes `data` as administrative
inspection that bypasses read rules, warns when `run --as` targets a system
job, and refuses a malformed `data --limit`. The focused regressions verify
all 15 dispatched verbs appear in help, the job warning, and strict limit
parsing. The Rust binary suite passes 5/5 tests, and the combined focused host
run passes all 18 reported tests.
