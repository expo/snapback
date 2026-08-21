# `POST /capability-links` deadlocks permanently (found via a hanging test)

**Status:** Resolved
**Filed:** 2026-08-21
**Severity:** Production endpoint wedges forever, holding the write mutex; also blocks `cargo test -p snapback-server --lib` from ever completing

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


## Root cause — 2026-08-21, corrected again

The name of this ticket was wrong, and so was my earlier guess that an
approval-required mutation hangs the request. Independent read-only analysis
located the defect exactly, and it is NOT in the approval path.

The test's approval assertions all pass. It then mints a credential and issues
`POST /capability-links` (`tests.rs:4600`); THAT is what wedges.

`AdmissionInner.state` is a non-reentrant `std::sync::Mutex<AdmissionState>`
(`crates/snapback-auth/src/auth/admission.rs:150,155`). It is acquired twice,
nested, on this path:

1. OUTER, retained: `capability_link_mint` calls `effect_authority.effect_guard`
   (`server.rs:25586`) → `AdmissionLease::effect_guard` (`admission.rs:918,927`),
   which locks the mutex and stores the `MutexGuard` inside the returned
   `AdmissionEffectGuard`, holding it for the guard's lifetime.
2. NESTED: the same `PreparedAuthority` is passed to
   `snapback.mint_capability_link` (`server.rs:25626`), whose first act is
   `authority.validate_admission` (`engine.rs:5083,5088`) →
   `AdmissionLease::validate` (`admission.rs:907,911`) — the same mutex.

The nested lock waits for the outer guard to drop; the outer guard cannot drop
until the engine method returns; the engine method cannot return until the
nested lock succeeds. The blocking thread never reaches the engine's own effect
guard (`engine.rs:5113`) or the mutation (`:5114`). Since `with_snapback`
already holds the `SharedSnapback` tokio mutex inside `spawn_blocking`, the
tokio task parks awaiting a JoinHandle that never completes — the sampled park.

**This is a real production defect.** Production registers `POST /capability-links`
to the same `capability_link_mint` handler (`server.rs:9072,9083`) on the same
router the test builds; the fixture changes transport only, not state or routing.

**Capability-link revoke has the identical duplicate-guard defect** and no test
covers it: outer guard `server.rs:25833`, engine revalidation and second guard
`engine.rs:5140,5146,5167`.

`ApiFunctionApproval::Required` is not load-bearing. A one-use link, or any
request with `"approval": true`, reaches the same nested call and deadlocks
even with no function-level approval.

**Introducing commit:** `ed06d2b4b0` ("refactor: carve transport-independent
engine crate"), which turned the raw database call into
`LocalSnapback::mint_capability_link` and added engine-side validation plus a
second effect guard. The transport already held the outer guard beforehand
(blames to `fc75acf242`). NOT `c5633d707`, which only carved the test into
`snapback-server`, and NOT step 8 — the test passes at `c5633d707` and hangs at
both `56982daef` and `8de11f06e`.

## Fix

Remove the transport-level outer `effect_guard` in `capability_link_mint` and
in revoke, leaving the engine method sole owner of validation and of the effect
guard across the durable commit. Exactly one `AdmissionEffectGuard` must remain
across each durable commit — it is the atomic epoch-retirement fence
(`admission.rs:915`). Do not make the mutex reentrant, do not drop both guards,
and do not delete or time out the test as the behavioral fix.

In progress on `lane/capfix`, including a revoke regression.


## Resolution — 2026-08-21

Fixed by `46d85496b`. The transport-level `effect_guard` calls in
`capability_link_mint` and revoke are gone; the engine method is sole owner of
validation and of the guard across the durable commit.

Verified unsandboxed rather than taken on report: the formerly hanging test
passes in 0.20 s, and the `snapback-server` lib suite COMPLETES for the first
time. Against a clean-main baseline the failure set is identical — 6 failures,
same names, before and after — so this regresses nothing. Those six are
tracked in `issues/20260821-server-suite-six-pre-existing-failures.md`.

Both reviewers independently verified the fence survives: mint and revoke each
validate, drop, re-validate and RETAIN, then commit under the live guard, with
no unfenced window. The removed transport guards were exact duplicates — same
authority clone, same epoch, same mutex, same diagnostic — enforcing nothing
extra.

Two follow-ups came out of the reviews, both filed separately:

- A third instance of the same defect class in `ctx.push.send`
  (`server.rs:1984` → `engine.rs:6618`), which wedges the detached action
  worker while it holds the global `SharedSnapback` guard. NOTE: its ownership
  is INVERSE — the host guard is the fence and `reserve_push_send` has none —
  so deleting the outer guard there would UNFENCE the reservation. It needs the
  opposite fix: keep the host guard, stop the inner revalidation.
- `consume_capability_link_use` and `settle_capability_link_use` hold no
  admission guard at all:
  `issues/20260821-capability-link-consume-settle-unfenced.md`.
