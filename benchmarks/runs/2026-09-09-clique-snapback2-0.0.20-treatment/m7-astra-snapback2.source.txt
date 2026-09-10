# M7 final report

lane id astra-clique-snapback2  
model gpt-6-astra; effort=medium; backend=snapback2-0.0.20  
phase=m7  
start=1788978135  
end=1788979666  
wall=1531 seconds  
status=capability-failure

Polls, offline voting, and the backfilled count are implemented. The milestone cannot be green because the required prior-suite regression assertion fails for M2 and M3. Both failures reproduce on the isolated pre-M7 schema and inherited UI. They were preserved rather than repaired under this phase's budget.

## Acceptance and choreography

`npm run acceptance -- --milestone m7` exited 1. M7 feature assertions a01, a03, a04, a06, and a07 pass; a09 fails. [Final suite](suite-final.json), [command output](acceptance-final.log), [validated six-assertion coverage manifest](coverage-manifest.json), [coverage validation](coverage-validation.json).

The sole selected `m7` choreography segment ran. Both assertions pass: all three retained live vote attempts and the offline pending/reconciliation attempt. Live tally observation times were 83.4, 80.5, and 102.3 ms. The runner correctly exits 1 with `green=false`, `nonGreenCause=suite-failed`, `outcomeClass=application`, because it binds the failing suite. [Output](choreography-final.log), [compact attempt results](choreography-attempts-summary.json), [linked summary](choreography-summary.json). No assertions or harness conditions were relaxed.

## Migration and preservation

The pre-M7 schema **already carried a raw messageCounts structure**. It included tombstones and was not the new required conversation field. The fresh starter instance is retained under `m7/instance`; all three starter segments were replayed through the app's write path before schema changes. No scale database was used.

An additive successor introduced the optional field and maintained visible-message buckets; a bounded job wrote both pre-existing conversations; a second successor made the field required. Backfilled counts were 6 and 9. [Migration details](migration.md), [backfill receipt](backfill-2.json), [initial count oracle](count-oracle-initial.json), [ready successor](migration-status-final.json).

The [pre-snapshot manifest](pre-snapshot/manifest.json) hashes eight persona exports over the M6 field manifest. The strict comparison immediately after migration/backfill passed for all 48 persona-visible records, representing 15 distinct messages. [Strict comparison](snapshot-comparison.json). The final comparison also passes for every original body, media reference, reaction, flag, and conversation field; six receipts legitimately advanced after browser interaction. Those advances are listed explicitly, not treated as strict equality. [Final preservation](final-preservation.json). Stored counts match the final visible history of all 12 conversations visible to the starter personas. [Final count oracle](final-counts.json).

## Previously green suites

| Suite | Result | Evidence |
| --- | --- | --- |
| M1 | pass | [receipt](suites/m1.json) |
| M2 | fail | [receipt](suites/m2.json) |
| M3 | fail | [receipt](suites/m3.json) |
| M4 | pass | [receipt](suites/m4.json) |
| M5 | pass | [receipt](suites/m5.json) |
| M6 | pass | [receipt](suites/m6.json) |
| M8 | pass | [receipt](suites/m8.json) |

M2 times out waiting for the paginated feed's oldest probe row. M3 observes the pending reply before its quoted excerpt is present. Both reproduce on the isolated, freshly seeded pre-M7 app/schema using URL-only copies of the original assertions. [Baseline results](baseline-regression-results.json), [baseline output](baseline-regression.log). M8's first ranking failure came from my reuse of auxiliary test state; a fresh auxiliary instance resolves it with unchanged assertions. Prior native M6/M8 and scale-browser failures remain untouched.

## Validation and corrections

Quarry check and TypeScript pass. [Compiler](check-final.log), [types](typecheck-final.log). The final Node 24 iOS Hermes export succeeds at `ios-final/`; no new simulator parity claim is made. [Export log](ios-export-final-node24.log), [artifact hashes](artifact-hashes.json).

11 correction/attribution log events are retained in [correction-loops.json](correction-loops.json); these are evidence events, not a claimed count of independent bugs. They cover:

- **agent-error:** wrong guide keyword; optional-time comparison; serve mode for an operator job; login-token handling; dirty auxiliary ranking state; CI-disabled Metro watching.
- **ambiguous:** poll row width exceeded the existing search closure ceiling; inherited M2/M3 application/suite failures reproduced on the baseline.
- **snapback2-defect:** `old.id` in the attempted conversation update rule was typed `Id` where `Ref<conversations>` was required (`E_RULE_INVALID`); the mixed rule fallback refused `E_QUARRY_UNKNOWN`. [Exact diagnostics](check-2.log), [fallback diagnostic](check-3.log).
- **environment:** PATH resolved Node 25 despite the overlay's Node 24 claim; initial suite/server execution used that runtime, then explicit Node 24 was used. React Native Web omitted native selected/busy state until explicit web attributes were supplied and actually served.

## Candid gaps

The all-green regression requirement remains unmet. The initial choreography attempt failed on missing web selection semantics; the final attempt passes. The conversation table rule now permits member updates so sends can maintain the field; exposed settings/member operations still enforce their original admin requirements. This relies on operation-level authorization rather than the preferred old/new declarative rule. Initial seeding preceded the provider and left 41 failed notification effects; data writes survived and M6's later provider regression passes. No retrospective notification-delivery claim is made. Preservation is proven on starter data, not migration at scale. Native proof is a Hermes build, not a simulator interaction run.

All started servers were recorded and stopped by exact PID after checking lane ownership. No listeners remain in ports 50100–50119. [Cleanup](server-cleanup.json), [listener check](listeners-after-cleanup.txt). The diary and essay were written before this numerical tally. [Diary](diary.md), [essay paragraphs](essay-paragraphs.md).

end=1788979666
