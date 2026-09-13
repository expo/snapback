# Unforgeable identity is hand-rolled five times; it should be one primitive

Status: open
Date: 2026-08-25
Systems: snapback-kernel, snapback-engine, snapback-auth, snapback-server
Related: llp/0303-subject-authority-correlation-policy.decision.md,
  issues/shelved/20260824-q05-operation-identity-route-enumeration.md,
  issues/shelved/20260824-q04-membership-writer-route-enumeration.md

## The recurrence

Q05 has now been defeated **five times**, each time by the same shape rather than by a flaw in the
fix it had just made. Round 5 is the clearest example yet. Conditions 1–3 held under execution:
identities mint fresh per operation, no second joinable carrier exists, and a provider-A-plans /
provider-B-commits composition on one live database refused with every durable table unchanged.

Condition 4 then failed because the capability was **next door**:

- `attempt_bound_planned_session_issuance` remained publicly callable.
- `CatalogSessionIssuanceOperationBinding::new` publicly accepted caller-created `Arc<()>`
  identities *and* a caller-named `DatabaseBinding`.
- the `operation_binding` field was publicly installable.

A dependent crate minted two `Arc<()>` values, built a binding for a different live database,
installed it through the public field, and committed nine `_auth_*` tables. Negative-control tables
were untouched, so this was a precise composition, not a shotgun.

`#[doc(hidden)]` appeared on part of that path. It is a rustdoc directive, not a capability
boundary, and should be read as `pub`.

## Why it keeps recurring

The pattern that *works* is known and has been executed successfully in this repository: an
`Arc<()>` with a private field and a private constructor, compared by `Arc::ptr_eq`, so a second
`LocalDatabase::memory()` cannot forge one. Q03 closed its route exactly this way.

The problem is that **every lane hand-rolls it**. There is no shared primitive:

| File | `Arc<()>` sites |
|---|---:|
| `crates/snapback-kernel/src/storage.rs` | 6 |
| `crates/snapback-kernel/src/auth/service_fence.rs` | 5 |
| `crates/snapback-engine/src/local/engine.rs` | 4 |
| `crates/snapback-kernel/src/fork_promotion_bench.rs` | 3 |
| `crates/snapback-kernel/src/storage/auth_mode.rs` | 1 |

Twelve files call `Arc::ptr_eq` on identity-like values. Each open-coded instance is one careless
`pub` away from being forgeable, and the reviews keep finding exactly that `pub`. The defect is not
that any individual lane was sloppy — it is that the safe construction is a *convention* rather than
a *type*, and conventions are re-derived by every lane independently.

## What to build

One primitive, owned by a single module, with the unforgeability enforced by the type rather than by
each site's discipline:

- The inner handle is private to the defining module. No public constructor, no public field, no
  `From`/`Into` that accepts a caller-supplied handle, no `*_for_test` mint.
- It is `Clone` — cloning is legitimate and necessary — but a clone is the *same* identity, which is
  the point of `ptr_eq`. It must not be constructible from parts.
- Minting is a privileged operation available only to the component that owns the fact.
- Comparison is a method on the type, so no site open-codes `Arc::ptr_eq` against the wrong field.

Then migrate the 19 sites onto it.

## Two cautions

**This does not make identity a lifetime-safe fact by itself.** LLP 0303 (j) applies: consuming a
value by move makes a *binding* single-use, not the underlying *fact*. And (l) applies: if the
guarded-ness lives on a handle rather than on the resource, a second handle starts unguarded. A
shared identity primitive removes the forgery route; it does not remove the need for durable state
where durable single-use is claimed.

**Sequencing.** This touches `snapback-kernel` and `snapback-engine` broadly, which is where the
active row lanes are working. Landing it mid-wave would collide with all of them. It should be
designed now — this document is that design — and implemented once the current lanes land, so the
migration happens against a quiet tree rather than five moving ones.
