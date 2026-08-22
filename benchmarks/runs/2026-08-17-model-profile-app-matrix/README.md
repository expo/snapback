# Model × profile × app matrix — 2026-08-17/18

Author-requested (2026-08-17) 12-cell sweep on the freshly published 0.1.24
closure: three models in their native harnesses × two Snapback authoring
profiles × two client stacks, reduced Clique/Coterie scope (M1–M3), one lane
per cell.

- **Models:** GPT-5.6 Sol xhigh (codex CLI 0.147.0, real binary, unsandboxed),
  Grok 4.6 xhigh (grok CLI, bypassPermissions), Claude Opus 5 (claude CLI
  headless, skip-permissions). Bypass modes are required parity: the codex
  seatbelt sandbox SIGABRTs Playwright browsers (both engines) before context
  creation — the archived sandboxed pilot attempt is the evidence.
- **Profiles:** default explicit; familiar (`snapback-familiar-ts-v1` via
  codegen.policy.json), both consumed only from the published npm 0.1.24.
- **Apps:** Clique as an Expo Router web app (LLP 0201 instrument); Coterie
  as an Exact/Contract web app (LLP 0266 lineage) with the REQUIRED green
  against a Snapback-backed ContractDataProvider. Same social-messenger
  brief, fixtures, assertions, and frozen two-client choreography for all 12.
- **Pins:** Snapback published 0.1.24 (candidate revision `f8cbf3d253b5`,
  LLP 0041 §0.1.24); instrument snapshot at `bbc324323` (kit 0.3.x-m8);
  Exact framework at local commit `4046cafcf` (no npm release; lanes symlink
  a frozen clone).
- **Evidence level:** N=1 per cell, calibration/exploratory only, per
  LLP 0201 D5. No magnitude or scored claim.
- **Machine caveat:** all lanes ran on the primary M5 Max MacBook Pro, which
  concurrently hosts fleet agent sessions (the reserved sweep rigs were
  unavailable). Lanes ran at most two at a time, never two of one model.
  Per-lane one-minute loadavg samples were captured; one opus lane's own log
  documents choreography waits failing at loadavg ~150–250 and passing at ~6.
  Wall-clock comparisons across lanes carry that contamination.
- **Metering:** codex `--json` turn.completed usage (cumulative input
  includes cached); grok streaming-json usage events (fresh input and cache
  reads separate); claude final-result usage + harness-reported cost. Costs
  for sol/grok are computed from public list prices (sol $5/$0.50-cached/$30
  per M; grok $2/$0.50-cached/$6 per M, standard tier) and are approximate;
  opus costs are harness-reported. Cross-model token counts are NOT
  comparable; cost and wall are the cross-model axes.

Lane prompts are the four templates in this directory, rendered per lane
(lane id, model, published Snapback version, 20-port block). The retained
results describe their original 0.1.24 rendering; on 2026-08-21 the reusable
templates advanced to LLP 0295 W1's ruled lifecycle and receipt contract, so a
rerun must supply a published `{{SNAPBACK_VERSION}}` carrying that contract.
Raw lane directories, event streams, load
samples, and receipts are retained outside git at
`/Users/ccheever/bench-matrix-20260817/` on the execution machine.
Consolidated results: [record.md](./record.md). Build experience:
diaries 0092–0103.
