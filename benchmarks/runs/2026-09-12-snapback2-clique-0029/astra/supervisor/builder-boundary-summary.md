# Astra 0.0.29 continuous-builder boundary

Captured after actual builder exit and before independent grading. This is private supervisor interpretation, outside the actor packet. No findings were sent to the builder or grader.

- Builder: PID 3569177, model gpt-6-astra, medium; 2026-09-12 05:36:14–09:24:15 UTC, exit 0. Foreground wrapper exited 0. Raw root rollout retained; no descendants, no wait/capture error. Token accounting remains raw and unjoined; cap adjudication unavailable.
- Initial snapshot: initial-builder-snapshot/MANIFEST.json, SHA256 6a1b0500a902233f7807145ac432105e8a56f7ae193f1773bd61a75ebe021e5b; 3,041 files, 152,655,371 bytes, no source changes during copying.
- Published payload comparison: initial-sdk-payload-comparison.json, SHA256 29775b7698bd187d8539129fdb2558f26879b90860b3a512b740140113e1a4e2. All 253 snapback2 files and all four Linux native files match the exact published 0.0.29 tarball manifest, with no missing, mismatched, or extra files.
- Snapshot/process helpers exited: capture PID 766099; comparison PID 766088. The actor shutdown receipt names the owner stops, exact Metro/static signals, and all assigned ports free. This does not erase the earlier port 53200 incident or establish a global traffic ledger.

## Actual client architecture at exit

The web provider creates one durable provider-owned client using indexedDbRangeStore and browserTokenStore. The native provider uses the React Native arm, its offline default, and expoSecureTokenStore.

Insights uses that provider client: initial useQuery(api.insights.mine), then c.query(api.insights.mine) on refresh. It does not call the new fallback. Source inspection does not establish the requested obsolete-result/account-change fences: this app's refresh function has no request-generation check and its local displayed state is not explicitly cleared by viewer identity in that file. Parent/graded evidence must determine actual coverage.

The app as a whole does NOT retain a single-client read architecture. src/read-fallback.ts creates an additional createClient({url, token}) with no durable store, obtaining the already-authenticated bearer from the provider client's public snapshot.token. It observes online when the durable result is unavailable and closes on effect cleanup/offline/account changes. Two callsites ship: profiles.social in src/profile.tsx and posts.thread in src/feed.tsx. No mutations are submitted through this reader. Its held React state can remain after the transport closes; there is no explicit offline state clear in the return expression.

The fallback was introduced after a canonical readable posts.thread repeatedly returned durable partial / Some data is not downloaded / never-held while a same-bearer plain observer succeeded. This is preserved in never-held-fallback-0812 and never-held-source-20260912T081522Z. The architecture is observed; the underlying SDK/application cause remains unadjudicated here.

## Builder outcomes and limits

All seven requested milestone latest suite/choreography receipts are claimed green by the final report and its final audit. Original greens, subsequent source changes, and later regressions are separate in the snapshot. A final M3 green was retracted after the actor discovered it had read a stale prior choreography log after a gated suite failure. A later NEW suite and NEW choreography passed after fixing in-flight send completion clearing a newly typed draft.

All 167,157 scale actions settled. Final invariant/custom-client checks: 3,242 passed, including exact 1,008 profiles, 50,228 posts, 100,015 messages, and 2,053 memberships. Supplemental named/media assertions: 135 passed. Hidden grader sample was not run.

Retained scale failures: 30-second cold durable sync deadline exceeded; Trending 50% read p95 exceeded its frozen interpolation ceiling by approximately 0.033 ms. Celebrity-write relative ratio was 0.827784. Group-visible p95 was 3711.708239 ms (20 measurements after three warmups); no calibrated absolute ceiling is claimed. Post-checkpoint E_TRANSPORT failures at both checkpoints are preserved separately from their invariant passes; same-id retries resumed.

No Apple simulator execution exists. Hermes exports are build artifacts only. N=1, different EPYC/Ryzen hardware across builders, no committed holdout/calibration, and prompt-only runtime caps remain explicit.

## Evidence custody clarification

The snapshot audit found 32 matching receipt links and five actual early-run hash mismatches: M2 attempt 1 and M3 attempts 2–5 link to suite aliases overwritten later. Four additional missing-path candidates are bundled metering TEST FIXTURES, not lost benchmark receipts. Do not count those four as missing run artifacts.

Other limitations remain: initial M1 suite alias was overwritten; missing m8-failure.png image-view attempt is retained in stderr; an attempted sync-probe archive raced alias replacement and was relabeled; accidental packaged minified source in uncaught errors was retained. Raw events preserve command/error history but do not reconstruct every overwritten standalone file.

## Read-only storage observation

storage-breakdown.json, SHA256 94c720a637194f3d796ace252c5e591c1dc964bf86310e1851c33780252036cb. Executed only after measurement completion, SQLite mode=ro&immutable=1 plus query_only, 15-second query/25-second process bound, completed in 3.346 seconds. No row contents selected or printed; source size/mtime unchanged.

Physical database: 5,196,644,352 bytes; 4096-byte pages; 1,268,712 pages; two free-list pages (8192 bytes). Generic index_entries table/index family: 3,638,677,504 bytes (70.020%); rows+primary index: 806,375,424 (15.517%); search-postings family: 687,235,072 (13.225%); commits: 37,990,400 (0.731%). In-page unused bytes total 577,937,297. This identifies allocated structures, not the cause or necessity of their size.

The earlier whole-file Node hash failure above 2 GiB was a probe implementation failure. The canonical store remains preserved for grading; no vacuum, repair, schema write, or row update was performed by the supervisor.
