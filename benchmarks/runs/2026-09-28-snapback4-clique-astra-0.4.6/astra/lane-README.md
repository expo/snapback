# Clique

Expo Router client with a Quarry backend, pinned to `snapback4@0.4.6` and `snapback4-expo@0.4.6`. Use Node 24.18.0. All commands run from this lane.

```sh
npm install
npx snapback4 check
npx snapback4 dev --port 49360
# In another terminal:
npm run build:web
node scripts/serve-web.mjs
npm run seed -- --segment m1
npm run seed -- --segment m2
npm run seed -- --segment m3
npx snapback4 token --service pusher > .snapback4/pusher.token
chmod 600 .snapback4/pusher.token
node scripts/push-worker.mjs
# In another terminal:
npm run acceptance -- --milestone m8
node scripts/choreo.mjs m8
```

The web client runs at http://127.0.0.1:49361. The copied choreography uses that address explicitly. Starter credentials are in `instrument/fixtures/personas.json`. Seed segments are idempotent and must be installed in order.

`node scripts/configure.mjs shortened` selects the fixture edit/delete/expiry windows; `production` restores production durations. Run `npx snapback4 check` after changing configuration. The development server adopts the schema automatically. `node scripts/verify.mjs mN` checks TypeScript, runs the milestone suite, exports an iOS Hermes bundle, and runs the matching frozen choreography. Artifacts live under `artifacts/`; logs and receipts live under `evidence/`.

Backend rules authorize every operation. The replica stores acquired chat history and ordinary viewed media, queues writes, and respects server revocation. Search labels its limited device horizon offline. View-once photos are fetched only on explicit open and their transient handle is revoked on close. Expiry belongs to the schema and runs without clients.

See `API.md` for operations, `coverage-manifest.json` for suite coverage, `milestones.json` for recorded boundaries, and `run-log.md` for corrections and evidence.

`node scripts/replay.mjs sample` validates and replays the M6 conformance sample on the main instance. After M8, `node scripts/scale-run.mjs` creates a fresh `scale-instance` on port 49362, seeds the three starter segments, and runs the hash-pinned full replay with effects/schedules suppressed. It verifies all rows and the invariant manifest at checkpoints, then runs sequential probes. Results and independent replay epochs go to `evidence/scale-result.json`. Use a new `SCALE_INSTANCE` directory for an explicitly recorded fresh retry; existing instances are preserved. `node scripts/scale-summary.mjs` reports the measured read-path ratios.

After a successful full replay, `node scripts/scale-write-probes.mjs` stops only that replay's recorded server PIDs and copies its closed store into `scale-probe-instance`. The original fixture stays unchanged. The isolated server uses port 49364. `evidence/scale-celebrity-write.json` compares a 900-follower author with an actual five-follower author. The optional production web build for `scripts/scale-receipt-probe.mjs` uses `EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:49364`, `expo export --clear` and output `artifacts/scale-probe-web`, and the static server's `WEB_ROOT`/`WEB_PORT=49365` options. Probe data never belongs in the original invariant verification.

`node scripts/validate-coverage.mjs` checks each mapping against the passing named tests and validates the canonical companion manifest with the frozen instrument validator. Final diagnostic reporting distinguishes base-schema validation from unavailable native metering/driver evidence; it does not invent tokens or independent grader scores.
