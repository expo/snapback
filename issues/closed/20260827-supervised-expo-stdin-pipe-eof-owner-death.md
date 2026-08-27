# Supervised Expo dev owner reportedly dies on stdin/pipe EOF (verify: regression or Expo-supervisor gap)

**Status:** Closed (clean non-reproduction)
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

## Resolution (2026-08-27)

The supervised Expo owner **survives stdin EOF** both before startup and after
application readiness. No CLI or supervisor fix is needed.

Verification used a fresh locally scaffolded `expo-chat` app whose installed
Snapback packages resolved to published `0.1.29`, launched by this worktree's
CLI and bootstrap-qualified runtime. Each run used its own never-before-used
database path under `/tmp/snapback-expo-eof.AsfPfG/`, so no previous server
could own the database.

1. **EOF at startup.** `printf '\n' | snapback dev snapback --expo
   --expo-platform web --db <fresh-immediate-db> --json` emitted supervisor
   `ready` for correlation
   `snapback-expo-dc1761ee-468a-4903-b4d0-28cf5d86ebf9`. Ten seconds later,
   supervisor PID 65542, backend PID 65625, and Metro PIDs 65636/65677 were
   still alive (34–38 seconds elapsed), and both the backend and Metro origins
   returned HTTP 200. Ctrl-C then emitted `closed` with backend, Metro, and
   bootstrap all reclaimed.
2. **EOF after readiness.** A `sleep 317` pipe held stdin open while the same
   command used `<fresh-after-ready-db>`. After supervisor `ready` for
   correlation `snapback-expo-a0590e70-2365-4e3b-b7ea-0775ea47dab0`, killing
   only pipe-writer PID 67494 delivered EOF. Ten seconds later, supervisor PID
   67495, backend PID 67579, and Metro PIDs 67590/67631 were still alive
   (42–46 seconds elapsed), and both origins returned HTTP 200. SIGTERM then
   exited 0 and emitted `closed` with backend, Metro, and bootstrap reclaimed.
   A final process/database-owner check found none of those PIDs and no holder
   for either fresh database.

The clique-lane observation was therefore not an Expo stdin lifecycle defect.
The two earlier failed verification attempts' `database already owned by
another local server` diagnosis remains the supported ownership refusal: use
the existing server, stop its owner, or select a fresh isolated database with
`--db` (and use an in-memory database on commands that expose `--memory`).
