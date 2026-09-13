# Restore selected automatic Actions after the low-noise interval

Status: open
Filed: 2026-08-24
Area: CI, verification, visibility governance

Progress (2026-08-27): precondition 3 is complete. Preconditions 1, 2, 4,
and 5 remain open, so this ticket remains open and no automatic trigger has
been restored.

LLP 0189's 2026-08-24 temporary low-noise ruling removed automatic execution
from GitHub Actions whose repeated failures or superseded work produced little
new information during bursty direct-to-main development. The measured hour
before the ruling contained 130 runs from 16 pushes: 66 failures and 40
cancellations.

This ticket owns restoration. Do not mechanically restore every old trigger.

## Preconditions

1. Repair the current generated-artifact, deployment-identity,
   workspace-graph, and security-gate-fixture baseline reds.
2. Provision the protected visibility-governance environment, signing
   material, append-only ledger, and external custody required by LLP 0234
   before restoring its observer or reconciler automation. Until then,
   visibility widening remains activation-disabled.
3. **Complete 2026-08-27.** Define and test complete path selectors for
   deployment identity and generated inventories so the offending change is
   checked without repeating an inherited red on every unrelated push. The
   existing `scripts/local-proof-selection-policy.v1.json` deployment-identity
   authority is machine-tested by `tests/local_proof_selection_v0.mjs`; LLP
   0316 Phase 6 adds the workflow-specific, ordered
   `scripts/required-surface-build-paths.v1.json` authority, whose exact
   manifest-derived surface inventory and positive/negative selection behavior
   are enforced by `scripts/check-required-surface-builds.mjs` and
   `tests/required_surface_builds_v0.mjs`. The workflow remains
   `workflow_dispatch`-only; this completion does not satisfy precondition 5.
4. Decide which heavyweight proofs belong to publication/promotion automation
   and which should remain operator-dispatched.
5. Obtain an explicit author direction ending the temporary posture.

## Exit evidence

- A dry-run or bounded observation window shows that ordinary direct pushes
  launch only cheap/affected work and do not queue one heavyweight copy per
  commit.
- Selected checks still fail the change that introduces a representative
  stale artifact or affected product regression.
- Complete latest-main proof remains scheduled at least twice daily and can be
  invoked manually.
- Visibility automation produces a protected verdict in its real custody
  profile before activation consumes it.
- The trigger restoration and the LLP 0189 amendment land together.
