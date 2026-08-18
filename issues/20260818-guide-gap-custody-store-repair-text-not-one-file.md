# guide-gap: "delete the database file" repair text under-specifies the custody store

**Status:** Open
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
