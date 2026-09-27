# Clique

Expo Router client and a Quarry backend using exactly `snapback4@0.4.4` and `snapback4-expo@0.4.4` from npm.

Use Node 24.18.0. Install with `npm ci`, then `npx snapback4 check` to generate the typed API. Run `npx snapback4 dev --port 49360` and `npx expo start --web --port 49361`. The client defaults to that backend URL; set `EXPO_PUBLIC_SNAPBACK_URL` when exporting for a different endpoint.

Run `npm run seed -- --segment m1` (then each implemented starter segment in order). Seeds use real password signup/login, uploads, and application mutations. Fixture IDs map deterministically to valid engine IDs. Repeating an installed segment keeps existing entities and does not repeat set-state intents.

Run `npm run acceptance -- --milestone m1` for the coverage-checked suite. Suite receipts and assertion mappings are in `evidence/`. `node scripts/choreo.mjs m1 <attempt>` runs the copied frozen choreography with the lane URL, fixture credentials, setup identity, and suite linkage. The harness's sibling metering modules are also copied unchanged. Install its dependencies with `npm ci --prefix choreography` and provision Chromium with its Playwright CLI.

Native proof in this run is an iOS Hermes bundle export under `artifacts/mN-ios`. It is not a simulator or physical-device execution claim. Browser sessions persist explicitly through localStorage; native sessions use SecureStore. `createApp` selects the browser replica or installed Expo native device, with online fallback in Expo Go. Backend production deployment uses the package's `deploy` and `serve` commands; `dev` is loopback development only.

See `run-log.md` for clocks, diagnostics, process IDs, and evidence; `diary.md` records milestone experience. Only milestones with both passing suite and choreography receipts are green.

Run acceptance and choreography serially: both write real application data, and unrelated feed activity can move a choreography fixture past the first page. Freeze edits during a choreography run. The setup identity hashes installed executable artifacts; it does not claim an independently qualified prepack closure.

Verification uses the production web export served on port 49362 (`node scripts/serve-web.mjs`) and the Quarry backend on 49360. Run `npm run build:web` after client changes. `CHOREO_BASE_URL=http://127.0.0.1:49362 node scripts/choreo.mjs m4 1` runs the copied frozen harness. Receipts live in `evidence/`.

Server edit/delete and disappearing durations come from `config/windows.json`, copied from the shortened fixture config. `npm run check` regenerates Quarry constants. For production durations, run `CLIQUE_WINDOWS=config/windows.production.json npm run check` before starting the backend. Authorization and all time-window checks execute in Quarry against server time.

M5 adds member-synchronized chat settings, server-deadline disappearing messages, one-view photos, and people/chat/global message search. A one-view photo is fetched only on an explicit open, kept in a transient viewer handle, and revoked on close. Ordinary viewed media uses the replica's bounded cache. The header distinguishes initial offline preparation from a ready device; offline search applies to content the device has acquired.

Long-press a message for its scoped actions, or use its inline controls. Group name/description and disappearing settings require an administrator; the server checks permission even if a custom client bypasses the UI. The shortened `24h` setting expires new messages after 180 seconds; `7d` uses 300 seconds. Existing messages retain their original deadlines.

M6 adds `API.md`, the token-only Node demo, `scripts/replay.mjs`, and `scripts/scale-run.mjs`. Replay preserves server-arrival time and waits for each authoritative receipt. Run full scale only against a fresh seeded instance with `snapback4 dev --replay` on an allowed port. Its checkpoint verifier reads actual public exports and authorized inbox/history pages. Sample conformance uses the frozen grammar validator plus fifty settled writes and resulting-state assertions.

The push provider seam is `node scripts/push-worker.mjs`. Mint its token while the backend is stopped: `npx snapback4 token --service pusher > .snapback4/pusher.token`, protect that file (`chmod 600`), restart the backend, then launch the worker. It logs payloads to `evidence/push.jsonl` and deduplicates provider retries. Never ship this token to a client. The provider is a log seam; real APNs/FCM transport is intentionally outside the brief.

`config/digest.json` selects the fixture's 120-second digest schedule. `CLIQUE_DIGEST=config/digest.production.json npm run check` generates the daily 08:00 UTC schedule; `CLIQUE_WINDOWS=config/windows.production.json npm run check` selects production edit/delete/expiry windows. Keep these environment selections when starting through `npm run backend`, which regenerates both configurations. Digests run in Quarry without a connected client, persist per-user period progress, and exclude private, read, deleted and expired message activity. `--replay` suppresses effects and holds schedules.

Insights and Trending query server-computed aggregates; refresh buttons and pull-to-refresh reload them. The replica keeps ordinary viewed media, while view-once handles remain transient. Pending sends come from durable outbox custody, including intents that cannot yet predict a row. Native Hermes exports are in `artifacts/mN-ios`; simulator execution is not claimed.

When exporting for a different backend endpoint, set `EXPO_PUBLIC_SNAPBACK_URL` explicitly for the export command and use Expo’s `--clear` option. Verify the resulting endpoint before running scale browser probes. The retained final scale store is immutable proof data; mutating performance probes use a stopped-store copy. See `final-report.md` for the measured scale limits and `evidence/server-shutdown.json` for cleanup.
