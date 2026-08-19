# Vector decimal halfway witness parses to the wrong pinned bits

**Status:** Open
**Date:** 2026-08-19
**Systems:** Vector distance profile, Rust decimal conversion
**Source:** unrelated red observed during LLP 0276 security-hardening verification

## Problem

`cargo test -p snapback-kernel --lib` fails
`vector::profile::tests::decimal_conversion_witnesses_parse_to_the_pinned_bits`
for `arbitrary-length-halfway-ties-to-even`: the parser returns
`3ff0000000000001`, while the independently pinned expected result is
`3ff0000000000000`.

The hardening change does not modify
`crates/snapback-kernel/src/vector/profile.rs`, `Cargo.lock`, or the workspace
dependency declarations. The same owner-level run passed 789 tests, ignored
the explicit scale qualification, and failed only this witness.

## Acceptance

- Determine whether the parser or the committed halfway witness is wrong.
- Preserve the independently pinned cross-language profile contract.
- Make the exact test pass without weakening or deleting the witness.
