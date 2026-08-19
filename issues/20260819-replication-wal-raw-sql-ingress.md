# Remove the replication WAL raw-SQL ingress

**Status:** Open
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
