# Make lane setup tolerate milestones without starter logs

**Status:** Open
**Opened:** 2026-08-22
**Systems:** Benchmark lane setup, Social-messenger instrument
**Related:** LLP 0201; LLP 0277;
`benchmarks/runs/2026-08-22-clique-full-familiar-vs-explicit/record.md`

## Problem

`benchmarks/tools/lane-setup.mjs` renders one
`fixtures/starter-<milestone>.log` link for every in-scope milestone. The
social-messenger instrument has starter segments for M1–M3 but none for
M4–M8, so setup for the full scope fails and its generated orientation can
advertise reduced scope even when the prompt carries the full brief.

The assumption remains in current `main` in the `Fixture entrypoints`
renderer.

## Impact

Full-scope benchmark lanes need prompt-only scope repair or hand-authored empty
fixtures. That weakens the frozen lane packet as the self-contained authority.

## Required change

Represent starter availability explicitly in the instrument manifest and emit
only declared starter links, or deliberately ship and pin empty starter files
for milestones that need them.

## Acceptance

- Lane setup succeeds for M1–M6+M8 without invented fixture paths.
- The generated orientation names the complete requested scope.
- Existing M1–M3 starter links and snapshot validation remain intact.
