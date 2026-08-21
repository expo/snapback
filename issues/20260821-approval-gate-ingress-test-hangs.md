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

## Why the battery did not catch it — corrected

An earlier revision of this ticket said the test "completed" in the
2026-08-20 battery. That was wrong, and the real answer matters more than the
hang.

The `rust-tests` gate runs `cargo test --workspace` with NO `--no-fail-fast`,
so cargo stops at the first failing test target. At `157118d4e` the gate
reported one `FAIL rust-tests (exit 101, 248810 ms)`, but the log shows it ran
only FIVE test binaries — `snapback` lib, `snapback` main,
`action_denial_witness_v0`, `action_stream_envelope_v0`, `action_watchdog_v0` —
and stopped on the watchdog failures. The `snapback-server` lib suite never
ran at all. So this test was never executed, and the hang could be
considerably older than the commits below.

That also means the battery's failure count understates the true state by an
unknown amount while presenting as a complete inventory.

Bisecting is therefore lower value than it first appeared, and partial results
already point earlier than expected: the test hangs at `56982daef`, i.e.
BEFORE step 8. Do not assume step 8 without finishing the bisect.

Commits in the window originally suspected:

- `56982daef` fix(server): make config.verify an exact powerless probe lane
- `8de11f06e` feat(kernel): move room authority into the kernel (LLP 0285 step 8)
- `8176b4348` fix(kernel): make registry retirement authoritative for issued authority

## Next step

The harness defects are being fixed separately (`--no-fail-fast` plus a
per-gate wall-clock timeout with descendant kill), because fixing fail-fast
alone would make the battery hang here forever instead of finishing. Once the
full suite actually runs, bisect this test with a hard timeout.

Diagnosis so far: the test parks in the tokio driver waiting on IO/timer that
never fires. Switching it to a multi-thread runtime does NOT help, so this is
not current-thread starvation but a genuine never-completing await — a
lock-ordering deadlock is the leading hypothesis. The request path is
`require_effect_approval_if_configured` → `with_snapback` →
`create_pending_effect`. Note the product implication: if a mutation requiring
approval blocks instead of returning its 202 pending shape, that is a hung
request, not merely a hung test.

## Related

- `issues/20260820-f3-bucket-b-pre-existing-reds.md`
