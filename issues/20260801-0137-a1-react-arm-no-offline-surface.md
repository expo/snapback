# A1 sweep: the React arm has no offline surface (freshness, retention, outbox invisible to hooks)

**Opened:** 2026-08-01
**Systems:** Client integration, Sync
**Related:** LLP 0137 (A1 arm), LLP 0114, LLP 0129, demos/improvement-sweep/arms/a1-snapback-web/findings/0137-a1-f5-react-arm-no-offline-surface.json

`@expo/snapback-react` 0.1.7 exposes rows, status, and the connection axis,
but none of the offline facts the headless client carries: no per-query
`freshness` ('retained' vs 'current'), no `retention` fact, no outbox/queued
state. A React field notebook cannot render the documented honest freshness
state or a queued-changes badge from the first-party arm; the A1 shell wires
its freshness chip to connection status with a finding comment. Firebase
exposes `SnapshotMetadata.fromCache` per snapshot; InstantDB hooks are
offline-first natively (frozen Diary 0027).

Fix shape: project freshness/retention onto the query-hook result and add an
outbox hook (queued count + replay state) over the existing client facts,
with a packaged-closure cold-boot-offline hook test.
