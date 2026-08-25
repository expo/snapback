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

## Follow-up

Confirm each code has no live producer, protocol obligation, persisted-record
compatibility requirement, or Guide contract. If all nine are dead, delete
their match arms in a Rust-capable lane and remove the adjacent
`diagnostics-registry: reserved SNAPBACK_X` comments in the same change. Regenerate the
diagnostics registry, symbol registry, and Guide projections afterwards.
