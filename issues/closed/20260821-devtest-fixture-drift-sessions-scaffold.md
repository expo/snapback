# Dev-loop/verify fixtures drifted behind the sessions-mode + governance template overhaul

Systems: CLI, Testing, Templates
Status: Closed
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

## Resolution (2026-08-25)

The sessions scaffold failure was a strict fixture assertion: the React
template already declared sessions mode, so rewriting it was a no-op that the
test treated as failure. The sessions-dev-loop fixture now accepts an existing
sessions declaration and rewrites only an older dev-mode shape; the
reset-dev-fresh fixture uses the same tolerant rule.

The reset-dev-fresh initial generation failure was isolated to fixture setup,
before any forced lifecycle verb: deleting the copied `generated/` directory
also deleted the LLP 0234 authorization-program inputs. The fixture retains
and restores the owner/override baselines, table-policy baseline and transition
ledger, and quarantine ledger before regeneration. This change documents that
governance dependency with an `@ref` and leaves the generated products
themselves disposable.

Two lane-environment drifts masked those assertions and are fixed in the same
scoped test path: generated temp modules now receive the workspace client link
they import, and the shared runtime symlink is verified against the physical
checkout's Hermes artifacts rather than the empty lane checkout.

Verification: `sessions-dev-loop.test.mjs`, `reset-dev-fresh.test.mjs`, and
the 50-case `verify.test.mjs` suite pass against the shared prebuilt runtime.
