# Clique / Snapback 2 — M7 final report

lane id: grok-clique-snapback2
model: grok-4.6
effort: xhigh
backend: snapback2-0.0.21
host: macOS arm64 (Apple M5 Max)
instrument: social-messenger@0.3.6-m8
phase: m7
start=1789075751

## Wall clock (unix epoch seconds)

| Milestone | start | first-green (suite+choreo) | end | wall s | status |
|---|---|---|---|---|---|
| M7 | 1789075751 | 1789077029 | 1789077159 | 1408 | green |

Raw session: start=1789075751. Tokens: null/advisory (grok; no harness-native per-turn meter).

## Suite and choreography

`CHOREO_BASE_URL=http://127.0.0.1:52401`, `--lane-run-id grok-clique-snapback2`, coverage format `clique-coverage-manifest.v1`.

| artifact | result |
|---|---|
| `npm run acceptance -- --milestone m7` | pass `artifacts/suite-m7.json` |
| coverage | `artifacts/coverage-manifest.json` maps m7-a01, m7-a03, m7-a04, m7-a06, m7-a07, m7-a09 (all suite-required) |
| choreography `m7` sole segment | green `artifacts/receipts-m7.jsonl` (third run; `green=true`, `nonGreenCause=null`) |
| iOS Hermes | `artifacts/ios-hermes-m7/` `.hbc` ~3.95MB (exported this session, not copied) |

## Snapshot comparison

Pre-M7 snapshot: `m7/pre-snapshot/` via `scripts/export-m7-snapshot.mjs` (custom-client API, M6 field manifest, each persona's token; token stored as sha256 only).

| persona | conversations | messages |
|---|---|---|
| alice | 2 | 15 |
| bob | 2 | 15 |
| carol | 1 | 9 |
| erin | 1 | 9 |
| dave, frank, grace, henry | 0 | 0 |

Post-successor compare (`scripts/compare-m7-snapshot.mjs`, after generation `366192ba`, before sample-50 regression replay): **pass**, mismatches=0. Evidence: `m7/snapshot-compare.json`. Pre-existing message ids, bodies, timestamps, media asset ids, and reactions intact.

## Previously-green suites

Re-run inside the M7 acceptance process after poll/count assertions: m1, m2, m3, m4, m5, m6, m8 all passed. `m7-a09` pass. Prior failures: none to preserve (continuous session recorded all green).

## Pre-M7 count structure (B8 honesty)

Yes. Inherited schema already had `maintain messageCounts: count messages by conversationId` (all rows, including tombstoned). Settings UI did not display it. M7 added `visibleMessageCounts` grouped by `conversationId, tombstone` and reads the `false` group. Successor `backfilledMaintains: 2`.

## Servers (recorded PIDs)

- snapback2 owner pid=56461 url=http://127.0.0.1:52400 (found leftover, adopted after `reset` to starter state; not scale-instance/)
- expo-web first pid=5598 listen=5645 url=http://127.0.0.1:52401 (killed to restart)
- expo-web pid=18520 listen=18549 url=http://127.0.0.1:52401
- killed at end: only these PIDs (no pkill/killall)

## Correction loops (attribution)

1. `reset --empty` dropped `appConfig`; seed died `CONFIG` — **agent-error** — evidence: seed m2/m3 reject site posts.q:5 / messages.q:69. Fix: `snapback2 reset` with seed, then starter logs.
2. Offline vote pending in UI but not reconciled — **agent-error** / **snapback2-defect** (IndexedDB `useMutation` under Playwright offline, known from M6) — evidence: first choreography MISS m7-a05. Fix: flush pending votes via token-only `createClient` on `window` online.
3. Two polls sharing `m7-option-a/b` → `sm-poll-total` strict-mode 2 elements — **agent-error** — evidence: second choreography MISS m7-a02. Fix: render one poll per option-id in the thread.

## Candid gaps

1. Quarry `maintain` cannot `where`; visible counts are a tombstone grouping, so a not-yet-purged expired row still counts until `purgeMessage` flips tombstone.
2. Expo web offline mutations still need an aux client; the packaged outbox is not a reliable Playwright-offline path.
3. Live poll tallies on the other client are a 400ms `pollFor` poll, not a trusted `useQuery` subscription (same live-join caution as M5).
4. `reset --empty` does not reinstall `appConfig`; an empty owner cannot send until seed.ts is reapplied.
5. Duplicate client-supplied option ids across polls are legal at the schema layer and hostile to page-global poll test ids.
6. iOS simulator runtime proof was not produced; Hermes bundle was exported. Not faked as a simulator receipt.
7. Scale-instance/ (port 52402 historically) was not reused; this session used the lane owner after reset to starter state.

end=1789077159
