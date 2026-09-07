# M7 final report

status=green
start=1788744500
end=1788745332
wall=832 seconds

Lane `astra-clique-convex`; model `gpt-6-astra`; effort `medium`; backend `convex@1.45.0`. Fresh anonymous local backend, seeded through the app with starter M1/M2/M3. The inherited database is preserved in `m7/inherited-backend`; the active M7 database is `.convex/local/default`. No other lane, scale database, prior diary, or prior essay was inspected.

**Delivered:** group poll creation and live changeable votes with persistent retry-safe set-state intents; conversation message counts with transactional backfill and forward text/media/poll/delete/expiry maintenance; settings display; API and migration documentation. The pre-M7 schema had no conversation count structure.

**M7 acceptance:** 6/6 tests passed; all six suite-required assertions covered, zero missing. Evidence: [suite](acceptance/suite-m7.json), [coverage](coverage-manifest.json), [console](acceptance-console.log). The actual npm command used `M7_REUSE_REGRESSION=1` to consume the seven unchanged suites just run in this same session; the documented default command reruns those suites.

**Choreography:** sole segment `m7`, both required assertions passed; `green=true`, `nonGreenCause=null`. All three retained live actor/option trials and the distinct offline vote path ran through real browser contexts. Evidence: [receipts](choreography.jsonl), [console](choreography-console.log). The lane adapter selects a unique UI-created poll group and its actual option IDs; no harness check changed.

**Data preservation:** the pre-snapshot has eight persona files plus SHA-256 manifest. Immediately after backfill, every full persona API export was exactly equal, including all M6 fields and supplemental profile/post API views. The final post-test check preserves all original message fields and accepts only monotonic receipt advancement caused by real activity. Evidence: [pre-snapshot](pre-snapshot/manifest.json), [exact comparison](snapshot-comparison.json), [final comparison](final-snapshot-comparison.json).

**Previously green suites:**

| Milestone | Result | Tests |
|---|---|---|
| M1 | pass | 6/6 |
| M2 | pass | 10/10 |
| M3 | pass | 5/5 |
| M4 | pass | 3/3 |
| M5 | pass | 4/4 |
| M6 | pass | 3/3 |
| M8 | pass | 3/3 |

Evidence: [regression results](regression/results.json). Prior suites were not edited. TypeScript passed; the [iOS Hermes export](ios/metadata.json) passed.

**Correction loops and attribution:**

- `agent-error` (knowledge-lookup): Absent lib directory and PollCard.tsx; enumerated existing components and found PollCompose/PollDisplay.
- `agent-error` (knowledge-lookup): Absent choreography/adapter.mjs; inspected adapter defaults in choreography.mjs.
- `environment` (knowledge-lookup): No .git repository in supplied lane; used direct source inspection and acceptance evidence.
- `agent-error` (coverage-manifest): Shared tester overwrote m7-a06 mapping with its second test; restored backfill mapping and retained expiry evidence. No failing application assertion or changed suite verdict.

No demonstrated Convex defect, application-test retry, choreography retry run, capability failure, or safety-cap exhaustion. The observed whitespace warning is separately `ambiguous` and was not repaired. Timestamped evidence is in [run-log.md](run-log.md).

**Candid gaps:**

- Backfill is validated on the prescribed starter corpus, not the scale database; each conversation is read in one transaction.
- Starter messages contain no media/reactions. Exact M6 preservation covers their actual empty state; supplemental profile/post API views preserve existing media references. No pre-migration message-media bytes were present to hash.
- Post-test original message receipts advanced normally in six cases; immediate post-migration comparison was exact, and final comparison requires monotonic receipts with all other original M6 message fields unchanged.
- Inherited RNWeb whitespace warning observed during settings visual QA; origin is not browser-baselined and remains an ambiguous non-blocking issue.
- Count field remains optional to allow rolling migration; operators must run the documented backfill. Null means migration pending.
- Inherited native offline proof and performance limitations remain unchanged; M7 produces a Hermes bundle, not a new simulator proof.
- Existing outbox retains permanently rejected writes; voting on a poll revoked while offline inherits that recovery limitation.

Servers used ports 49200–49202. Only recorded PIDs 68043, 68206, and 1803 were signaled; all exited. Evidence: [shutdown](server-stop.json). Diary and closing essay were written before this numeric report. Token accounting is unavailable (`null`), not estimated.

end=1788745332
