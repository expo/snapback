# Live witness receipts

`run-witness.mjs` creates one `0600` JSON file per witness row in a dated
subdirectory. Prior iOS-simulator and Android-emulator receipts are retained
here, but their earlier 2026-08-25 runs predate the strengthened server-observed
capability assertion and therefore do not qualify the current D2 rows. The
strengthened Expo-web/Chrome receipt is
`web-2026-08-25T16-03-15-778Z/` and records a nonempty sessions-authorized
mutation/query. Native summaries bind the selected device class
and enumerate the native reader, rotation, replay/refusal, browser-Origin, and
tunneled-bootstrap rows. The web summary proves an ordinary session without a
native checkout/capability and direct dev-identity refusal. Receipt
serialization rejects every string containing the `sbdev_` capability prefix,
in any field, as well as registered checkout material.

Physical Android USB remains unwitnessed. The full Expo-web row is separate
from the narrower Node Origin-gate probes retained by native runs.
