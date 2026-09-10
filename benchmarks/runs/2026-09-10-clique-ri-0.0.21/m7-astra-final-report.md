# M7 final report

Status: **green**. Backend: public npm `snapback2@0.0.21`; model `gpt-6-astra`, effort `medium`.

start=1789066632
end=1789067776
wall_seconds=1144
wall_minutes=19.07

Group polls support validated creation, member-only changeable voting, mutation-ID deduplication, live tallies, and durable offline voting. Every conversation now has a required `messageCount`, displayed in chat settings and maintained atomically for text, media, polls, tombstones, and expiry.

The predecessor **already carried `maintain messageCounts: count messages by conversationId`**. It counted tombstones and was not a conversation field. The actual migration added optional `conversations.messageCount` and a visible-count aggregate, backfilled the two starter conversations, then narrowed the field to required with zero null rows. Existing values were preserved. See [optional successor](successor-optional.json), [backfill receipt](backfill-receipt.json), and [required successor](successor-required.json).

## Acceptance and builds

| Check | Result | Evidence |
|---|---|---|
| `npm run acceptance -- --milestone m7` | Pass; all 6 suite-required assertion IDs covered | [Suite](suite-result.json), [coverage](coverage-manifest.json), [final invocation](acceptance-final.log) |
| Sole selected `m7` choreography | Green; live tallies and offline vote reconciliation pass | [Final output](choreography-final.log), [summary](choreography-summary.json), [raw successful receipt](../evidence/m7-choreography-1789067584372.jsonl) |
| Immediate post-migration snapshot | Fully exact for 8 personas and 48 message views | [Comparison](snapshot-comparison.json), [pre hashes](pre-snapshot/manifest.json), [post hashes](post-snapshot/manifest.json) |
| Starter survival after all tests | Original content fields exact; 6 receipt views advanced monotonically during normal activity | [Comparison](final-survival-comparison.json), [final hashes](final-snapshot/manifest.json) |
| Current visible counts | Exact across all 13 Alice conversations, including test residue | [Paged history audit](final-count-verification.json) |
| TypeScript | Pass | [Log](typecheck-final.log) |
| iOS Hermes export | Pass; final bundle exported | [Log](ios-export-final.log), [metadata](../artifacts/m7-ios/metadata.json) |

The final choreography's suite SHA-256 matches the final acceptance receipt. Its fixture-only adapter names a fresh group; the poll was created through the browser composer. See [fixture](choreography-poll.json), [adapter](choreography-adapter.json), and [evidence hashes](final-evidence.json). No assertion was skipped or fabricated. The backend remained the fresh starter-seeded owner, not the scale database.

Previously green suites were M1, M2, M3, M4, M5, M6, and M8. **All seven pass again**, twice during this phase. [Regression results](regressions/results.json) link each final receipt. There were no inherited suite failures to repair. Existing suites were not weakened; M7 was added to the shared entrypoint.

## Correction loops and attribution

| Episode | Attribution | Evidence and disposition |
|---|---|---|
| Optional expiry comparison did not narrow inside an `or` | agent-error | [Diagnostic](check-optional.log); explicit presence branch |
| `old.id` in a bound update rule was typed `Id`, not `Ref<conversations>`; `.id` with binders was refused | ambiguous | [Diagnostics](check-optional-2.log), [follow-up](check-optional-3.log); member-level table update rule with admin configuration guard retained in the operation |
| Expanded history exceeded the 1 MiB output bound | agent-error | [Diagnostic](check-optional-2.log), [remaining overflow](check-optional-4.log); separate poll details and 19-row history pages |
| Backfill invoked before a valid generation installed | agent-error | Initial `E_OP_UNKNOWN` is recorded in [run log](run-log.md); retried only after certification/install |
| Slicing a quoted excerpt did not reduce the inferred output bound | ambiguous | [Diagnostic](check-optional-5.log); reverted the slice, kept full excerpts and reduced page size |
| Backfill JSONL parsed as one JSON object | agent-error | Chunk/final structure in [receipt](backfill-receipt.json); parsed final line and verified `state: done` |
| Outbox entry arguments were typed `unknown` | agent-error | Local entry annotation; [final typecheck](typecheck-final.log) |
| Web poll selected/busy attributes absent despite native accessibility state | agent-error | [First choreography miss](choreography-attempt-1.log), [DOM/server diagnostic](debug-poll.log); explicit ARIA attributes added |
| Retry tried to delete a poll after the shortened deletion window | agent-error | [Refusal](prepare-choreo-2.log); fresh normal group/poll fixture instead. A launched retained-fixture run passed but was superseded by clean-fixture proof |
| Initial render showed fallback zero tallies before detail data loaded | agent-error | Loading state added; final clean-fixture choreography passes |
| Inspection globs/path assumptions and retained generated-storage location | agent-error | [Run log](run-log.md); corrected paths, storage retained under `m7/inherited/.snapback/` |
| Actual Node PATH differs from the environment overlay | environment | Actual Node v25.9.0/npm 11.12.1 matches inherited `setup-identity.json`; package pin unchanged |

There were two full passing M7 suite invocations and five choreography invocations: the first failed the selected-state prerequisite, and the later invocations passed. The final invocation follows the final suite and is the linked green result. Compiler refusals and intermediate browser failures were correction loops, not terminal milestone capability failures. No confirmed unworked-around Snapback defect is claimed; the two ambiguous compiler limitations retain exact diagnostics.

## Candid gaps and boundaries

- This proves migration over the starter state, not the scale replay. The starter message snapshots contain no attached-message media or reaction entries; preservation of those nonempty message fields across migration is therefore not demonstrated by this fixture. All media/reaction regressions pass on post-migration writes.
- History pages changed from 20 to 19 rows to fit the certified output bound. Clients must follow opaque cursors. Poll details are a separate live snapshot from the message page.
- Count updates require a member-level conversation update rule. Public configuration operations still enforce the inherited admin guard; the binder rule diagnostic is unresolved at the platform level. No general client row-update API was added.
- Expiry uses the inherited owner timer. The real shortened-window poll expiry test passes; crash/restart timing and migration at large scale were not tested.
- The iOS result is a Hermes bundle export. No M7 native offline or simulator behavior is claimed.
- Earlier choreography receipts reference earlier suite versions. Use the final hash-linked receipt above. The initial fully exact post-migration snapshot is distinct from the final active app state, where normal reads advanced receipts.
- The inherited copied choreography contains its preexisting dependency/path repairs; those were not changed under M7. No external grader ran, so author green is not a hidden-grader claim.

Both started servers used allowed ports: backend PID 63273 on 52100 and Expo PID 78391 on 52101. Only those PIDs received SIGTERM; both exited. [Cleanup evidence](server-cleanup.json). The original storage is preserved under `m7/inherited/.snapback/`; the evolved fresh database remains at the lane's `.snapback/` for restart.

The [diary](diary.md) and [closing essay paragraphs](essay-paragraphs.md) were written before this final metric tally. Machine-readable result: [status.json](status.json).

end=1789067776
