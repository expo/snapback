# Snapback 4: intermittent Mac production-background maintenance drain

Status: Open
Date: 2026-10-18
Scope: `snapback4/packages/snapback4/test/export-background.test.mjs`,
“Darwin export launch policy: production background”, cleanup.

Integration 16's first pinned Node 24.13.1 Mac Studio scope passes this complete
file. A repetition under the same export implementation/runtime fails the unchanged 90-second
coalesced-maintenance drain in cleanup (case duration95.3s); all other tests in
the 52-file scope pass. The capture records active/next custody, parked/request
records, retention traces and processes. The failure snapshot is retained in
the final integration16 Mac archive. No timeout or scheduling policy is relaxed.
The test/helper and retention source are byte-identical to ccb9f752d1.

The case passes alone under the same pinned Node 24.13.1 in 4.3s. Following the isolated pass, the complete
52-file scope passes: 1,096 tests, 1,082 passed, zero failed, 14 platform/opt-in
skips. The separately enabled published F2 witness also passes. This broad
repeat does not establish a cause or close this issue. Inspect discretionary scheduling, observer/coalesced handoff
and retention/guardian termination against the captured trace. Preserve the
production background policy assertion and custody/cleanup semantics.
