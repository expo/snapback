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
