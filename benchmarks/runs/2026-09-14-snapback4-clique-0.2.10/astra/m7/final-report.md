# M7 — Day-2 evolution final report

- lane id: astra-clique-snapback4-full-20260913
- model: gpt-6-astra; effort=medium
- backend: snapback4@0.2.10; native arm: snapback4-expo@0.2.3
- phase: m7
- start=1789433536
- end=1789436360
- wall=2824 seconds (47.07 minutes)
- status: **green**

## Shipped behavior

Group polls support server-validated questions and options, one changeable vote per user, idempotent client-mutation IDs, live tallies, and durable offline voting. Polls use the existing message receipts, deletion window, and expiry behavior. Deletion also removes option labels from sync. The message-count API field is shown in chat settings and includes polls while excluding tombstones and swept expired rows.

The pre-M7 schema carried **no conversation message-count structure**. Its messageClocks table was an ordering clock. The physical migration adds/backfills messages.countWeight; a stored maintained sum supplies conversation.messageCount. This is a projected API field backed by persisted aggregate state, **not a physical counter column on conversations**. The initial backfill wrote 15 starter messages. The published CLI's nullable-stage → Quarry job → required-column/adoption path is implemented in [migrate.mjs](migrate.mjs). Backend changes are Quarry only.

## Acceptance and choreography

**npm run acceptance -- --milestone m7** passed: **7/7 cases**, **6/6 suite-required IDs**, no missing coverage. [Suite](evidence/m7-suite.json) · [coverage manifest](coverage-manifest.json) · [complete final command output](evidence/acceptance-final.log).

The sole selected segment was **choreography.mjs m7**, invoked by **node scripts/choreo.mjs m7**. Both required assertions passed: live retained vote changes and offline vote reconciliation. The live assertion ran its three retained actor/option trials. Final segment green=true; nonGreenCause=null. [Final choreography output](evidence/choreography-final.log) · [receipts](evidence/choreography.jsonl) · [observations](evidence/choreography.observations.jsonl).

The full acceptance command ran after the backend correction and PID-ledger correction. A subsequent cosmetic-only change replaced repeated question text in the message shell with “Poll”; final choreography, visual checks, typecheck, and iOS export were repeated afterward. No backend or assertion change followed the passing full suite.

## Previously green suites

Every previously green milestone was rerun through its existing assertions. The working directory was the fresh M7 instance, so SQL inspection, provider logs, and the M8 restart proof used the correct database. Prior assertion files were not modified. There were no previously non-green milestones to repair.

| Milestone | Result | Cases | Evidence |
|---|---|---:|---|
| M1 | pass | 6/6 | [receipt](instance/evidence/m1-suite.json) |
| M2 | pass | 10/10 | [receipt](instance/evidence/m2-suite.json) |
| M3 | pass | 5/5 | [receipt](instance/evidence/m3-suite.json) |
| M4 | pass | 6/6 | [receipt](instance/evidence/m4-suite.json) |
| M5 | pass | 7/7 | [receipt](instance/evidence/m5-suite.json) |
| M6 | pass | 5/5 | [receipt](instance/evidence/m6-suite.json) |
| M8 | pass | 4/4 | [receipt](instance/evidence/m8-suite.json) |

[Combined regression results](evidence/regressions.json). Initial passes and the PID-ledger-induced failed M8 attempt remain retained; the final result is from the complete successful rerun.

## Preservation and migration evidence

A fresh backend was seeded through the application's own path with starter-m1.log, starter-m2.log, and starter-m3.log. No scale database was used. Seed outputs are under evidence/seed-m1.txt, seed-m2.txt, and seed-m3.txt.

Before any app/schema change, the custom-client API exported all eight personas using their own tokens into [pre-snapshot/](pre-snapshot/), with one file per persona and a SHA-256 manifest. The immediate post-migration comparison passed over every recorded M6 message field, including timestamps, media references, reply IDs, tombstones, reactions, and caller receipt state. The starter conversations backfilled to 6 and 9 visible messages. [Primary comparison](evidence/snapshot-comparison.json) · [post-migration export](post-migration-snapshot/).

The starter message corpus has no populated message-media references or reactions; its empty values were preserved, not presented as populated coverage. Supplemental API reads verified **18 starter avatar/post media byte hashes** against the fixture files. The later corrective schema adoption was also snapshotted before/after and preserved populated test-era message state: **3 distinct media messages** and **0 distinct reacted messages** were present in that comparison. [Media verification](evidence/starter-media-preservation.json) · [corrective adoption comparison](evidence/correction-snapshot-comparison.json).

These comparisons are recorded at the migration boundaries. Subsequent acceptance/choreography legitimately adds data and advances receipts; the final exercised database is not claimed byte-identical to the untouched starter state. Independent grader execution of m7-a08 remains external.

## Corrections and backend defect

There are 12 grouped correction episodes: 10 agent-error, 1 environment, and 1 snapback4-defect. These are grouped episodes, not a count of every diagnostic line. [Structured corrections](correction-loops.json) · [timestamped run log](run-log.md).

- **paths — agent-error:** Guessed several module paths; used file search to locate the actual harness and frozen poll widgets. [evidence](run-log.md)
- **rules-and-indexing — agent-error:** Used row dereferences in rules and treated list indexing as nonoptional; corrected rules and unwrapped validated option indices. [evidence](evidence/check-1.txt)
- **nullable-sum — agent-error:** A sum maintain cannot use int?. Staged nullable contribution, ran the backfill, then required the column and introduced the sum. [evidence](evidence/check-2.txt)
- **expiring-mutation-scan — agent-error:** A mutation cannot scan expiring option/vote tables. Removed the unsupported sweep and later implemented bounded option-key point deletions. [evidence](evidence/check-3.txt)
- **poll-label-revocation — agent-error:** Review found option labels retained after a tombstone. Stored option keys, backfilled test-era polls, and used four explicit point deletes after a list-delete loop was refused. [evidence](evidence/check-deletion.txt)
- **generated-aggregate-identity — snapback4-defect:** A maintained compound key accepted during writes exceeded the identity bound during later schema adoption. Old schema reopened. Minimal reproduction confirmed the failure; replacing only the derived tally cache with indexed vote counts preserved data and enabled adoption. [evidence](evidence/aggregate-id-repro.json)
- **failed-adoption-sequencing — agent-error:** Dependent export/comparison/suite commands continued after adoption failed, producing a setup-red attempt. Retained failed evidence and verified recovery before the next full run. [evidence](evidence/m7-suite-startup-failure.json)
- **node-shim — environment:** The shell shim resolved Node 25.9.0 despite the environment document declaring Node 24 first. Final acceptance, choreography, and native export used explicit Node 24.18.0. [evidence](evidence/toolchain-final.txt)
- **pid-ledger-order — agent-error:** A late historical backend entry made the inherited restart helper choose an exited PID. It failed ESRCH without killing a process. Relabeled the historical CLI child and reran the full unchanged suite command. [evidence](evidence/pid-ledger-order-failure.jsonl)
- **adapter-relative-path — agent-error:** Preflight review caught fixture paths resolving relative to the M7 adapter directory; corrected before choreography. [evidence](prepare-choreography.mjs)
- **duplicate-question — agent-error:** Screenshot review found duplicate question copy in the message shell and poll card. Changed only shell text to Poll; repeated choreography, screenshots, typecheck, and iOS export. [evidence](evidence/poll-ui-before-label-fix.png)
- **report-template-quoting — agent-error:** Markdown backticks were not escaped inside the JavaScript report template. Corrected formatting and reran generation; application verification was unaffected. [evidence](evidence/report-generation-error.txt)

The backend diagnostic was **E_INPUT: identity exceeds 144 canonical tagged UTF-8 bytes**. A compound maintained poll-tally key was generated and accepted on write, but prevented a later unrelated schema adoption. The old schema reopened. The minimal public-CLI reproduction records success → adoption failure → old-schema success. The workaround removes only the derived tally cache and reads exact bounded indexed counts from preserved vote rows. No Snapback source checkout or backend internals were edited. [Reproduction](evidence/aggregate-id-repro.json).

## Native, UI, and cleanup

Final typecheck passed. The final iOS Hermes export used the required pins and Node 24.18.0. [Hermes bundle](artifacts/final-ios/_expo/static/js/ios/entry-014cfc6bb7f1f6071503f60be3a1d60e.hbc) — 2700438 bytes, SHA-256 1749e8f09b9f2ed6e592c0d043ed5ec2eec9228cc74126ca8631b636a23b9a88. [Export log](evidence/ios-export-final.log) · [toolchain](evidence/toolchain-final.txt).

[Poll screenshot](evidence/poll-ui.png) · [settings count screenshot](evidence/count-settings-ui.png). The diary and essay were written before this tally: [diary](diary.md), [essay paragraphs](essay-paragraphs.md).

All recorded servers are stopped. Cleanup used explicit recorded PIDs with command/cwd verification, and no pattern kills. No listeners remain on the used ports 49340 and 49341. [PID ledger](pids.jsonl) · [cleanup](evidence/server-cleanup.json) · [port check](evidence/ports-after-cleanup.json).

## Candid gaps and limits

- Maintained message counts follow Snapback's expiry sweep, documented within one second. Message reads refuse expiry immediately; instantaneous aggregate expiry is not claimed.
- Migration was over the required starter state, with a later preservation check over test residue. No migration-at-scale claim is made.
- Native evidence is an iOS Hermes build, not an M7 simulator/runtime proof. The native package remained pinned.
- Poll options/questions are immutable after creation; votes are changeable. Indexed tally reads are bounded by the vote table's per-poll cap.
- The generated aggregate-identity defect is worked around in this app, not fixed in the public backend package. It remains a risk for other long compound maintains during future evolution.
- The initial shell resolved Node 25.9.0 contrary to the environment document. Final scored verification used explicit Node 24.18.0; earlier attempts remain disclosed.

end=1789436360
