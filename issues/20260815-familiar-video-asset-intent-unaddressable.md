# Familiar asset surface: derived intent is image-only and the explicit video intent cannot be named

**Filed:** 2026-08-15 · **Source:** clique-0121 exploratory sweep (LA Durand,
`~/clique-0121-20260814`), lane `sol-snapback-familiar` (0.1.21) ·
**Systems:** Assets, Familiar profile (LLP 0252/0253)

## Problem

Familiar's derived same-profile asset intent is image-only, and the
explicit top-level video intent cannot be addressed through Familiar's
two-segment export namespace. Faced with Clique's video-post requirement,
the lane stored the fixture video as a data URL split across three
independently bounded backend fields and reconstructed it in the live
projection — recorded as the run's clearest "capability cliff" where the
familiar convenience boundary ends without an escape.

The general principle the lane states is right: everything reachable in
the explicit profile should be nameable from Familiar, or Familiar's docs
must define the sanctioned escape (mixed-profile or otherwise). Media is
exactly where a social app hits this first.

## Evidence

- `lanes/sol-snapback-familiar/diary.md` M2 + `final-report.md`
  ("Profile capability failure") + `essay.md` (media section).
- Calibration: the simplified lane (explicit profile) admitted real image
  and MP4 bytes through the canonical asset intent/command flow on the same
  0.1.21 closure, so the runtime capability exists; Familiar just cannot
  reach it.

## Suggested fix

Give Familiar a way to declare or name non-derived asset intents (video
first), or extend the derived intent beyond image. Add a familiar-profile
asset acceptance test that uploads and reads back an MP4.
