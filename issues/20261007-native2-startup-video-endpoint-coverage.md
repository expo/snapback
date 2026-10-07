# Native.2 independent-app startup captures miss mandatory endpoint coverage

**Opened:** 2026-10-07, Lane P3 Round 2
**Status:** Open
**Area:** Native benchmark startup recorder
**Related:** LLP 0201.000; Phase-2 rerun results

Snapback 4 M6 attempt-02 and M8 attempt-03 both record secondary
`invalid-startup-video:video-endpoint-uncovered` after the independently observed
ordinary-media selector failure. All 2,030 and 2,028 encoded frames decode and
were inspected, but that does not establish complete launch-through-prime
wall-clock coverage. The retained failure trees and screenshots establish the
application failure independently. Neither capture is a measured native pass.

Preserve the qualified strict endpoint check. Diagnose recording start/stop and
terminal sampling against these exact movies, then retain complete startup
coverage on ordinary app failure as well as on known-good operation. Repeat the
extended-endpoint, truncated/undecodable-video and startup-failure controls for
any collector change. Do not loosen validation to promote these null records.

Evidence: eb1000 `~/sb5-evidence-archive/20261007-p2rerun/`,
`snapback4-retained-m6/m6/evidence/` and `snapback4-retained-m8/m8/evidence/`.
