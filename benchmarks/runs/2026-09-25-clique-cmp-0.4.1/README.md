# Clique comparative, two families — `snapback4@0.4.1` against Convex and Supabase

| Wave (builder and scorer) | Snapback 4 | Convex | Supabase |
|---|---:|---:|---:|
| **Astra** (gpt-6-astra: medium builders, xhigh scorer) | **82** | 83 | 73 |
| **Grok** (grok-4.6 xhigh builders and scorer) | **70** | 76 | 47 |

Each wave's scorer read only its own family's three lanes. The Snapback 4 lanes are new, built on the published 0.4.1 release. The Convex and Supabase lanes are the same family's lanes from the 2026-09-16 full run (lane ids `astra-clique-convex-20260916`, `grok-clique-supabase-20260916` and so on; packet `~/clique-full-20260916-sb4-convex-supabase` on expo-build-1000, with no run record in this repository), copied unchanged into this packet. They are nine days older than the Snapback 4 lanes, and ran on the same host. N=1 per cell. This is supporting evidence beside [calibration #20](../2026-09-25-snapback4-clique-astra-0.4.1/README.md), not a calibration: there is no independent functional grade.

**On 0.4.1, Snapback 4 is not better than Convex.** It is second to Convex in both families, by 1 point (Astra) and 6 points (Grok), and ahead of Supabase in both.

## Scores

| Category | Astra: SB4 | Convex | Supabase | Grok: SB4 | Convex | Supabase |
|---|---:|---:|---:|---:|---:|---:|
| **overall** | **82** | 83 | 73 | **70** | 76 | 47 |
| setup_and_docs | 90 | 78 | 82 | 78 | 70 | 58 |
| data_modeling | 86 | 88 | 92 | 88 | 76 | 82 |
| authorization | 91 | 80 | 80 | 86 | 64 | 55 |
| queries_and_live | 84 | 86 | 73 | 56 | 82 | 40 |
| writes_and_transactions | 94 | 94 | 91 | 84 | 74 | 78 |
| offline_sync | 90 | 55 | 52 | 88 | 50 | 40 |
| media_assets | 95 | 72 | 72 | 82 | 78 | 68 |
| background_work | 94 | 90 | 68 | 80 | 86 | 50 |
| client_integration | 82 | 86 | 68 | 72 | 80 | 48 |
| diagnostics_dev_loop | 95 | 83 | 81 | 66 | 62 | 54 |
| scale_and_limits | 55 | 91 | 75 | 92 | 42 | 32 |
| operations | 84 | 84 | 78 | 78 | 55 | 42 |

Scorers:
- Astra: gpt-6-astra xhigh, 309 s, exit 0 ([prompt](./score-astra-prompt.md), [meta](./score-astra-meta.json), [scores](./scores-astra.json)).
- Grok: grok-4.6 xhigh, 325 s, exit 0 ([prompt](./score-grok-prompt.md), [meta](./score-grok-meta.json), [scores](./scores-grok.json)).

Where Snapback 4 leads in both waves: authorization, offline sync, media, writes, setup and diagnostics. Where it trails Convex, the two families charged different things.

## What each wave charged

**Astra: scale (55) and the client.** The builder's scale replay passed: 167,157 actions settled and the invariants verified. The **cold web sync of the full scale partition** failed its 30 s deadline, however, and did not finish within a further 180 s observation ([final report](./astra-snapback4/final-report.md)). The scorer: "E_TIMELINE_SHAPE forbids bounding materialized Following sources, requiring broad residency. That constraint earns the penalty." It also charged `data_modeling` 86 for "indexed-prefix bindings and prediction eligibility", and `client_integration` 82 for "held reads, prediction eligibility, and admission states".

**Grok: live two-client behavior in M3 (`queries_and_live` 56).** The builder got M1, M2 and M4–M8 green, and the scale replay settled all 167,157 actions with manifest-exact counts (`scale_and_limits` 92). M3's API suite passed, but its two-browser choreography did not: typing within 2 s, delivered receipts, and live delivery to a just-added member. The run log attributes almost every loop to the agent. One is ambiguous: "membership watermark updates may not invalidate membersOf". The essay's charge is design: delivered receipts took three mechanisms (membership watermarks, `connected[p]` and a focus heartbeat) where Convex needed one query.

Both families met, independently, the symptom calibration #20's grader called d-02. After a follow and unfollow, an unfollowed author's original appeared next to the viewer's repost in Following. The grok builder hid such originals in client code. [Lane W](../../../snapback4/reports/20260925-lane-w.md) found that the frozen check reads Bob's Following tab immediately after Alice posts, and mistakes a copy not yet delivered for an absent follow edge. End-to-end delivery latency, from a post to a follower's render, decides that race.

## What 0.4.2 and 0.4.3 do about it

| Finding | Answer |
|---|---|
| Cold sync of the full public corpus (Astra `scale_and_limits` 55) | [LLP 3000.016](../../../llp/3000.016-following-on-a-bounded-device.rfc.md): bounded Following sources and a per-reader inbox floor (revision 5, lane U). Owned events follow their source rows (revision 8). Lane V: packed IndexedDB, 73 s → 18 s for 65,180 rows |
| Held reads, admission states, readiness UX | Lane V: a synchronous admission journal from the first `mutate`, and `useAcquisition()` |
| Pending sends vanishing under a skewed server clock (Astra M8) | Lane Y: the device keeps the server's time |
| Learning cost, first-guess spellings | Lane X: a SQL/Convex Rosetta card, cards that lead with the paved form, and the builders' guesses repaired |
| Receipts and presence as three mechanisms (Grok M3) | Open. Candidate: a platform delivered-receipt fact |
| Delivery latency behind d-02 | Open. Measure post-to-follower render latency end to end |

## Harness deviations

- **The grok Snapback 4 lane stopped early and was continued.** It ended its turn at 06:20:17Z after 7,721 s, with the M3–M5 choreography not yet green. It was resumed in the same session, with a continuation prompt ([prompt](./lifecycle/grok-snapback4.cont.start.json)), from 07:10:39Z to 10:18:11Z. Its run log records the break.
- **The grok CLI symlink broke on the host.** `~/.local/bin/grok` pointed into an npm install whose `node_modules` another process removed at 07:54Z. This happened after the continuation had started, so it did not affect the lane. The scorer's first launch failed with `FileNotFoundError`. The symlink was repointed to the standalone binary of the same version (grok 1.0.30), and the scorer then ran once.
- **A source-built Linux CLI.** Both Snapback 4 lanes used one, because `snapback4@0.4.1` ships only darwin-arm64 ([SNAPBACK4_LINUX_BINARY.json](./SNAPBACK4_LINUX_BINARY.json)).

## Files

| Path | What |
|---|---|
| [astra-snapback4/](./astra-snapback4/) and [grok-snapback4/](./grok-snapback4/) | Each Snapback 4 lane's diary, essay, final report and run log, with its Quarry program under `source/snapback/` |
| [lifecycle/](./lifecycle/) | Builder start, end and continuation records |
| `scores-*.json`, `score-*-prompt.md`, `score-*-meta.json` | Each scorer's JSON, prompt and invocation |

The raw packet is at `~/clique-cmp-20260925/` on expo-build-1000. It holds the instrument, the prompts, all six lanes, the builders' stream logs and the scorers' raw output. Secrets and `node_modules` were never copied into this record.
