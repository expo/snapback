# Step-up claimant authentication needs a schema/ceremony that does not exist

**Status:** open (decision-grade; no code changed)
**Date:** 2026-08-26
**Systems:** snapback-kernel auth catalog, keyring, step-up provider binding
**Related:** LLP 0303 revision (u) as generalized, LLP 0057, LLP 0285,
`issues/20260826-landing-a-cannot-establish-file-wide-authority.md`

## What happened

Six rounds hardened the step-up chain. Round 5 rooted the **keyring material** at catalog
creation (v5) — correctly, and confirmed working for what it authenticates. An executing
review then reproduced a bypass against a **correctly created v5 catalog**, from an external
dependent crate:

```text
ATTACKER_FIRST_INSTALL=accepted LEGITIMATE_PROVIDER=SNAPBACK_AUTH_STEP_UP_PROVIDER_INVALID
```

Both an authorization bypass and a denial inversion: the unauthorized caller is accepted and
the rightful provider is locked out.

Round 6 was asked to authenticate the **claimant** rather than only the material, and to
delete first-writer-wins. It stopped and reported that this cannot be done honestly with the
mechanisms available.

## Why there is no claimant root today

- `PreparedAuthCatalogActivation` contains only the keyring-material commitment, **not provider
  identity** (`keyring.rs:176`).
- Every database constructor initializes `auth_step_up_provider: None`.
- Ready-v5 startup checks only `load_existing()` plus `catalog_origin_matches()`
  (`lifecycle.rs:48`).
- Installation still performs `None => Some(binding)` (`storage.rs:3933`) — first-writer-wins.

And the two obvious places to put a claimant root both fail:

- **A persisted process identity would not survive restart.**
- **A credential stored in the publicly readable keyring sidecar would remain available to the
  second wrapper** — which is exactly the attacker's position.

So the material can be rooted; the *claimant* cannot, without a new claimant-binding schema or
ceremony. Adding another comparison would only compare values the caller can produce, which is
the defect LLP 0303 revision (u) names.

## Relationship to the Landing A custody finding

This is the second independent lane to reach the same shape of conclusion. Landing A found
that a per-connection SQLite authorizer cannot establish file-wide authority; this lane finds
that catalog-rooted key material cannot establish claimant authority. In both cases the
property is not reachable with the mechanisms in scope, and in both cases the honest move was
to say so rather than add a layer that compares caller-producible values.

Both point at the same missing capability: **an identity that survives restart and is not
readable by an unprivileged same-machine caller.** Whatever answers the Landing C boundary
question is likely to answer this one too, and the two should be decided together rather than
separately.

## Reproduction

```text
cargo test --locked -p snapback-kernel review_same_sidecar_first_installer_can_approve -- --nocapture
same-sidecar first installer approved authority-creating effect
```

---

Stopped as requested: authenticating the claimant requires a new claimant-binding schema/ceremony that does not exist. Adding another comparison would only compare caller-producible values.

Evidence:

- `PreparedAuthCatalogActivation` contains only the keyring-material commitment, not provider identity: [keyring.rs](/Users/ccheever/lanes/f1forge/crates/snapback-kernel/src/auth/keyring.rs:176).
- Every database constructor initializes `auth_step_up_provider: None`.
- Ready-v5 startup checks only `load_existing()` plus `catalog_origin_matches()`: [lifecycle.rs](/Users/ccheever/lanes/f1forge/crates/snapback-auth/src/auth/lifecycle.rs:48).
- Installation still performs `None => Some(binding)`: [storage.rs](/Users/ccheever/lanes/f1forge/crates/snapback-kernel/src/storage.rs:3933).
- A persisted process identity would not survive restart; a credential stored in the publicly readable keyring sidecar would remain available to the second wrapper.

Baseline full-chain reproduction:

```text
$ CARGO_TARGET_DIR=/Users/ccheever/lanes/f1forge/target cargo test --locked -p snapback-kernel review_same_sidecar_first_installer_can_approve -- --nocapture

running 1 test
same-sidecar first installer approved authority-creating effect
test storage::pending_effects::tests::review_same_sidecar_first_installer_can_approve ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 897 filtered out
```

External dependent crate:

```text
$ CARGO_TARGET_DIR=/Users/ccheever/lanes/f1forge/target cargo run --offline --manifest-path .round6-root-proof/Cargo.toml

ATTACKER_FIRST_INSTALL=accepted LEGITIMATE_PROVIDER=SNAPBACK_AUTH_STEP_UP_PROVIDER_INVALID
```

The temporary unit test and dependent crate were removed. Final state:

```text
$ git status --short --branch
## f1forge
```

No guards, mutation pairs, or commits were created because there is no honest claimant root to implement against. The requested rebase was also blocked by the environment:

```text
$ git fetch origin main && git rebase origin/main
error: cannot open '.git/FETCH_HEAD': Operation not permitted
```

The repository’s `llp-orient` skill was unavailable because its submodule is uninitialized and `.git/config` is read-only; I manually followed the relevant LLP 0057/0285/0303 references instead. No push was attempted.