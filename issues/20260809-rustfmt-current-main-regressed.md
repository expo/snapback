# Rust formatting is red again on current main

**Status:** Open
**Opened:** 2026-08-09
**Systems:** Rust, Local proof, Developer experience
**Related:** `issues/closed/20260808-rustfmt-red-and-ungated.md`, LLP 0175

## Summary

`node scripts/check-rustfmt.mjs` starts successfully at clean `origin/main`
revision `a8e1d75df0b17c35a4281a606a03290f2d855fe4` but reports formatting diffs
across the committed Rust tree. This is a recurrence after the original
formatting debt and missing-gate issue was closed.

The LLP 0175 fast-core correction deliberately does not hide this result:
`.rs` changes still select `rustfmt` additively and will fail until the tree is
formatted. Docs-only changes no longer select the gate because formatting has
no ownership relationship to those paths.

## Resolution criteria

- Apply one reviewed, mechanical `cargo fmt --all` change without semantic
  edits.
- `node scripts/check-rustfmt.mjs` passes on a clean checkout.
- Keep the additive `.rs` selector fixture green so formatting cannot silently
  drift again.
