# Ownership-composition enforcement left ~207 lib tests red repo-wide

**Filed:** 2026-08-16 · **Status:** Open · **Systems:** Auth, Storage,
Testing

**Related:** the LLP 0264 Phase 1a owner-write landing (`4fe648fd0`, per the
burn-down coordinator's attribution — wave owner gets first refusal on this
burn-down); issues/20260815-finish-media-happy-path.md (whose 11 media tests
were the first adapted slice, landed `d4fbc1604`).

## Verified counts (media-happy worktree, RUST_MIN_STACK=16777216)

- `cecff14e4` (main tip pre-media-push, post-enforcement): media filter
  already 30 passed / 10 FAILED — the enforcement landing broke tests on
  main before any media-program push.
- `9971c640c` (main tip pre-adaptation): full lib **2588 passed / 218
  failed**.
- With the media adaptation (`d4fbc1604`): full lib **2599 passed / 207
  failed** — exactly the 11 media tests healed; the remaining 207 are
  enforcement-wave fixture debt in unrelated suites.

## Failure classes observed

1. `SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE` — owner-policy Patch/Delete
   fixtures lacking sealed `owner_write_checks`.
2. `SNAPBACK_TABLE_WRITE_OWNER_IMMUTABLE` — fixtures that patch an owner
   field as a scenario vehicle (now forbidden by design).
3. `SNAPBACK_TABLE_WRITE_UNDECLARED_REFUSED` — fixtures writing tables with
   implicit/undeclared visibility. Representative deterministic repro:
   `cargo test --lib storage::tests::stored_enum_tests::optional_enum_field_addition_admits_on_a_nonempty_table`
   (refuses its pre-existing undeclared `items` fixture when run alone).

## Adaptation pattern that worked (from the landed media slice)

Sealed checks: `owner_write_checks: vec![OwnerWriteCheckV1 { step_index,
absent }]` on the fixture `MutationPlan` (in-file precedent
`src/storage/tests.rs` `checked_patch`). Owner-transfer scenario vehicles:
re-express through grant replacement, content-based OCC staleness, or
sealed parent deletion — adaptation may change fixtures and vehicles, never
an assertion's meaning (see `d4fbc1604` for six worked examples across
storage and served-HTTP tests).

## Wanted

The wave owner (or a commissioned burn-down lane) sweeps the remaining ~207
using the classes and pattern above, suite by suite, rather than letting
the drift backstop file per-signature tickets. Counts above are the
baseline for measuring the sweep.

## Scope note (2026-08-16, post-filing)

The wave is not test-fixture-only: AUTHORED demo handlers that insert
owner-policy rows with an explicit owner field now refuse at runtime with
`SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED` (owner fields are host-stamped).
`demos/media-happy-post` hit this live and was adapted (drop the authored
ownerId from inserts); other demos with the same authored pattern will hit
it on their next boot — relevant to any demo boot sweep.

## Scope note 2 (2026-08-16, per snapback-ca)

issues/20260815-codegen-pretest-media-ref-capability-unsupported's remaining
pretest reds are exact-base visibility diagnostics from the same
ownership/visibility waves (the capability itself is declared at base), so
that ticket's remainder folds into this sweep's scope.
