# 0.4.38 attempt 1 at cadb7c55be: deterministic red (not published)

Commit: cadb7c55be13054036cc724786f0b9a9fe3b9bdc (origin/main tip at 20:14Z; carries 0.4.38; contains 951ecdd4df).

## Linux suite (qualify-linux, attempt 1): `== 2 failure(s) in 3360 s`
- cargo test FAIL (1,154 s): 6 targets / 19 tests.
  - snapback4-device::readauth (8), snapback4-lang::live_parent (6), snapback4-sim::maintains_recorded (2),
    snapback4::timeline_adoption (2): `Schema("source reservations differ from the schema derivation")`.
  - snapback4::init (2: w7a/w8b residency): `snapback4 test --residency` exits 1 with
    `cannot open a store: E_SCHEMA: source reservations differ from the schema derivation`.
  - snapback4-lang::declarative_receipts (1: prediction round1 authentic predecessor):
    `Schema("add: execution facts changed without a program change")`.
- client tests FAIL (1,639 s): 428/428 files, 7,889 tests, 1 fail: residency.test.mjs test 6
  ("check sidecar, why and test residency ...") with the same E_SCHEMA message.
- client models ok (372 s).

## Root cause
Both messages come from snapback4-core/src/engine/activation_facts.rs (`prepare` and `check_operations`), added by
202826334f "Fix maintained-column release evolution invariants" and merged by c3f23ff2c2 after 951ecdd4df. `prepare`
refuses any schema whose non-empty `source_reservations` differ from a fresh derivation; schemas built by these
tests (and by the CLI's residency path) now trip it.

## Determinism
- snapback4-sim maintains_recorded alone: 2/2 fail on Linux, 1/1 fail on the Mac (same message).
- Same root cause in all 20 failing tests across Rust and client tests. Not a timing flake; not environment.

## State
- Linux qualify killed by kill-linux.sh (musl build stage); no receipt. Linux worktree ~/sb4-pub-0438 clean at cadb7c55be.
- Mac native-1, prepare-1, lean-1, warm-1 done at cadb7c55be; dry run NOT started. Mac worktree clean at cadb7c55be.
- Logs: linux-qualification-0.4.38/suite.log, iso-a1/.
