# Supervised Expo dev owner reportedly dies on stdin/pipe EOF (verify: regression or Expo-supervisor gap)

**Status:** Open (needs code verification)
**Systems:** Dev loop, Expo/Metro supervision
**Date:** 2026-08-27
**Related:** `issues/closed/20260805-snapback-dev-stdin-eof-silent-stop.md`
(closed: general dev-loop stdin EOF no longer calls `stop()`),
`issues/20260825-dev-control-channel-requires-stdin.md`, LLP 0030,
`packages/snapback-cli/expo-dev.mjs`

## Observation (not yet code-verified)

In the 2026-08-27 clique matrix (published 0.1.29), the autonomous lane
`grok-snapback-explicit` recorded, as a "Fought" item: *"supervised Expo web
wants stdin detached or the owner dies on pipe EOF."* The model detached stdin
to keep the supervised `snapback dev --expo --expo-platform web` owner alive.

## Why this needs verification (don't assume regression)

`20260805-snapback-dev-stdin-eof-silent-stop` was **fixed + closed**: the
readline close handler no longer calls `stop()`, so general dev-loop stdin EOF
keeps the server/watcher/client arm live. This new observation is about the
**supervised Expo owner** specifically. Two possibilities to distinguish:
1. **Regression** — the 20260805 fix regressed on the Expo path.
2. **Uncovered path** — the Expo supervisor owner has its own stdin/EOF handling
   the 20260805 fix (general dev loop) never covered.

It is a single lane observation; the model may also have detached stdin
pre-emptively rather than proving the owner dies. Treat as a lead to confirm.

## Wanted

- Reproduce: launch `snapback dev snapback --expo --expo-platform web` with stdin
  as a closed pipe / `/dev/null` and confirm whether the supervised Expo owner
  exits on EOF (vs staying live like the fixed general dev loop).
- If it dies: fix the Expo supervisor's stdin/EOF handling to match the
  20260805 contract (EOF closes only the optional command channel; the owner,
  Metro, and backend stay live), and add Expo-path acceptance coverage.
- Evidence: lane run-log `~/clique-matrix-0129/lanes/grok-snapback-explicit/`.
