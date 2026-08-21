# Dev-loop/verify fixtures drifted behind the sessions-mode + governance template overhaul

Systems: CLI, Testing, Templates
Status: Open
Opened: 2026-08-21

Since the react template started scaffolding sessions mode and honest table
visibility (80ff4864f and siblings), several test fixtures that rewrite a
scaffolded schema into sessions mode (or assume a pre-governance scaffold)
broke on main:

- `packages/snapback-cli/verify.test.mjs` live-sessions block — **fixed** on
  the sbs/20260820-g-verify-receipt branch (tolerant rewrite + freshness
  probe now preserves LLP 0234 governance inputs).
- `packages/snapback-cli/sessions-dev-loop` test — scaffold is already
  sessions-mode; its rewrite assertion fails the same way the verify block
  did. Still red.
- `packages/snapback-cli/reset-dev-fresh` test — fails its initial
  generation before any forced verb. Still red; root cause not yet isolated
  (likely the same scaffold-shape drift).

These are inherited main reds (LLP 0232 baseline class), discovered during
the 2026-08-20/21 sbs-orchestrate wave. Fix-forward: apply the same
tolerant-fixture pattern used in verify.test.mjs, and isolate the
reset-dev-fresh generation failure.
