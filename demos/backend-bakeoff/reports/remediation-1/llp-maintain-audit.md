# LLP maintenance audit — first calibration remediation

**Intent:** audit / pre-demo landing
**Scope:** `d4d8fc21..5f31cb61` plus coordinator-owned remediation evidence
**Mode:** propose-only; this artifact applies no LLP edits

## Deterministic result

`./ref-check --verbose` reports 107 LLP documents, 2,210 references in 3,702
files, zero errors, and zero unchecked references.

## Co-evolution review

- LLP 0053's quarantine, terminal-delete, exact-ACK, and
  authority-independent contracts still govern SB-001. The implementation and
  four-shape real-server evidence narrow a stale client projection check; they
  do not change the accepted contract.
- LLP 0059's terminal blank and handle-lifecycle ownership still govern SB-002.
  Idempotent high-level disposal preserves strict foreign ownership and
  low-level unsubscribe failures.
- LLP 0013's typed, non-durable, shared-lane ephemeral model still governs
  SB-003. Making stream demand/readiness part of the ordinary subscription path
  and restoring generated value types changes ergonomics, not the room model.
- LLP 0102 already requires provider-independent remediation, before/after
  evidence, append-only diaries, a Snapback freeze, and isolated reruns. The
  ledger, report, evidence roots, and concurrency map conform.
- The three repository issues now contain resolution sections and move to
  `issues/closed/`; no live state remains duplicated.

No governing LLP text contradicts the repaired behavior, and no LLP status
change is proposed.

## Non-blocking proposals

1. Consider adding a direct `@ref LLP 0059#typed-terminal-auth-error` annotation
   beside the query-specific terminal-delete early return in the live-handle
   retirement helper. The existing nearby annotation covers whole-authority
   blanking; a direct link would make the distinction easier to recover.
2. During Stage 4, reconcile the deferred SB-005 through SB-008 items against
   their existing LLP owners before promoting any to a new design document.
3. Keep the root LLP edit and vendored Ibex worktree state outside this demo
   landing because they predate and are unrelated to the remediation tranche.

These are review suggestions, not applied changes and not blockers for the
Stage 2 evidence landing.
