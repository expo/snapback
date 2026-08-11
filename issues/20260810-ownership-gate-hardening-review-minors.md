# Ownership-gate hardening: minor review findings (fix-forward)

**Status:** Open
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
2. Fingerprints embed owner names, so reassigning a module's owner rotates
   every touching fingerprint and orphans frozen records; a still-forbidden
   edge under new owners can only re-enter via a fresh deadline-bearing
   waiver. Fail-closed, but undocumented refactor friction — document the
   expected reassignment procedure in LLP 0225 §5 or teach `relocation`
   about owner re-keys.
3. `scripts/check-module-ownership.mjs` ~:776-778: the comment overstates
   the unassigned-residue guarantee — a module landed unmanifested through a
   bypass/red can be legally parked in `unassigned` by the next push (the
   patched predecessor set contains it). Requires a prior loud red, so
   acceptable; fix the comment.
4. `trackingTicketFor` demands one single open ticket naming every
   outstanding fingerprint — two independent red waves with separate tickets
   will red until someone aggregates them; and the observation-revision
   regex accepts any hex-looking word. Consider multi-ticket coverage and a
   revision-existence check.
5. `findNewViolations().violations` is computed but never enforced in
   `main()` — dead code that invites confusion; remove or wire it.
6. Worklist item ordering in
   `issues/20260809-0199-ownership-ratchet-worklist.md` is now
   8, 9, 10, 12, 11, 13 in file order after the merge insertions. Numbering
   stays unique (which is what the gate consumes); renumber or reorder for
   readers when next touched.
7. `formatExpiredWaiverEscalation` grammar nit: "1 expired waivers".
8. Documented-design note for the verifier: an expired worklist-only waiver
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
