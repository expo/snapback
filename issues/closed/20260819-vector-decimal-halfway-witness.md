# Vector decimal halfway witness parses to the wrong pinned bits

**Status:** Resolved
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

## Resolution

The parser was wrong; the committed witness remains unchanged. The exact input

```text
1.00000000000000011102230246251565404236316680908203125
```

is `1 + 2^-53`. Binary64 values in `[1, 2)` are spaced `2^-52` apart, so the
input is exactly halfway between `3ff0000000000000` (`1.0`) and
`3ff0000000000001` (`1 + 2^-52`). Round-to-nearest, ties-to-even selects the
lower endpoint because its significand has an even low bit. The independent
BigInt rational oracle in `scripts/vector-distance-reference.mjs` and the
cross-language profile contract are therefore correct to require
`3ff0000000000000`.

The kernel had not enabled serde_json's `float_roundtrip` feature. On an
arbitrary-length decimal whose significand overflows the parser's `u64`
accumulator, serde_json's default path discards the remaining digits before
constructing the float; for this exact tie that path returned the upper
neighbor. `crates/snapback-kernel/Cargo.toml` now enables `float_roundtrip`,
which retains the long decimal for correctly rounded conversion. No witness,
profile payload, profile digest, dependency version, or lockfile changed.

Pre-fix assertion:

```text
arbitrary-length-halfway-ties-to-even
left:  "3ff0000000000001"
right: "3ff0000000000000"
```

Post-fix verification (the sandbox required offline cached dependencies and
base-generated demo manifests):

```text
cargo test -p snapback-kernel --lib vector::profile
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 786 filtered out

cargo test -p snapback-kernel --lib
test result: ok. 790 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out
```

The required native bootstrap reached artifact validation but could not finish
the unrelated full Snapback build in this network-restricted worktree, ending
with `SNAPBACK_IBEX_CARGO_BUILD_FAILED`. The kernel-only affected tests above
compiled and passed.
