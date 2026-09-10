# Retention: `retain`

`retain delivered-history` keeps rows that went hidden; the default
`retain until-revoked` evicts them. Authoritative absence and generated removed
events evict either policy's body and leased bytes. `deliver` derives the
removal metadata in the schema; see `guide deliver`.

See `guide offline` for held custody and the fence.
