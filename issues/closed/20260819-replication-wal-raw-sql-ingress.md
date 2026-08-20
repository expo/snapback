# Remove the replication WAL raw-SQL ingress

**Status:** Resolved
**Owner:** Snapback kernel
**Due:** 2026-09-19
**Related:** LLP 0284 §3.2, `configure-connection-wal-lifetime`

`configure_connection_wal_lifetime` publicly accepts an already-held
`&rusqlite::Connection` to configure connection-local WAL behavior. It does not
return, store, or mint a handle, so it is not an egress escalation, but the raw
type remains in the dependent-visible API.

Close this ticket by moving the operation behind a typed kernel seam or making
it crate-private, then remove the matching privilege-surface allowlist row. The
row expires on 2026-09-19.

## Resolution — 2026-08-19

Four callers were kernel-internal (`instance_fork`, `storage`, and two storage
connection openers). Two cross-crate callers were in `snapback-services`: the
replication status connection and the instance-fork connection setup. The
kernel helper is now `pub(crate)`, and services owns a separate `pub(crate)`
implementation for its private connections; the former public services
re-export was removed.

The `configure-connection-wal-lifetime` privilege-surface allowlist row was
removed. The scanner no longer reports that item; the complete
`node scripts/check-kernel-raw-sql-api.mjs` gate remains red only on the 127
pre-existing LLP 0283 F-1 findings recorded in
`issues/20260819-security-gates-expected-red-until-f1.md`.
