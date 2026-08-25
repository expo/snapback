# Live witness receipts

`run-witness.mjs` creates one `0600` JSON file per witness row in a dated
subdirectory.

Stage 3 is blocked by exactly four missing D2 witnesses: **iOS simulator —
NOT YET**, pending a strengthened rerun; **Android emulator — NOT YET**, pending
a strengthened rerun; **physical Android USB — NOT YET**; and **Expo web — NOT
YET, isolation witness only**. The retained
`ios-2026-08-25T15-06-51-734Z` and
`android-2026-08-25T14-54-18-163Z` native receipts predate the fail-sensitive,
server-observed checks and must not be treated as D2 evidence. The honest
Expo-web direct-binding receipt is `web-2026-08-25T20-16-02-195Z`; it records
`serverDevIdentityCapabilityWitnessed: false`, both custody headers absent, one
session-owned row, the invalid-assertion refusals, and `"d2Evidence": false`.

## Superseded summaries

Every retained summary below predates at least one current fail-sensitive
criterion and therefore carries `"d2Evidence": false`. A `passed` status means
only that the older run's own checks passed.

- `ios-2026-08-16T21-45-27-490Z/run-summary.json`
- `android-2026-08-25T14-54-18-163Z/run-summary.json`
- `ios-2026-08-25T15-06-51-734Z/run-summary.json`
- `web-2026-08-25T14-49-42-653Z/run-summary.json`
- `web-2026-08-25T16-03-15-778Z/run-summary.json`
- `web-2026-08-25T19-34-11-484Z/run-summary.json` — a Playwright interceptor
  stamped the owner-only capability on `/connection/open`; this is not a
  shipped Expo-web topology.

The current Expo-web/Chrome isolation receipt records a nonempty
sessions-authorized mutation/query without custody. Native summaries bind the
selected device class and enumerate
the native reader, rotation, replay/refusal, browser-Origin, and
tunneled-bootstrap rows; they remain useful non-D2 evidence. The web summary
proves an ordinary session without a native checkout/capability and direct
dev-identity refusal. Receipt serialization rejects every string containing
the `sbdev_` capability prefix, in any field, as well as registered checkout
material. The full Expo-web row is separate from the narrower Node Origin-gate
probes retained by native runs.
