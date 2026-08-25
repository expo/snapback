# The strict family is not batchable: 45 roots for 58 rows

Status: open
Date: 2026-08-25
Systems: snapback-auth, snapback-engine, snapback-kernel, snapback-sync, snapback-types
Related: issues/20260825-p2-rows-are-nine-decisions-not-sixty-eight.md,
  issues/20260825-the-critical-path-is-the-shared-surface-not-the-rows,
  llp/0303-subject-authority-correlation-policy.decision.md

## The assumption that was being repeated

After the P2 analysis collapsed 68 rows into nine decisions, this programme — including its
supervisor, repeatedly — began saying that the 58-row strict derive-not-supply family would become
*largely mechanical* once the authority root was closed. The plan implied by that: close three or
four roots, then batch the rest.

The P2 analysis had actually warned otherwise, in one sentence that was read past:

> The 58-row family is not safely executable as one global replacement because its authoritative
> roots differ.

That was dispatched as an explicit question rather than left as an assumption, with the instruction
that *"many roots, not batchable"* was the more useful answer if true.

## The answer

**45 authoritative root contracts for 58 rows.**

| Root size | Roots | Rows |
|---|---:|---:|
| four-row | 2 | 8 |
| three-row | 2 | 6 |
| two-row | 3 | 6 |
| **singleton** | **38** | **38** |
| **Total** | **45** | **58** |

And the leverage is worse than the distribution suggests: **none of the four-, three-, or two-row
roots is currently sound.** The four roots that *are* sound — `AdmittedProjectionSnapshot`, the
current manifest/invitation fact, `PreparedConnectionAct`, and `SecretReadOperator` — each unblock
exactly one leaf row.

So there is no root whose closure both (a) is achievable now and (b) unlocks more than one row.

## What this changes

**The strict family is predominantly irreducibly per-row work.** Thirty-eight of the 58 rows have a
root shared with nothing else. Closing `ResolvedSession` and `ResolvedAppAuthority` — which the
authority-root lane is doing, and which remains worth doing — unlocks its own rows and the
cross-engine provenance problem behind F190/F191, but it does not convert the family into a batch.

**The search for leverage is over, and it should stop.** Every inventory bucket has now been audited
and every structural shortcut tested:

- P2's policy blockers were mostly imaginary → real leverage, taken.
- The shared `test-support` surface was the true blocker for five lanes → real leverage, taken.
- `MembershipWriter` is 61 of 107 ratchet violations → real leverage, in flight.
- The strict family batching → **no leverage; it does not exist.**

Three of four hypotheses paid off. The fourth did not, and continuing to look for a fifth is the
wheel-spinning this programme should avoid rather than a route out of it.

**Throughput now matters more than cleverness.** If most of the remaining work is per-row, the
governing constraints become how many lanes can run concurrently, how fast reviews return, and how
much merge contention concurrent lanes create — not how to make the rows fewer. That is a different
kind of problem from the one this programme has been solving, and it should be staffed as one.

## The honest forecast consequence

Prior estimates assumed a batching multiplier that does not exist. Any remaining-time figure quoted
before this analysis was optimistic for that reason, and should be re-derived from a per-row cost
against 45 distinct roots rather than adjusted.

## Provenance

Read-only against `85d272010`, rechecked unchanged at the end. Rows were grouped by **provenance —
what the subject is actually derived from — not by type name**, which was an explicit requirement:
this programme has twice been misled by name similarity (F037 and F061 share a name and are
different defects; a landed fix bound an input view while an identically-typed reconstructed output
travelled to a second database).
