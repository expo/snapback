# Clique

Expo Router client with a Quarry backend, built from public `snapback4@0.4.0` and `snapback4-expo@0.4.0`. The frozen presentational kit is copied into `ui/` without application data logic.

Use Node 24.18.0. Run `npm install`, then `npx snapback4 check`. Generate server windows with `node scripts/configure.mjs` (production defaults), or `CLIQUE_CONFIG=shortened node scripts/configure.mjs` for the frozen grading configuration used in this lane. Start the backend with `npx snapback4 dev --port 49360`. Run `npm run seed -- --segment m1`, then each implemented starter segment in order. Seed actions use real password signup, authenticated mutations, upload, and durable intent IDs. Fixture timestamps never enter writes.

Export web with `npx expo export -p web --output-dir dist`, then `npx snapback4 web-shell dist`. Serve with `node scripts/serve.mjs` on port 49361. Native exports use `npx expo export -p ios --output-dir artifacts/mN-ios` and contain Hermes bytecode. Native development builds use the published Expo module; Expo Go has only the online fallback.

Run `npm run acceptance -- --milestone mN` against the running backend and web export. It writes `evidence/mN-suite.json`, the assertion coverage manifest, and `suite-status.json`. Run `node scripts/choreo.mjs mN` after the suite completes; it sets `CHOREO_BASE_URL`, reads fixture credentials outside the client bundle, and retains timestamped JSONL receipts. Do not run a mutating suite concurrently with choreography. The copied choreography requires `npm install` in its directory and `npx playwright install chromium`.

Development deployment is a local binary, not a production service. Password authentication is built in; public profile and post reads require a valid session. Browser sessions use the explicit SDK localStorage session store. Native sessions use SecureStore. Logout waits for server-confirmed account session revocation. Local data and pending writes belong to the SDK replica. Production deployment must use the documented `deploy`/`serve` path and a TLS proxy; dev intentionally admits loopback development facilities.

Only ports 49360–49379 are assigned to this lane. Server PIDs and all benchmark results are recorded in `run-log.md`. Frozen instrument files are never modified.

The final Following read uses a compact public `feedEvents` projection written atomically with originals and reposts. Sparse readers merge indexed author lanes; broad readers filter the compact chronological index. `backfillFeedEvents` is an idempotent bounded maintenance job for adopting this projection. Normal receipt counts are maintained over non-expiring rows; ephemeral receipts carry the message deadline. `chat.repairReceiptExpiry` migrates older receipt representations in bounded chunks. Neither maintenance job is a client-facing mutation.

Scale evidence is in `evidence/scale-replay*.jsonl` and checkpoint verification JSON. `scale-instance/` retains the final verified fixture state; `probe-instance/` is a separate copy modified by performance probes. `scale-initial-instance/` and `evidence/scale-initial/` preserve the first design and its results. Keep `.snapback4` stores and worker tokens private. The final report distinguishes invariant success, diagnostic performance, historical first-green milestones, and later regression passes.
