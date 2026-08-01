# A1 sweep guide-gap: the retainability opt-in is undocumented (sessions apps get zero offline by default)

**Opened:** 2026-08-01
**Systems:** Guide, Sync
**Related:** LLP 0137 (A1 arm), LLP 0129, guide/sync/offline-and-retention.md, demos/improvement-sweep/arms/a1-snapback-web/findings/0137-a1-f4-retainability-opt-in-undocumented.json

In a sessions-mode app even a public-table declarative live query is
authority-scoped by default: the handle reports
`SNAPBACK_RETENTION_NOT_RETAINABLE` and nothing persists, so the shipped
`sync.offline-js-arm` cold-boot claim silently never engages anywhere in the
app. The opt-in — `auth: 'public'` + `authorityIndependent: true`
(+ `retainable: true`) on the query declaration — is not taught: the offline
page says "authority-independent live queries" retain without showing how a
query becomes one, `retainable` appears nowhere in the guide, and the only
`authorityIndependent` example is an unrelated snapshot-bundles snippet. The
A1 arm learned the flags from packaged `define.mjs` bytes (recorded
assistance event).

Fix shape: teach the opt-in on the offline page and the queries page's
declarative spec table, with a CI-verified snippet whose handle reports
`retainable: true`.
