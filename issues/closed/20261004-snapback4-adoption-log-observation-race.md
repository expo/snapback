# Snapback 4 adoption test observes recovery before its asynchronous log line

Date: 2026-10-04
Status: Closed
Scope: Snapback 4 CLI adoption regression test

RPF's full Darwin suite fails
`check_adoption::w8c_adoption_lock_failure_repeats_on_sweep_and_retries_without_another_save`
at `crates/snapback4/tests/check_adoption/mod.rs:25`: the final immediate read
of `host.log` does not yet contain `schema adopted as generation 2`.
The preceding query has returned version 2 and `doctor` has succeeded.
Lock refusal, repeated sweep reporting and automatic recovery assertions pass.

The **same failure at the same assertion reproduces on unmodified base
`f2ec498379376421ce7f329c9efee972463cedc3`**, independently built from `git archive`
on the Apartment mini. The base test takes 17.04 seconds. An unchanged isolated
RPF rerun passes in 16.62 seconds; that does not erase the full-run failure.

Reproduce from `snapback4/`:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4 --test check check_adoption::w8c_adoption_lock_failure_repeats_on_sweep_and_retries_without_another_save -- --exact --nocapture
```

`serve_adoption.rs` emits the diagnostic before releasing the engine guard,
but `diagnostics::emit` queues it to a separate writer. The test waits for query
recovery, then assumes the queued log is already visible. This is consistent
with an asynchronous log-observation race; no runtime adoption failure was
observed. Use the existing bounded `wait_adoption` helper for the expected
complete diagnostic while retaining every recovery and refusal assertion.
No product path, test assertion or timeout was changed by RPF to conceal it.

Evidence: `/tmp/rpf-full.log`, `/tmp/rpf-adoption-baseline-qualified.log`,
`/tmp/rpf-adoption-rerun.log`. Base sources are in `/tmp/rpf-census-baseline`.
The test and `serve_adoption.rs` are byte-identical between base and RPF.

## Resolution — 2026-10-04, Lane FX

The fixture now uses the existing bounded `wait_adoption` helper to observe a
newline-terminated recovery diagnostic after query version 2 and successful
doctor. Refusal and sweep observations also wait for complete diagnostics.
Every recovery/refusal assertion remains. The wider audit fixed the same
observation pattern in other tests, and a clean stress run exposed and fixed
the adjacent external-adoption fixture's SIGSTOP/SQLite writer-lock race.

Validation and the excluded 13:51Z infrastructure interruption are recorded in
the [FX report](../../snapback4/reports/20261004-fx-test-races/REPORT.md).
No runtime behavior or timeout ceiling changed.
