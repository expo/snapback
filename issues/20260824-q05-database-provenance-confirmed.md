# Q05: the operation identity binds provider and operation, not database — confirmed by execution

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Systems:** Auth, Sync
**Date:** 2026-08-24
**Related:** LLP 0303 (provenance corollary; "Coverage, not just the primitive"),
  `issues/20260824-q03-unbound-finish-paths-executed-findings.md`,
  `issues/20260824-test-support-bypass-surface-inventory.md`

## How this was found

Predicted from source, then confirmed by execution — recording both halves because the
prediction is reusable and the confirmation is what makes it actionable.

Q05 round 2 (`e5ee104e4`) fixed a real defect: operation identity became a fresh
provider-minted private `Arc<()>` compared with `Arc::ptr_eq`, so the caller's `RandomSource`
no longer participates in uniqueness, and the four `Bound*Attempt::for_test` constructors were
deleted.

Reading the diff afterwards, two things stood out:

- there are only **two** `Arc::ptr_eq` sites in a provider with a dozen-plus `commit_*` entry
  points — one is the `PartialEq` impl, the other a single check in
  `AuthAdmission::for_planned_issuance` comparing `provider_identity`;
- there is **no `DatabaseBinding` anywhere in the diff**. The identity binds provider and
  operation. It does not bind the database — which is exactly what Q03 needed and was defeated
  twice for lacking.

Meanwhile `commit_guest_issuance_for_test` (`crates/snapback-auth/src/auth/provider.rs:3900`)
is public under `test-support` and takes a **caller-chosen `&mut LocalDatabase`**, with
siblings at `:2852`, `:2882`, `:3206`, `:3969`, `:3995`. Those are distinct from the removed
`Bound*Attempt::for_test` and survived that removal.

## Confirmed

A focused probe ran the composition. **All three disposable-database attempts were accepted by
the live coordinator**, creating phantom live projection state while the live durable catalog
was byte-identical before and after:

```
Q05 guest ACCEPTED disposable commit;
  live-before=sha256:3ec8aec53739ba10307163cef7290ff7964c0890eccd2d4c15ec0c4742afbe49
  live-after =sha256:3ec8aec53739ba10307163cef7290ff7964c0890eccd2d4c15ec0c4742afbe49

Q05 password-issuance ACCEPTED disposable commit;
  live-before=sha256:cd8f8b8cc90190bf87538da9d7f5870932eeb75fdf1e913b161395fa3d5de56a
  live-after =sha256:cd8f8b8cc90190bf87538da9d7f5870932eeb75fdf1e913b161395fa3d5de56a

Q05 password-change ACCEPTED disposable commit;
  live-before=sha256:9579a431b2c0eec40fec5d43adf4c273991eb18ec69c9f1b44cc74b00c2071b8
  live-after =sha256:9579a431b2c0eec40fec5d43adf4c273991eb18ec69c9f1b44cc74b00c2071b8
```

The password-change case shows the full populated set unchanged across `_auth_assurances`,
`_auth_credentials`, `_auth_identities`, `_auth_password_credentials`, `_auth_recovery_code_sets`,
`_auth_recovery_codes`, `_auth_security_events`, `_auth_sessions`, `_auth_users` and
`_snapback_meta` — identical column counts, row counts and digests.

An independent adversarial review of the same commit reached the same place by a different
route, and separately found that `AddressAdmission` mints one identity which `plan_mint_session`
clones, so two mint plans are one operation and `into_issue` released one operation's plaintext
against another operation's durable session — reachable through the production API with no
`test-support` at all.

## What this is evidence for

Round 3 is in flight and was briefed to answer this with **DERIVE** rather than another
comparison. This ticket exists so the executed evidence outlives the review output, and because
the prediction generalises:

> A lane that introduces an identity should be asked which of provider, operation, database, and
> caller it actually binds. Q05 bound the first two and was defeated through the third.

## Applied to a sibling, with a negative result

The same question was put to Q14 (`c16cd57cc1`), which is at a review gate.
`VerifiedHostedAdmission` is `pub` and derives `Clone`, which is the Q05 shape — but its fields
(`envelope`, `throttle_key`) are **private**, so a caller cannot forge one, and installation
defers a durable monotonicity check that should reject a replayed clone.

**No defect found there.** Recorded because a checked-and-clear result is worth as much as a
finding when the same question is being asked of every lane, and because it should not be
re-derived from scratch by the next reader.
