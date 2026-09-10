# M7 final report

lane id grok-clique-snapback2
model grok-4.6
effort=xhigh
backend=snapback2-0.0.20
phase=m7
tokens=null (advisory; Grok)

start=1788976193
end=1788979393
wall seconds=3200 (~53 min)

status=capability-failure

Green bar required suite pass AND choreography pass. Suite passed. Two-client `m7` choreography did not close green (`m7-a05-offline-vote-reconciles`).

## Suite

`npm run acceptance -- --milestone m7` → exit 0, `coverage-m7.json` 11/11 (final refresh).

Suite-required assertions (instrument `assertions.json` M7):

| id | result | notes |
| --- | --- | --- |
| m7-a01 | pass | `sendPoll` committed in a dedicated suite group |
| m7-a03 | pass | change vote: one row, option B, tallies a=0 b=1 |
| m7-a04 | pass | same `mutationId` retry does not flip |
| m7-a06 | pass | Weekend Plans `conversationView.count` equals visible `status=ok` rows (≥9 backfill) |
| m7-a07 | pass | count increments on new poll |
| m7-a09 | pass | nested re-run of previously-green m1–m6+m8 suites all exit 0 |

Coverage map: `coverage-manifest.json` keys `m7-a01, m7-a03, m7-a04, m7-a06, m7-a07, m7-a09`.

Choreo-owned (not suite): m7-a02 live tallies, m7-a05 offline vote. Grader-owned: m7-a08 snapshot comparison (also run here).

## Choreography

`node choreography/choreography.mjs m7` (sole selected segment), receipts `receipts-m7.jsonl`.

| assertion | result |
| --- | --- |
| m7-a02-live-poll-tallies | pass (best-of-3; later runs after single-poll cleanup) |
| m7-a05-offline-vote-reconciles | fail (last: option click / tally not observed within 30s after Playwright `setOffline`) |
| segment | `green:false` `nonGreenCause=choreography-failed` `outcomeClass=application` |

First choreography attempt: live failed (`sm-poll-total` strict mode, 3 polls in Weekend Plans); offline passed. After retracting extra polls, live passed and offline did not settle. Evidence: `receipts-m7.jsonl`.

## Snapshot comparison (m7-a08)

Pre-M7 export: `m7/pre-snapshot/` (8 persona files + `manifest.json` with sha256), taken over the M6 field manifest via `scripts/m7-snapshot.mjs` and each persona token, **before any schema edit**.

Post compare: `m7/snapshot-compare.json` **ok mismatches=0**. Pre-existing messages, media references, receipts, reactions, and tombstone flags intact. New poll messages are additive.

## Previously green suites (m7-a09)

Re-run under M7; prior failures not repaired:

| milestone | suite | coverage |
| --- | --- | --- |
| m1 | 8/8 | coverage-m1.json |
| m2 | 23/23 | coverage-m2.json |
| m3 | 8/8 | coverage-m3.json |
| m4 | 5/5 | coverage-m4.json |
| m5 | 6/6 | coverage-m5.json |
| m6 | 5/5 | coverage-m6.json |
| m8 | 6/6 | coverage-m8.json |

M3 web choreography remains the inherited non-green (not re-run, not repaired).

## Pre-M7 count structure

**Yes.** Pre-M7 schema already carried `maintain messageCounts = count messages by conversationId` (all rows). Recorded in `m7/run-log.md` before edits. M7 changed grouping to `conversationId, status` and settings read `messageCounts[id, 'ok']` (visible only; polls count).

## Migration

1. Additive successor (polls, pollVotes, pollTallies) auto-installed. Generation `2ea5644e…`.
2. Destructive successor: drop `messageCounts.byConversation`. Reviewed `.snapback/migration-c661423d….json`. Applied: `addedColumns=["messageCounts.status"]`, `addedIndexes=["messageCounts.byConversationStatus"]`, `backfilledMaintains=2`, to `c661423d…`. Owner `status=ready`.

## Correction loops

1. `messages.thread` E_BOUND when poll columns sat on `messages`. Attribution: **snapback2-defect**. Workaround: `polls` table + `pollFor` / `pollsInChat`. Evidence: `snapback2 check` refusal; run-log T=1788977002.
2. `fillMessageVisible` job E_STEPS non-uniform membership rule. Attribution: **snapback2-defect**. Workaround: rebuild maintain by status instead of a `visible` column job. Evidence: check refusal; run-log.
3. `E_SUCCESSOR_DESTRUCTIVE` on maintain regroup. Attribution: environment (documented successor). Applied reviewed plan. Evidence: apply-migration JSON.
4. `sm-poll-total` strict mode with 3 polls in Weekend Plans. Attribution: **agent-error** (suite polls in the starter group). Dedicated suite group; retracted extras. Evidence: first `receipts-m7.jsonl`.
5. Offline vote does not reliably queue/drain under Playwright `context.setOffline`. Attribution: **ambiguous** (Snapback `rejected` on transport unless `client.offline()` first; RN-web online events). Live tallies passed; offline remaining red. Evidence: later receipts-m7.jsonl.

## Native

`dist/ios-m7/_expo/static/js/ios/index-c98f34dd6007fb2621013a1d50a02ca6.hbc` (Hermes export). No simulator run.

## PIDs (this session)

- snapback2 owner: wrapper 6168, bin 6169 LISTEN 127.0.0.1:50400; shell 6135. URL http://127.0.0.1:50400
- expo web (last): node 82169 LISTEN *:50401; npm 82143; shell 82125. Earlier expo PIDs 27484/27427, 39982/39940, 51963/51920, 62317, 72856 killed individually when restarting.

Killed only those PIDs at session end (no pkill/killall).

## Gap list

- Choreography `m7-a05` offline vote queue/settle under Playwright network cut (not green).
- Cannot put poll payload on `messages` without overflowing retained-history thread closure (E_BOUND).
- Cannot job-fill membership-scoped `messages` (E_STEPS).
- Follower fan-out / scale replay still the inherited M6/M8 gap (not in M7 budget).
- Inherited M3 choreography still not green (preserved).

end=1788979393
