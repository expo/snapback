# Clique / Snapback 4 — M7 final report

lane id: grok-clique-snapback4-full-20260913  
model: grok-4.6  
effort: xhigh  
backend: snapback4-0.2.6  
phase: m7  
host: macOS arm64  

## Clock

| event | epoch (unix seconds) |
| --- | --- |
| start | 1789374381 |
| backend (pre-schema) up | 1789375001 |
| starter seed done | 1789375009 |
| pre-M7 snapshot | 1789375017 |
| schema check ok | ~1789375120 |
| backend adopt PID 68413 | 1789375172 |
| snapshot compare (post-adopt) | ~1789375230 |
| suite m7 pass | 1789375602 |
| expo web up | 1789375659 |
| choreography Node mismatch | 1789375686 |
| choreography m7 green | 1789375717 |

start=1789374381  
end=1789375914  
wall_s=1533  

## Status

**green**

Wall: 1533s (~26 min), under the four-hour safety limit.

## Pre-M7 schema (count structure)

The inherited schema did **not** carry a conversation message-count column and did **not** have `maintain … count messages by …`. Existing maintains were likes/reposts/replies/follows/insights only. Evidence: `m7/pre-m7-schema.q`.

M7 added `maintain visibleMessageCounts: count messages by conversationId, tombstoned` and projects `messageCount` from the `false` bucket (visible = not tombstoned; expired rows leave the table). After adoption, starter chats were `d-alice-bob=6` and `g-starter=9`.

## Suite

Command: `npm run acceptance -- --milestone m7`  
Receipt: `receipts/suite-m7.json`  
Coverage: `receipts/coverage-m7.json` (m7-a01, m7-a03, m7-a04, m7-a06, m7-a07, m7-a09 in registered order)  
Suite-status for choreography: `receipts/suite-status-m7.json`

| id | pass |
| --- | --- |
| m7-a01 create poll (2–4 options, group-only) | true |
| m7-a03 change vote, one per user | true |
| m7-a04 duplicate/retried mutation id does not flip | true |
| m7-a06 backfill visible counts | true |
| m7-a07 increment + tombstone exclusion | true |
| m7-a09 previously-green suites | true |

m7-a02 and m7-a05 are choreography. m7-a08 is grader snapshot comparison (also run here).

## Choreography

Command: `node choreography.mjs m7` with Volta Node v24.18.0, `CHOREO_BASE_URL=http://127.0.0.1:49301`, adapter `choreography-adapter.json`.  
Receipt: `receipts/choreo-m7.jsonl`  
Observations: `receipts/choreo-m7.jsonl.observations.jsonl`

| assertion | pass |
| --- | --- |
| m7-a02-live-poll-tallies (best-of-3, all three passed) | true |
| m7-a05-offline-vote-reconciles | true |
| segment green | true |

First invocation (Homebrew Node v25.9.0) was a startup refusal (`outcomeClass=setup`, exit 2) and is not a product red.

## Snapshot comparison (m7-a08)

Pre: `m7/pre-snapshot/` (one JSON per starter persona + `manifest.json` with sha256).  
Export path: custom-client API, M6 field manifest (`threadMessages`, `convReceipts`, `convReactions`, `convRecipients`, `conversationOf`, `inbox`, `me`).  
Compare: `m7/snapshot-compare.json` — **ok, mismatches=0**, including after the m7-a09 regression suite. Pre-existing messages, media refs, receipts, and reactions survived the schema adoption.

## Previously-green suites (m7-a09)

Inherited final-report: M1, M2, M3, M4, M5, M6, M8 **suites** were green; M3 **choreography** was not. M7 re-ran those suites in-process and they passed. Prior choreography failures were not repaired under this budget (M3 live DM/typing/receipts not re-attempted).

## Correction loops

| loop | attribution | evidence |
| --- | --- | --- |
| Choreography refused setup-identity Node pin | environment (PATH had Node 25.9.0); agent should have used the documented Volta 24.18.0 first | `CHOREOGRAPHY OUTCOME` startup, `declared=v24.18.0 actual=v25.9.0`; rerun with `/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node` went green |
| GET `/` for snapshot server card is 401 | agent-error | `m7/pre-snapshot/manifest.json` `server.tables` empty; persona files still complete |

No snapback4-defect loop this phase. Schema `check` accepted the additive change on the first compile.

## Ports and PIDs (this session only)

| role | port | PID | notes |
| --- | --- | --- | --- |
| snapback4 pre-adopt | 49300 | 43201 | killed after snapshot, before restart |
| snapback4 adopted | 49300 | 68413 | live through suite + choreo |
| npm expo | 49301 parent | 48892 | `npm exec expo start --web --port 49301` |
| expo / metro | 49301 | 49007 | listener |

Killed at end: 68413, 49007, 48892 only (no pkill/killall). 43201 already dead.

## Candid gaps

1. Web polls render in the inherited HTML overlay, not only the kit `PollDisplay` (native path does use the kit).
2. Poll option IDs are the choreography fixtures `m7-option-a`…`d` mapped from keys `a`–`d`.
3. `visibleMessageCounts` follows Snapback’s expire-vs-maintain lag (count drops when the sweep removes the row, ~1s; reads of the row are already null). Not exercised in starter data (no disappearing chats).
4. Snapshot manifest’s server/ops block is empty because unauthenticated `GET /` is `E_AUTH`.
5. Did not run `snapback4 deploy <dir>` as a release-tree migration; evolution used the documented `check` + `dev` re-adoption on the live store, which is what preserves starter data.
6. No new iOS Hermes export this session (prior continuous session already failed on private class fields).
7. M3 web choreography remains the inherited miss; M7 did not spend budget on it.

## Artifacts

- `m7/pre-snapshot/` + `m7/pre-m7-schema.q` + `m7/snapshot-compare.json`
- `receipts/suite-m7.json`, `receipts/coverage-m7.json`, `receipts/suite-status-m7.json`
- `receipts/choreo-m7.jsonl`
- `m7/diary.md`, `m7/essay-paragraphs.md`, `m7/run-log.md`

end=1789375914
