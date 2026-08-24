# Running the Snapback test suites on Linux build hosts

**Status:** Open
**Systems:** Testing, Build, Tooling
**Date:** 2026-08-24
**Related:** LLP 0010 (bootstrap diagnostic codes), LLP 0189,
  `scripts/bootstrap-ibex-runtime`, `scripts/ibex-doctor`

## Why

Work on this repository has been scheduled as if macOS were required, because
`snapback-server` was believed to need the macOS-only Hermes framework. That is not
accurate, and the belief has been costing real parallelism: Mac capacity was treated as
the hard ceiling on how many lanes could run at once.

Only `crates/snapback-runtime` declares `ibex-runtime` (`crates/snapback-runtime/Cargo.toml`).
Every other crate builds on Linux, and with a Linux Hermes present they also *run*.

## Verified on an x86_64 Ubuntu 24.04 host, 2026-08-24, at `1cb5a2307`

| Crate | Result |
|---|---|
| `snapback-auth` | 150 passed, 0 failed |
| `snapback-sync` | 254 passed, 0 failed |
| `snapback-kernel` | 840 passed, **1 failed** |
| `snapback-engine` | 509 passed, **22 failed** |
| `snapback-server` | compiles (3m14s); run not yet characterised |

All with `--features test-support`.

### Known Linux baseline failures — do not chase these

- `snapback-kernel`:
  `storage::tests::membership_write_tests::generated_authority_profile_manifests_validate_after_generation_rotation`
- `snapback-engine`: 22 failures, all in `local::engine::admission_fence_tests`, every one of
  the form `*_refuses_retired_epoch_*` / `*_refuses_retired_mode_epoch_*`. They are a single
  coherent group, which is why they read as environmental rather than as 22 independent bugs.
  Whether they are genuinely Linux-specific or a real defect that macOS masks is **not
  established here** and deserves its own investigation.

A lane must measure its own before/after on the same host. A count that differs from the
table above is not automatically the lane's fault, and is not automatically fine either.

## Setting a host up

1. **Generated demo artifacts are gitignored but compile-time required.** `snapback-kernel`
   does `include_str!` on `demos/*/snapback/generated/schema.manifest.json`. A fresh clone
   fails with `couldn't read ... schema.manifest.json`. Copy `demos/*/snapback/generated/`
   from a working checkout.

2. **Hermes must come from the pinned `vendor/ibex` gitlink.** Run
   `git submodule update --init --recursive vendor/ibex` *first*, then
   `scripts/bootstrap-ibex-runtime`, which builds and then writes the provenance stamp.

   Building Hermes without syncing the submodule first produces artifacts the bootstrap
   correctly refuses with `SNAPBACK_IBEX_HERMES_ARTIFACTS_UNUSABLE`. That refusal is right:
   this happened here, and the checkout was at `f8c893b0b` while the pin was `4c34c831a`.
   **Do not hand-write the stamp file to get past it** — that forges provenance onto a Hermes
   whose runtime contract may not match the linked glue, which is the exact wedge the check
   exists to catch. `scripts/ibex-doctor` names the expected and observed gitlink.

3. **Export the library path**: `LD_LIBRARY_PATH=<repo>/vendor/ibex/linux/lib`. Without it
   the test binary builds and then dies at load with
   `error while loading shared libraries: libhermesvm.so`.
   `scripts/verify-local-proof` sets this itself; ad-hoc `cargo test` does not.

## Worktrees need `vendor/ibex` linked

`git worktree add` does not populate submodules, so a lane worktree gets an **empty**
`vendor/ibex` and every engine/server test fails to build. The failure is quiet — it looks
like a build error, not a missing-submodule error.

Symlinking to the main checkout's already-built copy is enough and avoids rebuilding Hermes
per lane:

```sh
rmdir <worktree>/vendor/ibex && ln -sfn <main-checkout>/vendor/ibex <worktree>/vendor/ibex
```

## Hazard: lanes editing the shared checkout instead of their worktree

Observed here. Row-level plan documents cite **absolute** paths
(`/Users/ccheever/projects/snapback/crates/...`). A lane running in `~/lanes/<name>` can
follow those paths and edit the *main checkout* instead of its own worktree.

One lane's edits appeared byte-identical in both places — the worktree held the complete
change (6 files) and the main checkout held a 3-file subset, so a suite run in the main
checkout saw new tests without the production change and reported failures that belonged to
nobody.

Mitigations: give lanes repo-relative paths, tell them explicitly to stay inside their
worktree, and before committing from a shared checkout, `git status` it and stage only the
paths that landing actually owns.
