# Snapback 4 Darwin bootstrap inspector times out under shared-host contention

**Status:** Closed
**Date:** 2026-10-13
**Scope:** Publication client fixture infrastructure

Integration 7's first full Mac client pool (six slots, Node 24.19.0, default
TMPDIR, descriptor limit 65536) refused in-chat-search before its tests began:
`TEST_SIGNAL_REFUSED: cannot build Darwin identity inspector:
TEST_COMMAND_INSPECTION: ps failed: /bin/ps ETIMEDOUT`.
The failure arose in compiler-group cleanup's ten-second whole-table inspector,
not in a product query, bind, file open, or identity mismatch.

At the failure investigation the shared host reported load averages
942.68 / 838.72 / 429.68, approximately 5,100 processes and 104 logged-in users.
The file runner's three complete snapshots reported 15,445 unrelated rows in
aggregate. Read-only command counts showed many unrelated simulator services,
terminals and other agents. Integration 7 did not start simulators or signal
unrelated processes. The unchanged sixty-second group-drain deadline already
allows waiting for complete cleanup; its leaf ps had a stricter ten-second cap.

Repair: retry only ETIMEDOUT once within that original sixty-second deadline,
discard all timeout bytes and require two fresh complete empty snapshots.
No inspector error/malformed-row refusal or signal custody check is weakened.
Linux nine group tests pass, including partial-output and exhausted-retry
negative controls. Independent Muse and fresh Codex 6.1 high source reviews both mark the repair
READY at 1bc9993aec with no material finding. After the repair, another 69
process/signal controls pass on Linux (78 total across three files). At the repair commit, complete Mac qualification was still pending; a targeted
pass could not close this ticket or qualify the suite.

Evidence is archived under snapback4/reports/20261013-integration7/mac/.

## Resolution — 2026-10-13

Repair 1bc9993aec, independently reviewed READY by Muse and fresh Codex 6.1 high.
Fixed source b7f161eef8 completes the normal six-slot full Mac ordinary pool
373/373 (7363 passed /20 skipped /0 failed), then the default serial models
81/81 (no skipped or failed tests): one complete green publication client
stage. The original in-chat-search and keep-app-expiry files both pass in
that full pool. No seeds, assertions, deadlines or slot counts are reduced.

The extra generic Swift build passes with ARCHS=arm64, no simulator boot.
An intervening host reboot interrupted the preceding Swift attempt before
clients started; preserve its incomplete log separately. Root prerequisites
and inventory/Guide checks pass. Archived final Mac evidence records source,
Node 24.19.0, default TMPDIR, ulimit 65536 and the published 0.2.33 fence cache.
This bounds a transient leaf-inspector timeout, not arbitrary host hangs;
second timeout/malformed output still refuses, and no partial snapshot counts.
