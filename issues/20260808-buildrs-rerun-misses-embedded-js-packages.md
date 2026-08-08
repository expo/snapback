# build.rs identity stamp does not rerun when embedded harness/admin-client JS changes (ENG-23365 class, reopened)

**Opened:** 2026-08-08 · **Severity:** P1 (integrity; a binary can embed uncommitted code while self-reporting a clean commit) · **Area:** build / runtime identity

## What

`build.rs` `emit_build_identity` (lines 258-266) emits `rerun-if-changed` for
`Cargo.toml`, `Cargo.lock`, `src`, `packages/snapback-codegen`,
`packages/snapback-contract`, `tests`, and two scripts — but **not**
`packages/snapback-harness` or `packages/snapback-admin-client`, both of which
are compiled into the binary via `include_str!`:

- `src/runtime.rs:3870/3934/3988/4013/4170` → `packages/snapback-harness/{allowlist-install.js, invocation-iife.js, allowlist.json, ctx-bootstrap.js}`
- `src/admin.rs:314` → `packages/snapback-admin-client/index.mjs`

`scripts/runtime-build-inputs.txt` names both as build.rs consumers ("keep in
sync"), so the omission is drift, not intent.

## Failure scenario

Clean tree → build stamps `SNAPBACK_BUILD_GIT_DIRTY=false`. Edit
`packages/snapback-harness/allowlist-install.js` (uncommitted) → `cargo build`:
rustc's dep-info **does** recompile the crate with the new handler-harness bytes
(include_str! is a compile dependency), but the build *script* does not rerun,
so cargo replays the cached `rustc-env` — the old clean commit + `dirty=false`.
The resulting binary contains uncommitted allowlist/handler/admin-console code
while `/health` and the readiness-receipt `buildIdentity` self-report a clean
commit. This is exactly the ENG-23365 hazard the comment at build.rs:252-257
says these lines exist to prevent. The canonical proof path is safe (it does
`cargo clean -p snapback` and passes the stamp explicitly); ad-hoc `cargo build`
+ trusting `/health`/receipt identity is not.

## Fix

Add `cargo:rerun-if-changed=packages/snapback-harness` and
`packages/snapback-admin-client` (and `brand` if/when embedded). Better: derive
the rerun list from `scripts/runtime-build-inputs.txt`, which build.rs already
reads for the dirty probe, so the three hand-maintained copies of "what are the
binary's inputs" collapse to one.

## Confidence

High — verified the rerun set and the include_str! sites directly. Clearly
unintentional.
