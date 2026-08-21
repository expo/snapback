# guide-gap: "delete the database file" repair text under-specifies the custody store

**Status:** Closed
**Systems:** Guide, auth custody, diagnostics
**Date:** 2026-08-18
**Evidence:** diary 0100 workaround note — after deleting only dev.sqlite3*,
SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH persisted because the keyring
siblings survived; guide/operating/backup-and-copy.md already says the store
"is not one file" but the refusal's remediation says "move or delete the
database file".

Align the refusal repair text (and any docs echoing it) with the
whole-store reality: a fresh dev target means removing the `.snapback`
store (database + keyrings), or point at `snapback reset --dev-fresh`.

## Resolution

Resolved 2026-08-21. Both native and packaged-CLI projections of
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` now name the entire `.snapback`
custody store (database and keyrings), retain the exact backup command, and
point to `snapback reset --dev-fresh` with the same disposable-local-dev-only
destructive caveat used by the schema retype diagnostic. Rust and JavaScript
fixtures pin the whole-store wording and reject the former one-file repair.

landing SHA: TBD
