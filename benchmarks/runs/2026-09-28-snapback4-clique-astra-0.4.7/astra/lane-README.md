# Clique

Expo Router client with a Quarry backend on the exact public packages
`snapback4@0.4.7` and `snapback4-expo@0.4.7`.

Use Node 24.18.0. All commands run from this lane.

```sh
npm install
npx snapback4 check
npx snapback4 dev --port 49360
```

In another terminal:

```sh
npx expo export -p web --output-dir dist
node scripts/serve.mjs
npm run seed -- --segment m1
npm run seed -- --segment m2
npm run acceptance -- --milestone m1
npm run seed -- --segment m3
npm run acceptance -- --milestone m2
npm run acceptance -- --milestone m3
npm run acceptance -- --milestone m4
node scripts/choreo.mjs m4
```

Web is `http://127.0.0.1:49361`; native uses backend port 49360.
The copied choreography has its own `npm install` and Playwright Chromium.
The wrapper supplies `CHOREO_BASE_URL`, fixture credentials, the explicit fixture
adapter, setup identity, and hash-bound suite evidence. Receipts live under
`evidence/`. Do not regenerate the served web directory during verification.

The seed applies fixture actions through authenticated app operations, with
per-action settlement and per-segment installation journals. Keep journals with
the corresponding backend state; a fresh instance must use fresh journals.
No privileged database seed endpoint is used.

Native artifacts are under `artifacts/mN-ios/`; rebuild with
`npx expo export -p ios --output-dir artifacts/mN-ios`. These are Hermes bundle
exports, not simulator interaction proofs.

`run-log.md` records process IDs, lookups, corrections, and milestone boundaries.
Only a passing suite plus the frozen choreography segment establishes green.

Window settings live in `config/windows.production.json` and
`config/windows.shortened.json`. Run `CLIQUE_CONFIG=shortened node
scripts/configure.mjs` for the fixture grading profile, or omit the environment
variable for production windows, then run `npx snapback4 check`. The generated
Quarry constants enforce edit and delete windows using server time.

M5, M6 and M8 follow the same commands (`npm run acceptance -- --milestone mN`,
then `CHOREO_TIMEOUT_MS=30000 node scripts/choreo.mjs mN`). M7 is intentionally
excluded from this continuous run. `npm run build:web` also generates the
public offline shell. The SDK replica holds private data and viewed media;
view-once assets are never prefetched or durably cached.

Both window and digest schedules are selected by `scripts/configure.mjs`.
The shortened digest is 120 seconds; production runs daily at 08:00 UTC.
Scheduled jobs and message notifications emit through the same provider seam.
To run its logging provider, issue a service token to a private file and start
`node scripts/push-worker.mjs` (see its file paths). Service tokens are never
used for user actions. Provider receipts are `evidence/push-payloads.jsonl`.

The user-scoped third-party API and runnable Node example are in [API.md](API.md).
The replay adapter is `scripts/replay.mjs`; its sample receipts and independent
intent checks are in `evidence/replay-sample/`. `scripts/scale-run.mjs` creates
an isolated backend on 49362 and web shell on 49363, installs the three starter
segments, then replays the pinned scale log. It refuses an existing instance,
records every authoritative action receipt, pauses for manifest verification
and read-only builder probes at both checkpoints, and preserves the final
store. Hidden grader probes are not read or claimed. Checkpoint verification
and probes are excluded from the four-hour replay cap.

The additional `scripts/check-cold-offline.mjs` verifies browser restart with a
pending queue. `scripts/check-digest.mjs` verifies scheduled payloads with all
clients closed, a controlled restart of this lane's backend, and a quiet next
period. These scripts write their own evidence; they are separate from frozen
choreography.

This is a local production-shaped implementation, not a hosted deployment.
Use the published deploy/serve workflow for deployment; the developer server
explicitly enables loopback development facilities. Private session files,
replica test profiles, and backend stores are excluded from version control.
