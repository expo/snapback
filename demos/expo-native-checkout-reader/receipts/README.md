# Live witness receipts

`run-witness.mjs` creates one `0600` JSON file per witness row in a dated
subdirectory.

Stage 3 is blocked by exactly three missing D2 witnesses: **iOS simulator —
NOT YET**, pending a strengthened rerun; **Android emulator — NOT YET**, pending
a strengthened rerun; and **physical Android USB — NOT YET**. The retained
`ios-2026-08-25T15-06-51-734Z` and
`android-2026-08-25T14-54-18-163Z` native receipts predate the fail-sensitive,
server-observed checks and must not be treated as D2 evidence. The strengthened
Expo-web evidence is `web-2026-08-25T19-34-11-484Z`; its app row and run
summary both carry `"d2Evidence": true` because the server witnessed the
relayed capability, the session-owned query returned one row, and browser
JavaScript presented no checkout header.

## Superseded summaries

Every retained summary below predates at least one current fail-sensitive
criterion and therefore carries `"d2Evidence": false`. A `passed` status means
only that the older run's own checks passed.

- `ios-2026-08-16T21-45-27-490Z/run-summary.json`
- `android-2026-08-25T14-54-18-163Z/run-summary.json`
- `ios-2026-08-25T15-06-51-734Z/run-summary.json`
- `web-2026-08-25T14-49-42-653Z/run-summary.json`
- `web-2026-08-25T16-03-15-778Z/run-summary.json`

The strengthened Expo-web/Chrome receipt records a nonempty sessions-authorized
mutation/query. Native summaries bind the selected device class and enumerate
the native reader, rotation, replay/refusal, browser-Origin, and
tunneled-bootstrap rows; they remain useful non-D2 evidence. The web summary
proves an ordinary session without a native checkout/capability and direct
dev-identity refusal. Receipt serialization rejects every string containing
the `sbdev_` capability prefix, in any field, as well as registered checkout
material. The full Expo-web row is separate from the narrower Node Origin-gate
probes retained by native runs.
