# Diary 0073 — Clique P2 pilot: three lanes, one canonical app

**Date:** 2026-08-09 · **Run:** LLP 0201 D7 P2 pilot (N=1, not
claim-eligible) · **Record:**
`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md` ·
**Raw lane artifacts:** `/Users/ccheever/clique-runs/p2-pilot/` (run
machine; per-lane run-log/diary/essay/scores + M7 logs + receipts)

First execution of the Clique canonical full-app benchmark (LLP 0201,
brief revision h, instrument 0.1.0-p1): Snapback (skill, npm 0.1.15),
Convex (anonymous local, 1.43.0), Supabase (hosted cloud, js 2.112.2)
— each M1–M6 + scale replay by a cold builder agent, then M7 by a
contamination-shielded fresh session, then builder rubric scores.
This diary is the digest; the lane diaries and essays are the primary
narrative sources and are quoted here only at their sharpest points.

## What one sentence per lane would say

- **Snapback (holistic 72, B8 90):** "long stretches of gliding …
  punctuated by a few expensive dark rooms where the platform went
  silent and an afternoon of brokering around a missing auth mode" —
  and the best day-2 story of the three ("declare, migrate, types
  flow through, data verifiably intact" — near-verbatim the 90
  anchor).
- **Convex (holistic 78, B8 82):** "the *hard* parts of a messenger
  felt paved, and the *mundane-sounding* parts (a durable cache, a
  revocable image URL, a JWT key) were where the hours went …
  hand-rolling an offline store while knowing that on some other
  backend this milestone is a config flag."
- **Supabase (holistic 74, B8 74):** real Postgres and the only lane
  where auth mostly just worked (B2 82) — but "everything that made
  it safe was discipline, not tooling," and the hosted posture's
  fixed signup meter made the scale envelope structurally
  uncompletable inside the cap.

## The convergent findings (what the pilot was for)

1. **Snapback's outbox silent-queue trap was found twice, blind**: the
   builder lost hours to `{queued:true}` resolving like success; the
   fresh M7 session independently hit the same edge as a
   queued-but-rejected settlement promise erasing its optimistic
   marker. One platform edge, two sessions, zero shared context —
   the highest-confidence product finding of the run.
2. **The gap lists are nearly disjoint** — each platform's lanes
   hand-built what the others ship (Snapback: password auth, follower
   joins, offline protected reads; Convex: the entire durable offline
   layer, revocable media, presence; Supabase: offline, live queries,
   connection state). The brief discriminates; the instrument works.
3. **Posture dominates the replay**: local lanes completed (Convex
   39.9 min, Snapback 120 min); the hosted lane hit the 4 h cap at
   56.9% because of a fixed provider signup meter, honestly reported
   with rate decomposition and extrapolation (~5.07 h). P3 owns the
   ruling (registration carve-out vs posture budgets).
4. **B8 inverts the holistic ordering** (90/82/74 vs 72/78/74):
   day-2 evolution is where Snapback's architecture pays, and the
   fresh-session design successfully isolated that signal from
   builder familiarity.
5. **Measurement machinery held under adversity**: a machine outage,
   a watchdog stall, an externally killed replay driver, and an
   over-broad pkill all happened — and every one is visible in the
   record with honest clock accounting rather than silently absorbed.
   The idempotent-clientKey replay design turned the worst incident
   into bookkeeping (fast-forward 88k actions, zero errors, one
   explained mismatch).

## Harness lessons folded back (tickets filed)

Choreography segment-green is structurally unreachable in the P1
skeleton (issues/20260809-choreo-green-unreachable.md); per-milestone
token phases are not metered by this driver
(issues/20260809-per-milestone-token-metering.md); process-custody
rules (detached replay drivers with scaleexit lines; kill-by-own-PID)
belong in the P3-frozen lane templates.

## Next

Clean Snapback re-run for M5/M6 cap figures; grader phase (O-dims
never ran — B-scores are builder self-assessments for anchor
calibration); the F1 replay-posture ruling; then P3 gap-fix + freeze.
The Snapback gap list (12 items, headed by password auth) is the
work queue LLP 0201 predicted the pilot would produce.
