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

Align the refusal repair text with the supported reset: retain the diagnostic
database via `--db` as the target identity, preserve the complete store with
`snapback store export` when needed, and make `snapback reset --dev-fresh`
perform a path-validated whole-store reset only for the canonical CLI-owned
`.snapback/dev.sqlite3`. Custom/shared and symlink-ambiguous paths must refuse
before deletion.

## Resolution

Resolved 2026-08-21. Both native and packaged-CLI projections of
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` now say that the unequal deployment
identity pin is stored in the selected database, not a keyring. Main's initial
repair (`96ad7dcd8`, refined by `aeefdb936`) therefore made `dev-fresh`
database-only. Reconciliation preserves that database-resident-pin vocabulary
but restores the ticket's custody-store exit criterion: preservation uses
`snapback store export`, and `dev-fresh` removes the database, custody
keyrings/configuration, asset blobs, and managed readiness state as one managed
whole store. It does so only for canonical `.snapback/dev.sqlite3`, after
regular-file/non-symlink ownership validation; custom/shared paths refuse before
deletion, and unregistered `.snapback` files survive. Rust and JavaScript
fixtures pin both the whole-store result and the refusal-before-delete cuts.

initial database-only landing SHA: 96ad7dcd8
