# M7 final report — grok-clique-snapback2

lane id: grok-clique-snapback2
model: grok-4.6
effort: xhigh
backend: snapback2-0.0.29
phase: m7
host: Ubuntu Linux x86_64 (AMD Ryzen 5 3600, host 450b / expose-builder-pixel-a)
ports: owner 53400 PID 4128980; expo web 53401 PID 4155564 (npx parent 4155549)

## Clock

| | epoch |
|---|---|
| start | 1789208836 |
| end | 1789211822 |
| wall_s | 2986 (~0.83 h) |

## Status

`green`

Suite `npm run acceptance -- --milestone m7` pass (`receipts/suite-m7.json`).
Coverage `receipts/coverage-m7.json` maps m7-a01, m7-a03, m7-a04, m7-a06, m7-a07, m7-a09.
Choreography `node choreography/choreography.mjs m7` green (`receipts/choreo-m7.jsonl`).

## Snapshot

Pre-M7 export: `m7/pre-snapshot/` (one JSON per starter persona + `manifest.json`).
Post-M7 compare: `m7/snapshot-compare.json` ok, mismatches 0.
preExistingCountStructures: true — inherited `maintain messageCounts: count messages by conversationId`. M7 added `conversations.visibleMessageCount` (optional, filled by `fillConversationCounts`), `messages.visible`, `visibleMessageCounts`, and poll tables.

## Previously green suites (m7-a09)

| milestone | result |
|---|---|
| M1 | pass `receipts/suite-m1.json` |
| M2 | pass `receipts/suite-m2.json` |
| M3 | pass `receipts/suite-m3.json` |
| M4 | pass `receipts/suite-m4.json` |
| M5 | pass `receipts/suite-m5.json` |
| M8 | pass `receipts/suite-m8.json` |
| M6 | not re-run (prior a13 failure preserved) |

## Correction loops

| loop | attribution | evidence |
|---|---|---|
| Job updating `messages` refused E_BOUND (deliver fan-out × 100) | snapback2-defect / language | `snapback2 check` heap/write amplification |
| Dropping already-installed `visible` / `visibleMessageCounts` | agent-error | `E_SUCCESSOR_DESTRUCTIVE` plan; kept additive columns |
| Duplicate vote mutationId flipped after a prior change (immutable mutationId on vote row) | agent-error | m7-a04; fixed with `pollVoteIntents` |
| Nested maintain in `latestPolls` → web offline `partial/computed-key` | snapback2-defect / language | playwright `sm-poll-debug` JSON |
| PollDisplay inside collapsed ScrollView / composer-only visible | agent-error | choreo miss then dump of testIDs |
| Nested prior suites hit E_AUTH_RATE_LIMIT | environment + snapback2 auth | guide auth.md; 65s pauses in a09 |
| m2 page size last 40 vs suite expect 20 | agent-error / inherited mismatch | feeds.q last 20 (brief 20/page) |

## Candid gaps

1. `visibleMessageCount` on conversations is filled at migration and on poll create; live settings read `messageCounts` (remaining rows). Tombstones that stayed as `deletedAt` rows would still count until `visible` is maintained on every write path.
2. Jobs cannot backfill columns on `deliver` tables at starter scale even, let alone scale.log.
3. Web live queries that nest maintains are unusable with the default IndexedDB offline store.
4. M6 a13 (`oncePhoto` / sample-50) was not repaired.
5. M2/M3/M4 web choreography from the continuous session remain as previously recorded; M7 did not re-run them.
6. Feed page size was changed last 40 → last 20 so nested m2 pagination matched the brief; that is a small inherited-query correction under M7.

end=1789211822
