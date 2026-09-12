# M7 — Day-2 evolution

lane id astra-clique-snapback2  
model gpt-6-astra; effort=medium; backend=snapback2-0.0.29  
status=green  
start=1789209905  
end=1789211017  
wallSeconds=1112

Group polls and a persisted conversation message count are shipped. Work stayed in this lane, alone, without reading another lane, a Snapback source checkout, or an inherited diary/essay. The exact public npm pin remains 0.0.29. Actual executable Node was v24.13.1, despite the host wrapper declaring 24.18.0; the inherited setup identity correctly records the actual executable. There were no capability-failure episodes.

## Migration and snapshots

The predecessor already had `maintain messageCounts: count messages by conversationId`, but no conversation count field and no tombstone exclusion. A new optional `conversations.messageCount`, a visibility aggregate, poll data, and M7 programs were installed as a successor. The backfill visited all 15 starter messages and updated both existing conversations to 6 and 9. The required-column successor reported zero null/affected rows. New conversation creation initializes zero; text/media/poll creation, unsend, and scheduled expiry maintain the field transactionally.

- Fresh predecessor owner: [receipt](evidence/pre-owner.json); original generation `0ad1107b963bebf3d1629c0c09473eab4a329969cc986ce6513058cf37d783ab`.
- Optional successor: [installed report](evidence/migration-stage1-installed.json).
- Backfill: [plan](evidence/backfill-plan.json), [completed job](evidence/backfill-receipt.json).
- Required successor: [installed report](evidence/migration-stage2-installed.json), generation `1bf9a88c84995a86c807ae6612e5ded13479b160e89a91392f4bca91696975fe`.
- Reviewable backend change: [patch](backend.patch); [final source hashes](evidence/final-source-hashes.json).
- Pre-snapshot: [eight-persona hash manifest](pre-snapshot/manifest.json), exported through each persona's issued token and the M6 custom-client helper before schema changes. The scale store was never used.
- **Immediate post-migration comparison: exact pass**, all original conversation/message fields, media references, reactions and own receipt values: [comparison](evidence/snapshot-comparison.json), [post snapshot](post-snapshot/manifest.json).
- **Final post-test audit: original content intact**, with ten normal sent→read receipt advances caused by the required browser suites/choreography. Final state is therefore not byte-for-byte receipt equality with the pre-snapshot: [explicit deltas](evidence/final-snapshot-audit.json), [final snapshot](final-snapshot/manifest.json). No receipt was restored or falsified to hide user activity.

## Acceptance and choreography

`npm run acceptance -- --milestone m7` passed on its first run. [Suite receipt](evidence/acceptance.json) and [coverage](coverage.json) cover all six suite-required assertions: m7-a01, a03, a04, a06, a07, a09. Tests exercise UI creation, server bounds and membership refusals, changing votes, duplicate and stale retry intents, backfill, text/media/poll counts, duplicate sends/deletes, expiry, settings display, and prior-suite regressions.

The unmodified frozen harness ran **m7 alone** and passed both required checks. All three live-tally attempts passed; measured click-to-other-client-tally times were 558.9, 360.7, and 570.9 ms. Bob's offline vote showed pending, settled after reconnect, incremented Alice's observed tally, and cleared pending. [Choreography receipt](evidence/choreography-1789210717286.jsonl) and [output](evidence/choreography-attempt1.log). The suite hash linked by choreography matches the current passing receipt. [Frozen source hashes](evidence/frozen-surface-hashes.txt).

The previously passing suites all passed again:

| Suite | Result | Receipt |
|---|---|---|
| M1 | pass | [receipt](../evidence/m1-suite-1789210428826.json) |
| M2 | pass | [receipt](../evidence/m2-suite-1789210495181.json) |
| M3 | pass | [receipt](../evidence/m3-suite-1789210562544.json) |
| M5 | pass | [receipt](../evidence/m5-suite-1789210628720.json) |
| M8 | pass | [receipt](../evidence/m8-suite-1789210696331.json) |

The inherited latest M4 and M6 suites were failing; their status/receipt entries were preserved exactly and those product failures were not repaired. The baseline is [prior-suite-status.json](prior-suite-status.json), not an earlier first-green claim. [Regression summary](evidence/regressions.json).

Additional validation: `snapback2 check` passes; [TypeScript check](evidence/typecheck2.log) passes; the inherited [authored authority journey](evidence/platform-journeys.json) passes on port 53302. This is a journeys-only receipt, not a claim that the full derived suite passed. Web export and [iOS Hermes export](evidence/hermes.json) succeed. Native simulator execution was unavailable on Linux and is not claimed.

## Error and correction record

Six recorded error/correction episodes are retained; none is attributed to a proven Snapback implementation defect.

| Episode | Attribution | Correction and evidence |
|---|---|---|
| Seed M3 hit E_AUTH_RATE_LIMIT after earlier segments | environment | Honored the documented cooldown; [first refusal](evidence/seed-m3.log), [successful retry](evidence/seed-m3-retry2.log) |
| First seed retry happened before cooldown elapsed | agent-error | Waited the full interval; [retry refusal](evidence/seed-m3-retry.log), timestamped run log |
| Optional expiresAt used in ordered OR comparison | agent-error | E_QUARRY_TYPE required an explicit presence guard; [diagnostic](evidence/migration-stage1-check.log) |
| Backfill cleanup chunk100 exceeded fanout/index/write bounds | agent-error | E_BOUND/E_STEPS: reduced message chunk to1 while retaining the complete sweep; [diagnostic](evidence/migration-stage1-check2.log), [passing check](evidence/migration-stage1-check3.log) |
| Two callback implicit-any errors; initial inherited attribution lacked a baseline | ambiguous; attribution correction is agent-error | Added erased type annotations and corrected the log's claim; [first check](evidence/typecheck1.log), [passing check](evidence/typecheck2.log) |
| Report generator embedded Markdown backticks in a JS template literal | agent-error | SyntaxError before any report was written; moved prose into a separate template file; [diagnostic](evidence/report-generation-error.txt) |

No product acceptance or choreography retry was needed. The unavailable git repository was an environment fact, not a failed product capability. Knowledge sources and their timestamps are in [run-log.md](run-log.md).

## Candid gaps

- The required starter has 15 text messages and empty message-media/reaction fields. Exact snapshot preservation is real, but it does not prove a populated message-media/reaction backfill or a scale migration. Existing posts with media are outside the M6 message manifest.
- Expiry uses the owner's persisted timer. A late timer can briefly leave the stored count ahead of wall-clock visibility; no exact zero-lateness guarantee is claimed. The timed expiry acceptance case passed.
- Poll votes are capped at 50 historical voters per poll. This matches the current membership ceiling but can refuse a new voter after enough membership churn. This is an application bound, not a claimed platform inability.
- M4/M6 inherited failures remain; the M7 run does not upgrade those milestones. The new poll read path reuses the inherited authenticated fallback for unavailable durable composite coverage.
- Offline poll settlement was proved on web. Hermes export is not an iOS simulator proof.
- Final normal activity advanced ten original receipt values. Use the immediate post-migration snapshot for exact migration equality; the final audit lists every allowed receipt delta explicitly.
- No hidden grader ran and no comparative backend performance claim is made.

## Process closure

Backend PID 1083410 (53300) and static web PID 1097252 (53301) were stopped with exact-PID SIGTERM. Test-owner PID 1101767 (53302) was automatically reaped by the public CLI. No other PID was killed; no assigned port remained listening. [Shutdown receipt](evidence/shutdown.json).

The fresh migrated backend remains in the lane's `.snapback/`; the stopped inherited development store is archived at `m7/inherited/.snapback/`. The scale database was not read or modified. The [diary](diary.md) was written before the [essay paragraphs](essay-paragraphs.md), and both preceded this numerical tally.

end=1789211017