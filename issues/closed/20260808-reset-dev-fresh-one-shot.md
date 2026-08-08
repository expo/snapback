# One-shot deterministic dev reset: snapback reset --dev-fresh

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Systems:** CLI, Local server lifecycle, Auth, Seeds
**Date:** 2026-08-08
**Related:** Diary 0068; Diary 0066

Diary 0068's bare lane paid three restart loops to a cluster of
individually-correct refusals around state lifecycle: content-addressed
seed identity (`SNAPBACK_SEED_VERSION_REUSED`), untracked-seed residue
after a raw `reset --seed` (`SNAPBACK_SEED_NONEMPTY_UNTRACKED`), and
`app.reset` invalidating sessions so the supervised client boots to
`SNAPBACK_AUTH_REQUIRED` until the supervisor re-mints. Each refusal names
its own fix; collectively the deterministic escape the lane converged on
by experiment was "fresh DB + restart supervisor + re-mint."

Ship that as one command: `snapback reset --dev-fresh` (dev/supervised
targets only) — fresh database, seed re-apply, supervisor-coordinated
session re-mint, one readiness report. Keep every individual refusal
unchanged for partial operations. Acceptance: after arbitrary schema/seed
edits, one command returns a supervised Expo loop to a booting, seeded,
authenticated state with no manual sequence.

- **Claimed 2026-08-08:** session 86767887 (the diary-0068 orchestrator) is executing this ticket now; sibling sessions should not duplicate.

## Resolved — 2026-08-08

Shipped `snapback reset --dev-fresh` (dev/supervised targets only) as a
packaged CLI command composing the deterministic escape without weakening any
individual refusal:

- **Dev-loop verb.** `runDev` gains a fourth serialized verb, `dev-fresh`
  (TTY key `f`, JSON verb `dev-fresh`): stop the managed child, delete the
  database state (db/-wal/-shm/admin-token/ready file), respawn with fresh
  startup artifacts, regenerate, and load with `seed: true` (versioned
  reset-install or legacy seed). Events: `database-refreshed`,
  `dev-fresh-failed`; unmanaged targets refuse
  (`SNAPBACK_DEV_FRESH_UNMANAGED`).
- **Supervisor coordination.** `runExpoDev` writes a value-free discovery
  descriptor (`expo-supervisor.json`, 0600, removed on close) and its
  bootstrap exchange gains a loopback `POST /_snapback/expo/v1/control`
  route, operator-token-authorized (constant-time compare;
  `SNAPBACK_EXPO_CONTROL_UNAUTHORIZED` / `_VERB_UNKNOWN` / `_BODY_INVALID`).
  The `dev-fresh` verb there runs the dev-loop verb, re-derives the backend
  route/binding, re-verifies the all-loopback listener inventory, re-mints
  the ordinary session through the same helper `replaceAuthority` uses, and
  answers with one `snapback.reset-dev-fresh.v1` readiness report (no token
  material anywhere).
- **CLI.** `snapback reset [<backend-dir>] --dev-fresh [--db] [--ready-file]
  [--email] [--json]`: coordinates with a discovered live supervisor;
  refuses a live non-supervised dev loop
  (`SNAPBACK_RESET_DEV_LOOP_ACTIVE`, recovery names the control-channel
  verb) and a stale supervisor descriptor
  (`SNAPBACK_RESET_SUPERVISOR_STALE`); standalone it removes the state,
  boots managed once (fresh DB seeds automatically), verifies sessions
  authority with one discarded mint, stops the server, and reports. All
  other `reset` forms delegate byte-for-byte to the native `app.reset`.
- Guide: `versioned-seeds.md` (refusal-cluster escape),
  `sessions-and-principals.md` (supervised re-mint), and
  `the-authoring-loop.md` (destructive branch one-shot) teach the new
  command; generated projections refreshed.

Refusal preservation: `SNAPBACK_SEED_VERSION_REUSED` /
`SNAPBACK_SEED_NONEMPTY_UNTRACKED` paths are untouched (native/server code
unchanged; conformance suite unchanged); the new acceptance suite pins
`SNAPBACK_AUTH_REQUIRED` for a pre-reset bearer after a supervised
`--dev-fresh` and byte-exact native delegation for non-`--dev-fresh` resets.

Evidence (2026-08-08, `packages/snapback-cli/reset-dev-fresh.test.mjs`, real
runtime): standalone sequence (schema edit → `--dev-fresh` → clean re-boot
with seeded rows, no `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`), supervised
sequence (bearer rotated, stale bearer `SNAPBACK_AUTH_REQUIRED`, seeded read
through the replacement, binding origin updated, listener inventory loopback,
descriptor removed on close), control-route authorization, delegation, and
lifecycle refusals — all pass, twice. Regressions green: sessions-dev-loop,
dev-loop, dev-cli-diagnostics, load-generated, expo-bootstrap-exchange,
package.test, cli-help, check-package-test-inventory (234),
check-inventories, check-guide, ref-check. Note: `expo-dev-loop.test.mjs`
passed 2/4 runs with an identical failure reproduced on the unmodified
baseline under heavy machine load ("successor authority query/presence
re-entry" 30s timeout) — pre-existing load flake, not introduced here.
