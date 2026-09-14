# M7 day-2 evolution

The application remains pinned to snapback4 0.2.6 and snapback4-expo 0.2.1. Run the final app against this session's migrated starter database with `npx snapback4 serve m7/deployment --port 49300`, and `npm start` on 49301. Stop the exact server PIDs before deploying. The seed sessions in `.snapback4/seed-sessions.json` belong to this instance. Use `npm run seed -- --segment m1`, `m2`, then `m3` only when installing a fresh database. Never use an inherited replay-state cache against a fresh instance.

## Migration

The pre-M7 schema did not maintain visible message counts. `latestSequence` is an arrival counter, and existing reaction/digest counters serve different purposes.

The published deployment path was used, with no direct database edits:

1. Deploy the inherited `.q` files to a fresh directory; serve it and install all three starter segments through the app seed path. Export each persona via `node m7/snapshot.mjs`, before schema edits. `pre-snapshot/manifest.json` binds every file hash and the M6 field manifest. Asset byte hashes and public posts/profiles are also retained.
2. Stop the deployment. Expand messages with optional `visibleWeight` and `pollOptions`, and add the votes table. The exact intermediate source is retained under `deployment/releases/2/snapback`.
3. Deploy the expanded schema plus the root `backfillMessageCounts` Quarry job scheduled every minute (`deployment/releases/3/snapback`). Serve through one schedule boundary; require a completed job. This run visited all 15 starter messages in one chunk. The job writes 0 for a tombstone, 1 otherwise. New sends already write 1.
4. Stop the deployment and retain a backup. Deploy the final source with `--allow-destructive`: the compiler classifies optional-int to required-int as destructive, even after all values are filled. No field or table is removed. The engine rebuilds the new `visibleMessageCounts` sum aggregate. The temporary schedule is removed; the idempotent job remains available in the schema.
5. Serve and export `node m7/snapshot.mjs m7/post-snapshot`. `node m7/compare.mjs` requires exact equality, and `node m7/verify-migration.mjs` verifies counts against the pre-snapshot.

`run` uses a local development store and refuses a deployment store. The scheduled job is the working published mechanism here. Release, compiler, backfill, and comparison diagnostics are retained in this directory. `expanded-backfilled-backup` preserves the stopped deployment before the final type contract.

## Verification

`npm run acceptance -- --milestone m7` writes `evidence/suite-m7.json` and `coverage-m7.json`, with copies under `m7/`. It verifies shape/authorization bounds, vote changes and late duplicate retries, backfilled counts, increments, tombstones, expiry, and settings UI. The expiry check takes about three minutes with the shortened window configuration.

Previously green suites are run unchanged with `node m7/regressions.mjs`, which writes `m7/regression-results.json`. They require the app on 49301, the backend on 49300, the existing push seam worker, and an isolated development backend on 49304 for M8's synthetic aging test. Seed a new replay cache for M6. Start the push worker using the published service-token command with `--release m7/deployment`; keep its token private. M7 acceptance reruns these suites and validates their retained results.

Prepare the separate poll conversation with `node m7/prepare-choreo.mjs`, then run `node m7/choreo.mjs`. This invokes the frozen `choreography.mjs m7` as the sole selected segment, with its existing schema-validation loader and explicit adapter. It writes `m7/choreography.jsonl`. The poll UI uses generic message/option identities; the adapter points to the prepared fixture.

The post-migration comparison is captured before regression suites and browser reads legitimately advance receipt state or create new data. The starter fixture contains text messages; its message media, message reactions, and delivered/read marks are empty. The snapshot retains those fields exactly and also hashes its populated post/avatar assets. Additional M7 mutation tests exercise populated message media.
