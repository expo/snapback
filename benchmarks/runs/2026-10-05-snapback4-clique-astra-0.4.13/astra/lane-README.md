# Clique

Expo Router client with a Quarry backend on the exact public `snapback4@0.4.13` and `snapback4-expo@0.4.13` packages. Node 24.18.0 is required.

Install with `npm ci`, then `npx snapback4 check`. Run the backend with `npx snapback4 dev --port 49360`. Build the web client with `EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:49360 npx expo export -p web --clear --output-dir web-dist`, run `npx snapback4 web-shell web-dist`, then `node scripts/serve-web.mjs` on port 49361. Development can use Expo on the same port after stopping the static server.

Install the copied choreography dependencies with `npm ci --prefix choreography` and its browser with `npx --prefix choreography playwright install chromium`.

- `npm run seed -- --segment m1` replays the fixture registrations and profiles through the app UI and its authenticated write path. Repeating it preserves profile and avatar identities.
- `npm run acceptance -- --milestone m1` runs browser acceptance and writes suite status and assertion coverage under `evidence/`.
- `node scripts/setup-identity.mjs` records the local package and toolchain identity.
- `CHOREO_BASE_URL=http://127.0.0.1:49361 node scripts/choreography.mjs m1` runs the unmodified frozen two-client choreography. The wrapper reads fixture credentials without printing them.
- `SNAPBACK4_NATIVE_SMOKE=off npm run export:ios` exports the iOS Hermes bundle. Simulator smoke is outside this run's required proof scope.

Accounts use the backend's password identity. First signup continues to profile onboarding. Profiles and avatars are discoverable to authenticated accounts; only their owners can modify them. The client restores sessions using explicit browser storage or native SecureStore and opens the package's web/native replica.

The authoritative instrument is read-only. The copied choreography requires the unchanged adjacent metering helper files included here. Fixture locations are passed using its supported adapter.

See `run-log.md` for the execution record and evidence paths. A feature is not claimed complete until its milestone has passing suite and choreography receipts.

M2 adds Following and Global feeds, media posts, follows, likes, attributed reposts, and direct replies. Seed and acceptance accept `m2`. Pages contain 20 events; scrolling loads the next page. Following offers a complete historical reader after its materialized window. Backend mutations use explicit set/clear intents for interaction retries.

M3 adds `/chats`, unique DMs, distinct groups, admin membership controls, retained history, typing and receipts. M4 adds media messages, arbitrary emoji reactions, caption/text editing, and delete-for-everyone. Seed accepts `m3`; later suites replay all three installed starter segments.

The lane uses the frozen shortened windows for grading. `node scripts/configure-windows.mjs shortened` reads the exact fixture JSON and writes Quarry constants; `node scripts/configure-windows.mjs production` selects the production windows. Run `npx snapback4 check` and rebuild after switching. Authorization and deadline checks run in backend mutations. The acceptance test advances this development server's clock to test late-write refusal; its clock is separate from wall-clock run measurements.

M5 adds disappearing settings, one-view photos, chat colors/backgrounds, group name/description editing, and `/search`. Search offers people, all messages grouped by chat, and a conversation-specific scope. Matching uses the backend's normalized word-prefix index; incomplete device/history coverage is shown explicitly. A message captures its deadline at send time, so changing a setting does not rewrite older deadlines. The server expires rows and revokes their media; the UI also honors known deadlines while reads refresh.

The one-view photo viewer opens only on a user action and owns its media handle outside the virtualized list. Closing revokes the local handle. The server independently rejects a subsequent fetch by that principal.

M6 adds SDK-owned durable offline writes, account-scoped send references, queued interaction indicators, and a logged notification provider (`data/push-log.jsonl`). See `API.md` for the token-only Node API. `node scripts/sample-conformance.mjs` validates and applies the frozen 50-action sample through real signup and public mutations. `scripts/scale-replay.mjs` targets a separate fresh replay instance on 49362 and auth web client on 49363; it never backdates fixture records and records its own clock, per-action receipts, exact invariant checks, and public continuity probes. Hidden grader probes are not supplied and are not claimed.

M8 adds `/insights`, a Trending feed, cross-device unread counts, and an autonomous digest job. Insights uses maintained server aggregates, including zero-filled UTC calendar days. Trending ranks only original posts in a finite server-time 24-hour window. `digest-config.json` records the fixture's 120-second schedule; `node scripts/configure-digest.mjs --production` switches to the supplied daily 08:00 UTC config, then run `snapback4 check`. The digest uses recipient-authorized queries, current membership/read watermarks, expiry and tombstone filtering, a committed per-user period cursor, and effect idempotency keys. Its following-post count follows the app's feed semantics, including the recipient's own original posts and excluding repost events/replies. Scale mode is `snapback4 dev --replay`, which suppresses new effects and holds schedules.

Web export clears Metro's transform cache so changing `EXPO_PUBLIC_SNAPBACK_URL` cannot retain a previous backend binding. Main client: `EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:49360 npm run build:web`, then `node scripts/serve-web.mjs` on 49361. Replay client: export with `EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:49362 npx expo export -p web --clear --output-dir replay-web`, then `npx snapback4 web-shell replay-web`. Its static server uses `WEB_ROOT=replay-web WEB_PORT=49363`. Check the generated bundle's origin before registration. `scripts/start-replay.mjs` refuses an existing replay store. A retained interrupted replay continues with `node scripts/scale-replay.mjs --resume`; it never resets its clock or accepted prefix.
