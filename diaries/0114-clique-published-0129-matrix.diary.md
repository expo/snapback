# Diary 0114 — Clique matrix on published 0.1.29 (4 models × 5 backends)

A full Clique benchmark matrix run against the freshly published Snapback
0.1.29, web-only M1–M8, comparing four models — `gpt-5.6-sol` @ xhigh,
`gpt-5.6-terra` @ medium, `grok-4.6` @ xhigh, and `GLM-5.3-flash` (via
OpenCode) — across five backends: Snapback-explicit, Snapback-familiar,
Convex, Supabase, and PocketBase. Lanes ran in isolated workdirs on the fleet
(`expo-build-450b`, `450a`, `expo-build-1000`, `durand`, `bones`). Consolidated
scored record with the weighted per-category matrix:
`benchmarks/runs/2026-08-27-clique-published-0129-matrix/record.md`; the raw
per-lane `diary.md` / `essay.md` / `scores.json` / `run-log.md` are preserved
under that run's `lanes/`.

## Coverage and honesty about it

Of 20 intended lanes, **15 scored cleanly**, and the rest are recorded as they
actually ended rather than papered over:

- **sol-snapback-explicit** — a deep run (M1→M3→scale-replay, 263-line log,
  full diary + essay) that never wrote a final score because it wedged in a
  **scale-replay retry loop on a broken fixture** (only `scale-log.sha256`
  shipped, not the actual scale log). Not the model's fault; not the backend's.
- **glm-convex / glm-snapback-explicit / glm-snapback-familiar** — **stalled**
  (OpenCode/GLM-flash harness hangs; run-logs frozen 1–2.6 hours at 16–40
  lines). `glm-familiar` had degenerated into an observer of a duplicate
  launch earlier in the run.
- **glm-pocketbase** — never started.

The GLM lanes are inconclusive as a capability signal, and the terra lanes are
a **non-signal**: every terra lane ran ~4–6 minutes and self-aborted at M1
(0 greens on all five backends). terra @medium concluded prematurely rather
than hitting a real capability wall — a decisive effort-tier result, not a
coding-ability verdict. The trustworthy signal is **sol** and **grok**, which
ground for hours.

## What the matrix showed (see record.md for the weighted numbers)

- **PocketBase repeatedly topped the greens** (sol-pocketbase 7/8). It's a
  batteries-included single-binary backend, so the model spent its effort on
  product code, not backend wiring.
- **sol was the strongest model**, grok mid, terra a non-signal, glm
  inconclusive.
- **Explicit vs Familiar was not the clean win the "familiar" framing
  promises.** Familiar removed authoring *syntax* friction but not
  *behavioral* friction, and added a documentation-translation cost (no
  familiar-native starter template, no complete familiar auth example, custody
  hard-pinned to `durable-required`). Explicit front-loaded declaration
  ceremony but made authority boundaries legible and reviewable. sol-explicit
  reached deeper (scale-replay) than sol-familiar (which stopped at M3, on a
  harness bug).

## Where Snapback added friction (and what we fixed because of it)

The genuine Snapback friction clustered in four areas — realtime, the dev-loop,
media storage, and multi-client auth custody. Several turned into landed fixes
during the run:

- **The "cross-client fanout is broken" reports were a test-harness artifact,
  not a Snapback bug.** Headless personas shared the default durable auth
  `storagePartition` and collided (the "second client" restored the first
  principal), which *looks* exactly like broken live fanout. Core cross-client
  fanout is CI-green with separate partitions and worked sub-second in the
  0.1.24 coterie runs. Because agents kept mis-attributing this, we landed
  **symptom→cause routing** so a builder debugging "stale live updates" is
  pointed at `storagePartition` (guide `realtime/live-queries.md` troubleshooting
  + retrieval routing + a qualified client warning that names the symptom
  without false-alarming legitimate same-principal sharing).
- **Metro ↔ codegen watch race** (`SNAPBACK_EXPO_METRO_EXITED`): Metro's
  watcher crashed on the transient `.snapback/generations/.tmp-*` churn. Fixed
  by excluding that path from Metro's crawl in the templates.
- **The clock-dependent-visibility guard had no paved path** — builders kept
  re-deriving the client-clock-argument workaround for trending/typing-expiry
  live reads. We paved it with a CI-verified recipe (indexed range-scan, not
  the silently-wrong prefix-then-filter a first draft reached for).
- **A 32 KiB structured-value ceiling** blocked base64 media in document
  fields, and a **published-runtime capability skew** refused
  `assets.media-collection.v1` that 0.1.29 codegen emits (ticketed).
- **Multi-client auth/outbox single-writer contention** for headless
  multi-persona clients, and a **silent** `defineAuth minimumLength` successor
  refusal (ticketed as a silent-degradation-class defect).

Diagnostic precision was otherwise praised repeatedly ("the platform told me
exactly what was wrong every time") — the guard codes are good; it was these
few silent/realtime/media gaps that hurt.

## Benchmark-harness bugs surfaced (not Snapback)

- The **broken O5 scale-log fixture** (checksum only) that wedged
  sol-snapback-explicit and penalized O5 across lanes.
- The **shared-`storagePartition` multi-persona trap** that made real fanout
  look broken and unfairly depressed the Snapback lanes' realtime scores.
- A **frozen-instrument self-contradiction** in M3 choreography and read-only
  instrument dirs requiring writable mirrors.

## Comparison to the familiar alternatives

Against React + Convex/Supabase/PocketBase, the models found Snapback's
authoring *surface* competitive once past setup — the explicit profile's
declaration ceremony is heavier than Convex's, but it made authorization
boundaries reviewable in a way the others don't. The friction that actually
cost milestones was behavioral (realtime custody, dev-loop stability, media
limits), not syntactic. PocketBase's batteries-included single binary was the
lowest-friction backend for simply getting to green; Snapback's differentiator
(reviewable authority + local-first) showed up as ceremony the benchmark's
green/failure rubric doesn't reward but the diaries note as real value.
