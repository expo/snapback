# A regression test that passes with the fix reverted is a false witness

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Systems:** Testing, Security
**Date:** 2026-08-26
**Related:** LLP 0283 F-1, LLP 0303,
`issues/shelved/20260826-security-gate-is-an-instance-of-the-defect.md`

## What happened

Round 3 of the authority-gate review found a compile-fail witness that aborted
with an unrelated error before reaching its `@attack` line — it proved nothing
while reporting PASS. That defect was fixed.

Round 10 added seven regression tests to lock in the gate's new protections.
Round 11 checked whether those tests actually detect the loss of what they
claim to cover. Two of the seven do not:

- **Taint mode.** Removing `-T` from all three Perl shebangs leaves every one of
  the seven tests passing. Supervisor-reproduced independently in the lane: with
  `#!/usr/bin/perl` in place of `#!/usr/bin/perl -T`, `node --test
  tests/security_gates_v1.mjs` still exits 0. With that reversion a direct launch
  forges green.
- **Fresh target.** Replacing the `mkdtemp` fresh target with a fixed path still
  passes "every security Cargo phase uses an unpredictable fresh-process target",
  as does pointing the mutation runner's real `targetDir` back at the checkout
  while leaving an exported decoy constant fresh.

The other five are effective — reverting the sourcing and literal-pin fixes
correctly fails their tests with concrete diffs.

## Why this matters beyond the gate

The defect is the same shape LLP 0303 governs: the test derives its verdict from
something other than the property it claims to establish. A witness that cannot
fail is indistinguishable from no witness, and it is worse than none because it
reports assurance.

This is the second time this program has produced one, which makes it a method
problem rather than an accident.

## Rule

**A regression test for a security property must be shown to fail when that
property is removed.** Adding the test is not the deliverable; demonstrating the
red is. State the reversion and the resulting failure alongside the passing run,
the same way an attack-before/attack-after pair is stated.

Prefer witnesses bound to the implementation rather than to a restatement of it:
assert on the observable effect (the process refuses, the path differs per run)
rather than on an exported constant or a value the test itself computes.

## Next step

Fix the two ineffective witnesses so each fails under reversion, and re-check the
remaining gate tests for the same class before F-1 closes.
