# Snapback 4 Darwin bootstrap inspector times out under shared-host contention

**Status:** Open
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
process/signal controls pass on Linux (78 total across three files). Required
complete Mac client qualification remains pending;
a targeted pass cannot close this ticket or qualify the suite.

Evidence will be archived under snapback4/reports/20261013-integration7/mac/.
