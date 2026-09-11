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

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — implementation fixed; verification blocked by instrument drift. **Triage priority:** P2.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

Current lane-setup.mjs explicitly omits missing M4–M6/M8 starter segments, preserves canonical M1–M3 refusals and prints full continuous scope. Commits 607dd776d and eff33c588 implement the requested behavior.

Fresh command on 15c134d056: node --test --test-name-pattern='full continuous journey without inventing starter segments' benchmarks/tools/lane-setup.test.mjs. Result: 0 pass / 1 fail, before the target behavior, with instrument artifact brief digest mismatch at briefs/social-messenger.md. Do not label this the original starter bug or change the frozen manifest to get green. Remaining: run that existing regression against a coherently qualified instrument snapshot, then close.
