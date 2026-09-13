# M7 final report

Lane astra-clique-snapback4; model gpt-6-astra; effort=medium; backend=snapback4-0.1.0.

**Status: capability-failure.** Polls and count/migration proofs pass, but required assertion m7-a09 fails because the previously green M1 suite now fails at logout/signup navigation. The same failure reproduces with the pre-M7 schema; it was preserved, not repaired. The frozen choreography reports green=false, nonGreenCause=suite-failed. No partial-green label is claimed.

start=1789265724
end=1789267110
wall=1386 seconds

The diary and essay were written before this tally: [diary](diary.md), [essay paragraphs](essay-paragraphs.md).

## Delivered

Group poll creation uses typed server constraints, normal message receipts/expiry/deletion, unique per-user changeable votes, and durable ordered set-state intents. The actual UI creation and live/offline votes are exercised. Counts are backfilled maintained aggregates grouped by conversation, tombstone and expiry, projected into conversation.messageCount by the documented custom-client API and displayed in chat settings. The server excludes expired buckets immediately. This is an aggregate-backed field, not a denormalized conversation-row integer.

The inherited schema already carried messageSequence and receipt/unread aggregates; it did not carry a visible-message count. Final adoption from the pre-M7 schema was Additive and rebuilt maintained aggregates. An intermediate experiment redefined a newly-added derived aggregate and was classified Destructive for that derived column only; no inherited source column was removed. [Adoption evidence](evidence/migration-proof-backend.log), [schema hashes](evidence/final-schema-hashes.json).

## Acceptance and choreography

The exact command `npm run acceptance -- --milestone m7` completed with exit 1: 6/7 tests pass. Every suite-required ID is mapped in the [coverage manifest](coverage-manifest.json). Feature assertions m7-a01/a03/a04/a06/a07 pass; m7-a09 fails. The suite also verifies deletion and immediate expiry. [Suite](evidence/m7-suite.json), [command output](evidence/acceptance.txt).

The sole-selected m7 choreography passes both required checks, including all retained live vote trials and the offline pending/reconnect path. Its segment remains non-green because the linked suite fails. [Raw receipts](evidence/m7-choreo.jsonl), [summary](evidence/choreography-summary.json), [UI creation](evidence/poll-ui-creation.json). The inherited generic-validator loader shim is retained and disclosed; it changes only the missing dependency, not browser assertions.

A real shortened-window poll and text both expired: before=2, after=0, both message reads null immediately after expiry. [Server-time proof](evidence/expiry-proof.json).

Previously green suites, on a fresh isolated starter instance using the final schema:

| Suite | Final result |
|---|---|
| M1 | FAIL |
| M2 | pass |
| M3 | pass |
| M4 | pass |
| M5 | pass |
| M6 | pass |
| M8 | pass |

[Per-suite receipts and schema hash](evidence/regressions.json). M4 failed some earlier timing observations, passed an unchanged retry, and passed the final run on its first attempt. Earlier failures remain on disk. M1 failed repeated attempts and the separate pre-schema baseline. No prior scale-safety, native-runtime, video-duration or authentication gap was repaired under M7.

## Migration comparison

The official pre-snapshot was exported through the custom-client API with all eight persona tokens after the three real starter seed segments and before any application/schema edits. Tokens are not written into snapshots. It represents 15 unique messages / 39 persona-visible message records. [Pre-snapshot hashes](pre-snapshot/manifest.json).

The immediate post-adoption comparison is exactly equal for every M6 field, including caller-specific reactions and own receipt states. [Comparison](evidence/snapshot-comparison.json), [post-snapshot](post-snapshot/manifest.json). The frozen starter chats have no media or reactions, so those aspects of the initial comparison are vacuous. A separate pre-schema starter instance adds image/video messages, reactions, a read receipt and a tombstone through app mutations, then adopts the final schema: exact comparison passes and authenticated asset bytes match the uploaded fixture hashes. [Supplemental comparison](evidence/migration-proof-comparison.json), [media bytes](evidence/media-preservation.json).

Later browser sessions legitimately advance 10 persona-visible starter receipt fields monotonically. Therefore final live state is not byte-for-byte equal to the original pre-snapshot: it has no unexpected content changes, but it has those disclosed receipt advances. They were never reset. [Full final-state differences](evidence/final-state-comparison.json), [final snapshot](final-snapshot/manifest.json). No independent grader result is claimed.

## Validation and gaps

TypeScript and Quarry checks pass. The final iOS Hermes export succeeds; [artifact hashes](evidence/native-artifacts.json). No simulator runtime, cold offline restart, scale migration or deployment claim is made.

The phase is not green because M1 fails. The count field is an aggregate-backed API/UI projection rather than a stored scalar in conversations. Multi-page bucket reads have ordinary concurrent-read semantics. The poll tally query is bounded to 50 vote rows, matching current group capacity; extensive membership turnover accumulating more than 50 historical voters is not tested. Existing broader lane gaps remain as documented in the inherited final report.

All launched CLI/Expo PIDs were recorded. Four active native Snapback child PIDs were discovered and recorded at cleanup; the native child PIDs of already-completed isolated regression runs were not captured at their start. This is a process-recording gap. The runner now records direct native child PIDs after readiness (syntax checked after final suite). Only explicitly recorded owned launcher PIDs received SIGTERM, forwarding to their children. All owned listeners are gone from ports 49300–49319. [Cleanup](evidence/process-cleanup.json), [empty listener audit](evidence/listeners-after-cleanup.txt).

## Corrections

Nine grouped correction/knowledge loops: agent-error=3, snapback4-defect=2, environment=1, ambiguous=3. These are grouped episodes, not a count of every compiler refusal or test retry. [Attribution and evidence for each loop](evidence/correction-loops.json); chronological events and lookups remain in [run-log](run-log.md). No Snapback implementation source was read; package README, guide/why diagnostics, generated API and public hook declarations were used.

end=1789267110
