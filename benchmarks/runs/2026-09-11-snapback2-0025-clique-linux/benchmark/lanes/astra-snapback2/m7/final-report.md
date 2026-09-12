# M7 final report

Status: **green**. Lane astra-clique-snapback2; model gpt-6-astra; effort=medium; backend=snapback2-0.0.25.

Raw start epoch: **1789176401**. Raw end epoch: **1789177435**. Wall: **1034 seconds**.

Implemented group poll composition, live member tallies, changeable idempotent votes, offline queue presentation, and a required conversation messageCount displayed in settings. Counts include polls and exclude tombstones and scheduled expiry. API and upgrade instructions are documented in the lane README/API.

## Acceptance and evidence

- `npm run acceptance -- --milestone m7`: **pass**, all six suite-required assertion IDs covered. [Suite](suite-m7.json), [coverage](coverage-m7.json), [passing run](acceptance-fifth.log).
- Frozen choreography, **M7 as the sole selected segment**: **pass**, both required assertions. The live assertion retained all three actor/option attempts; the offline vote queued, arrived once, and cleared pending. [Passing output](choreography-second.log), [summary](choreography-summary.json), [all attempts](choreography.jsonl). The summary's suite SHA-256 matches the current suite receipt.
- Previously green suites **M1, M2, M3, M4, M5, M6, M8: all pass**. [Regression results](regression/results.json). Their inherited assertion implementations were not repaired. Earlier failed attempts remain under regression-first, regression-second, regression-fourth, and the acceptance logs; the final regression pass needed one attempt per suite.
- Schema certification passed for both migration stages. TypeScript passed after the final UI correction. Final iOS Hermes export: [artifact verification](artifact-verification.json), [export log](hermes-final.log). No iOS simulator claim on Linux.
- Scheduled text-plus-poll expiry reduced a count from two to zero: [expiry proof](expiry-proof.json). Independent persona/API count reconstruction passed: [count verification](count-verification.json).

## Migration and preservation

The pre-M7 schema **already carried count structures**: messageCounts and deletion-aware liveMessageCounts (plus author-specific counts). It did **not** have conversations.messageCount. A new optional count column and poll fields/tables were installed by a schema successor; the system backfill wrote both existing conversations; a second successor made the count required with zero null/affected rows. [Predecessor schema](pre-schema.q), [optional successor](successor-optional.json), [backfill receipt](backfill.log), [required successor](successor-required.json).

A fresh backend was seeded through the app's m1/m2/m3 seed commands. The previous main runtime was retained under inherited-runtime and never used as this migration's database; the scale databases were not used. Before product/schema edits, eight independent persona-token custom clients exported the M6 field manifest. Exact normalized pre/post comparison passes for **8 personas, 2 conversations and 15 unique messages**. [Pre snapshot and hashes](pre-snapshot/manifest.json), [post snapshot](post-snapshot/manifest.json), [comparison](snapshot-comparison.json). Tokens are not included in exported files. Comparison was captured immediately after backfill, before acceptance mutated application state.

## Correction loops and attribution

- **environment / agent setup:** initial background launch did not survive its shell; relaunched through a persistent foreground session. All actual server trees were recorded. Initial file-path guesses were corrected with file discovery.
- **agent-error:** the initial PID filter also matched the controller's lane argument; it was excluded before any cleanup. Exact recorded server trees, rather than pattern matching, governed termination.
- **ambiguous test/transport lifecycle:** M6 push checks failed while a preceding Bob stream remained reported connected. Initial parent-client and synchronous-subprocess explanations were incomplete; those claims are corrected in the log. Measuring the public connected predicate and waiting until zero satisfied the unchanged test's precondition. [Connection samples](regression/m6-precondition.json), [isolated passing M6](m6-isolated.log).
- **agent-error:** an ad-hoc connection diagnostic used invalid Quarry range syntax (E_QUARRY_SYNTAX); the final diagnostic takes one principal and returns its connection count. No product schema or stored data was changed by these refused diagnostics.
- **agent-error:** a settings assertion sampled the initial cached count before its live update; it now waits for the semantic value. [Failed attempt](acceptance-third.log).
- **ambiguous timing:** an unchanged M3 quote click detached during one regression run. That failure is retained; later unchanged runs passed. The M7 runner permits up to three attempts only for timing failures, per the global ruling.
- **agent-error:** the first choreography proved vote delivery but caught a busy marker retained after commit. The UI now tests queued entry state rather than the existence of a retained outbox ledger entry. [Failure](choreography.log), [correction pass](choreography-second.log).

No capability failures or unexpressible required platform feature were encountered. Incidental syntax/test failures were correction loops, not milestone capability failures. No inherited product failure was repaired under M7.

## Limits and gaps

- This is the prescribed starter-state migration, not a scale migration. The starter message snapshot contains **0 populated media references and 0 messages with reactions**; preservation checks for those absent message fields are therefore vacuous. Populated message fields, quoted replies and persona-specific receipt states were compared exactly; prior media/reaction suites also pass.
- The phase does not supply native simulator execution. It supplies an iOS Hermes build and web interaction evidence.
- Poll vote enumeration uses the inherited 50-member group envelope. Membership churn exceeding 50 distinct voters on one poll was not exercised.
- Regression requires a running owner/web server and this lane's migration snapshots. Its disconnected-recipient check explicitly waits for transport liveness to clear.

[Diary](diary.md) and [closing essay](essay-paragraphs.md) were written before this tally. [Run log](run-log.md) retains timestamped lookup, error and correction evidence. Only ports 53200 and 53201 were used. [Recorded server PIDs](server-pids.json) were stopped with exact-PID cleanup; no pattern kills were used. [Cleanup](server-cleanup.json).

end=1789177435
