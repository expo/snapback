# Frozen Expo v1 proof can contact its fallback backend after a URL-specific build

Status: Open
Date: 2026-10-28
Scope: saved frontend proof fixtures / Expo origin binding; coordinate with DX16

LAT3's wave33/009 copy originally failed its v1 signed-in UI assertion on the
baseline while the candidate passed. Four fresh ordered diagnostic copies
(baseline, candidate, candidate, baseline) all reproduce the same 30-second
`+ Open restoration` timeout. Source and assertions were not modified.

The later baseline and candidate traces show `/auth/login` failing with
`net::ERR_CONNECTION_REFUSED` at the frozen source's fallback
`http://127.0.0.1:21090`. The actual copied production host was allocated inside
51000–52999. The script passes `EXPO_PUBLIC_SNAPBACK_URL: host.url` to its Expo
export, so the observed browser request does not use that supplied origin.
This establishes an origin-binding failure, not its cache/compiler root cause.
No authentication throttle or proof assertion was relaxed.

Replaying the complete lane with its original supported 21090–21099 range
(checked free first) passes both packages, including migration, preserved rows,
frozen v1 calls, rollback and rollforward: day2 131.758 / 127.029 seconds.
That corrected measurement supersedes the invalid generic-range observation;
the original attempt and the diagnostic repeats remain disclosed separately.
The original-range replay of wave33/035 also passes both packages (95.229 /
93.483 seconds); its source has fallback 21350. No failed-request trace was
captured for that lane, so attributing it to the same mechanism is an inference.

[Diagnostic evidence](../snapback4/reports/20261027-lat3/frozen-ui-diagnostic.json)
contains only codes, timings and failed-request origins, with no credentials.
[Built input evidence](../snapback4/reports/20261027-lat3/built-inputs.json)
shows the exact seven-file proof/fingerprint delta; the other 329 installed
files and public proof declaration match the retained baseline.

Follow up on saved frontend proof construction: verify that repeated exports
and changed backend ranges always bind the browser to the actual served host.
Keep all existing sign-in and business assertions. Historical lane sources are
read-only in LAT3; no route interception, app rewrite or compatibility facade
was added to make them pass.
