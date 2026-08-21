# guide-gap: "delete the database file" repair text under-specifies the custody store

**Status:** Closed
**Systems:** Guide, auth custody, diagnostics
**Date:** 2026-08-18
**Evidence:** diary 0100 originally attributed a persistent
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` to surviving keyring siblings. The
implementation review corrected that hypothesis: the refusal compares unequal
deployment identities stored in the database; keyrings do not participate.
The old "move or delete the database file" text was still incomplete because
it omitted SQLite sidecars and target selection, while directory-wide deletion
would be unsafe for unrelated databases sharing the directory.

Align the refusal repair text with the supported database-targeted reset:
include the diagnostic database via `--db`, enumerate the exact artifacts
removed by `snapback reset --dev-fresh`, and do not recommend directory-wide
deletion.

## Resolution

Resolved 2026-08-21. Both native and packaged-CLI projections of
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` now say that the unequal deployment
identity pin is stored in the selected database, not a keyring. The backup step
states that `snapback auth backup` captures only its database/auth unit, not
config, asset blobs, or operation-detail keys. The reset command carries the
diagnostic's exact `--db` path and names only the database, WAL/SHM,
admin-token, dev-identity, and managed readiness files it removes; it explicitly
leaves keyrings and other databases alone. Rust and JavaScript fixtures reject
the former whole-directory wording.

landing SHA: 96ad7dcd8
