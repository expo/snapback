# Clique matrix — published Snapback 0.1.29 — scored record

**Run:** 2026-08-27. **Instrument:** Clique social-messenger (LLP 0201), M1–M8,
web-only. **Snapback:** freshly published **0.1.29** (npm). **Models:**
`gpt-5.6-sol` @ xhigh, `gpt-5.6-terra` @ medium, `grok-4.6` @ xhigh,
`GLM-5.3-flash` (via OpenCode). **Backends:** snapback-explicit,
snapback-familiar, convex, supabase, pocketbase. **Hosts:** `expo-build-450b`,
`450a`, `expo-build-1000`, `durand`, `bones`.

**Coverage:** 20 intended cells; **15 scored**, `sol-snapback-explicit` a deep
run left unscored (wedged on a broken scale-replay fixture), `glm-{convex,
snapback-explicit,snapback-familiar}` stalled on OpenCode harness hangs,
`glm-pocketbase` never run. Raw per-lane `diary.md` / `essay.md` / `scores.json`
/ `run-log.md` are under `lanes/`. Human-facing summary: `diaries/0114-clique-published-0129-matrix.diary.md`.

---

# Clique Benchmark — Scored Results (Snapback 0.1.29)

**Matrix:** 4 models (sol / grok / terra / glm) × 5 backends (snapback-explicit, snapback-familiar, convex, supabase, pocketbase) building a social-messenger app across milestones M1–M8 on freshly-published Snapback **0.1.29**. 20 lane cells; **15 scored**, 4 unscored (no `scores.json`), 1 never run.

## 1. Methodology

Each lane's `scores.json` (schema `clique-scores-v1`) carries two scoring halves with embedded per-dimension weights on a shared scale:

- **Grader-outcome half (O1–O5), weights sum ≈ 45** — what the app actually does against the graded milestone checklists (accounts/feed, chat/receipts, media, offline, scale-replay).
- **Builder-experience half (B1–B11), weights sum ≈ 55** — how it felt to build (schema, auth, live queries, offline, uploads, search, custom client, served page, diagnostics, lifecycle).

For each lane:
- **greens** = count of milestones marked `green`. **M7 (native / second-client) was `not-run` in every lane** (out of scope / web-only), so **7/8 was the practical ceiling.**
- **O** = Σ(weight×score)/Σ(weight) over *exercised* O1–O5.
- **B** = Σ(weight×score)/Σ(weight) over *exercised* B1–B11.
- **overall** = Σ(weight×score)/Σ(weight) over *all* exercised O+B dimensions — a single blend of the 45-pt grader half and the 55-pt builder half by their embedded weights. All rounded to whole numbers.
- **Holistic** is the lane's **self-rated experience (0–100), reported separately** below. It is *not* a green count and does not enter O/B/overall.

Two data quirks, noted for provenance: `glm-supabase` carries a copy-pasted `lane_id` of `grok-clique-supabase` (its `model` field and directory both say glm), and `terra-snapback-explicit`'s `model` field literally reads `grok-4.6`. The **directory prefix and 4×5 framing are authoritative** for model grouping in both cases.

## 2. Master matrix

Rows = backends, columns = models. Cell = `greens/8 · O · B · overall` (weighted). `NS` = terra non-signal (see §4).

| Backend | sol | grok | terra | glm |
|---|---|---|---|---|
| **snapback-explicit** | *deep run, unscored (scale-replay fixture-blocked)* | 4/8 · 42 · 63 · **56** | 0/8 · 0 · 26 · **16** `NS` | *STALLED (harness hang)* |
| **snapback-familiar** | 2/8 · 30 · 57 · **44** | 2/8 · 33 · 56 · **47** | 0/8 · 0 · 32 · **16** `NS` | *STALLED (harness hang)* |
| **convex** | 7/8 · 79 · 52 · **65** | 7/8 · 71 · 64 · **67** | 0/8 · 5 · 36 · **25** `NS` | *STALLED (harness hang)* |
| **supabase** | 7/8 · 72 · 66 · **69** | 1/8 · 32 · 49 · **43** | 0/8 · 13 · 49 · **36** `NS` | 1/8 · 48 · 78 · **66** |
| **pocketbase** | 7/8 · 50 · 55 · **53** | 2/8 · 31 · 61 · **50** | 0/8 · 3 · 44 · **24** `NS` | *not run* |

Self-rated **holistic** (separate axis, not a green count):

| Backend | sol | grok | terra | glm |
|---|---|---|---|---|
| snapback-explicit | — | 61 | 28 | — |
| snapback-familiar | 44 | 54 | 32 | — |
| convex | 74 | 79 | 35 | — |
| supabase | 74 | 44 | 52 | 72 |
| pocketbase | 74 | 61 | 48 | — |

## 3. Per-dimension breakdown

Raw 0–100 dimension scores for the 15 scored lanes; `–` = not exercised.

**Grader-outcome (O1 accounts/feed · O2 chat/receipts · O3 media · O4 offline · O5 scale-replay), weights 13·7·8·9·8:**

| Lane | O1 | O2 | O3 | O4 | O5 |
|---|---|---|---|---|---|
| sol-convex | 94 | 88 | 90 | 82 | 30 |
| sol-supabase | 94 | 86 | 84 | 82 | 0 |
| sol-pocketbase | 75 | 52 | 20 | 58 | 30 |
| sol-snapback-familiar | 30 | 30 | – | – | – |
| grok-convex | 86 | 84 | 72 | 74 | 30 |
| grok-snapback-explicit | 58 | 62 | – | – | 0 |
| grok-snapback-familiar | 48 | 42 | – | – | 0 |
| grok-supabase | 38 | 58 | – | – | 0 |
| grok-pocketbase | 38 | 52 | – | – | 0 |
| glm-supabase | 45 | 55 | – | – | – |
| terra-supabase | 20 | 15 | – | – | 0 |
| terra-convex | 5 | 10 | – | – | 0 |
| terra-pocketbase | 5 | 0 | – | – | – |
| terra-snapback-explicit | 0 | 0 | – | – | – |
| terra-snapback-familiar | 0 | 0 | – | – | – |

**Builder-experience (B1 schema · B2 auth · B3 live queries · B4 offline · B5 uploads · B6 search · B7 custom client · B8 push · B9 served page · B10 diagnostics · B11 lifecycle), weights 6·5·6·7·4·3·3·6·6·4·5:**

| Lane | B1 | B2 | B3 | B4 | B5 | B6 | B7 | B8 | B9 | B10 | B11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| sol-convex | 84 | 38 | 63 | 32 | 34 | 58 | 57 | – | 55 | 58 | 42 |
| sol-supabase | 92 | 82 | 78 | 34 | 70 | 60 | 42 | – | 72 | 56 | 64 |
| sol-pocketbase | 68 | 62 | 32 | 28 | 58 | 48 | 66 | – | 78 | 43 | 79 |
| sol-snapback-familiar | – | 68 | – | – | – | – | – | – | 56 | 45 | 57 |
| grok-convex | 88 | 44 | 80 | 42 | 76 | 68 | 64 | – | 60 | 68 | 55 |
| grok-snapback-explicit | 74 | 78 | 72 | 38 | 68 | 36 | 58 | – | 58 | 74 | 72 |
| grok-snapback-familiar | 74 | 82 | 58 | 28 | 62 | 55 | 68 | – | 38 | 57 | 52 |
| grok-supabase | 78 | 76 | 42 | 28 | 32 | 58 | 48 | – | 52 | 34 | 47 |
| grok-pocketbase | 74 | 86 | 57 | 32 | 71 | 60 | 69 | – | 48 | 51 | 78 |
| glm-supabase | 78 | 80 | 85 | – | – | – | – | – | 68 | 72 | 82 |
| terra-supabase | 65 | 70 | 55 | 35 | 50 | 15 | 30 | – | 45 | 55 | 50 |
| terra-convex | 45 | 35 | 40 | 20 | 30 | 10 | 15 | – | 65 | 50 | 30 |
| terra-pocketbase | – | 55 | – | – | – | – | – | – | 40 | 35 | 45 |
| terra-snapback-explicit | 18 | 35 | 15 | – | 20 | – | – | – | 40 | 20 | 30 |
| terra-snapback-familiar | – | 35 | – | – | – | – | – | – | 30 | 40 | 25 |

**B8 (push) was `not exercised` in every lane** — the scoring notes defer it to the M7 session, which never ran.

## 4. Per-model findings

**sol (gpt-5.6-sol) — the most reliable finisher.** 4 scored lanes, **23 greens** (three full 7/8 runs on convex, supabase, pocketbase), avg weighted-overall **57**. Top grader scores on the hosted backends (O 79 convex, 72 supabase; O1/O2 in the high 80s–90s). Its `sol-snapback-familiar` lane stalled at M3 (2 greens, overall 44), but the abort traces to *"cross-client stale live data, receipt failures, and a reload workaround"* (O2 rationale) — the harness storagePartition artifact (§6), not a sol gap. Its `sol-snapback-explicit` lane is the deep-run-unscored one, halted by the broken scale-replay fixture. Honest read: where sol scored, it went the distance.

**grok (grok-4.6) — the broadest and deepest signal.** 5 scored lanes, **16 greens**, avg overall **53**, and the single best individual lane (`grok-convex`, overall **67**, holistic 79). Crucially, grok got **furthest of anyone on native Snapback**: `grok-snapback-explicit` reached **M4** (4 greens, overall 56) before aborting at M5 offline, with strong builder scores (B 63). Weaknesses: `grok-supabase` (1 green, overall 43) was capped by hosted-Auth signup rate-limiting, and `grok-snapback-familiar`'s O2 (42) was again depressed by the receipt/two-client artifact. Honest read: versatile and the only model to exercise Snapback meaningfully deep.

**terra (gpt-5.6-terra) — NON-SIGNAL; do not read as a capability verdict.** All 5 lanes self-aborted early — M1 `capability-failure` or a ~4–6 min premature stop with everything downstream `blocked-by-M1` — **0 greens everywhere**, overall 16–36. Label **premature-stop, non-signal**. Terra's numbers must be excluded from any backend capability read. (Provenance note: `terra-snapback-explicit`'s stored `model` field says `grok-4.6`; directory and `lane_id` say terra.)

**glm (glm-5.3-flash) — INCONCLUSIVE; the harness is the story, not the model.** Of 5 lanes, `glm-convex`, `glm-snapback-explicit`, and `glm-snapback-familiar` all **STALLED on OpenCode harness hangs**, and `glm-pocketbase` **never ran**. The lone scored lane, `glm-supabase`, reached only **M1 green** (M2 choreography aborted) yet self-rated its builder experience very high (B **78**, holistic 72) — a single, shallow data point. Treat glm as inconclusive.

## 5. Per-backend findings

Signal-only averages exclude terra (non-signal).

**convex — furthest overall.** Two independent full **7/8** runs (sol 65, grok 67); highest signal-only avg overall **66** (14 greens total). The only backend where two different models both finished the scorable milestone set.

**supabase — highest raw average, but bimodal.** All-lanes avg 54, signal-only **59**. sol nailed a 7/8 lane (overall **69**, the top scored lane in the matrix); grok (43) and glm (66, but only 1 green) were capped by **hosted-Auth signup rate-limiting** on the O5 scale-replay probe (O5=0 for both sol and grok here — a *hosting* cause, distinct from the fixture bug). glm's high B is one shallow lane.

**pocketbase — solid mid-pack.** sol delivered a full 7/8 run (53); grok reached 2 greens (50). Signal-only avg **51** (9 greens total).

**snapback-explicit — only one scored signal lane, and it went deepest of the Snapback runs.** `grok-snapback-explicit` reached **M4** (4 greens, overall 56, builder B 63 — strong). terra's 16 is non-signal, glm stalled, and sol is unscored (fixture-blocked). Its bottom-of-table raw average (36) reflects **thin scored coverage plus the §6 artifacts, not a capability verdict.**

**snapback-familiar — two signal lanes, both cut off at the same artifact.** grok (47, 2 greens) and sol (44, 2 greens) each aborted at **M3** on the cross-client receipt/live-delivery failure (grok O2 42 / B3 58; sol O2 30 / B10 45). Corrected for that harness artifact, familiar's live-query story is materially better than its raw signal-avg (45) implies.

## 6. Fairness caveats folded into the read (authoritative context)

- **Snapback live/realtime scores are unfairly low — harness artifact, not a capability gap.** The familiar lanes aborted at M2–M3 on *"cross-client stale live data"* / *"receipt ticks never reached delivered"* / *"M3 receipts… never invalidated under two Playwright clients"* (sol O2, grok O2/B3). Established out-of-band: headless personas **shared the default auth `storagePartition` and collided** — a test-harness bug, not a Snapback fanout defect (core cross-client fanout is CI-green with separate partitions and worked sub-second in the 0.1.24 runs). Discount the depressed O2/B3/B4 realtime scores on `sol-snapback-familiar`, `grok-snapback-familiar`, and the receipt-liveness note in `grok-snapback-explicit`. This run's docs fix (`diaries/0114`, guide `realtime/live-queries.md` troubleshooting + retrieval routing + qualified client warning) exists to stop the misdiagnosis recurring.
- **O5 / scale-replay was penalized by a broken fixture** (only `scale-log.sha256` shipped, not the actual scale log). This is what **blocked `sol-snapback-explicit` from finishing** (its deep run is therefore unscored) and it cleanly hit **`terra-supabase`** (O5=0, rationale: *"required scale action log was absent"*). **Do not over-attribute:** the other O5=0s have different causes — `sol-supabase`/`grok-supabase` were **hosted-Auth rate-limiting**, and the Convex O5=30s were a **marginal mid-curve p95 predicate miss**, not the fixture.
- **terra is a non-signal** across all 5 lanes (premature M1 stop). Excluded from capability rankings.
- **glm is inconclusive** (OpenCode harness hangs): 1 shallow scored lane, 3 stalled, 1 never run.

## 7. Ranking

**Models by weighted-overall** (avg across scored lanes):

| Rank | Model | Avg overall | Note |
|---|---|---|---|
| — | glm | 66 | 1 lane only — **inconclusive** |
| 1 | **sol** | **57** | 4 lanes |
| 2 | grok | 53 | 5 lanes |
| — | terra | 23 | **non-signal** |

Among models with a real sample (≥3 scored lanes): **sol (57) > grok (53) ≫ terra (non-signal)**; glm inconclusive.

**Models by greens** (total across scored lanes):

| Rank | Model | Greens | Per scored lane |
|---|---|---|---|
| 1 | **sol** | **23** | 5.75 (4 lanes) |
| 2 | grok | 16 | 3.2 (5 lanes) |
| 3 | glm | 1 | 1.0 (1 lane) |
| 4 | terra | 0 | 0 |

**Backends by weighted-overall:**

- *All lanes:* supabase 54 > convex 52 > pocketbase 42 > snapback-explicit 36 = snapback-familiar 36
- *Signal-only (excl. terra):* **convex 66 > supabase 59 > snapback-explicit 56 > pocketbase 51 > snapback-familiar 45** (note snapback-explicit's 56 rests on a single grok lane).

**Backends by greens** (total / best single lane):

| Rank | Backend | Total greens | Best lane |
|---|---|---|---|
| 1 | **convex** | 14 | 7 (sol *and* grok) |
| 2 | supabase | 9 | 7 (sol) |
| 2 | pocketbase | 9 | 7 (sol) |
| 4 | snapback-explicit | 4 | 4 (grok) |
| 4 | snapback-familiar | 4 | 2 (grok, sol) |

**Which backend let models get furthest:** **convex** — the only backend with two independent full 7/8 runs. supabase and pocketbase each produced one 7/8 run (both sol). On Snapback, the furthest anyone reached was **M4** (`grok-snapback-explicit`, 4 greens) before the offline milestone; the familiar lanes were cut off at M3 **by the §6 harness artifact**, so Snapback's bottom-of-table placement reflects test-rig limits (partition collision, missing scale fixture) more than a 0.1.29 capability ceiling.
