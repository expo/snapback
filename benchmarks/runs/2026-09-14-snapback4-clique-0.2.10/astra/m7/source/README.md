# Clique

Expo Router client and a Quarry backend on exactly `snapback4@0.2.10` and `snapback4-expo@0.2.3`.

Use Node 24.18.0. Install with `npm ci`, then `npx snapback4 check`.
Run `npm run backend` (49340) and `npm run web` (49341). Scale uses 49342, its optional web client 49343, and isolated write probes 49344. All ports stay inside the assigned range.
Install starter segments in order with `npm run seed -- --segment m1`, then m2 and m3 as implemented. All actions use password authentication and the app's actual upload/mutation path.

`npm run acceptance -- --milestone m1` (or another implemented milestone) writes its suite receipt and complete assertion coverage under `evidence/`. `node scripts/choreo.mjs m1` runs the copied frozen Playwright harness against `http://127.0.0.1:49341` and retains JSONL receipts. Install the copied harness with `npm ci --prefix choreography` and its Chromium with `cd choreography && npx playwright install chromium`.

The instrument snapshot omits `../../lib/json-schema.mjs`, imported by its setup-identity code. A documented Node loader provides only that missing dependency using the harness's pinned AJV2020 and its unchanged complete JSON schema. No browser check is bypassed. The supported choreography adapter resolves fixture paths inside this lane.

Native build artifact: `npx expo export --platform ios --output-dir artifacts/mN-ios`. The app imports the pinned native device opener and uses SecureStore for native session persistence. Hermes exports are not simulator proofs.

The web app explicitly persists sessions in localStorage and uses a Snapback wasm replica persisted by IndexedDB. Only fixture credentials are used by seed and proof tooling, outside the app bundle. Backend logs, package integrity, server PIDs, diagnostics and milestone proof files are retained in this lane. `run-log.md` and `diary.md` record limitations and corrections.

Window configuration is read by `scripts/configure.mjs`, which emits Quarry helpers and the matching client affordance configuration. `npm run backend` uses production defaults (15-minute edits, 60-minute deletion). `npm run backend:grading` selects the frozen shortened values (60-second edits, 120-second deletion). This lane's proof runs use the shortened configuration. Enforcement remains in Quarry against `now`; neither mutation accepts a caller-supplied window or clock. Use `CLIQUE_WINDOWS_CONFIG` to select an explicit file.

M6 provider seam: Quarry sends a durable `pushCandidate`; the supervised worker relays it with an idempotency key to service-only `push.dispatch`. That Quarry mutation checks server connection presence and emits `notify`. The worker appends one payload per effect ID to `evidence/provider.jsonl`. This keeps presence out of the predictable message mutation. Presence eligibility is evaluated at dispatch, normally immediately after commit; the server's disconnect grace is 35 seconds. Provider delivery beyond this log is out of scope.

`API.md` documents the dependency-free token protocol. `scripts/replay.mjs <action-log> <receipt-jsonl>` implements every frozen action verb, with authoritative settlement before advancing. The 50-action sample runs on the development instance in M6 acceptance. `scripts/scale.mjs` requires `CLIQUE_BACKEND_URL=http://127.0.0.1:49342` and a fresh `scale-instance` running the finished Quarry schema with `replayMode(): true`. It seeds all three starter segments, checks the scale hash, records its own clock and per-action receipts, pauses at both checkpoints for manifest verification and diagnostic probes, and verifies the final state. The private grader sample remains external. Scale execution is deferred until M8 is implemented so analytics can be measured at every checkpoint; adapter authoring and sample conformance remain inside M6.

M8 Insights totals include all authored post entities (including direct replies); the separate replies-received total counts replies to the account’s posts. Counts and UTC daily buckets are maintained by the backend. Trending ranks only original posts by active likes, then arrival time, with a 24-hour expiry. Pull to refresh or use the visible Refresh buttons.

The digest configuration is read at startup: `CLIQUE_DIGEST_CONFIG=config/digest.shortened.json` selects two-minute periods; the production default is daily at 08:00 UTC. Quarry’s durable chunked job scans activity and emits once per user per period. Counts exclude tombstones, expired messages and messages outside current memberships. New posts count original posts by followed authors; unread messages count only arrivals in that period that remain unread. Zero-activity periods produce no payload. The schedule and transactional job cursor survive backend restart. `replayMode(): true` disables candidates and digests in the fresh scale instance.

The local SDK retains viewed ordinary media and the durable outbox; view-once bytes are never persisted. New media uploads require a connection (the published upload API is online-only). Text, likes and reactions queue through the local mutation path. `EXPO_PUBLIC_BACKEND_URL` selects an explicit server at bundle time.

## M7 day-2 evolution

The fresh starter instance is `m7/instance` on port 49340; it is separate from
the inherited development and scale databases. `m7/pre-snapshot/` contains
hash-manifested, per-persona M6 API exports before schema changes, and
`m7/post-migration-snapshot/` plus `m7/evidence/snapshot-comparison.json` prove
immediate preservation after migration.

For a pre-M7 dev instance, stop its recorded server PID, then run
`node m7/migrate.mjs <lane-relative-instance-directory>`. This uses Snapback's
published schema adoption and `run counts.backfill` path: add nullable
`messages.countWeight`, backfill existing rows in a Quarry job, then require
that column and introduce the maintained aggregate. Start the instance with
`snapback4 dev --port 49340 --no-watch` from its directory. No database edits,
source-checkout code, or privileged HTTP migration endpoint is used.
`conversation.messageCount` is an API field backed by that persisted aggregate,
not a second manually synchronized counter column. This also supplies zero for
empty conversations. Expiry follows the documented one-second aggregate sweep.

Use Create poll inside a group conversation; tap an option to set/change a
vote. Chat settings displays Messages. Existing message deletion and expiry
apply to polls. The pinned UI kit supplies the poll compose/display controls.

`npm run acceptance -- --milestone m7` runs M7 and all previously green suites;
its regression subprocesses use `m7/instance` as their working directory so
SQL inspection, provider logs, and the M8 restart proof target the fresh instance.
The instance's linked scripts and dependencies keep the previous assertions
unchanged. Run `node scripts/choreo.mjs m7` for the sole M7 segment after preparing
a fresh group/poll with the adapter's option keys. Its fixture setup is
`node m7/prepare-choreography.mjs`. The M7 suite coverage is retained under
`evidence/m7-coverage.json` and copied into `m7/` for the phase report.

M7 backend note: poll tallies use bounded, indexed counts of the durable vote
rows. An initial compound-key `maintain` produced an ID that Snapback accepted
on writes but rejected during a later schema adoption. The retained minimal
reproduction is `m7/reproduce-aggregate-id.mjs`; its diagnostics are under
`m7/evidence/aggregate-id-repro.json`. Removing only that derived tally cache
allowed adoption and preserved the actual votes. Conversation message counts
still use the simpler single-conversation-key maintained sum.
