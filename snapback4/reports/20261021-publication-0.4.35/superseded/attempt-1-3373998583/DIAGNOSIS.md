# 0.4.35 attempt 1 at 3373998583 — stopped on a deterministic Linux red (not published)

Commit: 3373998583ca72812414c86e41d7e845bea47a31 (first origin/main commit at or after 3373998583 carrying 0.4.35).

## What passed (Mac, black M5, Xcode 27.1 27A9275)
- native-1: xcframework 280.2 s, cargo build 58.4 s, wasm 99.6 s, Release chat-expo 94.9 s, witness offline 10.1 s / restart 17.1 s.
- prepare-1 (58.6 s): client sha512-DJrTqOSgujAX9bHCvcxNBeKY7rn4iJpvpOZTQ9uHi5ugVZa1Gen3LQNMZZj2M554ksRxso2Tt6V6B5+8kpMcZg== (1,316,094 B);
  expo sha512-YO6kPEsRY0q8nFKUYLwO/U2ihSRkF1TOuKybW4LezSvQYAoPF6sVeQkgme99g03f1ZfkdoO9tyPPKnCh6GcKSQ== (6,815,010 B); prepared Expo == native-qualified (24/24).
- lean-1 12.5 s; warm-1 1,886.6 s (Mac load average 250-800 from other agents' exact2 rustc/swift builds on 18 cores).

## The red (Linux qualify-linux, suite)
`-- FAIL: cargo test (796 s)` on one test:
snapback4-lang::guide every_emitted_code_is_explained (crates/snapback4-lang/tests/guide.rs:961):
"codes `why` cannot explain (add them to guide::CODES): E_REFUSED: crates/snapback4-core/src/engine/actions/requests.rs".
126/127 in that binary passed; every other Rust target green.

Diagnosis: deterministic source scan. At 3373998583, requests.rs:585 holds the literal `code: "E_REFUSED"` inside
`#[cfg(test)] pub(crate) mod test_cases` (line 115) — test-only code. Isolated rerun with a fresh CARGO_TARGET_DIR: FAILED 3/3
(isolated-guide.log). Fixed on main by the next commit 078b33ec45 (E_REFUSED -> E_ACTION_FAILED).

Also pending at that time: issues/20261021-snapback4-hot-release-named-worker-status-race.md (release-activation.test.mjs,
load-sensitive; failed two consecutive full runs on expo-build-450b). Fixed by the coordinator in 2e10681b32.

## Disposition
The Linux suite was left running for evidence, then stopped by script (kill-linux-a1.sh) per coordinator ruling at ~06:10Z; no receipt.
The Mac dry run was never started. Coordinator ruling: requalify 0.4.35 at 2e10681b32 (contains 078b33ec45 and the race fix).
