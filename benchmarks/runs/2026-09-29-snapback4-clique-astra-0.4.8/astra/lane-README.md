# Clique

Expo Router + Snapback 4, authored in Quarry. Exact backend/native pins: `snapback4@0.4.8`, `snapback4-expo@0.4.8`.

Use Node 24.18.0. On this host the login shell selects an older Volta default; prepend `/Users/ccheever/.volta/tools/image/node/24.18.0/bin` to PATH.

```
npm install
npx snapback4 check
npx snapback4 dev --port 49360
npm run seed -- --segment m1
npm run seed -- --segment m2
npm run seed -- --segment m3
npm run build:web
node scripts/serve.mjs
npm run acceptance -- --milestone m1
node scripts/choreo.mjs m1
```

Web is `http://127.0.0.1:49361`. All browser clients use the local replica and React client; native development builds use the pinned Expo native arm. Expo Go is online only. The native evidence requested for this run is an iOS Hermes export in `artifacts/mN-ios`, not simulator interaction evidence.

The frozen UI, choreography, and its relative dependencies are copied from `instrument/`. Its supported adapter points media at the lane's fixture pack. Credentials are read only by seed and harness scripts, never included in the application bundle.

Acceptance writes a coverage-validated JSON receipt in `evidence/` and updates `suite-status.json`. Choreography retains JSONL receipts and a typed observation sidecar there. A suite pass alone is never milestone green.

Messaging includes deduplicated DMs, distinct groups, role-gated membership changes, retained delivered history after leaving, ephemeral typing, quote navigation, and account-scoped receipt watermarks. Tests are repeated against the live installed segments; generated test groups are deliberately independent.

Window configuration is read from the fixture-derived JSON files in `config/`. Run `node scripts/configure.mjs production` for 15-minute edits, 60-minute deletes and 24h/7d expiry, or `node scripts/configure.mjs shortened` for grading. This generates server-side Quarry constants; the active run uses the shortened profile. `snapback4 check` and deployment/adoption apply the selected constants. Clients never supply authoritative message timestamps or window deadlines.

Chat settings include group name/description, eight accent colors, uploaded backgrounds, and disappearing-message modes. Group identity and expiry settings require an admin; DM expiry and chat appearance are member-controlled. New messages capture the selected expiry at server arrival. One-view photos use the platform's per-principal one-fetch asset column; their handles are transient and are revoked on close, expiry, deletion, membership loss, or unmount.

Search defaults to messages grouped by conversation. People and in-chat scopes use the same indexed word-prefix matching. Search runs against acquired device history while offline, with partial coverage labeled explicitly. The server remains authoritative for authorization, expiry, and media access.

Insights is linked from your own profile at `/insights`. Its six totals and seven UTC-day buckets are maintained on the server. Trending is the third feed tab. The digest schedule is generated from `config/digest.{production,shortened}.json` along with the message windows; the shortened profile fires every 120 seconds and production fires daily at 08:00 UTC. Start the logged delivery seam with `node scripts/start-worker.mjs` while the backend is running. The worker's service bearer stays in its process environment and is never printed in evidence.

`API.md` documents the custom-client contract. `scripts/custom-client-demo.mjs` uses only the published package and explicit operation descriptors. Supply credentials or a bearer through environment variables. `node scripts/replay-sample.mjs` validates and replays the fixture sample. `node scripts/replay-scale.mjs` creates its own fresh `scale-instance`, uses port 49363 and `--replay`, and records its separate clock, settle receipts, invariant checks, and probes. It deliberately refuses to reuse an existing scale store. The scale web export uses backend 49363 and is served on 49364; its read-only probe bridge is enabled only with `EXPO_PUBLIC_CLIQUE_PROBE=1`.

Saved send references expose failed/unknown outcomes without implementing a second outbox. The SDK owns durable replay. Native message custody uses SQLite rather than SecureStore's small value storage. The web transcript opts into the SDK's retained-read presentation during revalidation and labels refreshes; explicit expiry filtering and asset authorization remain active. Kept rows can briefly remain visible until the authorization re-read lands, as documented by the SDK.

The final report distinguishes web behavior, Hermes bundle artifacts, scale verification, and unavailable simulator/hidden-grader evidence. No production deployment or real push provider is claimed.
