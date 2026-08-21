# dev-loop.test.mjs typo-reload timeout flakes under machine load

**Status:** Resolved
**Opened:** 2026-08-12 (ordinary-TS authoring wave, run llp0245-0249-ordinary-ts-20260812)

`packages/snapback-cli/dev-loop.test.mjs` ("timed out waiting for runtime typo
handler load") flaked repeatedly on 2026-08-12 during the wave's final
verification, on a machine concurrently running another orchestration
session's workers plus cargo builds.

Evidence it is environmental, not a wave regression:
- the test file is byte-unchanged from the wave base (`1a32a69da`);
- it fails identically (3/3) on two single-lane trees with disjoint changes —
  `llp-ship/llp0245-0249-ordinary-ts-20260812/batch-reads` and `.../client` —
  the latter touching nothing the dev supervisor executes;
- it passed on the integrated tree twice earlier the same day (lane S's full
  CLI suite run and one isolated rerun), then began failing as machine load
  rose; pass/fail alternated 1-of-3 in isolation on the integrated tree;
- no port-4293 squatter existed at failure time (`lsof -nP -i :4293` empty);
- `defineJsMutation({ args, writes, handler })` (the fixture's spec) still
  builds — probed directly;
- prior branches `exec/dev-loop-regen-race` show this test's regen/watch area
  has a known race history.

Wanted: make the typo-reload wait tolerant of debounce starvation (longer
adaptive timeout or event-driven wait), or serialize the three edit waves on
explicit load acknowledgments. Until then treat reds from this file under
load as suspect and rerun on a quiet machine.

## Resolution

Resolved on 2026-08-21. The flake was in the test's synchronization: the
runtime-typo insertion and removal waited for the automatic watcher's
debounced `functions.mjs` event, so a starved debounce callback could exhaust
the test's event timeout even though the product path was intact.

Those two writes now send the existing machine-readable `reload` command and
wait for its request-correlated terminal load acknowledgment. The supervisor
serializes forced reloads and watcher passes on the same work chain, so the
acknowledgment proves the authored bytes completed generation and load without
depending on when the debounce timer runs. A correlated `generation-failed`
or `generated-but-not-loaded` event fails immediately, and the subsequent
`runtimeTypo` mutation still proves the loaded handler produces the expected
enriched runtime diagnostic. The later live-edit and generation-failure/
recovery waves remain watcher-driven, preserving the dev-loop acceptance
coverage.

This was preferred over a larger timeout because it removes debounce timing
from the typo assertion rather than merely reducing the probability of the
same failure. No supervisor change was needed; inspection found no evidence of
a product-visible regeneration race in this failure.

**Landing SHA:** TBD
