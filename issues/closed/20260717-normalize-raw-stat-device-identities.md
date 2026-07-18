# Normalize raw stat device identities across Apple and Linux

**Status:** Closed
**Severity:** P1
**Systems:** Local runtime, Auth backup/restore, POSIX filesystem, CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Closed:** 2026-07-17
**Related:** LLP 0057 §Consistent backup, LLP 0057 §Restore
**Marker:** portability, rust, clippy, filesystem-identity

Rust 1.93 Clippy rejects the four direct `libc::stat.st_dev as u64`
normalizations on Linux because Linux already exposes `dev_t` as `u64`.
Removing the casts outright would lose the Apple-side normalization required by
the same descriptor-pinned device/inode comparisons. The resulting Linux
`-D warnings` failure blocks the repository's local proof even though the
runtime identity checks are semantically unchanged.

**Done when:**

- One documented normalization point owns the platform-specific `dev_t` to
  `u64` representation difference.
- Backup publication and target-instance reservation comparisons use that
  normalization without weakening their device/inode checks.
- A regression proves raw `fstat` identity matches Rust filesystem metadata
  identity on Apple and Linux.
- The all-target Rust check and Clippy proof pass with warnings denied.

## Resolution

Closed 2026-07-17. `instance_lock::stat_device_id` now centralizes the
platform-specific normalization: Linux returns its native `u64` directly,
while the other supported Unix targets explicitly convert their `dev_t`. All
four raw-stat call sites use the helper, and
`raw_stat_identity_matches_metadata_identity` compares the normalized raw
`fstat` result with `MetadataExt`-backed identity.

Verified with:

- `scripts/bootstrap-ibex-runtime`
- `cargo fmt --all -- --check`
- `cargo check --all-targets`
- `cargo test raw_stat_identity_matches_metadata_identity --lib`
- `cargo test instance_lock::tests --lib` (10 passed)
- `cargo test auth::backup::tests --lib` (25 passed)
- `cargo clippy --all-targets -- -D warnings`
- `git diff --check`
- `./ref-check --verbose` (63 LLP documents, 1,374 refs, zero errors)
