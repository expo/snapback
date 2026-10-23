# Security wave19 contact-role refutation qualification fails

Date: 2026-10-23
Status: Open
Scope: Snapback 4 CLI security qualification, outside P1-EV-1

The P1-EV-1 fix-round binary sweep fails
`check_refutes_excluded_contact_roles_before_any_full_test` in
`crates/snapback4/tests/security_wave19.rs`. A serial rerun of that entire
target reproduces this one failure (ten other tests pass):

```sh
cargo test --locked -j 4 -p snapback4 --test security_wave19 -- --test-threads=1 --nocapture
```

Run from `snapback4/` with the worktree's own Cargo target and exported
`CARGO_PROFILE_DEV_DEBUG=line-tables-only` /
`CARGO_PROFILE_TEST_DEBUG=line-tables-only`, as in the lane report.

The fixture is `snapback4-lang/tests/security/wave20/050.q`. Expected:
`check` exits 1 and reports a generated-fixture trace refuting the excluded
contact-role read. Observed: exit 0, zero refuted and two unproved invariants,
with advisory audience notes. This is a qualification failure, not evidence
of an application disclosure. Investigate whether bounded campaign behavior,
the fixture, or replay/refutation is responsible.

Security source and this test are unchanged from `1875a9e77f`; this lane changes
Postgres evolution only. No claim that this result was reproduced on an old
binary is made. The broad sweep also failed missing-record and private-serve
preparation cases, both of which pass serially. Raw evidence stays under
`/tmp/sb4-p1ev1-fix1/`; the lane report records the remaining scope.

## Resolution (2026-10-23, lead)

Not reproducible off the loaded host.
`check_refutes_excluded_contact_roles_before_any_full_test` passes on
expo-build-1000 at both main `a044e8d606` and P1-EV-1 `f8c54693c1`
(2.97 s each). The failure was seen only on expo-build-450a under heavy
parallel load, so it is an environment failure, not a P1-EV-1 or security
regression. Closed.
