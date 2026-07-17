# Align codegen membership validation with activation

**Status:** Closed
**Severity:** P2
**Systems:** RBAC, Codegen, Manifest activation
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0056 §Declaring a membership table and §Writes
**Marker:** product-integrity, validation

Public codegen accepts membership declarations that Rust activation later
rejects, including reserved provenance fields, unreachable caller/target
combinations, patching membership axis fields, and user indexes colliding with
generated `_membership_pk`/`_membership_reverse` indexes. Authors receive a
successful artifact followed by a deployment refusal.

**Done when:**

- Codegen and activation enforce the same closed declaration invariants.
- Reserved fields, unreachable transitions, axis-field patches, and generated
  index collisions fail at authoring time with stable diagnostics.
- Parity fixtures exercise every duplicated invariant so the two validators
  cannot silently drift.

## Resolution

Closed 2026-07-16. Commits `dfd829e` and `d4fcfaf` made
`packages/snapback-codegen/define.mjs` enforce the activation invariants and added
shared parity coverage in `rbac-authoring.test.mjs`,
`tests/fixtures/membership-validation-parity-v0.json`, and `src/storage.rs`.
