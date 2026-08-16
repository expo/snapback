# Clique convex-familiar pilot — 2026-08-13

Calibration-only paired reduced run (M1–M3), requested after the first
`snapback-familiar-ts-v1` implementation landed. Each model builds Clique once
with Snapback's convex-familiar source profile and once with Convex.

- Models: `gpt-5.6-sol` xhigh and `grok-4.6` xhigh.
- Pair order: Snapback familiar, then Convex.
- Independence: every lane is a new headless model session and may not inspect
  a sibling lane.
- Pin: Snapback source commit `e15064b46`; Convex `1.44.0`; instrument from the
  same Snapback commit.
- Important deviation: the familiar package is not published yet. Snapback
  lanes are source-checkout diagnostics, not LLP 0201 published-surface lanes.
- Evidence level: N=1 calibration/exploratory only; no magnitude claim.

Raw model logs, lane directories, and launcher metadata live outside git under
`/Users/ccheever/clique-familiar-20260813/` on each execution machine. The
consolidated results are in [record.md](./record.md); the build experience is
recorded in
[Diary 0078](../../../diaries/0078-clique-familiar-convex-pilot.diary.md).
