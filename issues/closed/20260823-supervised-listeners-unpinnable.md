# Supervised Expo cannot pin its ports — Metro, client front, and bootstrap were `listen(0)`

- Status: Resolved
- Date: 2026-08-23
- Resolved: 2026-08-23
- Systems: `packages/snapback-cli` (`expo-dev.mjs`, `index.mjs`),
  `crates/snapback-cli` (`start --port-range`), Guide, Templates
- Governing: LLP 0299 (new); LLP 0010; LLP 0181; LLP 0223
- Evidence: Diary 0100, Diary 0101, Diary 0104, Diary 0106;
  `benchmarks/runs/2026-08-22-clique-local-main-grok/record.md`

## Symptom

`snapback dev --expo --expo-platform web` (the expo-chat template default)
brought up a working app, but Metro, the browser-facing origin, and the
bootstrap exchange each bound OS-assigned ephemeral ports with no CLI flag to
choose them. Only the backend honoured `--port`. On Linux the ephemeral ports
landed in 32k–60k (Clique saw 54050 and 33345), so pinned-range lanes were out
of contract, and every restart moved the origin the browser had just stored a
session for. `--external-client-origin` cannot be combined with `--expo`, so
the first-party Expo path could not say "pin backend and pin Metro"; every
Clique lane rediscovered the split-the-stack workaround (Diary 0106: 36
minutes of M1 wall).

## Resolution

LLP 0299 extends the backend's LLP 0010 posture (stable range by default,
explicit pin strict) to every listener `snapback dev` owns, in every profile:

- `--client-port`, `--bootstrap-port` (with `--port`) pin supervisor-owned
  listeners strictly; an occupied pin refuses with
  `SNAPBACK_DEV_PORT_UNAVAILABLE` naming the holder, never adopting or
  killing it.
- `--port-range <lo>-<hi>` places every unpinned owner inside the range,
  including the backend (`snapback start --port-range`); exhaustion refuses
  with `SNAPBACK_DEV_PORT_RANGE_EXHAUSTED`.
- With no flags, supervisor-owned listeners are allocated deterministically
  from the default 4287–4387 range (descending from the top), so origins are
  stable across restarts on a quiet host.
- `SNAPBACK_DEV_PORT`, `SNAPBACK_DEV_CLIENT_PORT`,
  `SNAPBACK_DEV_BOOTSTRAP_PORT`, `SNAPBACK_DEV_PORT_RANGE` are the
  environment equivalents (flag > env > default).
- Readiness, the supervisor descriptor, and `inspection()` carry a
  `portPlan` with per-owner provenance.

See LLP 0299 for the contract and the honest comparison with Convex/Supabase
(origin-scoped sessions and a supervisor-owned bundler are the structural
reasons this class of bug exists at all; those remain open author questions).
