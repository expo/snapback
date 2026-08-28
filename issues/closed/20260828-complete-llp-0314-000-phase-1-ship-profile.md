# Complete LLP 0314.000 Phase 1 — ship path does not use the ship profile

**Status:** Resolved
**Systems:** Packaging, Build, Runtime, Distribution
**Date:** 2026-08-28
**Related:** LLP 0314, LLP 0314.000, LLP 0041, LLP 0123, LLP 0276

## Finding

The workspace defines `[profile.production]`, but the runtime-package producers
and their consumers still select ordinary `--release` output. The resulting
published binary therefore misses fat LTO and compile-time symbol stripping,
and qualification or receipt steps can silently bind a different target path
from the bytes ultimately shipped.

## Acceptance

- Every public-package producer builds with `--profile production`.
- Every public-package preparer, receipt, qualification, and measurement
  consumer selects `target/production/snapback`.
- The linked source-checkout custody lane remains explicitly separate.
- Release and production builds are measured in bytes, and the stripped
  production binary passes runtime qualification.

## Resolution

Every public-package producer now builds with Cargo's `production` profile,
and the Darwin/Linux preparers, packaged-store qualifier, Linux qualification
receipt, EAS staging jobs, and path-migration pins all consume
`target/production/snapback`. Linux CI retains a separately named ordinary
release build and sibling receipt only for linked source-checkout custody.

On Darwin arm64, `cargo build --release --bin snapback` produced 157,195,920
bytes and `cargo build --profile production --bin snapback` produced
102,657,760 bytes: 54,538,160 bytes smaller (34.69%). The production binary
passed the restricted no-eval handler-VM `runtime-qualify` probe with dynamic
loader overrides scrubbed.
