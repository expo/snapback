# A1 sweep guide-gap: the retainability opt-in is undocumented (sessions apps get zero offline by default)

**Status:** Resolved
**Opened:** 2026-08-01
**Resolved:** 2026-08-01
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

## Resolution (2026-08-01, 0137 between-arms fix lane)

`guide/sync/offline-and-retention.md` gained the section **"Opt a live
query into cold retention (`rqsEligible`)"**: it states that retention is
per-query opt-in and that a sessions-mode app retains NOTHING by default
(`SNAPBACK_RETENTION_NOT_RETAINABLE` on every authority-scoped handle),
teaches the exact declaration (`auth: 'public'` +
`authorityIndependent: true` on a declarative closed-inputs live query),
explains the derived (never authored) `rqsEligible` predicate, and
disambiguates the two neighbors the A1 arm had to reverse-engineer:
`publicInline` (Channel A disclosure, not required) and `retainable: true`
(the lease-class Contract-arm opt-in, not this arm's cold retention). All
three refusal codes are named. Transcluded-verified snippets: the eligible
declaration from `demos/public-dashboard/snapback/functions.mjs` and the
`retention.retainable === true` + refusal handle facts from
`demos/public-dashboard/tests/acceptance/offline-local-first.mjs` (both
CI-exercised). `guide/realtime/live-queries.md` ("Define one") now points
at the opt-in, and the `sync.offline-js-arm` capability row names the
per-query declaration so the index no longer implies default-on retention.
`node scripts/check-guide.mjs` green (45 pages, 117 snippets).
