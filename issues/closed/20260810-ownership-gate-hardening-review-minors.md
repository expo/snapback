# Ownership-gate hardening: minor review findings (fix-forward)

**Status:** Superseded 2026-08-19
**Date:** 2026-08-10
**Systems:** Proof/gates
**Source:** same-family review of the LLP 0225 §5 enforcement landing
(verdict: no material finding remains; these are the MINOR notes, deferred
by ruling at that landing). Useful input for the LLP 0198 session's
post-landing adversarial verification pass.

1. **Resolved 2026-08-10.** Added adversarial fixtures for `#[path]` module
   aliasing and `self::`/`super::` inside inline `mod { }` blocks. The tests
   assert the exact resolved edges; the `#[path]` probe also proves a
   forbidden direction produces a red with its fingerprint named while an
   allowed direction stays green.
2. Fingerprints embed owner names, so owner reassignment orphans frozen
   records. The attempted exact-endpoint `relocation` path was removed on
   2026-08-16 after Codex reproduced disposition laundering: an owner re-key
   could convert a deadline-bearing waiver into ordinary relocation and drop
   its deadline and inversion owner. This remains open under the shared
   fingerprint-change design bar in
   `issues/20260816-split-relocation-disposition-needs-sound-evidence.md`.
3. ~~The predecessor-snapshot comment overstated the unassigned-residue
   guarantee.~~ **Resolved 2026-08-15:** it now states that already-missing
   predecessor modules may be removed or explicitly parked, while modules new
   in the pushed tree remain outside the patched set and are blocked by the
   shrink-only comparison.
4. ~~`trackingTicketFor` required one ticket covering every fingerprint and
   accepted a loose observation-revision shape.~~ **Resolved 2026-08-15:**
   open tickets may jointly cover the outstanding set, and every covering
   ticket must carry an explicit backticked `Observed at`/`Re-observed at`
   revision. The tightened parser also accepts the explicit colon forms
   `Observed at: \`abc1234\`` and `Observation revision: \`abc1234\``. Tests
   cover two independent tickets, both colon forms, and rejection of an
   unbackticked hex-looking token.
5. ~~`findNewViolations().violations` was computed but never enforced.~~
   **Resolved 2026-08-15:** the dead computation was deleted. The set-based
   snapshot protocol remains the enforcement path because it understands
   baseline attribution, waivers, and inherited-ticket coverage; wiring the
   old baseline-only list would have duplicated that logic incorrectly.
6. Worklist item ordering in
   `issues/20260809-0199-ownership-ratchet-worklist.md` is now
   8, 9, 10, 12, 11, 13 in file order after the merge insertions. Numbering
   stays unique (which is what the gate consumes); renumber or reorder for
   readers when next touched.
7. ~~`formatExpiredWaiverEscalation` emitted "1 expired waivers".~~
   **Resolved 2026-08-15:** singular and plural summaries are both tested.
8. **Amendment-gated; intentionally unchanged.** An expired worklist-only waiver
   still suppresses outstanding-ness with only the advisory escalation in
   summaries — per the revision-(l) posture (expiry blocks only NEW
   admissions). If the fleet wants expiry to convert frozen edges back to
   outstanding after a grace window, that is an LLP 0225 amendment, not a
   gate patch.

## Verifier confirmations — 2026-08-10 (LLP 0198 session)

- **Resolved 2026-08-10.** The live-proven `#[path]`/inline-mod fixture gap
  now has checked-in regression fixtures and exact-edge assertions mirroring
  the A9-red/B9-green result recorded in the closed gaps ticket.
- **Resolved 2026-08-10.** The unassigned-growth refusal now appends the
  seven permitted owners read from the current manifest, and the existing
  shrink-only test asserts that complete runtime-derived list. This closes
  the diagnostic-completeness finding.
- Faked-clock (2026-08-12) CLI run passes with `2 expired waivers
  (escalate)`; expired-waiver advisory posture behaves as the
  pre-landing MATERIAL fix claims.

## Resolution

The remaining fingerprint, worklist-order, and expiry-posture notes applied
only to the retired module analyzer. LLP 0276 Phase 3 replaces that analyzer
with exact crate membership and dependency checks, so no analyzer hardening
work is carried forward.
