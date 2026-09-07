# M7 final report — astra-clique-snapback2

status=green
start=1788744775
end=1788745931
wall=1156 seconds (19.27 minutes)

Backend: public npm snapback2@0.0.4. Model gpt-6-astra, effort=medium. No other lane or Snapback source checkout was inspected. The permitted grading/trace.md was consulted for the environment port recipe.
Implemented group poll composition, member-only live tallies, changeable one-vote-per-user state, mutation-ID deduplication, and offline queued votes with pending state. Added a required stored conversation.messageCount, shown in settings, with a bounded backfill job and forward updates for text, media, view-once, polls, tombstones, and expiry.
## Validation

| Check | Result | Evidence |
|---|---|---|
| `npm run acceptance -- --milestone m7` | pass; all 6 suite-required IDs mapped | [suite](../evidence/m7-suite-1788745692744.json), [coverage](coverage-manifest.json), [log](acceptance-final.log) |
| Frozen `choreography.mjs m7` | green; nonGreenCause=null | [receipt](choreography-final.jsonl), [summary](choreography-final.log) |
| Pre/post schema comparison | all 8 persona files byte-identical | [pre manifest](pre-snapshot/manifest.json), [comparison](snapshot-comparison-required.json) |
| Count backfill | DM=6, group=9 | [verification](backfill-verification.json), [job receipt](backfill-receipt.jsonl) |
| Final original-data survival | pass; subsequent read receipts advance, none regress or disappear | [check](final-data-check.json) |
| Previously green M3/M4/M8 suites | all pass, rerun inside final M7 suite | [results](regression-results.json) |
| Quarry check / TypeScript | pass | [check](check-final.log), [tsc](tsc-final.log) |
| iOS Hermes bundle | exported with port 49120 endpoint | [log](ios-export-final.log), [artifact](artifacts/ios/metadata.json) |

The pre-M7 schema had no message-count structure. A fresh backend was seeded with all three starter segments through scripts/seed.mts; inherited data and seed journals were retained separately. The optional successor rebuilt new maintains, the job wrote both existing conversations in one chunk, and a second successor made the count required. Existing message IDs, authors, timestamps, bodies, quotes, receipt rows, and reaction/media fields were unchanged immediately after each successor.

The prior report classified M1/M2/M5/M6 as aborted with retained historical greens; those failures were preserved and not repaired. M3/M4/M8 were the prior final green milestones. Their inherited paging test required more than the starter DM’s six messages, so test-owned messages were added after the migration snapshot comparison.

## Corrections and attribution

- **agent-error**: Unknown guide successor / dev --help invocation; used listed diagnostics instead. Evidence: `m7/guide-successor.md`.
- **snapback2-defect**: guide app repeatedly E_GUIDE_STALE despite successful check; successor diagnostic and job pages used. Evidence: `m7/guide-app.md`.
- **agent-error**: Snapshot required complete but bounded chats.list returned capped with no continuation; accepted documented capped state below list bound. Evidence: `m7/pre-snapshot.log`.
- **agent-error**: Nullable aggregate lookup refused E_QUARRY_UNKNOWN; switched to total minus true tombstones after two compile attempts. Evidence: `m7/check-polls-1.log,m7/check-polls-2.log`.
- **snapback2-defect**: Documented ?? expression nested inside max refused E_OPAQUE; introduced a local binding. Evidence: `m7/check-polls-3.log`.
- **agent-error**: Binding rewrite misindented an update, unknown conv; fixed indentation. Evidence: `m7/check-polls-4.log`.
- **agent-error**: Votes in history exceeded static 1MiB ceiling E_BOUND; moved votes to separate live poll query. Evidence: `m7/check-polls-5.log`.
- **agent-error**: Port hook installed too late for static import; three M7 UI attempts reached inherited49101. Dynamic import after hook fixed routing. Initial route diagnosis was incorrect. Evidence: `m7/acceptance-1.log,m7/acceptance-2.log,m7/acceptance-3.log,m7/acceptance-4.log`.

## Gaps and deviations

- The starter message corpus has no message media or reactions. Their fields were included in every snapshot, but preservation of populated values in those classes is not demonstrated by this corpus. No scale migration was attempted.
- The app guide returned `E_GUIDE_STALE`: “certificates.json is missing operation(s): digest._timerBinding_digestClock, insights._timerBinding_expireTrending, messages._timerBinding_expireMessage, presence._timerBinding_expireDevice”; its suggested check did not repair the lookup. The available job and successor diagnostic pages supplied the migration instructions.
- Port substitution was required: backend49120, web49121, push49122. Compiled effect grants needed the same source-level relocation because a module hook cannot rewrite the native owner’s compiled effect configuration. Push stayed disabled during starter replay.
- **Port-scope deviation:** the first three M7 UI suite attempts accidentally accessed the unrelated service on49101 due to static import ordering. The final suite and both green choreographies used49121. No unrelated process was stopped or inspected. The early attempts are retained as failures; their side effects are not claimed as this lane’s evidence.
- Runtime was Node25.9.0, differing from ENVIRONMENT.md’s24.18.0. The inherited setup identity was passed unchanged to choreography; its toolchain declaration is therefore not a newly measured environment attestation. No dependency pins changed.
- The M7 expiry suite temporarily sets a1.5-second server window through the existing operator configuration API, then restores production windows. It tests actual scheduled expiry; no caller timestamp is accepted.
- Native evidence is a Hermes build artifact, not an iOS simulator interaction proof. Existing product/platform gaps in the inherited final report remain outside M7 scope.
- No capability-failure stop was reached. Compiler refusals and UI setup failures were correction loops, not silently discarded successful attempts. No token estimate is made.

Recorded server PIDs: [27149, 1366, 1367, 1368, 1369]. All were stopped by explicit PID. The final scan of49120–49123 was empty: [cleanup](cleanup.json), [ports](ports-after-cleanup.txt). Diary and essay were written before this quantitative tally.

end=1788745931
