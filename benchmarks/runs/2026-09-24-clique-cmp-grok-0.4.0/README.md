# Grok-family Clique comparative — `snapback4@0.4.0` against Convex and Supabase

**Snapback 4 81, Convex 73, Supabase 56** (holistic, one grok-4.6 xhigh scorer reading its own family's three lanes). A second builder family on the 0.4.0 release, beside [calibration #19](../2026-09-24-snapback4-clique-astra-0.4.0/README.md) (gpt-6-astra medium, holistic 88). N=1 per cell. This is supporting evidence, not a calibration: the scorer is not the calibration scorer, and there is no independent functional grade.

## What was compared

| Lane | Builder | When and where | Outcome |
|---|---|---|---|
| `grok-snapback4` | grok-4.6 xhigh (grok 1.0.13 harness) | 2026-09-24 13:04:57Z–15:29:45Z (8,688 s) on expo-build-1000 (Linux x86_64, Hetzner EPYC) | M1–M6 and M8 green. Scale replay verified (167,157 actions, 788 s) **after dropping `expire at` from `messages`**. M7 not run. Native simulator segments not run (no Xcode on Linux); Hermes exports produced. |
| `grok-convex` | grok-4.6 xhigh | the [2026-09-05 three-backend run](../2026-09-05-clique-full-3x3/README.md), on the black M5 Max | M1–M6 and M8 green. The 2026-09-05 record lists the scale replay as settled. The lane's own final report leaves its verification PENDING after a 32k-document read limit, and that is what the scorer read. |
| `grok-supabase` | grok-4.6 xhigh | the same 2026-09-05 run | M1 green, then M2–M8 `aborted` (Expo and Playwright plumbing, mostly agent error). |

**Caveats that bound the comparison.**
- The Convex and Supabase lanes are nineteen days older and ran on a different, heavily loaded machine: host load 45–112 from other sessions, which the 2026-09-05 record says stretched that wave's wall clocks three- to fourfold.
- Supabase ran against a hosted project, with no CLI or local stack.
- The builder model and harness version are the same across all three lanes.
- The Snapback 4 lane used a source-built Linux CLI, because `snapback4@0.4.0` ships only a darwin-arm64 binary. See [SNAPBACK4_LINUX_BINARY.json](./SNAPBACK4_LINUX_BINARY.json): it was built from `639fc9105`, whose crates are identical to the release.

## Scores

Scorer: grok-4.6 xhigh, 369 s, exit 0 ([prompt](./score-prompt.md), [meta](./score-meta.json), [scores and notes](./scores.json)).

| Category | Snapback 4 | Convex | Supabase |
|---|---:|---:|---:|
| **overall** | **81** | 73 | 56 |
| setup_and_docs | 74 | 70 | 58 |
| data_modeling | 84 | 76 | 80 |
| authorization | 90 | 64 | 58 |
| queries_and_live | 80 | 80 | 46 |
| writes_and_transactions | 82 | 70 | 76 |
| offline_sync | 86 | 40 | 35 |
| media_assets | 83 | 78 | 64 |
| background_work | 84 | 80 | 50 |
| client_integration | 74 | 70 | 54 |
| diagnostics_dev_loop | 86 | 64 | 62 |
| scale_and_limits | 60 | 48 | 46 |
| operations | 76 | 70 | 52 |

Snapback 4 leads both other backends in every category but one: it ties Convex at 80 in `queries_and_live`. Its narrowest lead over Supabase is `data_modeling`, 84–80. The scorer's verdict: "The authorized local replica collapsed live, offline, and multi-device into schema, then billed that gift back as an examined-row ceiling on expiring unique indexes."

## What the run found in 0.4.0

The builder's attributions are in its [final report](./grok-snapback4/final-report.md) and [run log](./grok-snapback4/run-log.md). These are the platform findings. Each has the 0.4.1 lane that answers it (see [LLP 3000.013 §12](../../../llp/3000.013-quarry-states-intent.rfc.md)).

1. **An expiring table's keyed insert grew with the live population.** `messages` was declared `unique byConversationOrdinal: conversationId, ordinal`, `cap 200000`, `expire at .expiresAt`. Inserting the 8,193rd message into one group conversation failed with `E_BOUND` (examined rows reached 8,192), although no row had expired. The builder dropped `expire at`, which gave up server-side purging of disappearing messages. It is the first charge in the scorer's `scale_and_limits` 60. → **Lane P**: cap enforcement uses a maintained physical occupancy, unique checks are point lookups, and expiry work is charged only after authorization.
2. **Uploads returned 429 when admission slots were full.** → **Lane O**: the server marks the slot refusal `retryable: true` (it did not), and `client.upload` retries it with bounded backoff, honoring `Retry-After`.
3. **`snapback4 init` refused the lane directory.** → **Lane O**: the `instrument` symlink was never the cause; an existing README was. `init` now keeps it, writes `README.snapback.md`, and names every conflict before writing anything.
4. **Typing indicators needed a local hide clock.** → **Lane O** could not reproduce it. A real-browser `useQuery` test empties both clients' views within 23 ms of a 4.5 s `expire at` deadline, without another write.
5. **`first 50 by .id` hid new delivery acknowledgements.** The page correctly omitted row 51, and `N_NO_CURSOR` already fired there. → **Lane O**: its rewrite now names both fixes, a cursor or a narrower key.
6. **No Linux binary in the npm package.** This is an open packaging gap, not a 0.4.1 change.

## Files

| Path | What |
|---|---|
| [grok-snapback4/](./grok-snapback4/) | The Snapback 4 lane's diary, essay, final report and run log |
| [grok-snapback4/source/snapback/](./grok-snapback4/source/snapback/) | The lane's Quarry program as it ended, with `expire at` dropped from `messages` |
| [lifecycle/](./lifecycle/) | Builder start and end records |
| [scores.json](./scores.json) | The scorer's JSON, verbatim |

The raw packet is at `~/clique-cmp-20260924/` on expo-build-1000. It holds the instrument, the prompts, all lanes, the builder's stream logs, and the scorer's raw output. Secrets and `node_modules` were never copied into it.
