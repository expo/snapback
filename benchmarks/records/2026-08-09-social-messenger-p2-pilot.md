# Run record — social-messenger (Clique) P2 pilot, 2026-08-09

**Status: PILOT — calibration evidence only, not claim-eligible**
(LLP 0201 D7 P2; published per P2's clearly-labeled-calibration rule).
N=1 per tier-1 lane, primary family (Claude, claude-fable-5 via the
session harness), serial lanes, same machine (M5 Max, shared fleet
load), brief at revision (h) blobs e2c65704/da973789, instrument
0.1.0-p1 (commit d2e8af707). Full artifacts (run journal, per-lane
run-logs/diaries/essays/scores, receipts, snapshots) at
`/Users/ccheever/clique-runs/p2-pilot/` on the run machine; narrative
digest in `diaries/0073-clique-p2-pilot.diary.md`.

## Lanes

| | Snapback (skill, npm 0.1.15) | Convex (anon local, 1.43.0) | Supabase (hosted us-west-1, js 2.112.2) |
|---|---|---|---|
| Posture | local binary via dev supervisor | local dev backend | hosted cloud dev |
| M1 | 16.2 min GREEN | 19.8 min GREEN (incl. scaffold) | 22.9 min GREEN (incl. scaffold) |
| M2 | 17.6 min GREEN | 10.7 min GREEN | 11.7 min GREEN |
| M3 | 30.3 min GREEN | 13.7 min GREEN | 16.9 min GREEN |
| M4 | 15.2 min GREEN | 3.4 min GREEN | 9.4 min GREEN |
| M5 | GREEN — wall in combined blob* | 16.0 min GREEN | 6.7 min GREEN |
| M6 | GREEN — wall in combined blob* | 15.2 min GREEN | 7.1 min GREEN |
| M1–M6 total | ~4.5 h* | 78.9 min | 74.7 min |
| Replay (own clock) | 120.0 min COMPLETE | 39.9 min COMPLETE | **4 h CAP at 56.9%** |
| Replay integrity | 1 mismatch (lane ops account, explained) | 0 mismatches | exact over applied prefix; tail honestly unapplied |
| M7 (fresh session) | 43.6 min, diff clean | 29 min, diff clean | 21 min, diff clean |
| Holistic | 72 | 78 | 74 |
| B8 day-2 | 90 | 82 | 74 |

\* The Snapback lane's M5+M6 interval (3h23.5m combined) contains a
machine outage, a harness watchdog stall+resume, an externally killed
replay driver, and the lane's own orphaned-suite cleanup; per-milestone
attribution inside it is not clean and is reported combined. The lane
recorded the stall in-log; wall-clock interpretation must subtract the
gap. A clean Snapback re-run is required before its M5/M6 figures can
seed caps.

Builder dimension scores (0–100 vs frozen anchors; B8 from the M7
sessions; no weighted totals computed — nulls-block-totals applies):

| Dim | SB | CX | SU | | Dim | SB | CX | SU |
|---|---|---|---|---|---|---|---|---|
| B1 schema | 72 | 85 | 88 | | B6 search | 55 | 58 | 65 |
| B2 auth | 48 | 55 | 82 | | B7 push | 58 | 58 | 55 |
| B3 realtime | 78 | 72 | 78 | | B8 day-2 | 90 | 82 | 74 |
| B4 offline | 55 | 32 | 35 | | B9 DX | 68 | 82 | 80 |
| B5 media | 62 | 50 | 62 | | B10 diagnostics | 55 | 60 | 58 |
| | | | | | B11 operations | 74 | 52 | 75 |

## Scale-envelope probe data (informational; postures differ — no cross-backend speed claim)

- Snapback: busy-chat page1 p95 47.7 ms vs page50 48.3 ms (flat);
  following-feed 500-vs-5 ratio 1.8; **search.busyChat p95 806 ms**
  (the one slow surface); replay ~23/s.
- Convex: page50/page1 ratio 0.86; feed ratio 1.0; global search p95
  82.3 ms; cold sync p95 233.6 ms; replay ~68/s; all degradation
  rules pass.
- Supabase: cp10/cp50 sub-manifests exact; registration phase
  0.21/s (GoTrue fixed 30-signups/5min/IP, ~382/hr, no management
  knob); post-registration 18.56/s sustained, zero 5xx; full-envelope
  extrapolation ≈ 5.07 h of which ≈ 2.62 h is the auth meter.

## Calibration outputs (provisional cap bases, formula: 2× slowest tier-1 pilot figure)

| Milestone | Slowest pilot figure | Provisional wall cap |
|---|---|---|
| M1 | 22.9 min (SU) | ~46 min |
| M2 | 17.6 min (SB) | ~36 min |
| M3 | 30.3 min (SB) | ~61 min |
| M4 | 15.2 min (SB) | ~31 min |
| M5, M6 | **UNRESOLVED** — SB figures contaminated | pending clean SB re-run (safety limit stands in) |
| M7 | 43.6 min (SB) | ~87 min |
| Replay | 120 min (SB, completed) | 240 min — but see finding F1 |

Token caps: **NOT DERIVABLE from this pilot** — the orchestration
harness metered lane-total tokens only (SB ≈ 1.9M across
build+recoveries, CX ≈ 0.52M, SU ≈ 0.49M, M7 sessions 0.23–0.31M),
not per-milestone phases. Per-milestone token metering is open P1
harness work (run-record extension exists; the driver does not emit
it).

## Findings for P3 (freeze inputs)

- **F1 — Replay posture**: a hosted lane cannot complete the
  registration phase inside any reasonable cap (fixed provider
  signup meter). P3 must choose: registration carve-out from the
  replay clock, posture-adjusted replay budgets, or capped-failure
  stands as an honest posture finding. The replay contract's
  settle-before-next rule is otherwise sound (all three adapters
  proved idempotent resume/verification).
- **F2 — P1 choreography harness defect**: segment-level `green` is
  structurally unreachable (every segment carries implemented:false
  stubs; M6 requires an iOS-simulator receipt with no driver). All
  lanes were graded under a documented "pilot interpretation."
  Tickets filed (issues/20260809-*).
- **F3 — Per-milestone token phases missing** (see above).
- **F4 — Process custody**: two incidents — the harness task sweep
  killed lane 1's replay driver (fix: detached own-session spawn +
  guaranteed scaleexit line, now proven), and lane 3's shutdown
  pkill was over-broad (fix: kill-by-own-PID rule, added to M7
  prompts mid-pilot). Both rules belong in the P3-frozen lane
  templates.
- **F5 — Snapback gap list** (12 items, lane final report):
  headline items — no password auth (undocumented session-mint HTTP
  shape); outbox `{queued:true}` resolves like success (independently
  rediscovered by the M7 session as the queued-but-rejected
  settlement promise — the strongest convergent product finding);
  JS-arm protected-data cold-offline retention GAP; typed
  `client.search()` contract-hash skew within 0.1.15;
  membership-visible search slow at envelope (806 ms p95).
- **F6 — Competitor gap symmetry**: Convex (8 items: no durable
  offline ~350 LoC hand-built; unrevocable storage URLs; ephemeral +
  connection registry hand-built; no count()) and Supabase (9 items:
  unconfigurable signup meter; no offline story; no live-query
  primitive; RLS fail-silent writes; JWTs survive logout) each
  hand-built what Snapback ships as primitives, and vice versa — the
  three gap lists are nearly disjoint, evidence the brief
  discriminates.

## Deviations and honesty notes

- Lane greens use the pilot interpretation (suite + implemented
  choreography checks) per F2. Simulator-class offline assertions
  (m6-a01..a04) are not simulator-proven in any lane; web
  backend-stopped evidence recorded instead.
- Convex "fresh instance" = full wipe (no second-instance story);
  Supabase M7 reset via lane tooling on the same cloud project.
- The Snapback lane's replay was resumed after an external kill with
  clock carried from its own checkpoint log (documented in-log);
  Supabase's checkpoint verification ran concurrently rather than
  pause-verify-resume (documented; upward-drift on one count class).
- Graders have not run; O-dimensions are unscored. B-scores are
  builder self-assessments against frozen anchors — pilot-grade
  evidence for anchor calibration, not outcomes.
