# snapback4: security_wave19 check-refutation test depends on check's 1,500 ms wall-clock budget

Status: Closed
Found: 2026-10-23, 0.4.38 publication (Mac dry runs 1 and 2 at 951ecdd4df)

`crates/snapback4/tests/security_wave19.rs::check_refutes_excluded_contact_roles_before_any_full_test`
asserts that plain `snapback4 check` exits 1 with a `generated-fixture-trace` refutation of
`snapback4-lang/tests/security/wave20/050.q`. `check` explores concrete paths under
`Campaign::bounded(1500)` (`src/verbs/security.rs:21`; `bind/security/challenges.rs:43` marks the rest
"unproved" when the deadline passes). On the shared M5 under the full publication suite the refutation
was not reached within 1.5 s, so check printed `0 proved, 0 refuted, 2 unproved` and exited 0:

- dry run 1 (18 Rust test processes): empty fixtures=false, check 1,832 ms;
- dry run 2 (6 processes): empty fixtures=true, check 1,749 ms.

Alone it passes 5/5 (3.3 s) and the whole target 3/3; Linux qualification passed it in the suite.
This is a wall-clock flake that costs a full Mac publication cycle each time.

Fix direction: make the test independent of wall-clock (assert with a work-bounded budget, e.g. a test-only
flag or env for the exploration deadline, or `--security-full`-style deterministic exploration for this
fixture), or make check's budget work-based rather than time-based.

## 0.4.39 recurrence — 2026-10-23

Mac publication dry run 1 for 0.4.39 at `d4441c83b6` failed only this test. It ran at the lower
parallelism that passed 0.4.38 (`SNAPBACK4_RUST_TEST_PROCESSES=3`), with empty fixtures=true,
check at 1,706.5 ms, and `0 proved, 0 refuted, 2 unproved`, so `Some(0) != Some(1)`. The M5's
15-minute load average reached about 100 from other sessions during cargo test.

- Alone, it passed 5/5 (3.2–4.1 s). The whole `snapback4` `security_wave19` target passed 3/3
  (62–64 s).
- Dry runs 2 and 3, at 2 Rust test processes, passed it.

So the lower-parallelism workaround does not reliably avoid it. The test still needs a work-bounded
fix. Evidence: `snapback4/reports/20261023-publication-0.4.39/kit/isolated/dr1/` and
`kit/iso-dr1.log`.


## Resolution — 2026-10-24, SEC10

Default check and production deployment now use fixed work budgets (512 and
8192), with no wall-clock deadline. Explicit caller-selected deadline campaigns
report `stopped early (time)` rather than a completed campaign. The real CLI
wave-19 regression checks repeated no-cache refutations and asserts the default
has no time cut. The affected `security_wave19` target passed all 11 tests on
Linux (75.92 s); Mac is intentionally skipped by the SEC10 commission.
