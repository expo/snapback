# Clique

An Expo Router social messenger with a Quarry backend. Backend packages are pinned to public `snapback4@0.4.2` and `snapback4-expo@0.4.2`. The lane uses Node 24.18.0 and only ports 49360–49379.

## Run locally

```sh
npm install
npx snapback4 check
npm run backend
```

In another terminal, install the starter segments in order. Each segment is idempotent after installation and uses the app's real authentication, mutation and upload paths.

```sh
npm run seed -- --segment m1
npm run seed -- --segment m2
npm run seed -- --segment m3
npm run build:web
npm run serve:web
```

Open `http://127.0.0.1:49361`. Fixture accounts and passwords are in `instrument/fixtures/personas.json`; no outside identity service is needed. `npm start` runs Expo on port 49364. `npm run build:ios` exports an iOS Hermes bundle. Per-milestone exports are retained under `artifacts/m1-ios` through `artifacts/m6-ios`, plus `artifacts/m8-ios`. M7 is intentionally not implemented.

## Verification

`npm run acceptance -- --milestone mN` writes the suite receipt, coverage manifest and suite-status linkage under `evidence/`. Use m1, m2, m3, m4, m5, m6 or m8. M8's age-boundary proof uses the isolated instance created by `scripts/start-proof.mjs` and `scripts/trending-proof.mjs`; `m8-trending-clock.json` retains its proof.

`node scripts/choreo.mjs mN` runs the copied frozen harness with `CHOREO_BASE_URL=http://127.0.0.1:49361`, the fixture directory adapter, setup identity, and suite receipt. Run the matching suite first. Browser contexts use fixture credentials read from the instrument. Repeated M8 choreography consumes an unliked Alice post; the M8 suite publishes fresh normal test activity before the next run. Frozen passing attempts and their hash-matching suite receipts are under `evidence/frozen/`.

The setup identity makes no claim of independently qualified binaries or wrappers, or a locally performed package prepack. The final report distinguishes builder verification from unavailable hidden grading and harness-owned metering.

## Data and offline behavior

Application data, authorization, sync, mutations, aggregates, jobs and schedules live in `snapback/*.q`. `scripts/config.mjs` generates Quarry helpers and the digest schedule from `config/windows.json` and `config/digest.json`. The installed grading configs use 1-minute editing, 2-minute deletion, 3-/5-minute disappearance, and a 2-minute digest. Production configs are retained alongside them. Select alternate configs with `CLIQUE_WINDOWS_CONFIG` and `CLIQUE_DIGEST_CONFIG`, then run `node scripts/config.mjs` and `npx snapback4 check`.

The client uses the installed Rust replica through web Wasm and the native Expo arm, with a 64 MiB viewed-asset cache. Native sessions use SecureStore; web sessions use explicit localStorage persistence. The SDK owns queued writes and recovery. The small pending-intent journal is presentation state keyed by durable write IDs and discards confirmed intents. View-once bytes are never persisted. Messages have server-assigned conversation ordinals; receipts and unread state share account-level progress. Group membership at send time determines receipt requirements.

`snapback/worker.mts` implements the logged notification-provider seam. It records payloads in `evidence/push.jsonl`, with effect IDs as provider idempotency keys. The scheduled digest includes the viewer's implicit own-post membership in Following, just as the Following feed does. Real APNs/FCM delivery is out of scope.

## Custom clients and replay

[API.md](API.md) documents authentication, token revocation, paging, message fields, sending and polling. `scripts/custom-client-demo.mjs` is an independent raw-HTTP Node client.

`scripts/replay.mjs` implements all 13 fixture verbs and retains exact media-upload arguments for retries. Each action receives an authoritative receipt before the next begins. `scripts/scale.mjs` verifies the pinned scale hash, replays all starter segments plus the scale log on a fresh instance, pauses for checkpoint verification and read probes, and records its own clock. `--replay` suppresses notifications and holds schedules. The original run and final-schema run have separate evidence and stores; neither uses the development database as its base.

The shipped posture is a loopback development server. Native deliverables are Hermes exports; no simulator proof or hosted production deployment is claimed. See [final-report.md](final-report.md), [diary.md](diary.md), and [essay.md](essay.md) for outcomes and limitations.

Export commands clear Metro’s transform cache so changing `EXPO_PUBLIC_SNAPBACK_URL` cannot silently retain the previous backend. The separate full-scale client uses port 49366 and backend 49365.

The conversation list has a separate local membership query so an unavailable unread aggregate cannot hide offline navigation. Unread totals use maintained 128-ordinal blocks and a boundary scan; a cold offline reload omits totals that require unavailable source coverage. Background delivery acknowledgements begin after the initial snapshot is acquired.
