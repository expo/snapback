# `snapback generate` under `--expo` kills Metro (`SNAPBACK_EXPO_METRO_EXITED`)

**Filed:** 2026-08-25
**Resolved:** 2026-08-26
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-familiar`
**Systems:** Code generation, CLI, React/Expo, Local server lifecycle
**Owner:** LLP 0310.000 Track C — implemented

## Problem

Familiar's M1→M2 and M2→M3 generates killed the lifecycle owner with
`SNAPBACK_EXPO_METRO_EXITED`. Metro's watcher saw ENOENT on a codegen
`.tmp-*` directory. The lane restarted `snapback dev` against existing
`dev.sqlite3`. That restart is what recooked the Expo receipt; it is not
an acceptable paved recovery.

## Evidence

- `benchmarks/runs/2026-08-25-clique-grok-0127/cells/grok-clique-familiar/run-log.md`
  (epochs 1787658800 and 1787660200)
- LLP 0310 F2 / P3

## Direction

Write codegen temps outside Metro's project watch set, blockList them, or
publish the generated graph atomically so the watcher never opens a path
that then vanishes. `SNAPBACK_EXPO_METRO_EXITED` caused by generate tmp is
a product bug. Distinct from the already-closed `CI=1` watcher issue
(LLP 0307 T1).

Until that lands: one sentence on the familiar / expo-chat loop that
generate under `--expo` can kill Metro on a watched tmp path, and that
restarting the same owner against existing sqlite is a fallback, not the
paved successor step. Do not teach owner restart as success.

## Resolution

Codegen now builds its candidate graph, materialization copy, and rollback
backups in a same-filesystem scratch directory beside and outside the project
root, then immediately publishes the completed graph into `generated/`.
Generation returns only after the successor graph is present; no visibility
delay or owner restart was added.

The LLP 0310.000 C1 regression runs the public `snapback generate` command
under a live supervised Expo owner. Its Metro fixture exits if an in-project
codegen staging directory appears, and the test additionally asserts the same
owner, backend, and Metro pids plus a Metro-served successor descriptor.
