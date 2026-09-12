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
trusted-Node refusals both rewrite `check` to `npx snapback2 check` and
preserve `dev --foreground` as `npx snapback2 dev --foreground`; each also
names the explicit environment-variable alternative. Platform packages now
ship a README that routes `check` and `dev` through the public wrapper.

Production evidence for source checkpoint `44f8da6fec3651b72eef4f05e29b075f985dba68`:

- A fresh engine-bearing Linux binary was built at 47,885,880 bytes with
  SHA-256 `8eb50bf4f8c62ea2661feb00f4444f75b4127b743a9b2353df2efb76b1055c9a`.
- Fresh `snapback2-linux-x64@0.0.26` and `snapback2@0.0.26` tarballs were
  packed in `snapback2/dist/npm/verify-raw-binary-44f8da6fe/`; their SHA-512
  integrities are `0AWKEkEWpk1ae0baXyjPHtub9Cf8HhXQ5EbZier8LHRtgV2iCjpJxyLaMT9jd+7QGXtp1VRD44A/M/QVjovwaQ==`
  and `xuS7ANIpcwCAPFz5buUug40xcKH7qNzk+lUO46tLHjkyAE4pcOhO7iy7RdrCFz5WQ3Q2+SdlAlnnTEQhpUh5gg==`.
- The installed production consumer passed the platform README check; raw
  `check` and raw `dev --foreground` rewrites with the compiler missing;
  the same two rewrites with only trusted Node missing; public-wrapper
  `check`, `dev`, React live traffic, and both template test receipts.
  Both engine-backed receipts were `pass`.
