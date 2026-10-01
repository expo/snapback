# Clique

Expo Router client with a Snapback 4 Quarry backend. Exact backend/native pins are `snapback4@0.4.10` and `snapback4-expo@0.4.10`.

Use Node 24.18.0. Install with `npm ci` and `npm ci --prefix choreography`. Install the choreography browser with `PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright" node choreography/node_modules/playwright/cli.js install chromium`.

Run `npx snapback4 check`, then `npx snapback4 dev --port 49360`. This development posture stores data under `.snapback4/`. Run `npm run build:web` and `npm run serve:web`; the client is at `http://127.0.0.1:49361`. Only ports 49360–49379 belong to this lane.

Seed each implemented starter segment in order with `npm run seed -- --segment m1` (then m2, m3). Segments use real password authentication and application mutations, with stable mutation/entity IDs. Fixture credentials remain in the instrument, outside the application bundle.

Run `npm run acceptance -- --milestone m1` (substitute the milestone). Coverage and suite receipts are written under `evidence/`, linked by `suite-status.json`. Run `node scripts/choreo.mjs m1` afterward; it sets `CHOREO_BASE_URL`, loads fixture credentials without printing them, and retains timestamped JSONL receipts. The wrapper passes only fixture paths and ordinary route inputs to the frozen choreography.

Export native bundles using `npm run export:ios -- --output-dir artifacts/m1/ios`. These are Hermes build artifacts; they make no claim of simulator execution.

The client uses the package's `createApp` with web/native devices, React reads/mutations, durable session stores, and viewed-asset retention. Quarry is the entire backend schema and authorization surface. Generated API types come from `snapback4 check`.

See `run-log.md`, `diary.md`, and the final report for execution status and limitations. A build or a passing subset of tests is never called milestone green.

For the grading windows and scheduled digest, run:

```sh
CLIQUE_WINDOWS_CONFIG=config/windows.shortened.json CLIQUE_DIGEST_CONFIG=config/digest.shortened.json npm run configure
npx snapback4 check
```

Without those environment variables, `npm run configure` selects production windows and the daily 08:00 UTC digest. A running dev server adopts the generated Quarry config. The notification worker writes deduplicated payload records to `evidence/push/` and logs them; it has no external push credentials or real APNs/FCM delivery.

M8 acceptance starts and stops its own fresh replay-mode test backend on port 49363 to isolate seeded counts and clock-advance tests from the main app. That port must be free. Its PIDs are recorded in `run-log.md`. The M8 browser choreography and real scheduled-digest proof use the main instance on 49360.

The custom-client protocol and runnable headless demo are documented in [API.md](API.md). `scripts/replay-adapter.mjs` covers all fixture verbs with authoritative settlement and JSONL receipts. To replay the scale fixture, create an empty `replay-instance/snapback/`, copy the three Quarry files there, start `npx snapback4 dev --port 49362 --replay --no-watch` from that directory, then run `node scripts/scale-replay.mjs` from the lane root. Do not point scale replay at the acceptance/choreography database. The replay validates the fixture hash, installs all starter segments, checks both checkpoints and final count invariants, and records its own clock. Then run `node scripts/scale-spots.mjs` to verify every named profile/post/message/conversation and regular media byte hash; it extends the verification end while preserving the stream end. `--replay` disables notification emission and holds schedules.

After complete verification, `node scripts/performance-server.mjs` creates a separate full-state snapshot on 49364 with its web export on 49365, recording both PIDs. Run `node scripts/scale-write-probe.mjs` and `node scripts/scale-busy-ui.mjs` against that snapshot. `node scripts/scale-cold-sync.mjs` measures a fresh published process-device replica against 49362. Finally run `node scripts/scale-performance-summary.mjs` for the measured public degradation checks. These probes do not substitute for rotated grader results. The replay adapter retains an atomic `*.assets.json` upload-intent journal alongside its receipt log; keep it when retrying the same workload.
