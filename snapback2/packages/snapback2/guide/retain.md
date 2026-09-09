# Retention: `tombstones`

`retain delivered-history` keeps rows that went hidden; the default evicts them.
`tombstones messages[.messageId] if .kind = 'removed' or .kind = 'expired'`
declares delivered-row eviction. Its column references the target; its predicate
uses this table's `enum`/`bool`/`text`, literals, `=`, `!=`, `and`, `or`, `not`,
and parentheses. Lines union. Schema hash/certificate bind owner and twin.

See `guide quarry` for related topics.
