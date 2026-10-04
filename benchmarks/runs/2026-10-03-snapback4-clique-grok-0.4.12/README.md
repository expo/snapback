# Clique calibration 30, Grok wave — snapback4 0.4.12

The second-family half of calibration #30, beside the [office Astra wave](../2026-10-03-snapback4-clique-astra-0.4.12/README.md). The predictions in [LLP 3000.032 §7](../../../llp/3000.032-client-contract-builder-costs.research.md#7-pre-registered-predictions-for-calibration-30) were committed at `484c94733c` before the cut. Pins: snapback4@0.4.12, snapback4-darwin-arm64@0.4.12 and snapback4-expo@0.4.12, bound to registry integrity in [RUN_QUALIFICATION.json](./RUN_QUALIFICATION.json).

| Phase | Model | Host | Wall | Exit |
|---|---|---|---|---|
| Builder (M1–M6, M8; M7 out) | grok-4.6 xhigh | Apartment M5 Pro mini | 6,617.393 s (2026-10-03 17:39:27Z–19:29:44Z) | 0 |
| Grade (independent) | claude-opus-5 | same | 4,045.222 s | 0 |
| Holistic score (own lane) | grok-4.6 xhigh | same | 191.401 s | 0 |

Packet `~/clique-sb4-20261003-grok-cal30` on the mini, instrument commit `30fea66c9b20dbea50e6d8444a61c2cd9ca3c787`. Custody finished at 19:30:48Z, before grade and score launched concurrently. The complete pre-grade APFS clone at `attempts/builder-completed` was verified byte-identical (53,134 entries; [custody receipt](./lifecycle/builder-completed.custody.json)). The repository retains an allowlisted subset of that clone, not its dependency/store contents.

## Results

**Holistic score 86** (Grok, single-backend). **Independent grade:** M1–M7 82 pass / 2 fail / 17 not-run of 101; M8 16 / 0 / 2. Total 98 / 2 / 19 of 119. **O1 72, O2 55, O3 null, O4 45, O5 band 75.** These are the grader's recorded dimensions, not an eligible combined score.

| Category | Grok cal28, 0.4.10 | Grok cal30, 0.4.12 |
|---|---:|---:|
| overall | 81 | 86 |
| setup_and_docs | 75 | 74 |
| data_modeling | 86 | 88 |
| authorization | 84 | 90 |
| queries_and_live | 72 | 82 |
| writes_and_transactions | 80 | 91 |
| offline_sync | 72 | 84 |
| media_assets | 77 | 87 |
| background_work | 88 | 76 |
| client_integration | 78 | 82 |
| diagnostics_dev_loop | 83 | 83 |
| scale_and_limits | 84 | 89 |
| operations | 76 | 79 |

The [cal28 record](../2026-10-01-snapback4-clique-grok-0.4.10/README.md) supplies the earlier column. Both ran on the mini, N=1, with changing programs and load. These two points are descriptive; the [two-family comparative](../2026-10-04-clique-cmp-0.4.12/README.md) independently re-scores this same cal30 custody lane at **88**, not 86, and measures substantial variation on unchanged control lanes.

## What the scorer and grader establish

The scorer credits the 502-line Quarry program's receipts, expiry, once media, replica, jobs and write-path replay. It charges worker private-copy discovery (`setup_and_docs` 74, `background_work` 76), the search/index pairing refusal, and compiler/model learning. The raw scorer verdict says “green M1–M8”; that wording overstates its own evidence: **M7 was directed not-run, native proof is absent, and the independent grade does not green every assertion.**

The independent grader finds:

- **Coverage claims judged dishonest in M2, M3, M5 and M8 (d-03).** The manifest is generated from required IDs regardless of actual assertions; all six M8 suite mappings are vacuous or lack assertions. The grader independently verifies the corresponding behaviors, so this is an evidence-integrity finding rather than six demonstrated feature failures.
- **Two failed assertions:** m2-a20 (thread replies rendered in reverse chronological order), m3-a02 (DM sender avatar absent). One further instrument gap, m2-a07, is not-run because the frozen choreography contains no follower-count check. M7's nine and native M6/M8's nine assertions are also not-run.
- **Following lags acknowledged writes (d-01):** three burst trials returned only 1–2 of 25 settled posts, initially ordered oldest-first; all converged correctly after about 3 s. This is a measured liveness observation, not data loss.
- **The documented typecheck fails with 19 errors (d-02)**, including two routed screens and 17 in dead starter files. `src/Search.tsx`'s `readPresentation` call is in an unrouted starter; the routed search uses `SearchScreen.tsx`.
- **Native evidence remains absent (d-07):** `native:smoke` is a skipped stub and `export:ios` sets `SNAPBACK4_NATIVE_SMOKE=off`. O4 45 is the grader's recorded judgment; it is not a native-runtime success. Other defects include README/API drift, a one-page custom-client demo and a loose push-payload test.

Server-side expiry with clients closed, view-once refusal from a fresh session, delete-for-everyone asset denial, edit-window enforcement and digest counts/restart idempotency were independently exercised. O3 is nevertheless null: no secret holdout probe set was committed. Opus 5 had not passed the grader calibration gate. The grade explicitly labels this N=1 run uncalibrated and ineligible for an overall weighted claim.

## Scale and resource evidence

The [replay receipt](./grok/scale-replay.json) reports **167,157 scale actions, 1,008 users, 263 s**, excluding starter actions from the action count. Checkpoint markers were recorded at 24,777 and 88,057 actions. [Verification](./grok/scale-verify.json) records matching end-state counts and named fixtures; the grader independently found zero mismatches across every invariant class, including 100,015 messages, 50,228 posts, 5,921 follows, the 500-follow/100-conversation user and the 50-member/10,000-message group.

**Checkpoint/performance qualification is limited.** The replay script records markers and continues; it does not run verification or latency probes at those markers. The grader's O5 rationale calls them pauses, but [the retained script](./grok/source/scripts/scale-replay.mjs) only logs them. O5 75 falls through the frozen scoring rule because end-state conformance is established and no degradation probes or calibrated ceilings were present. It is not measured degradation headroom. The scale instance used a fixed copied schema; [its source](./grok/source/scale-run/snapback/schema.q) differs from the final app only by omission of `seenOrdinal` in the inbox return shape. No mid-replay source change is recorded. No returned-shape meter refusal is reported; there is no boundary-crossing test of `N_SHAPE_METER`.

Builder usage: **654,178 fresh input + 52,113,920 cached input + 162,587 output = 52,930,685 reported tokens**; 64,299 reasoning tokens are already within output. The same extraction for cal28 gives 9,343.860 s and 78,521,029 total tokens. See the [comparative's complete wall/token table and method](../2026-10-04-clique-cmp-0.4.12/README.md#builder-wall-time-and-tokens); no efficiency causation is inferred.

## Operator notes (disclosed)

- **Failed first launch:** the lane instrument symlinks still pointed at the cal28 packet. The runner refused with `lane instrument link is missing or wrong` before starting a builder. Links were corrected and the run was relaunched about **1h45m later** in the operator account. The retained timestamps are more precise: first launch 15:58:37.962Z, corrected launch 17:39:26.966Z, **1h40m49s** apart. [Failed-launch packet](./lifecycle/launch-attempt1-wrong-instrument-link/) retains qualification, launch, refusal and sampler evidence. The gap is not included in the successful builder wall time and is not a failed build on 0.4.12.
- Grade and single-backend score launched together after verified custody; the scorer could spot-check source but did not read the grade.
- Host: 18 CPUs, Node 24.18.0, 13 logged-in users at qualification. Across 109 samples during the builder, 5-minute load ranged 1.97–6.97, median 2.47 ([host-load.jsonl](./host-load.jsonl)). The full sampler file also covers assessments; other sessions shared the host.
- The builder reports worker-copy path discovery as a `snapback-defect` / `knowledge-gap`, and a scale-instance `node_modules` symlink causing worker-copy recursion as environmental. Replay suppressed effects; these attributions are retained rather than rewritten as product conclusions.

The result is descriptive; it makes no causal claim about 0.4.12. [LLP 3000.032 §8](../../../llp/3000.032-client-contract-builder-costs.research.md#8-calibration-30-against-the-pre-registration) scores the pre-registration separately.

## Files

`grok/FINAL.md` is the exact `scores/grok/raw.out` (including scorer progress prose); `grok/grader-report.json`, `m8-assertion-results.json`, `trace.md` are grading output. `grok/lane-*.md` are custody narratives; `grok/source/snapback/`, `src/` and `app/` preserve schema/generated bindings and client evidence, including dead starter files so adoption claims remain auditable. `grok/source/scale-run/` preserves the replay schema, and the three `scale-*.json*` files preserve compact replay evidence. `lifecycle/` holds phase start/end/launch files, custody and the failed attempt. No secrets, `node_modules`, `.expo`, build bundles or store databases are copied.
