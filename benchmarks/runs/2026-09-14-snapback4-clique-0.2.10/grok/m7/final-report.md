# Clique on Snapback 4 — M7 final report

lane id: grok-clique-snapback4-full-20260913  
model: grok-4.6  
effort: xhigh  
backend: snapback4-0.2.10  
pins: snapback4@0.2.10, snapback4-expo@0.2.3  
phase: m7  

start=1789436514  
end=1789438129  

Wall from start to this report: 1615 s (~27 min). Token totals are harness-native and not estimated here.

## Status

**green**

Suite `npm run acceptance -- --milestone m7` PASS (`acceptance/m7.json`).  
Coverage manifest `acceptance/m7-coverage.json` maps suite-required m7-a01, m7-a03, m7-a04, m7-a06, m7-a07, m7-a09.  
Choreography `node choreography.mjs m7` green (`receipts/m7.jsonl`): m7-a02 live tallies 3/3, m7-a05 offline vote reconciles.  
Snapshot comparison PASS (`m7/snapshot-compare.json`, mismatches=0) against `m7/pre-snapshot/` (M6 field manifest via custom-client API, each starter persona token).  
m7-a08 is grader-owned; this session’s comparison is the lane evidence the grader consumes.

## Ports and PIDs (this session)

| role | port | PID |
| --- | ---: | ---: |
| python `scripts/sb4.py dev --port 49340 --fresh` | 49340 | 29621 |
| snapback4 binary | 49340 | 29627 |
| snapback worker.ts | — | 29630 |
| npx expo start --web | 49341 | 79827 |
| npm exec expo | 49341 | 79830 |
| node expo CLI / Metro | 49341 | 80051 |
| earlier expo (killed before restart) | 49341 | 46099 / 46102 / 46214 then 76532 |

Kill only recorded PIDs at lane end. Never pkill / killall / pattern kill.

## Pre-M7 schema note

The inherited pre-M7 schema did **not** carry a conversation message-count structure: no `messageCount` column on `conversations`, no `maintain` over messages by conversation. Follow/like/repost/reply maintains existed for the social graph only.

After Additive re-adopt (generation 2, 13 ms): `conversationMessageCounts` backfilled d-alice-bob=6 and g-starter=9 (visible messages; no tombstones in starter).

## Suite and choreography

- M7 suite PASS. Choreography green.
- Previously green milestones (M1, M2): acceptance still PASS (m7-a09 nested plus direct).
- Previously suite-pass / choreo-fail (M3, M4, M5, M6, M8): acceptance still PASS; choreography **not re-run and not repaired**.

## Snapshot comparison

`scripts/export-m7-snapshot.mjs` over inbox + threadMessages + messageReactions + receiptsOf.  
Pre: `m7/pre-snapshot/manifest.json`. Post-migration (before new poll seed): `m7/post-snapshot/`. Compare: intact messages, media refs, receipts, reactions.

## Native artifact

iOS Hermes: `dist/ios-hermes/_expo/static/js/ios/entry-71432f226675a54956f6d5f02611ef4c.hbc`, copied `dist/ios-hermes-m7/`. Simulator proofs not run.

## Correction loops

| # | attribution | evidence |
| --- | --- | --- |
| 1 | agent-error | `E_SYNC` pollOptions horizon index; `byConversation`. `snapback/schema.q` |
| 2 | agent-error | `E_QUARRY_TYPE` optional poll labels; `! else POLL_OPTIONS`. createPoll |
| 3 | environment | choreography setup-identity Node v24.18.0 vs runner v25.9.0; volta node 24.18.0 |
| 4 | agent-error | offline vote click not stable; PollMessage kept last options and froze while pending. `src/PollMessage.tsx`; first `receipts/m7.jsonl` fail then green |

## Candid gap list

1. Web still uses `createClient` (online). Offline votes queue in that client’s in-memory outbox, not a wasm replica; M8 durable-across-kill is unchanged.
2. `conversation` became server-run (`N_NOW_SERVER`) because `conversationMessageCounts` is `online only`.
3. Choreography poll option IDs `m7-option-a` / `m7-option-b` were seeded into Weekend Plans; compose mints its own ids.
4. Prior M3–M8 choreography failures left in place by M7 budget.
5. Jobs still cannot page expiring `messages`; filtered counts go through maintains, not a recount job.
6. Host Node 25 vs pinned 24 is an environment trap for any choreography run that forgets PATH.

end=1789438129
