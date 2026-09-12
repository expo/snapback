# Independent grading trace — focused Snapback3 Clique (selected scope)

Grader: single Claude Opus 5 agent, no delegation, no other model invocations.
Window: 2026-09-12 16:19:40Z → 16:42Z (90-minute prompt safety limit).
Working copy: `packet/lanes/astra-snapback3-grade` (grader-mutable). Builder snapshot never written.
Scope file `../../SCOPE.md` SHA-256 `98ad61d3…1c0d` — matches the frozen value.
No builder diary, essay, final report, run log or self-assessment was opened; those files are absent from this copy. No contamination occurred.
No credentials or environment variables were printed; the fixture password appears nowhere in this trace or the report.

## 1. Intake and identity
- Read `execution-input.json`, `SCOPE.md`, `BUILD.md`, `API.md`, `package.json`.
- Installed package identity confirmed as `snapback3@0.0.1-experimental.0`; lockfile still points at the authorised immutable tarball (`719eba5b…fbc4e`).
- Verified all 31 coordinator-oracle input files byte-for-byte against `instrument/fixtures` (31/31 match), the oracle script hash, and all 6 oracle artifact hashes. → `grading/evidence/oracle-input-verify.txt`.

## 2. Servers (grader-owned only)
`scripts/start-owned.mjs` could not run: builder `evidence/*.log` files are read-only (EACCES). Started the same CLI directly:
- PID 1609943 `serve .` on 54900, PID 1609944 `dev artifacts/scale-app` on 54901; logs under `grading/evidence/`.
Ports 54910–54912 and 54800 untouched. Both PIDs stopped at the end.

## 3. Builder's documented selected suite (raw result preserved)
`node scripts/selected-checks.mjs` → exit 0, 11.6 s, 19/19 pass (`grading/evidence/rerun-selected-checks.log`).
`node scripts/controls-check.mjs` → exit 0, 3/3 pass (`grading/evidence/rerun-controls-check.log`).
The builder's own `selected-results.json` retains 25 pass + 1 fail (`s3-resource-independence-http-batch-failure`); that failure is preserved here as a failure.

## 4. Fixture/projection audit against the independent oracle (read-only)
Copied the three SQLite stores to `grading/dbcopy/` and queried them read-only.
- Scale store: 1,002 conversations, 100,015 fixture messages (+18 recorded diagnostic sends), 2,053 memberships, 2,000 reactions, 1,008 profiles.
- Sorted-ID digests for messages and conversations **equal** the oracle commitments; 2,736 quoted-reference tuples digest **equal**; all 2,000 reaction tuples identical.
- Scopes: u0001 1,000 conversations (100 groups / 900 DMs) and 100,000 authorized messages, and it does **not** see the 15 starter messages; u0500 100 conversations / 10,000 messages with g0001 at 50 members / 10,000 messages; starter DM 6 / group 9.
- 910 media→text conversions all preserve the exact source caption with a distinct `[Projected media image: …]` label; the 6 starter media posts are labelled text in `posts`.
- Projection manifest matches the oracle exactly: 167,243 original → 105,134 selected → 62,109 omitted, 1,008 avatar omissions; omitted breakdown sums correctly.
- The builder harness's expected-ID files (`artifacts/fixture/*-ids.json`) equal the oracle-derived authorized sets exactly for u0001, u0500, alice, bob, carol.
Evidence: `scale-db-vs-oracle.txt`, `scale-quotes-reactions-media.txt`, `fixture-idfiles-check.txt`.

## 5. Insights computed independently (not from the app's own aggregate)
From the database rows plus the recorded mutations: Alice has 3 top-level posts + 1 authored reply, 2 fixture likes received, 1 repost, 1 reply, 4 followers, 2 following; every relation matches the oracle.
The rendered Insights screen showed seven UTC-day rows 2026-09-06 … 2026-09-12 with six zero-filled empty days. A grader-issued fresh Bob like on the previously unliked Alice post `sp0003` moved likes-received by exactly +1 (3→4) on refresh.
**Declared ambiguity (not silently resolved):** the app's "Posts" total is 4, i.e. it counts the authored reply; the oracle records both 3 (top-level originals) and 4 (all authored entities) and flags the label as unspecified.

## 6. Independent browser exercises (my own drivers, not the builder's)
`grading/independent-probe.mjs` and `grading/independent-probe2.mjs`, reading rendered DOM values:
- Auth restoration after a full reload without re-login: principal restored, fixture text rendered.
- Rapid navigation + logout/login churn: probe 2 passed; probe 1 failed to re-render DM history within 15 s → intermittent defect D3.
- Denied ancillary summary (`?denyUnread=1`): rendered unread "Unknown" (not zero), 84 authorized messages still rendered, send committed once, exactly one recipient copy.
- Durable send during an artificially delayed read (4 s route delay on `messages.page`/`conversations.unread`): durable 3.4 ms, settled 21.7 ms, committed, recipient observed.
- Genuine browser offline: `fetch('/api/query')` throws before close and after reopen; the reopened page restored the shell from the service worker, rendered 88 acquired messages from IndexedDB, kept exactly one pending send, and offline search found the exact expected row. (`navigator.onLine` misreports `true` on the reopened page; the fetch failure is the authoritative evidence.)
- Two offline queues, reconnect client0 then client1: exactly one copy of each on the independent recipient, non-decreasing server arrival timestamps.
- Receipt states: acceptance set neither watermark; `messages.fetched` then `messages.viewed` each advanced past the target timestamp. A delivered-only state could not be isolated because the recipient UI auto-issues `viewed` when it renders history (D5).
- Unread: the rendered UI never shows a non-zero unread for the open conversation because opening it marks it viewed (D4); convergence itself is verified at the resource level.

## 7. API and pagination (independent)
- Documented raw HTTP: `POST /api/auth/login` → bearer token → `POST /api/query`; authorized inbox and message pages returned.
- SDK persona path on the scale server for u0500: 100 conversations over 2 pages; g0001 history over 51 pages (200×50 + 19) = 10,019 unique IDs, 0 duplicates, 0 missing versus the oracle-derived set.
- Ran `scripts/custom-client-demo.mjs` (m6-a10/a11) successfully, and independently followed the API.md prose recipe to fetch `messages.latest` for `g-starter` → `sm0015` (m6-a12, which the builder had listed as an omission for independent execution).

## 8. Acquisition repetitions (independent, 180 s deadline, 30/60 s progress retained)
| run | variant | result |
|---|---|---|
| u0500 | foreground send at t=20 s | complete 34.8 s, 10,000/10,000 IDs in memory, **IndexedDB 503 rows / 402 message IDs**, offline reopen served 200 of 10,000, 96 page failures |
| u0500 | repeat, send at t=20 s | complete 35.4 s, same collapse (503 rows, 92 failures, 9,800 missing) |
| u0500 | builder placement, send at t≈0 | complete 33.8 s, IndexedDB 10,221 rows, offline all pages complete (10,021 IDs, 0 failures) — reproduces the builder result |
| u0001 | send at t=20 s | **timeout at 180 s**, 38,900 of 100,000 (builder: 42,500–42,900), 10,000 @30 s, 17,400 @60 s, 430 requests, 74.3 MB, 415 long tasks |

This is defect **D1**: complete durable acquisition + offline reopen for u0500 holds under the builder's send ordering but not under the SCOPE-mandated foreground send after substantial acquisition, where previously acquired content stops being durable. **D2**: hub acquisition cannot complete, as the builder honestly reported.

## 9. Paging and storage audit
- Busy g0001 record audited: 3 warm-ups + 20 real-request samples per page, every sample with ≥1 HTTP request and 200 rows, page 1 IDs `mg0001-00001…00200`, page 50 IDs `mg0001-09801…10000`, zero failures; p95 137.4 ms (page 50) vs 237.8 ms (page 1), ratio 0.578 ≤ 3. No cached zero-request reads.
- Storage reproduced read-only: scale file 113,262,592 B (4,096 × 27,652 pages); `rows` 30,523,392 B, `_commits` 23,511,040 B, `index_entries` family 55,689,216 B — matching the builder's physical table exactly. WAL sizes were recorded pre-stop by the builder with an explicit checkpointing disclosure. No comparison to the prior 5.2 GB full app appears anywhere.

## 10. Measurement audit highlights
- Peak/last-sampled heap in every acquisition row includes the IndexedDB `getAll()` + `JSON.stringify` inspection step and the driver's in-memory ID arrays; last sampled heap is not steady-state retained heap. The builder discloses instrumentation inclusion generically but not this specific inflation.
- IndexedDB bytes are correctly reported twice with provenance (storage estimate vs direct JSON serialization).
- The builder's foreground send is issued at acquisition start, so its sub-second durability/settlement numbers describe an unloaded client; the grader's later-placed send is reported separately.
- No CPU profile exists for the slow acquisitions (gap G1); neither party invented a phase attribution.

## 11. Housekeeping
Grader-owned PIDs 1609943 and 1609944 stopped by exact PID at the end. Builder `selected-results.json` and `measurement-summary.json` were read only. No product or app code was repaired; all probes live under `grading/`.
