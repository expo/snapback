# Clique comparative, two families — snapback4 0.4.12 against Convex and Supabase

Both scorers rank the cal30 Snapback 4 lane first for this brief. These are **holistic narrative assessments, N=1 per family/backend**, not independently graded comparative trials or a causal release experiment.

| Family / comparative | Snapback 4 | Convex | Supabase |
|---|---:|---:|---:|
| Astra, [0.4.1](../2026-09-25-clique-cmp-0.4.1/README.md) | 82 | 83 | 73 |
| Astra, **0.4.12** | **92** | 80 | 72 |
| Grok, [0.4.7](../2026-09-28-clique-cmp-0.4.7/README.md) | 78 | 80 | 55 |
| Grok, **0.4.12** | **88** | 71 | 54 |

The old/new Snapback 4 cells are different builds. Each family's Convex and Supabase cells re-score unchanged September 16 narratives. The latest Snapback 4 leads are 12/20 points over Convex/Supabase for Astra and 17/34 for Grok; they must be read beside the control-score variation below.

## By category, beside each family's previous comparative

Each group of three columns is Snapback 4 / Convex / Supabase. Overall is the scorer's holistic judgment, not the category mean.

### Astra: 0.4.1 → 0.4.12

| Category | 0.4.1 SB4 | Convex | Supabase | 0.4.12 SB4 | Convex | Supabase |
|---|---:|---:|---:|---:|---:|---:|
| overall | 82 | 83 | 73 | 92 | 80 | 72 |
| setup_and_docs | 90 | 78 | 82 | 94 | 80 | 85 |
| data_modeling | 86 | 88 | 92 | 90 | 88 | 93 |
| authorization | 91 | 80 | 80 | 95 | 81 | 81 |
| queries_and_live | 84 | 86 | 73 | 92 | 83 | 75 |
| writes_and_transactions | 94 | 94 | 91 | 94 | 96 | 90 |
| offline_sync | 90 | 55 | 52 | 93 | 45 | 45 |
| media_assets | 95 | 72 | 72 | 97 | 74 | 74 |
| background_work | 94 | 90 | 68 | 92 | 86 | 65 |
| client_integration | 82 | 86 | 68 | 90 | 81 | 70 |
| diagnostics_dev_loop | 95 | 83 | 81 | 95 | 82 | 80 |
| scale_and_limits | 55 | 91 | 75 | 90 | 90 | 75 |
| operations | 84 | 84 | 78 | 83 | 85 | 80 |

### Grok: 0.4.7 → 0.4.12

| Category | 0.4.7 SB4 | Convex | Supabase | 0.4.12 SB4 | Convex | Supabase |
|---|---:|---:|---:|---:|---:|---:|
| overall | 78 | 80 | 55 | 88 | 71 | 54 |
| setup_and_docs | 84 | 72 | 64 | 80 | 68 | 58 |
| data_modeling | 90 | 78 | 86 | 90 | 76 | 84 |
| authorization | 91 | 60 | 56 | 92 | 70 | 55 |
| queries_and_live | 78 | 86 | 52 | 88 | 82 | 50 |
| writes_and_transactions | 84 | 70 | 76 | 90 | 74 | 80 |
| offline_sync | 80 | 54 | 44 | 88 | 38 | 32 |
| media_assets | 82 | 78 | 66 | 90 | 74 | 68 |
| background_work | 90 | 88 | 56 | 84 | 80 | 50 |
| client_integration | 64 | 74 | 48 | 86 | 74 | 48 |
| diagnostics_dev_loop | 84 | 66 | 62 | 82 | 64 | 56 |
| scale_and_limits | 46 | 40 | 30 | 90 | 44 | 32 |
| operations | 78 | 70 | 46 | 84 | 68 | 38 |

Astra's Snapback 4 leads Convex in 9 of 12 categories, ties scale, and trails writes and operations. It leads Supabase in 11, trailing data modeling. Grok's Snapback 4 leads both controls in all 12. These statements describe these scorers' readings, not backend capability rankings outside this brief.

## Scorer verdicts

**Astra** ([scores and notes](./scores-astra.json)):

- **Snapback 4:** “Snapback supplied the strongest fit for this brief by integrating the guarantees that otherwise became separate application subsystems.”
- **Convex:** “Convex was a strong reactive transactional backend whose largest gap for Clique was the application-owned durable offline layer.”
- **Supabase:** “Supabase handled Clique's relational rules well, while this lane retained substantial responsibility for synchronization and service coordination.”

**Grok** ([scores and notes](./scores-grok.json)):

- **Snapback 4:** “Snapback 4.12 is the only pin here where Clique’s distinctive model (receipts, expiry, once, replica, digest-once) was language, not library code.”
- **Convex:** “Convex 1.45 is a strong live-query runtime for Clique’s two-client UI and a weak product for password auth, receipts, clocks, offline, and envelope-scale reads.”
- **Supabase:** “Hosted Supabase was an excellent Postgres-plus-password-hasher and a poor Clique runtime: live, offline, jobs, and tenancy isolation were assembled, not provided.”

Astra credits integrated receipts, durable intents, row-owned media, expiry and jobs; it charges Quarry learning, coverage/prediction UI, and the 69-second aggregate adoption. Grok credits the same integrated primitives, while charging worker file isolation and search/index discovery. These are the scorers' judgments of the published pins and each builder's choices. In particular, Grok's Supabase verdict describes its service-role BFF and polling implementation, not a proof that Supabase cannot provide realtime.

## Measured scorer variation on unchanged controls

| Family / unchanged September 16 lane | Previous | 0.4.12 re-score | Change |
|---|---:|---:|---:|
| Astra Convex | 83 | 80 | -3 |
| Astra Supabase | 73 | 72 | -1 |
| Grok Convex | 80 | 71 | **-9** |
| Grok Supabase | 55 | 54 | -1 |

The category tables expose the variation too: Astra Convex offline sync moves 55 → 45 and client integration 86 → 81; Grok Convex offline sync moves 54 → 38 while authorization rises 60 → 70. Earlier Grok comparative readings of these same control lanes were 76/47 (0.4.1), 73/50 (0.4.3), 80/55 (0.4.7), now 71/54. Thus the observed overall ranges are 71–80 for Convex and 47–55 for Supabase. These are repeat-score differences, not an estimated population variance or a ±9 confidence interval. The comparison context changes because Snapback 4's lane changes.

The [narrative hash comparison](./narrative-provenance.json) verifies every retained control narrative byte-for-byte against both its previous comparative packet and the September 16 full-run packet. No fresh Convex/Supabase builder or grader ran here.

## Builder wall time and tokens

Measured by `python3 ~/sb5-lanes/tokens.py <ndjson> <end.json>` on eb1000, and `/tmp/tokens.py` on each Mac. [Exact outputs](./builder-usage.json) and the [measurement script](./evidence/tokens.py) are retained. Wall time is the builder process interval from `end.json`, including its waits; it excludes grader/scorer phases and Grok's rejected first launch. Tokens aggregate reported usage, including repeated cached context. Reasoning is already inside output and must not be added again. Provider counters and cache accounting differ; these are not billing-cost estimates or unique-context sizes.

| Family / builder | Host | Wall (s) | Fresh input | Cached input | Output | Reasoning within output | Total |
|---|---|---:|---:|---:|---:|---:|---:|
| Astra SB4 0.4.12 cal30 | office M1 Max | 8,025.003 | 639,915 | 36,557,440 | 149,276 | 57,164 | 37,346,631 |
| Astra SB4 0.4.11 cal29 | office M1 Max | 11,874.262 | 783,530 | 55,025,792 | 188,422 | 85,295 | 55,997,744 |
| Astra Convex, Sept 16 | eb1000 (Linux) | 9,403.007 | 677,714 | 47,933,568 | 228,084 | 101,781 | 48,839,366 |
| Astra Supabase, Sept 16 | eb1000 (Linux) | 5,871.927 | 511,639 | 33,507,968 | 152,870 | 55,893 | 34,172,477 |
| Grok SB4 0.4.12 cal30 | Apartment M5 Pro mini | 6,617.393 | 654,178 | 52,113,920 | 162,587 | 64,299 | 52,930,685 |
| Grok SB4 0.4.10 cal28 | Apartment M5 Pro mini | 9,343.860 | 1,071,478 | 77,203,456 | 246,095 | 117,579 | 78,521,029 |
| Grok Convex, Sept 16 | eb1000 (Linux) | 10,202.317 | 1,195,904 | 78,689,024 | 271,837 | 258,211 | 80,156,765 |
| Grok Supabase, Sept 16 | eb1000 (Linux) | 8,486.527 | 393,418 | 44,684,416 | 174,127 | 164,394 | 45,251,961 |

Against the requested same-family earlier calibration, Astra cal30 uses 32.4% less builder wall time and 33.3% fewer reported total tokens than cal29; Grok uses 29.2% less wall time and 32.6% fewer tokens than cal28. These adjacent measurements are resource descriptions, not evidence that a particular change caused savings. The [pre-registration assessment](../../../llp/3000.032-client-contract-builder-costs.research.md#8-calibration-30-against-the-pre-registration) evaluates scores against the longer fitted series. The September 16 builders ran on eb1000; the cal30 builders ran on different Macs. Different hardware, contention, caching, app choices, completed work and evidence quality prevent a backend speed or efficiency inference from this table.

## Custody, assessment scope and caveats

- Packet: `~/clique-cmp-20261003-0412/` on eb1000. Pins in its prompts: `snapback4@0.4.12`, `snapback4-expo@0.4.12`, `convex@1.45.0`, `@supabase/supabase-js@2.112.4` (hosted Supabase).
- Snapback 4 lanes are the cal30 `attempts/builder-completed` custody clones: [Astra calibration](../2026-10-03-snapback4-clique-astra-0.4.12/README.md), recorded by the office session at `7c9c0c0dab`, and [Grok calibration](../2026-10-03-snapback4-clique-grok-0.4.12/README.md). Both comparative copies omit `node_modules` and `.expo`; **the Astra copy also omits the 1.3 GB `scale-instance` store**. This record retains narratives, selected source and small receipts, not runnable complete clones. [Source hashes](./custody-source-hashes.json) compare the retained app/source evidence with the original Mac custody clones; they do not attest the omitted stores.
- Convex and Supabase were copied unchanged from `~/clique-cmp-20260925` for Astra and `~/clique-cmp-20260928-047` for Grok, ultimately from `~/clique-full-20260916-sb4-convex-supabase`. They are September 16 builds, 17 days older than the October 3 cal30 builds, with no new runtime or contemporary-package qualification. Different hosts compound the age and version confounds.
- One builder per family/backend; one comparative scoring pass per family. Astra builders use gpt-6-astra medium, Grok builders grok-4.6 xhigh; scorers use their own family at xhigh. No family pooling or significance claim.
- Each scorer read only its own family's three lanes, with source spot-checks allowed; grading directories were excluded. Astra score: 328 s, exit 0; Grok: 285 s, exit 0. [Astra prompt](./score-astra-prompt.md), [meta](./score-astra-meta.json), [raw](./score-astra-raw.md); [Grok prompt](./score-grok-prompt.md), [meta](./score-grok-meta.json), [raw](./score-grok-raw.md).
- These comparative scores are **92/88**, distinct from the same custody builds' single-backend cal30 scores **93/86**. The independent cal30 grades apply only to Snapback 4: Astra 101 pass / 0 fail / 18 not-run, Grok 98 / 2 / 19 across 119 assertions. Both are uncalibrated-grader, no-holdout-probe runs; O3 is null and there is no eligible weighted total. M7 and native runtime proof are absent. Hermes exports do not establish native execution.
- Grok's grader calls coverage dishonest in M2/M3/M5/M8 despite independently passing the mapped behaviors; it also finds two assertion failures and 19 TypeScript errors. Its O5 band 75 is the frozen fallback with no degradation probes, not measured performance. Astra's grade finds four missing O5 degradation comparisons and records its post-replay M8-schema adoption. Narrative score gains cannot override these limitations.
- Grok's failed first launch pointed lane instrument symlinks at cal28, so the runner refused before a builder started. The corrected relaunch was about 1h45m later in the operator account (the retained launch timestamps measure 1h40m49s). The [calibration record](../2026-10-03-snapback4-clique-grok-0.4.12/README.md#operator-notes-disclosed) preserves both attempts.

Secrets, dependency trees, build bundles and store databases are excluded. `series-fit.json` retains the pre-cut fit and the descriptive update through cal30; it does not substitute these comparative scores into the calibration series.
