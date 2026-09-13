# Snapback 4: Align the distributed binary with the profile used for shipped-size claims

Status: Open
Priority: P2
Observed: 2026-09-12
Review finding: R36
Evidence: Code traced
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.002](../llp/3000.002-end-to-end-resource-bounds.research.md), [comprehensive review](../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

`Cargo.toml` describes the `production` profile as "the shipped bytes" and
`measure.mjs` records `target/production/snapback4` after building that profile.
`publish.mjs` instead builds `--release` and copies `target/release/snapback4`
into the platform package. The published artifact does not receive the
production profile's fat LTO, size optimization, stripping and codegen-unit
settings, and the loop measurement is not measuring that distributed binary.

Use the intended shipping profile consistently or explicitly distinguish the
two artifacts and their claims. Record size from the actual packed platform
binary and verify its source version/profile identity in the existing
installed-consumer step. Preserve the incremental release profile for the
ordinary edit loop if desired. Acceptance: unpack a dry-run platform tarball
and show it is the binary/profile whose shipped-size figure is reported.
No npm publication or expensive production build was run during this review;
the mismatch is directly present in the build/copy commands.

## Implementation locations

- [Cargo.toml](../snapback4/Cargo.toml)
- [scripts/publish.mjs](../snapback4/scripts/publish.mjs)
- [scripts/measure.mjs](../snapback4/scripts/measure.mjs)
