# LLP 0234 G2 corpus closure: repo sweep finds 10+ demo schemas with undeclared tables

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Demos, Auth, Code generation
**Date:** 2026-08-17
**Found while:** 0.1.24 release gating (fourth straggler fixture fixed tonight)

Stragglers fixed so far by release-gating fix-forwards: the five CLI scaffold
templates (80ff4864f), tests/fixtures/familiar-todo* (f66df78dd), the
packaged-store qualification probe (18607c046), and
packages/snapback-react/fixtures/packed-expo (this landing).

A repo-wide sweep (`grep -c visibility < grep -c defineTable` over every
snapback/schema.mjs outside node_modules) still finds undeclared tables in at
least: demos/catalog-lens (2/3), demos/tiny-triumphs (1/2),
demos/public-dashboard (1/2), demos/latency-kanban (2/3), demos/warble (0/4),
demos/file-drop (1/2), demos/chirp (3/4), demos/dispatch-board (2/3),
demos/pointing-room (3/4), demos/media-happy-post (2/3), and possibly more
(sweep truncated at 10).

These only red when regenerated, so they are landmines for any lane that
touches those demos. The 0234 owner should close the corpus with per-table
honest policies (precedent pattern: @ref comment + honest narrowest, landed
examples above) rather than letting each future lane fix-forward one at a
time. Consider a repo check that fails on undeclared tables in tracked
schema.mjs files so the corpus cannot regrow.
