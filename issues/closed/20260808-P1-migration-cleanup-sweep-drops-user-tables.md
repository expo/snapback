# P1: migration cleanup sweep can DROP user tables whose names match `{base}__g{digits}`

**Opened:** 2026-08-08 · **Severity:** P1 (silent data loss of an unrelated user table) · **Area:** storage / migration executor

## What

`src/storage/migration_executor.rs:3123-3146` (`cleanup_sweep`), resume path at
:3239-3261.

The sweep iterates **all** of `sqlite_master` (`physical`), and:

```rust
CleanupTerminal::RolledBack =>
    !name.contains("__retired_g")
    && name.rsplit_once("__g").is_some_and(|(base, generation)|
        !base.is_empty() && !generation.is_empty()
        && generation.chars().all(|c| c.is_ascii_digit())),
// Released => name.contains("__retired_g")
```

matching names are `DROP TABLE IF EXISTS`'d. The comment claims these are
"system-owned patterns no schema manifest can declare" — but nothing enforces
that reservation.

## Failure scenario

`is_user_identifier` (`src/manifest.rs:2154`) admits double underscores and
digits — verified that an app can legally declare a table named `logs__g2`
(first char `l`, remainder alphanumeric/underscore, not `_snapback`/`_auth`).
Any **unrelated** migration that rolls back (or whose cleanup resumes at reopen)
splits `logs__g2` into base `logs` + generation `2` (all digits) → match →
`DROP TABLE IF EXISTS logs__g2` with all its data. The `Released` terminal has
the same exposure for a user table containing `__retired_g`.

## Fix

Reserve the `__g<digits>` and `__retired_g<digits>` suffixes in
`is_user_identifier` (refuse them at manifest admission), **or** restrict the
sweep inventory to table names derived from the operation's own journal rather
than scanning all of `sqlite_master`.

## Confidence

High on mechanics (grammar and sweep both verified directly); medium on
real-world frequency of such user table names.

## Resolution (2026-08-08)
Fixed on main (Lane A). Verified: cargo build; migration_executor suite 29 pass; projection activation 3 pass; new regression tests pass; ref-check clean.
