# A sealed trait seals implementation, not its `&mut LocalDatabase` parameter

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Systems:** Auth, Kernel
**Date:** 2026-08-24
**Related:** LLP 0303 (revision h, "Removing a constructor is not removing the capability"),
  `issues/shelved/20260824-test-support-bypass-surface-inventory.md`,
  `issues/shelved/20260824-q05-database-provenance-confirmed.md`

## The surface

`crates/snapback-auth/src/auth/database_plan.rs` on `origin/main`:

```rust
mod private { pub trait Sealed {} }

#[doc(hidden)]
pub trait AuthDatabasePlan: private::Sealed {
    type Output;
    #[doc(hidden)]
    fn execute(self, database: &mut LocalDatabase) -> Self::Output;
}
```

Its module doc states the intent plainly: *"A plan can be minted only by auth policy in this crate…
execute it against its private `LocalDatabase`; higher [layers] … a plan but cannot supply an
arbitrary closure or implementation."*

**The seal delivers the second half of that and not the first.** `private::Sealed` stops an external
crate from *implementing* `AuthDatabasePlan`. It does nothing to stop a caller who holds a legitimate
plan from calling `execute` and **naming the database it runs against**. The plan is minted by auth
policy; the database is a parameter.

## Why it is recorded now

A reviewer executed a composition through this seam while reviewing an unrelated lane, from an
**external dependent with no feature flags**:

```
plan on live → premark live coordinator → create commit plan through provider B
  → execute on shadow DB → finish live coordinator → release/resolve plaintext
```

All three flows were accepted while every non-SQLite table, column and row in the **live** database
stayed byte-identical; the shadow database absorbed the writes to `_auth_assurances`,
`_auth_security_events`, `_auth_sessions`, `_auth_users`,
`_snapback_auth_guest_idempotency` and `_snapback_auth_successful_effect_charges`.

## What is verified, and what is not

**Verified by direct inspection:** the trait is sealed and `#[doc(hidden)]`; `execute` takes `self`
plus `&mut LocalDatabase`; the file is **byte-identical between `origin/main` and the lane** under
review (`git diff --stat` empty); no `cfg`/`feature` gate guards it; six files on `main` reference
`database_plan`.

**Not verified here:** that the exploit reproduces against `main` standalone. It was executed against
a branch whose copy of this file is identical to `main`'s, which makes reproduction likely but not
established. **Do not treat this ticket as proof of a live exploit on `main` until someone runs it
there.** The lane will close its own row; this ticket exists because the surface is not the lane's.

## The generalisation

`#[doc(hidden)]` and a sealed supertrait both read as "this is not public API", and neither is a
capability boundary:

- **Sealing** prevents new *implementations*. It does not prevent *calls*, and it says nothing about
  the arguments those calls accept.
- **`#[doc(hidden)]`** removes an item from rendered documentation. It is still `pub` and still
  nameable by any dependent. The bypass-surface inventory found the same thing:
  `#[doc(hidden)]` changed none of its reachability results.

> If a method takes the database — or the provider, registry, or connection — as a parameter, the
> caller chooses it, whatever the trait around it is sealed with.

## Suggested disposition

The plan should carry the identity of the database that minted it and refuse any other. The accepted
shape is `DatabaseBinding` — a private `Arc<()>` compared with `Arc::ptr_eq`
(`crates/snapback-kernel/src/storage.rs`) — which a sibling lane already applied to revocation
successfully. Either that, or `execute` should take no database at all and use the one the plan was
minted against.
