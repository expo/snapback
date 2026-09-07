# M7 final report — astra-clique-supabase

status=green

start=1788745660
end=1788747212
wall=1552 seconds

Model gpt-6-astra, effort medium, backend @supabase/supabase-js 2.112.4. Fresh schema clqfa_m7 and Auth namespace clqfa_m7_; all three starter segments were seeded through the inherited app path before migration. No other lane, prior implementation, diary, or essay was inspected.

## Results

- Exact command `npm run acceptance -- --milestone m7`: PASS, 6/6 suite-required assertions. [Suite](suite-m7.json), [coverage](coverage-manifest.json), [console](acceptance-final.log).
- Sole-segment `node scripts/choreo.mjs m7`: GREEN; live retained votes, changing vote, offline pending state, and exact settlement passed. nonGreenCause=null. [Receipts](choreography-final.jsonl), [console](choreography-final.log).
- Immediate post-migration snapshot comparison: PASS. Final post-regression verification: PASS for 8 personas, 48 original message projections, 224 post projections, and 18 unique media byte hashes. [Original manifest](pre-snapshot/manifest.json), [immediate comparison](snapshot-comparison.json), [final preservation](final-preservation.json).
- Conversation backfill: d-alice-bob=6, g-starter=9. Pre-M7 schema had no conversation count structure; post like_count already existed. Polls, deletion, and real shortened-window expiry are covered; final count mismatch set was empty. [Migration](migration.log), [checks](acceptance-details.json).
- Concurrent insert/delete and revoked-membership/deleted-poll probes: PASS. [Evidence](count-concurrency.json). Connected poll creation followed by voting: PASS. [Evidence](new-poll-vote.json).
- TypeScript: PASS. iOS Hermes and web exports built from final source; [hash manifest](artifact-manifest.json). [Poll](poll.png), [settings](chat-settings-final.png).

## Previously green suites

| Milestone | Final result | Evidence |
|---|---|---|
| M1 | PASS | [log](regression-m1.log) |
| M2 | PASS | [log](regression-m2.log) |
| M3 | PASS | [log](regression-m3.log) |
| M4 | PASS | [log](regression-m4.log) |
| M5 | PASS | [log](regression-m5.log) |
| M6 | PASS | [log](regression-m6.log) |
| M8 | PASS | [log](regression-m8.log) |

All prior milestone suites stayed unchanged. There were no previously-red milestone suites in the inherited record. The pending-quote renderer correction restored the previously-green M3 behavior. Earlier failures are retained rather than replaced by the final pass.

## Correction loops

1. **agent-error** — Background server exited before readiness; initial seed connection refused. Persistent exec session and absolute Node24.18.0. Evidence: m7/seed-m1.log.

2. **agent-error** — Initial snapshot could acquire changing receipt states. Before app/schema edits, stabilized every persona at read and resealed complete media/hash export. Evidence: m7/pre-snapshot-export-final.log.

3. **agent-error** — Python UI-edit helper quoting SyntaxError. Corrected helper quoting before it wrote the UI file. Evidence: m7/run-log.md.

4. **agent-error** — Previously-green M3 quote suite twice observed missing pending excerpt. Resolve quoted text from already-loaded source until server projection arrives; unchanged M3 suite passes. Evidence: m7/regression-m3-attempt1.log; m7/regression-m3-retry.log; m7/regression-m3-corrected.log.

5. **agent-error** — M7 scratch messages reused the unique starter search phrase; M5 strict locator matched multiple rows. Changed M7 fixture string; Alice left only M7-owned earlier scratch groups via API; unchanged M5 suite passes. Evidence: m7/regression-m5-attempt2.log; m7/scratch-cleanup.log.

6. **agent-error** — React Native View received raw empty text; first whitespace-only diagnosis was incomplete. Removed JSX whitespace and boolean-gated empty error strings in the touched renderer. Evidence: m7/poll-dom.log; m7/poll.png.

7. **agent-error** — Native poll accessibility props did not produce contracted web attributes; first choreography failed. Explicit aria-valuetext/selected/busy using the inherited web adapter pattern; frozen instrument untouched. Evidence: m7/choreography-attempt1.log; m7/choreography-final.log.

8. **agent-error** — Code review found raw cached poll options differ from history projection. Normalize option lookup for cached/queued/history shapes; connected create-then-vote probe passes. Evidence: m7/new-poll-vote.json.

9. **agent-error** — Supplemental blocked-history probe dereferenced an absent option while pending state settled. Removed artificial history block, added null-safe wait, tested connected create-then-vote; no blocked-history success claim. Evidence: m7/new-poll-vote-attempt1.log; m7/new-poll-vote.log.

No Supabase-defect attribution was established. Environment facts: the initial PATH resolved Node25 despite the inherited pin, so work switched to absolute Node24.18.0; the lane has no .git directory.

## Gaps and limits

- Starter-state migration only; no migration-at-scale claim.
- Starter conversations have no media attachments or reactions. Their empty fields are preserved; social post media and avatar bytes were independently hashed. No claim of migrating populated pre-existing chat-media/reaction rows.
- Polling, the Node API, and its one-second expiry worker remain deployment dependencies. Chat reads settle expiry before returning counts; the stored field can lag a wall-clock expiry until a worker/read settles it.
- M7 includes an iOS Hermes export, not an M7 simulator interaction run. No Android run.
- Prior scale degradation failures recorded by the inherited final report remain outside M7 scope and were not repaired or rerun.
- No Git repository exists in this lane; changes are local with inherited-file copies and artifact hashes, not a commit.
- Hosted M7 state is retained for the grader. Local servers are stopped; restart instructions are in m7/README.md.

## Process and record cleanup

Only ports49300 and49301 were used. Recorded server PIDs:77368 (exited before readiness),86466 and40762 (stopped during API restarts),2343 (web),86626 (final API). The final active PIDs2343 and86626 were verified and individually stopped. No pattern kills or hosted-state cleanup were used.

[Diary](diary.md) was written first, then [closing essay](essay-paragraphs.md), before this numeric report. The timestamped [run log](run-log.md) retains errors, retries, lookups, and corrections.

end=1788747212
