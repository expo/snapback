# Guide asset-client sweep red: bench r2 harness log carries an unallowlisted raw-client accessor

**Opened:** 2026-08-25
**Closed:** 2026-08-25
**Status:** Closed

**Signature:** `check-guide-asset-client-example.mjs` fails `asset client minimal example packed typecheck`:
`unallowlisted raw-client asset accessor in benchmarks/runs/2026-08-23-r2-published-0125/cells/opus-clique-explicit/events/harness.stdout.jsonl; use createAssetClient(client)`

**Resolution:** recorded `benchmarks/runs/**/events/*.jsonl` transcripts are skipped as frozen model-under-test evidence. The authored count-exact allowlist is unchanged. `isRecordedBenchmarkEventsTranscript` in `scripts/guide-lib.mjs` is covered by `scripts/guide-freshness.test.mjs`. Two runs of `node scripts/check-guide-asset-client-example.mjs` exit 0 and no longer report the bench-r2 harness path.
