# LLP maintenance audit — second deep-round remediation

**Intent:** audit / pre-demo landing

**Scope:** `c42feb250..pending-final-freeze` plus coordinator-owned remediation evidence

**Mode:** propose-only; this artifact applies no LLP edits by itself

## Deterministic checks

The final integration gate must retain:

- `./ref-check --verbose`: zero errors and zero unchecked references;
- `node scripts/check-guide.mjs`: pass;
- the focused sessions preflight regression and `auth_artifacts_v1`: pass;
- all 35 run capsules under both the repository verifier and strict Draft 2020
  schema validation; and
- the deep-remediation ledger verifier: pass.

## Co-evolution review

- LLP 0058 continues to govern complete-pair, pre-effect, fail-closed sessions
  startup. The repair changes target-fact construction, not the authority or
  transition contract.
- LLP 0076's exact-instance capability contract remains governing. Its
  implementation ledger is reconciled to disclose that the earlier
  "every loader" claim had missed sessions preflight and to bind the repair and
  full Research Room confirmation.
- LLP 0061 governs the Guide additions. Every observed Guide-preventable
  friction has either a resolved Guide-gap ticket or an explicit capability
  row.
- LLP 0102's protocol remains frozen. Original deep evidence and timing are
  unchanged; remediation evidence is additive, target-isolated, and
  before/after linked.
- The separate served-capability-manifest consolidation issue remains open so
  future loader/inspection seams cannot drift independently.

No LLP status change, supersession, retirement, or normative amendment is
proposed.

## Non-blocking proposals

1. Implement one internal served-manifest constructor and make every admission,
   publication, and inspection seam consume it.
2. Add generation-time membership-command cardinality diagnostics where the
   authored shape is statically visible.
3. Make public client inspection sessions-aware while preserving the separate
   secret-read operator lease.
4. Keep assets, vector retrieval, hosted deployment, protected offline
   settlement, and clean external packaging as product gaps in the final
   backlog; this remediation did not close them.
5. Keep the unrelated root LLP edit and vendored Ibex worktree state out of
   bakeoff commits.

These are proposals, not blockers for the Stage 4 evidence landing.
