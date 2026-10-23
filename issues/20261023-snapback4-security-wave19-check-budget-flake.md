# snapback4: security_wave19 check-refutation test depends on check's 1,500 ms wall-clock budget

Status: Open
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
