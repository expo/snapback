# Gate hardening is a Landing E precondition, not a Landing A blocker

**Status:** Open
**Systems:** Security, Kernel
**Date:** 2026-08-27
**Related:** LLP 0313 §8, LLP 0315 §4, LLP 0283 F-1,
`issues/shelved/20260826-security-gate-is-an-instance-of-the-defect.md`,
`issues/shelved/20260826-regression-tests-must-fail-when-reverted.md`

## The observation

The `landingA5` lane carries ten commits: four that are Landing A's actual
deliverable (private connection-owned authority transition, hostile-schema probe
confinement, file-backed activation refusal, writer-policy ownership) and six
`gates(security):` commits produced by adversarial review rounds 4 through 14.

Those six exist because each review round asked whether the workspace security
gate could be forged, found that it could, and blocked the landing until it was
fixed. Sixteen rounds have now run on that question.

**But Landing A does not claim a security property.** LLP 0313 §8 states its
claim exactly: *"Green workspace; infrastructure only."* The first-landable-commit
paragraph is explicit that it "exposes no public authority ceremony" and "makes
no F-1 closure claim." The 2026-08-26 custody finding reaffirms it: Landing A is
acceptable as private, dormant, handle-local infrastructure, and "must never be
read as evidence that same-file second handles or raw processes are refused."

An unforgeable gate is a precondition for the landing that *does* make the
claim — Landing E, where "only here may F-1 close and publication unblock."
Rounds 4–16 have been holding Landing A to Landing E's bar.

## Why this was not obvious

The rounds were not wrong to find what they found; every in-scope defect they
closed was real, and several were serious (a caller-authored Cargo cache
supplying the test executable; `path.resolve` discarding the prefix on an
absolute toolchain channel; two witnesses that passed with or without their
claimed protection). The error was in what the findings gated, not in the
findings.

It compounded because the gate is itself an instance of the defect it detects,
and because — as the root-identity survey established — the regress has no local
terminator. So the loop had no natural stopping point of its own. LLP 0315 §4
supplies the scoping rule; this ticket supplies the sequencing.

## Disposition

1. The ten commits land together. A clean split is not mechanically available:
   the gate commits also modify `crates/snapback-kernel/src/storage/authority_transition/core/`
   and `write_authority.rs`, overlapping the core commits in eight files.
2. The landing claims Landing A's narrow claim as written in LLP 0313 §8 —
   green workspace, infrastructure only, no F-1 closure claim, no same-UID
   resistance claim. It does not claim the gate is unforgeable.
3. Landing B unblocks as soon as A lands. B has been complete and waiting.
4. Remaining gate hardening continues as **Landing E precondition work**, scoped
   by LLP 0315 §4, and does not block Landings A through D.
5. The false-witness rule is unaffected and still blocks at every landing: a
   regression test for a security property must be shown to fail when that
   property is removed.

## Closing condition

Close when Landing A has landed under its narrow claim and the remaining gate
work is tracked against Landing E.
