# Clique

Clique is an Expo Router social feed and messenger backed entirely by Quarry on public `snapback4@0.4.3`. The native replica arm is public `snapback4-expo@0.4.3`. M1–M6 and M8 are implemented; M7 is reserved for a separate session.

## Run locally

Use Node 24.18.0. All commands run from this lane.

```sh
npm ci
npm ci --prefix choreography
node scripts/configure.mjs
npx snapback4 check
npx snapback4 dev --port 49360
```

In another terminal:

```sh
npm run seed -- --segment m1
npm run seed -- --segment m2
npm run seed -- --segment m3
npx expo start --web --port 49361
```

Seeds use real password authentication, uploads, and application mutations. Each installed segment is idempotent. Fixtures are under the read-only `instrument/fixtures` snapshot. The app includes public profiles, following/global/trending feeds, posts with images or video, private DM/group messaging, receipts, quoted replies, reactions, edits/deletion, view-once photos, disappearing messages, search, and chat customization.

The default config selects the fixture's shortened windows: edit 60 seconds, delete 120 seconds, disappearance 180/300 seconds for the 24h/7d controls, and digest every 120 seconds. Production configs are retained beside them. To generate production rules, set `CLIQUE_WINDOWS=config/windows.production.json` and `CLIQUE_DIGEST=config/digest.production.json` when running `scripts/configure.mjs`, then check/restart. The server enforces every deadline.

## Verification

```sh
npm run acceptance -- --milestone m5
node scripts/setup.mjs
node scripts/choreo.mjs m5
```

Replace m5 with m1, m2, m3, m4, m6, or m8. The wrapper supplies `CHOREO_BASE_URL=http://localhost:49361`, fixture credentials, and lane-local JSONL paths. Suites and choreography must run sequentially on the starter instance because they deliberately mutate it. Coverage manifests map assertion IDs to executable tests. Native artifacts are under `artifacts/mN-ios`; these are Hermes exports, not simulator proofs.

```sh
npm run build:web
node scripts/static-server.mjs
```

The exported offline shell runs on port 49363. Visit online once to acquire data and viewed ordinary media. The SDK persists the replica and transport outbox; `src/OutboxView.ts` keeps only account-scoped presentation metadata for writes without predicted rows. View-once bytes never enter the durable media cache. Native sessions use SecureStore and the installed native replica where available.

## Push and scheduled digest

```sh
npx snapback4 token --service pusher > .push-token
chmod 600 .push-token
node scripts/push-worker.mjs
```

The provider seam appends idempotent payloads to `evidence/push.jsonl`. No APNs/FCM service is claimed. Schedule admission, per-period deduplication, unread authorization, and expiry are server-owned. The worker's durable provider log deduplicates effect IDs. Run `scripts/digest-proof.mjs` for the real-time unattended two-period test; its pending receipt announces a safe mid-period backend restart window.

Third-party protocol documentation and a dependency-free Node example are in [API.md](API.md) and `scripts/custom-client-demo.mjs`.

## Scale replay

Use a fresh directory under this lane, copy the application's `snapback/*.q` there, and link this lane's installed `node_modules`. Start its CLI from that directory on port 49362 with `--replay`. Do not seed the scale workload into the interactive instance.

```sh
BACKEND_URL=http://127.0.0.1:49362 REPLAY_INSTANCE=scale-instance \
REPLAY_RECEIPTS=evidence/scale-replay.jsonl \
REPLAY_SESSIONS=evidence/scale-sessions.json \
node scripts/replay.mjs instrument/fixtures/starter-m1.log \
  instrument/fixtures/starter-m2.log instrument/fixtures/starter-m3.log \
  instrument/fixtures/scale.log
```

Each action waits for an authoritative receipt. The adapter implements all 13 verbs, pauses at both checkpoint markers, verifies manifest state, and records read probes. Read-only CLI SQL is used only for independent verification, never for importing fixture data. Replay disables new notifications and schedule admission. `evidence/sample-conformance.json` records the 50-action conformance run. Session and mutation-argument files are local ignored artifacts and must not be published.

See `run-log.md`, `diary.md`, `essay.md`, and `final-report.md` for the run's evidence and limits.
