# `approval_gate_returns_one_pending_shape_on_bare_api_mcp_and_link_ingress` hangs indefinitely

**Status:** Open
**Filed:** 2026-08-21
**Severity:** Blocks `cargo test -p snapback-server --lib` from ever completing

`server::tests::approval_gate_returns_one_pending_shape_on_bare_api_mcp_and_link_ingress`
never terminates. It blocks the whole `snapback-server` lib suite, which stops
after 465 of its tests and hangs there.

## Evidence

- Reproduced running the test alone, `--exact`: killed at 420 s (rc 124) and
  again at 240 s. Not slow — hung.
- `sample(1)` on the test thread shows it parked in a socket `read` that never
  returns, not spinning.
- Reproduced on `origin/main` on a second machine (M1 Max) with no local
  changes, so it is NOT caused by the writer-gate fix in `6974f80e8`.
- Setting `SNAPBACK_EXPECT_WORKERD=1`, as the battery's `rust-tests` gate does,
  does not change it.

## Why the battery did not catch it

The complete battery at `157118d4e` (2026-08-20 15:00) ran
`env SNAPBACK_EXPECT_WORKERD=1 cargo test --workspace -- --test-threads 4`
and it FAILED in 248 s with exit 101 — a panic, not a hang — so this test
completed there. The test itself dates from `c5633d707` (2026-08-18), well
before that run.

Three commits touching this area landed after that battery and before the hang
was observed:

- `56982daef` fix(server): make config.verify an exact powerless probe lane
- `8de11f06e` feat(kernel): move room authority into the kernel (LLP 0285 step 8)
- `8176b4348` fix(kernel): make registry retirement authoritative for issued authority

Step 8 is already known to have broken live serving in a second way (see
`issues/closed/20260820-step8-retirement-breaks-live-delta.md`), so it is the
leading suspect, but this has NOT been bisected yet. Do not assume.

## Next step

Bisect across those three commits, running only this test with a hard timeout.
A hang is invisible to `--test-threads 4` aggregate timing, so add a per-test
timeout to the `rust-tests` gate as well — otherwise the next hang also
presents as "the battery is still running" rather than a failure.

## Related

- `issues/20260820-f3-bucket-b-pre-existing-reds.md`
