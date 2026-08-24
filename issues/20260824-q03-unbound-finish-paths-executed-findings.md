# Q03 round 3: the binding was real and four sibling paths were not

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Systems:** Auth, Sync, Kernel
**Date:** 2026-08-24
**Related:** LLP 0303 (corollary, "Coverage, not just the primitive"),
  `issues/20260824-assertion-provenance-is-the-recurring-test-defect.md`

## Why this is written down

Q03 round 3 (`2fb51cc76`) introduced a correct database binding — `DatabaseBinding(Arc<()>)`,
private field and constructor, compared with `Arc::ptr_eq` — and **two independent executable
reviews confirmed the original exploit dead**. Both then found the same thing: the binding
covered *revocation*, and the sibling finish paths kept the raw type.

Recording the compositions because round 4 is in flight against a subset of them, and because
finding 4 below is a shape other lanes in this program may share.

Both reviewers **compiled and ran** every composition. None of this is argued.

## The confirmed-closed part — do not regress it

```
replacement exploit refused: SNAPBACK_AUTH_PROJECTION_UNAVAILABLE; live durable row: (1, None)
committed_revocation_seal_from_disposable_database_cannot_finalize_live_projection ... ok
real_revocation_plan_from_disposable_database_cannot_premark_live_projection ... ok
```

## 1 — rotation finish accepts a raw attempt

`premark_rotation` (`snapback-sync/src/auth/coordinator.rs:710`) checks no binding;
`ProviderTokenRotationPlan` has no binding field; `finish_rotation` (`coordinator.rs:1156`) takes
the unsealed `AuthTransactionAttempt<PlannedRotationCommit>`. Production refresh uses that seam at
`snapback-server/src/server.rs:20192`.

Three executed variants, all succeeded:

- **Disposable seal** — plan against a second `LocalDatabase::memory()` seeded with
  `insert_email_session_for_test`, premark on the LIVE coordinator, commit against the disposable
  database, finish on live.
- **No second database, no commit at all** — plan against the live database through the ordinary
  production API, premark, **skip `commit_planned_rotation`**, and pass
  `AuthTransactionAttempt::Committed(PlannedRotationCommit::Committed { session: SessionResponse { .. } })`.
  All fields public. *A commit that never happened was accepted.*
- **`ProviderTokenRotationPlan::for_test`** — same finish.

```
live durable row: (1, None); successor projection: accepted; durable original still current: true
```

## 2 — issuance finish accepts a raw attempt, and its check is vacuous

`premark_issuance` (`coordinator.rs:732`) checks **only nested revocation bindings**.
`ProviderSessionIssuancePlan::for_test` (`snapback-auth/src/auth/provider.rs:1385`) accepts a
caller-authored `ProjectedSessionInsert` and ships `revocations: Vec::new()`, so the check runs,
passes, and proves nothing. `finish_issuance` (`coordinator.rs:1240`) takes the raw attempt.

The caller's bearer resolves successfully while the durable projection source stays empty.

## 3 — caller-built committed stream reset

Rotates projection authority without resetting durable state.

## 4 — `AuthenticatedUse::Unchanged` extends authority past durable expiry

**This one is not about database provenance, and other lanes should check for its shape.**

`AuthenticatedUse` (`snapback-types/src/contract_types.rs:144`) is publicly constructible.
`finalize_authenticated_use` (`coordinator.rs:1782`) accepts it **without provenance**, and the
`Unchanged` branch makes `publish_authenticated_use_deadline`
(`snapback-sync/src/auth/session_projection.rs:1829`) derive a fresh in-memory sliding deadline.

A session whose durable expiry is `1000` is accepted at `2000`. The durable row is untouched and
correct; the projection simply stops agreeing with it.

## The threat model, demonstrated rather than argued

One reviewer built these **in an external Cargo dependent** that enabled the three public
`test-support` features — not as in-crate tests.

That is the standing repo position made concrete: `test-support` is a Cargo feature, any dependent
can enable it, and "only tests can do that" has now been refuted by execution rather than by
assertion. Treat every `#[cfg(feature = "test-support")] pub` item as production surface.

## What closes this

Bind every finish that can mutate the live projection the way revocation was bound — rotation,
issuance, password-change, stream-reset — rejecting a carrier that is not the exact database the
coordinator was minted from, **including a caller-built `AuthTransactionAttempt::Committed`**.
Give `finalize_authenticated_use` provenance. Remove or neutralise `*_for_test` constructors that
premark without a binding.

Then add an executed test **per finish path** that reads back the durable columns *that path*
writes. Rotation needs `token_hash` / current-bearer, not `(generation, revoked_at)` — projecting
the previously-fixed path's columns is exactly how these survived. And fix
`committed_rotation_response_ignores_only_doomed_sibling_refresh_tickets`, which performs
composition 1 as a happy path and asserts it is fine.
