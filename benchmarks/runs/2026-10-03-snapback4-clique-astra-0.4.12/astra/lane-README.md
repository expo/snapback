# Clique

Expo Router client and Quarry backend. Install with `npm ci` using Node 24.18.0. Exact backend pins are `snapback4@0.4.12` and `snapback4-expo@0.4.12`.

Run `npm run backend` on port 49360. Run `npm run build:web`, then `node scripts/serve.mjs` to serve the exported, offline-capable web shell on port 49361. The client defaults to that backend; override with `EXPO_PUBLIC_SNAPBACK_URL` before export if needed. Native uses SecureStore and the installed Expo replica module; browsers use IndexedDB and explicit localStorage session persistence.

Run `npm run seed -- --segment m1` then `m2` when installed. Seeds replay the frozen fixture action logs through password auth and ordinary mutations; repeat runs preserve installed entities. Fixture credentials remain in the instrument, outside client bundles.

Run `npm run acceptance -- --milestone m1` (or another implemented milestone). Evidence and assertion-to-test coverage are written under `evidence/`, with `suite-status.json` linking the result. Install the copied choreography dependencies with `npm install --prefix choreography`, install Chromium there, then run `node scripts/setup-identity.mjs` and `node scripts/choreo.mjs m1`. That wrapper supplies `CHOREO_BASE_URL=http://127.0.0.1:49361` and fixture credentials without printing them.

Export native artifacts with `npm run export:ios -- --output-dir artifacts/mN-ios`. Exports contain Hermes bytecode. This is bundle evidence, not a simulator execution claim.

Generated `snapback/generated/api.ts` comes from `npx snapback4 check`; the backend's source of truth is `snapback/*.q`. Runtime data is under `.snapback4/`. Build artifacts, validation logs, and retained harness receipts stay in this lane. `run-log.md`, `diary.md`, and `milestones.json` record progress and errors.

M5 adds row-declared expiry (`messages.expiresAt`), once-only image placements, synced chat identity/color/background, and ordinary indexed search. The server uses generated constants from the fixture window configuration; run `CLIQUE_WINDOWS_CONFIG=config/windows.shortened.json node scripts/configure.mjs` for three/five-minute grading. The production backend command regenerates production windows by default. Search labels device-only and incomplete coverage rather than claiming a full corpus. Expiry is not driven by the app: the engine hides expired rows and sweeps their assets on its own clock.

All requested continuous-session milestones are implemented: M1, M2, M3, M4, M5, M6, and M8. M7 is intentionally excluded for the later fresh-session run. Seed starter segments in order (`m1`, `m2`, `m3`); later milestones add no starter segment. Run each matching acceptance and choreography segment. M8 acceptance owns a fresh temporary backend on 49363 for seeded aggregates and isolated clock tests; keep that port free. `scripts/probe-digest.mjs` uses 49364 for its real-clock schedule/restart proof.

For grading windows and digest cadence, start the backend with:

```sh
CLIQUE_WINDOWS_CONFIG=config/windows.shortened.json CLIQUE_DIGEST_CONFIG=config/digest.shortened.json npm run backend
```

Production defaults are the fixture's 15-minute edit, 60-minute delete, off/24-hour/7-day expiry, and 08:00 UTC daily digest. The supervised worker logs provider receipts in `evidence/push-provider/` and convenience JSONL in `evidence/push.jsonl`. The ledger and per-effect receipt make retries idempotent at this logged provider seam; APNs/FCM transport is deliberately outside scope.

See `API.md` and `scripts/custom-client-demo.mjs` for token-only third-party access. `scripts/sample-replay.mjs` checks all 13 fixture verbs and resulting state. `scripts/scale-replay.mjs` requires a separate fresh backend in `scale-instance/` on 49362 started with `snapback4 dev --port 49362 --replay`; it seeds the starter baseline, replays the pinned log serially, verifies checkpoint manifests, and records its own clock. Never run it against the acceptance database. `scripts/verify-scale-sql.mjs` independently checks the completed corpus through the published read-only SQL inspection command.

`artifacts/mN-ios/` contains every milestone's Hermes export. No simulator proof is claimed. The browser cold-offline and durable-restart probes are supplementary evidence, not substitutes mislabeled as native execution.
