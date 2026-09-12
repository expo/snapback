# Snapback 2 concurrent signup unique race is `E_AUTH_STORE`

**Status:** Closed
**Priority:** P3
**Date:** 2026-09-11
**Systems:** `snapback2/crates/snapback2-core/src/identity.rs` (`signup`)
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1001 §6

## Symptom

Signup’s email-taken check is not in the same transaction as the insert. Two concurrent signups of the same email both pass `EXISTS`, both hash, and the loser hits `UNIQUE` on `_credentials.email`. That becomes `IdentityError::Store`, served as `E_AUTH_STORE` with rusqlite’s `UNIQUE constraint failed: _credentials.email` on the wire. The common path correctly returns `E_AUTH_EMAIL_TAKEN` without hashing.

The owner is a single writer, so HTTP-level concurrency is serialized on `OwnerHandle::call`. The race is still real for in-process `Runtime::signup` (tests, seeds, two calls inside one turn if that ever happens) and for any future multi-thread writer.

## Proposed patch

Map a unique-constraint failure on the credentials (and principals) insert to `EmailTaken`. Keep hashing outside the transaction.

```rust
        let transaction = self.engine.store_mut().conn.transaction()?;
        let inserted = transaction.execute(
            "INSERT INTO _principals(id, kind, name, created_at) VALUES (?1, 'user', ?2, ?3)",
            params![principal.id.as_str(), email, now],
        );
        if let Err(error) = inserted {
            return Err(map_signup_constraint(error));
        }
        let inserted = transaction.execute(
            "INSERT INTO _credentials(principal, email, hash) VALUES (?1, ?2, ?3)",
            params![principal.id.as_str(), email, hash],
        );
        if let Err(error) = inserted {
            return Err(map_signup_constraint(error));
        }
```

```rust
fn map_signup_constraint(error: rusqlite::Error) -> IdentityError {
    match &error {
        rusqlite::Error::SqliteFailure(sqlite, _)
            if sqlite.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            IdentityError::EmailTaken
        }
        _ => IdentityError::Store(error),
    }
}
```

Same pattern as `engine/mod.rs` mapping constraint failures to `E_CONSTRAINT`. Do not map every store error — only constraint.

## Acceptance

- Two `signup` calls with the same email: one session, the other `E_AUTH_EMAIL_TAKEN` (never `E_AUTH_STORE` / rusqlite text).
- A genuine store IO failure is still `E_AUTH_STORE`.
- Unknown-email login still uses the dummy hash path.

## Resolution (2026-09-11)

Signup now maps only SQLite's extended `SQLITE_CONSTRAINT_UNIQUE` error for
`_credentials.email` to `EmailTaken`. Principal collisions, other constraints,
and all other store failures keep their original `IdentityError::Store`; the
unknown-email dummy-hash login path is unchanged. The suggested blanket
constraint mapping was deliberately narrowed.

The current single writer and exclusive Store ownership serialize real owner
signups. The regression verifies the common duplicate-email path, then uses a
SQLite trigger to inject a duplicate between the existence check and credentials
insert. A separate aborting trigger proves a real non-unique SQLite failure is
not relabeled as email-taken. The integrated core identity suite passed.
