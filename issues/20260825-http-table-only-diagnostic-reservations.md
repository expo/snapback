# Review HTTP-table-only diagnostic reservations for deletion

Status: Open — requires a Rust-capable lane
Created: 2026-08-25
Related: `crates/snapback-server/src/server/api_error.rs`, LLP 0193

## Why

The diagnostics registry now reserves nine spellings that remain only in the
server's HTTP-status match table. Removing those dead match arms is a Rust
product change and was deliberately kept out of the JS-only `registry-envvar`
lane:

- `SNAPBACK_AUTH_MODE_CHANGED`
- `SNAPBACK_OPERATION_CANCELLED`
- `SNAPBACK_ADMIN_SECRET_READ_MINT_DENIED`
- `SNAPBACK_API_BUDGETS_UNAVAILABLE`
- `SNAPBACK_AUTHORITY_ROSTER_CURSOR_INVALID`
- `SNAPBACK_BRANCH_CAPTURE_ONLY_MISSING`
- `SNAPBACK_PROMOTION_EFFECT_INTENT_MISSING`
- `SNAPBACK_SCHEMA_UNIQUE_INDEX_OPTIONAL_FIELD`
- `SNAPBACK_UNSUPPORTED_BLOB`

`SNAPBACK_SHUTDOWN_CHECKPOINT_TIMEOUT_MS` is not reserved and is not in the
diagnostic vocabulary. It is an environment-only shutdown tuning input; its
HTTP arm remains a non-emitting match reference in this JS-only lane, while the
real emitted diagnostic is `SNAPBACK_SHUTDOWN_WAL_CHECKPOINT_INCOMPLETE`.

`SNAPBACK_INVALID_FLOAT` also remains in the HTTP table, but it is not a
deletion candidate. The server accepts it as closed caller-error vocabulary on
the error-tracking wire through `CALLER_ERROR_CODES`; the diagnostics registry
therefore retains its `crates/snapback-types/src/error_tracking.rs` site as
`received`. It also remains governed by `schemas/operation-class.v1.json` and
LLP 0154's closed classifier vocabulary.

## Follow-up

Confirm each code has no live producer, protocol obligation, persisted-record
compatibility requirement, or Guide contract. If all nine are dead, delete
their match arms in a Rust-capable lane and remove the adjacent
`diagnostics-registry: reserved SNAPBACK_X` comments in the same change. Regenerate the
diagnostics registry, symbol registry, and Guide projections afterwards.
Do not remove `SNAPBACK_INVALID_FLOAT` without a separately reviewed wire and
observability compatibility change.
