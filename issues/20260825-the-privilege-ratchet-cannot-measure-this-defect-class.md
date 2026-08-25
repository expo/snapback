# The privilege ratchet cannot measure this defect class

Status: open
Date: 2026-08-25
Systems: scripts/security-gates-rust, snapback-kernel
Related: llp/0303-subject-authority-correlation-policy.decision.md,
  llp/0284-workspace-security-gate-threat-model.spec.md,
  issues/20260825-what-the-107-ratchet-violations-actually-are.md,
  issues/20260825-none-of-the-nine-landed-rows-were-closed.md

## What happened

`node scripts/check-kernel-raw-sql-api.mjs` has been this programme's second axis of progress — an
objective 26-second number every lane could measure itself against. It read **107** for the whole
session, and `MembershipWriter` alone accounted for 61 of those, so the membership lane's landing was
expected to take it to **46 in one step**.

It does. Two independent reviewers measured it, one of them across 28 feature cells on both revisions:

```
origin/main c8b3140c2 : 107
reviewed    5aaf0f547 :  46
delta                 :  61
```

**And all 61 are scanner-signature disappearances.** The scanner's only authority discriminator is the
literal type name `MembershipWriter` (`scripts/security-gates-rust/src/main.rs:92`). The replacement
public surface takes `W: MembershipWriterAccess` and hands out a publicly obtainable
`AdmittedMembershipWriter`, neither of which the scanner follows. Exactly 61 `caller-discriminant`
findings vanished; the other 46 categories were untouched. As one reviewer put it, the capability was
**relocated below the signature scanner, not removed** — and the repository's own integration test
constructs the composition and commits a membership row, which the reviewer ran independently.

## The general statement

> The ratchet counts **declared public paths named by type**. A capability reached through a
> composition, a generic bound, or a renamed carrier declares nothing the scanner recognises. A falling
> count is therefore consistent with no capability being closed at all.

This is the measurement-side twin of LLP 0303 revision (q): enumerating the effect's *producers* rather
than the entry point's callers. A signature scanner can only ever see entry points.

Three consequences, all of which this programme has already hit:

- **A flat ratchet is not evidence of safety.** It read 107 on both trees while two live no-feature
  compositions existed against rows that had been reported closed.
- **A falling ratchet is not evidence of progress.** 61 eliminations, zero capabilities closed.
- **A rising ratchet remains meaningful.** New declared surface is still real surface. The gate keeps
  its value as a one-directional guard; it has none as a progress metric.

## What to do with it

- Keep the gate. Stop quoting the number as programme progress. Any capability claim needs an executed
  refusal at current `origin/main`, per
  `issues/20260825-none-of-the-nine-landed-rows-were-closed.md`.
- If the gate is to detect this class at all, it needs to follow **generic bounds and trait-implementing
  types**, not a literal name — `MembershipWriterAccess` and `AdmittedMembershipWriter` are the worked
  example. That is a real change to `scripts/security-gates-rust`, not a config tweak, and LLP 0284
  already discloses the absent cross-crate symbol graph as a known deviation.
- Until then, treat every ratchet delta in a landing report as **unattributed** unless the lane also
  shows an executed refusal for the capability it claims to have removed.

## Provenance

Independently found by two reviewers who did not see each other's work: one derived it from the
scanner's predicates and declined to claim a measurement it had not run; the other measured both
revisions across 28 cells and ran the repository's own integration test to confirm the capability
survives. Both reviews were of the same commit, and both returned DO NOT LAND.
