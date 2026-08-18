# `rust-tests` gate red: `tests/auth_invocation_v1.rs` has not compiled since 2026-08-16

**Status:** Open
**Filed:** 2026-08-17
**Found by:** LLP 0276 Phase 1 verification (the pre-move base was measured to
attribute Phase 1's reds; this one is inherited, not introduced)
**Related:** LLP 0264, LLP 0214, LLP 0189

## The failure

```
error[E0063]: missing field `owner_write_checks`
  --> tests/auth_invocation_v1.rs:354:61
```

`cargo test --no-run` compiles 73 of 74 integration-test targets; this is the
one failure. The `rust-tests` gate in `scripts/verify-local-proof:433`
(`cargo test -- --test-threads …`) builds every test target, so that gate has
been red for as long as this has.

## Provenance

- `4fe648fd0` (2026-08-16 10:03, *feat(auth): LLP 0264 Phase 1a — owner-policy
  enforcement on generic writes with a staged migration window*) added
  `pub owner_write_checks: Vec<OwnerWriteCheckV1>` at `src/manifest.rs:11126`.
- `tests/auth_invocation_v1.rs` was last modified at `df1449a46`
  (2026-08-16 04:37) — **before** the field existed.

So `4fe648fd0` landed a struct field without updating this test's construction
site, and it has been red on `main` for roughly 36 hours. No open ticket covers
it (the two `issues/` hits for these symbols are closed and unrelated).

## The fix

Add the field at the construction site, matching how the four other in-tree
construction sites default it (`src/args_contract.rs:717`,
`src/manifest.rs:16871,19918,20249`):

```rust
owner_write_checks: Vec::new(),
```

Then confirm the test's assertions still express what LLP 0264 Phase 1a
intends — a mechanical default may not be the semantically right value for an
auth-invocation test, so check LLP 0264 before assuming `Vec::new()` is
correct rather than merely compiling.

## Why it stayed invisible

Nothing selects this file by name; it is covered only by the whole-inventory
`rust-tests` gate, which needs the native runtime bootstrap and therefore runs
in the complete battery rather than in ordinary affected-scope landings
(LLP 0189). That is the designed cadence, so this is a fix-forward ticket, not
an argument for changing the cadence — but 36 hours of an uncompilable test
target suggests the complete-battery red was not converted into a ticket when
it fired.
