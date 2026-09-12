# Build and run

Node 24.13.1, npm, Expo Metro, TypeScript, and Playwright 1.62.1 are used. No new esbuild invocation or platform patch was introduced. The supplied M1 profile/auth shell and frozen presentational kit are prerequisites, not a from-zero build.

```
npm ci
npm run check
npm run typecheck
npm run build:web
node scripts/build-shell.mjs
node scripts/start-owned.mjs serve . 54900
node scripts/wait-server.mjs http://127.0.0.1:54900
# Only on a fresh database:
node scripts/seed-starter.mjs
node scripts/selected-checks.mjs
node scripts/controls-check.mjs
node scripts/custom-client-demo.mjs
```

The lockfile still references only the authorized immutable old-package tarball. Browser tests need the installed Playwright Chromium. `start-owned.mjs` prints and records the exact PID. Stop only that PID using `node scripts/restart-owned.mjs PID`. The server launcher returns before readiness, hence `wait-server.mjs`.

`artifacts/starter-app/` contains a separate fresh starter schema/database with DM 6/group 9 and all 52 starter social actions text-projected. Start it with `node scripts/start-owned.mjs serve artifacts/starter-app 54902`; do not rerun the fresh seed into its populated DB. `evidence/fresh-starter-{alice,bob,carol}.json` are its initial snapshots. The coordinator should add the requested populated controls and capture new snapshots before M7.

Large projection preparation:

```
node scripts/project-fixture.mjs
python3 scripts/verify-projection.py
# prepare-scale expects its output directory not to exist
node scripts/prepare-scale.mjs
node scripts/start-owned.mjs dev artifacts/scale-app 54901
node scripts/wait-server.mjs http://127.0.0.1:54901
node scripts/measure-acquisition.mjs
node scripts/paging-measure.mjs
node scripts/verify-server-fixture.mjs
```

The supplied `artifacts/scale-app` is already prepared and populated. Its development seed is supported public `seed({personas,rows})`, not direct SQLite writes. It deliberately uses development persona identities and loader-assigned authoritative seed timestamps. All diagnostic sends are retained. Do not label this public-mutation replay throughput or canonical O5.

After stopping its exact recorded owner PID, inspect storage with:

```
python3 scripts/storage-inspect.py artifacts/scale-app/.snapback3/store.sqlite evidence/storage-scale.json
```

Owner shutdown may automatically checkpoint the WAL; reports must retain pre-stop file sizes and disclose this boundary. No explicit checkpoint/vacuum/compaction command is used.

The frozen instrument remains read-only. Authored drivers preserve original selected assertion IDs with browser/text qualifiers. Historical baseline `acceptance.mjs` is not the selected suite. No full frozen milestone suite or weighted score is claimed. `scripts/build-schema.py` and `scripts/add-social.py` are retained authoring scratch scripts, not repeatable build steps; the checked-in `.q` files are the authoritative final source.

## M7 prepared-state build and verification

Only ports 54900–54903 are assigned for M7. The database is already populated and migrated; do not seed, reset, reinstall a starter DB, or rerun historical fixture preparation. The fixed installed package is unchanged. Build the current app with:

```
npm run check
npm run typecheck
npm run build:web
node scripts/build-shell.mjs
node m7/start-owner.mjs
node scripts/wait-server.mjs http://127.0.0.1:54900
```

`m7/start-owner.mjs` records its exact PID and serves this lane at 54900. The completed session's owner and worker are stopped. Before future shutdown, record that run's worker child PID as well; stop only owned PIDs. `m7/stop-owner.py` checks recorded process identities and signals exact PIDs.

The completed migration evidence is `m7/migration.json` (including the failed account-census tail) and `m7/migration-verification.json`. `m7/migrate.mjs` is the retained original one-shot driver, not a rerunnable reset or an instruction to migrate again. `m7/verify-migration.mjs` is a read-only census using actual fixture handles. Both original chunks committed. `m7/compare-snapshots.py` compares the immutable pre-change snapshots with the immediate post-change exports and checks required-field coverage, including nested controls.

Tests that mutate data must respect the recorded checkpoint order. Do not rerun `m7/poll-browser-attempt-01.mjs` into this changed state: its baseline is the original group9, and its retained pluralization error is intentional evidence. `m7/poll-browser.mjs` is the corrected same-poll resume driver, with populated B2 preconditions. The exact original run commands and all attempts are in `m7/commands.jsonl`; results and receipts are retained separately. The API boundary controls create their own new conversation after the canonical group10/group11 checkpoints. The frozen canonical full browser segment was not run; these are authored selected web checks using the frozen poll components and option-ID semantics.

The unchanged `scripts/selected-checks.mjs` and `scripts/controls-check.mjs` were rerun on the new bundle. `m7/custom-client/check.mjs` reruns the API checks from a separate offline npm install of the fixed package. Its latest-message expectation comes from the recorded new text receipt, replacing the prior driver's now-stale last-fixture-message expectation without changing product behavior. `m7/updated-build-manifest.json` binds source and build hashes; `m7/final-api-audit.json` verifies served bundle equality and final stored counts. Regression outputs are copied into `m7/` for review.
