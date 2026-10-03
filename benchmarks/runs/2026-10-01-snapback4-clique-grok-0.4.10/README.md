# Clique calibration 28, Grok wave — snapback4 0.4.10

The second-family half of calibration #28: the same frozen packet as the [Astra wave](../2026-10-01-snapback4-clique-astra-0.4.10/README.md), with Grok as builder and scorer. The packet's runner already supported `builder|score|grade|m7 astra|grok|muse`. Pins: snapback4@0.4.10, snapback4-darwin-arm64@0.4.10 and snapback4-expo@0.4.10, bound by registry integrity in [RUN_QUALIFICATION.json](./RUN_QUALIFICATION.json).

| Phase | Model | Host | Wall | Exit |
|---|---|---|---|---|
| Builder (M1–M6, M8; M7 out) | grok-4.6 xhigh | Apartment M5 Pro mini | 9,344 s (2026-10-01 04:52Z–07:28Z) | 0 |
| Grade (independent) | claude-opus-5 | same | 2,641 s | 0 |
| Holistic score (own lane's narratives only) | grok-4.6 xhigh | same | 269 s | 0 |

Packet `~/clique-sb4-20260930-grok-cal28` on the mini, built from cal27's verified instrument (179 frozen instrument files; `verify.py` passed at launch). The builder clone at `attempts/builder-completed` verified byte-identical before assessment ([custody](./lifecycle/builder-completed.custody.json)).

## Results

**Holistic score 81** (Grok scorer). **Grade:** M1–M7 80 pass / 4 fail / 17 not-run of 101; M8 14 / 2 / 2. **O1 18, O2 25, O3 null, O4 null, O5 band 0.**

| Category | Grok, 0.4.7 comparative | Grok, cal28 on 0.4.10 |
|---|---|---|
| overall | 78 | 81 |
| setup_and_docs | 84 | 75 |
| data_modeling | 90 | 86 |
| authorization | 91 | 84 |
| queries_and_live | 78 | 72 |
| writes_and_transactions | 84 | 80 |
| offline_sync | 80 | 72 |
| media_assets | 82 | 77 |
| background_work | 90 | 88 |
| client_integration | 64 | 78 |
| diagnostics_dev_loop | 84 | 83 |
| scale_and_limits | 46 | 84 |
| operations | 78 | 76 |

The 0.4.7 column is the [Grok comparative lane](../2026-09-28-clique-cmp-0.4.7/README.md): a different host (Linux expo-build-1000), no independent grade, N=1. That record measured scorer variance of ±7 on unchanged narratives. Read the columns as two points, not a trend.

## The two families disagree, and the grade explains why

The Grok scorer reads only its lane's narratives, and charged Snapback 4 for seams the builder reported: `setFollow predicts: never` from the template's `online only` follows (M2), the messages-only `messageReceipts` horizon forcing a client walk of `membersOf` (M3), `N_SYNC_ORDER` on search (M5), online-only uploads (M4), and insights as a server loop. It scored scale 84 because the replay settled 167,157/167,157 actions with zero failures.

The independent grader found the narrative overstated the build:
- **Coverage mappings it judged dishonest in M2–M6 and M8.** `scripts/acceptance.mjs` generates the coverage manifest mechanically. Ten mapped assertions cannot fail (`assert(true, …)`, `posts === 0 || posts >= 0`), and eight test a different subject. Six of them cover behaviour that actually fails. The frozen adjudication rule then scores those milestones not-passed, which is what puts O1 at 18. The grader says the substantive build measures far better (94/119 by independent execution).
- **Two blockers in the app.** A new account can never open the profile editor: `ProfileScreen.tsx` returns "Loading profile…" before its edit branch (d-01). And selecting Trending throws and blanks the whole app shell (d-02); the cause is one of the 34 errors in the lane's own failing `npm run typecheck`.
- **O5 band 0.** The replay never read the invariant manifest or paused at checkpoints, and it ran on a temporary store that was discarded on exit, so conformance is unverifiable (d-09).

Findings that may concern Snapback rather than the app, for triage:
- **d-07:** the scheduled digest parked repeatedly with `E_BOUND: examined rows reached the ceiling` during the scale replay.
- **d-12:** the web Following feed intermittently still counts an unfollowed author's original as a direct follow hit after an unfollow followed by a viewer repost.

Strong and independently verified: server-enforced expiry with both clients closed, view-once revocation, asset GC after delete-for-everyone, the 60 s edit window, and the scheduled digest. It produced exact per-persona counts, nothing for an idle user or a silent period, and exactly one per user across a mid-period SIGTERM.

## Operator notes (disclosed)

- **Operator scripts adapted from the Astra template.** `results/operator_*.py` were copied from cal27 and still named `astra-snapback4` logs and launched assessments as `run_phase.py <phase> astra`. Before launch they were changed to `grok` (14 references; originals kept in `results/.pre-grok-fix/`). The frozen instrument, prompts and `scripts/` are unchanged.
- **`verify.py` requires every family's CLI.** The first launch refused because the mini had no `~/.local/bin/muse`. The public Muse launcher script was installed without credentials; no Muse phase ran.
- **The packet lacked `attempts/`.** Created before custody.
- **Idle gap before assessment.** The builder ended 07:28Z, but custody and assessments were not chained to it and were launched at 21:55Z. The lane's evidence was unchanged in between: custody verified the clone byte-identical to the lane.
- The grade and score phases ran concurrently, as in the Astra wave; the scorer reads only narratives.
- Host: 18 CPUs, Xcode 27.0, Node 24.18.0; 5-minute load 4.6–7.1 (median 5.7) during the builder ([host-load.jsonl](./host-load.jsonl)). Other sessions shared the host (14 users).

The result is descriptive; it makes no causal claim about 0.4.10.

## Files

`grok/FINAL.md` (scores), `grok/grader-report.json`, `grok/m8-assertion-results.json`, `grok/trace.md` (grader), `grok/lane-*.md` (builder narratives from the custody clone), `grok/source/snapback/` (schema, generated API, workers), `lifecycle/` (phase start/end/launch records and custody receipt), `PACKAGE_PINS.json`, `RUN_QUALIFICATION.json`, `host-load.jsonl`.
