# Invoking the linux-x64 `snapback2` binary without the compiler worker is `E_OWNER_NO_COMPILER`

**Status:** Closed
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback 2 published linux-x64 package, owner spawn, Clique scale / digest restart
**Related:** LLP 1002 (`E_OWNER_NO_COMPILER`); `snapback2/crates/snapback2/src/project.rs`

## Symptom

The 0.0.24 Clique builder restarted a scale/digest owner by calling the packaged native binary:

`node_modules/snapback2-linux-x64/bin/snapback2 dev …`

That spawn missed the compiler worker (`E_OWNER_NO_COMPILER`). The public `npx snapback2` / `.bin/snapback2` wrapper sets `SNAPBACK2_COMPILER` and worked. Restart scripts and “use the binary on PATH” are how agents recover an owner; this is a sharp edge on Linux.

The 0.0.25 lane hit a cousin: “wrong shim `dist/cli.js` nonexistent; use installed bin command.”

## Evidence

- 0.0.24 run-log epoch `1789169403`: “raw binary dev misses compiler worker E_OWNER_NO_COMPILER, use public npx wrapper.”
- Package layout: `snapback2-linux-x64/bin/snapback2` vs `snapback2/dist/compiler.mjs`.
- Existing tests: `snapback2/crates/snapback2/tests/owner_cases/mod.rs` already asserts the code when the worker is absent.

## Requested outcome and acceptance

Pick one and ship it:

1. The native binary finds the compiler worker next to the JS package the way `npx snapback2` does, **or**
2. The binary’s first refusal names the exact wrapper command (`npx snapback2 dev` / `SNAPBACK2_COMPILER=…`) and the linux-x64 README says not to exec the raw bin for `dev`/`check`.

Acceptance: `node_modules/snapback2-linux-x64/bin/snapback2 check` in a production-consumer install either works or prints a one-line rewrite an agent can paste. Clique-style restart of `dev --foreground` must not require discovering the worker path from a run-log.

## Resolution

Implemented outcome 2 on 2026-09-11. Missing compiler-worker and missing
trusted-Node refusals rewrite the complete invocation through `npx snapback2`,
with POSIX shell quoting for every argument. The compiler refusal names
`SNAPBACK2_COMPILER`; the Node refusal independently names the trusted
`SNAPBACK2_NODE` path. Platform packages ship a README that routes `check`
and `dev` through the public wrapper.

Production evidence for repair checkpoint `4a9ddd57ef52a3a6b0196689d1cc33e92249fa52`:

- A fresh engine-bearing Linux binary was built at 47,886,776 bytes with
  SHA-256 `ded4832c63101e86ada3afe959a0361a32c0fe64e7c8d64f3c79f6592edd4385`.
- Fresh `snapback2-linux-x64@0.0.26` and `snapback2@0.0.26` tarballs were
  packed in `snapback2/dist/npm/verify-raw-binary-4a9ddd57e/`; their SHA-512
  integrities are `NPzK7/oHSLUP2ZdGpWyOFeIbNLTvdMMpBcedStRLBqADtkKpN2WGxaArfl6447Vkxg83/1wQZUKNlLyGyYKSIA==`
  and `xuS7ANIpcwCAPFz5buUug40xcKH7qNzk+lUO46tLHjkyAE4pcOhO7iy7RdrCFz5WQ3Q2+SdlAlnnTEQhpUh5gg==`.
- The installed production consumer passed the platform README check; raw
  `check` and `dev --foreground` exact rewrites with the compiler missing;
  then the distinct message and `SNAPBACK2_NODE` rewrite with a valid compiler
  but no trusted Node. Those commands carried an external `--project` path
  containing a space and apostrophe plus `--json`; the public wrapper used the
  same external project successfully for `check`, `dev`, React live traffic,
  and both template tests. Both engine-backed receipts were `pass`.
- The two focused Rust toolchain tests and the repaired debug packed consumer
  passed before production qualification.

Final review repair checkpoint `951178082dbcbe32d7a92a73a426cc9e5fce57a1`
closes the detached-owner gap in that evidence. Detach now passes the exact
parent argv to its foreground child for recovery rendering only; synthetic
child flags cannot replace user-selected foreground, JSON, project, port,
migration, or serve arguments. Internal test-owner recovery still removes only
its private child flags, and compiler-worker versus trusted-Node refusals retain
their distinct environment fallbacks.

Production evidence for that checkpoint:

- A fresh engine-bearing Linux binary was built at 47,891,736 bytes with
  SHA-256 `da4beea2dad15e31c63cd773119e5c31b1138ec6d86261f6c68e85235644ceb3`.
- Fresh `snapback2-linux-x64@0.0.26` and `snapback2@0.0.26` tarballs were
  staged without publication in
  `snapback2/dist/npm/verify-raw-binary-951178082/`; their SHA-512 integrities
  are `ika/vkfVBfFN/k+x+a7Gsz0bUAy6YT5ohdx25YwPKKyOXKXO5mQvX27/IAi2ZgO68FErLhGgOU81BYdfYnj9pA==`
  and `xuS7ANIpcwCAPFz5buUug40xcKH7qNzk+lUO46tLHjkyAE4pcOhO7iy7RdrCFz5WQ3Q2+SdlAlnnTEQhpUh5gg==`.
- The production consumer passed all prior checks plus default detached raw
  `dev --project <quoted external path> --port 0` rewrites for both missing
  compiler and missing Node. It then executed the same invocation through the
  installed public wrapper, started detached, stopped via that exact project,
  and verified its recorded owner and compiler-worker PIDs exited. Both
  engine-backed template receipts were `pass`.
- Focused Rust toolchain tests passed 4/4, publication tests passed 16/16, and
  the debug packed installed consumer passed the same causal detached case.
  The prior `verify-raw-binary-4a9ddd57e` stage remains intact.
