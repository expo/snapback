# Clique — Snapback 4 cold build

Expo Router social messenger, Quarry backend, real password sessions, browser replica, and native Expo arm. Exact backend pins: `snapback4@0.4.11`, `snapback4-expo@0.4.11`. Node 24.18.0.

```sh
npm ci
node scripts/configure.mjs
npx snapback4 check
npx snapback4 dev --port 49360
```

In another terminal, seed the installed starter segments in order (each is idempotent):

```sh
npm run seed -- --segment m1
npm run seed -- --segment m2
npm run seed -- --segment m3
npm run build:web
node scripts/serve.mjs
```

Open http://127.0.0.1:49361. Fixture credentials are under `instrument/fixtures/personas.json`; Alice is `alice@example.com` / `Alice!Clique2026`. The feed includes a chat rail, Following/Global/Trending tabs, media posts, reactions and threads. Profiles lead to Insights; chat settings expose member administration, appearance and disappearance settings.

`npm run acceptance -- --milestone mN` writes a suite receipt and assertion coverage to `evidence/`. Run `node scripts/choreo.mjs mN` afterward for frozen choreography, using `CHOREO_BASE_URL=http://127.0.0.1:49361` internally. The copied choreography has its own dependencies (`cd choreography && npm ci`). Tests for M8's old-post scenario use the isolated `trend-instance` server at port 49365 (`npx snapback4 dev --port 49365 --replay` from that directory). This keeps test clock changes out of the app and scale stores.

`npm run export:ios -- --output-dir artifacts/mN-ios` produces the iOS Hermes artifact. This run does not claim simulator execution. Browser proofs of offline history, viewed media, search, durable queue restart and ordered flush are retained separately.

`CLIQUE_CONFIG=production node scripts/configure.mjs` selects 15-minute edits, one-hour deletes, production disappearance TTLs, and the 08:00 UTC daily digest. Default shortened config uses the instrument's test windows and two-minute digest. Restart/check after changing configuration. The worker records notifications in `evidence/push-seam.jsonl`; this is the requested provider seam, not an APNs/FCM integration.

Read `API.md` for the token-only custom client. `scripts/replay-adapter.mjs` supports every frozen action verb and writes a settle receipt per action. `scripts/scale-replay.mjs` runs all starters then scale against a fresh `scale-instance` at port 49363 with `--replay`; do not point it at the app store. Verification pauses at the fixture checkpoints, independently counts stored state, checks the named envelope fixtures through the API, and records diagnostic query probes. Secret grader probes are external to this build.

The backend uses `dev` only on loopback here. Production deployment, TLS termination, backups, monitoring and real push-provider delivery are outside the requested local proof. Preserve the store and worker ledger together. `diary.md`, `essay.md`, `run-log.md`, `final-report.md`, and `evidence/` describe the run and its limitations. M7 is intentionally reserved for a separate session.

The scale web build is `dist-scale`, compiled with `EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:49363`. Serve it with `CLIQUE_WEB_DIR=dist-scale CLIQUE_WEB_PORT=49362 node scripts/serve.mjs` to inspect the scale corpus at http://127.0.0.1:49362. The ordinary client remains on 49361 against 49360. The first replay was preserved as an interrupted diagnostic attempt; the final replay uses a new empty store and the frozen full M8 schema.


Scale closure: all 167,243 actions settled on the fresh instance. The final query checkpoint exposed a raw inbox unread scan; the row-keyed count correction and complete re-verification are recorded in `evidence/scale-result.json`, including correction time and the preserved initial failure. The final source differs from the checkpoint source, so those timings are not an unchanged-generation performance curve. When exporting a web client for a different backend URL, use `EXPO_PUBLIC_SNAPBACK_URL=... npx expo export -p web --clear --output-dir dist-scale` to avoid a cached URL.
