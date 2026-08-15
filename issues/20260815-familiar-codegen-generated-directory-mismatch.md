# Familiar codegen writes `_generated/` while `snapback dev` reads `generated/`

**Filed:** 2026-08-15 · **Source:** clique-0121 exploratory sweep (LA Durand,
`~/clique-0121-20260814`), lane `sol-snapback-familiar` (0.1.21) ·
**Systems:** Codegen, CLI, Dev loop

## Problem

Under `authoringProfile: "snapback-familiar-ts-v1"` on the published 0.1.21
closure, code generation emitted `snapback/_generated/` but `snapback dev`
opened `snapback/generated/`. The obvious compatibility symlink triggered a
watcher loop. The lane's reliable workaround was a mechanical post-codegen
copy of the generated directory followed by a server restart — on every
generation.

This is a first-session wall for any familiar-profile consumer: the scaffold
+ generate + dev sequence from the published packages does not converge
without a workaround the docs don't describe.

## Evidence

- `lanes/sol-snapback-familiar/diary.md` (M1 section) and
  `final-report.md` "Capability failures, fallbacks, and gaps" — the copy
  workaround is recorded as a standing fallback; the watcher loop from the
  symlink attempt is in the correction-loop table (instrument/tooling, 12
  loops, of which this is the first).

## Suggested fix

Pick one canonical directory name across codegen and the CLI dev path (and
admission/build tooling), and make the other spelling a hard, explanatory
error rather than a silently different location. Add a regression test that
runs familiar codegen and then boots `snapback dev` against the same tree.
