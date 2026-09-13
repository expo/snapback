# Milestone reconsideration: rows are the application, classes are the asset

**Status:** Open — for author review
**Systems:** Process
**Date:** 2026-08-25
**Related:** LLP 0303, LLP 0283, `issues/shelved/20260824-landings-must-name-the-rows-they-close.md`,
  `issues/shelved/20260824-lane-staleness-is-a-second-gate.md`

## What the milestones currently say

The programme is tracked as "N of 96 rows landed". After roughly 60 hours: **2 lanes landed,
approximately 11 rows.** At that rate the remaining 85 rows are not reachable on any near horizon,
and reporting only that number makes the work look like it is barely moving.

That framing is measuring the *application* of what has been learned, and ignoring the learning.

## What has actually been produced

**Nine named defect classes**, accumulated across ten revisions of LLP 0303 (a → j):

1. Coverage — a binding on one path is not a binding on its siblings
2. VERIFY chosen where DERIVE was available, and why coverage kept leaking
3. Derivation is a lifetime property, not a constructor event
4. A derivation is only as strong as its root
5. The wrapper is not the binding — combinators and recycling
6. Removing a constructor is not removing the capability
7. Re-runnable producers and generic seams
8. **Move semantics protect the handle, not the fact**
9. A test can demonstrate the exploit and call it correct

Every one was found by an executed exploit, and **every one applies to all 96 rows**, not to the
lane that surfaced it. They are the durable output; the rows are where they get spent.

The evidence that this compounds is in the round counts. The OAuth lane, briefed when none of these
existed, took **10 fix rounds**. The deny lane, briefed with three of them, took **4**. Lanes briefed
with more are failing on progressively more exotic routes rather than on the basics.

## The problem with the current metric

Beyond being pessimistic, "rows landed" has three defects already recorded elsewhere:

- It was **not computable** until this session added a `Closes-rows:` trailer; the OAuth attribution
  had to be reconstructed forensically.
- Three published counts have been corrected — 137 that was 134, 47 that was 34, and an in-session
  figure whose basis was unclear.
- It does not move when a lane closes rows that the privilege-surface scanner cannot see, which is
  what both landed lanes did. The ratchet has sat at **105** through both landings, and will drop
  sharply when the lanes that *are* scanner-visible land (one measured 44 in its branch, another 100).

## Proposed milestone set

Four axes rather than one, because they answer different questions:

| Axis | Measures | Now | Why it matters |
|---|---|---|---|
| **Defect classes identified** | Rules in LLP 0303, each found by execution | 9 | The durable asset; applies to every remaining row |
| **Rows landed** | Surfaces closed on `main` | ~11 / 96 | The application; now computable via `Closes-rows:` |
| **Privilege-surface ratchet** | `check-kernel-raw-sql-api.mjs` | 105 | Objective, machine-checked, 26 seconds |
| **Structural fixes in flight** | Durable replay, route enumerations | 4 lanes | Each generalises beyond its lane |

## The honest forecast

**All 96 rows is not a near-term outcome.** At 4–10 rounds per lane, with `main` advancing ~50
commits per round and a serialized landing queue on shared test files, the remaining 85 rows are
tens of lanes and hundreds of rounds away.

What *is* reachable, and what the next decision should be about:

- The **nine classes** are close to exhaustive for this defect family. New rounds are now finding
  narrower variants rather than new kinds.
- The **ratchet** can plausibly go from 105 to under 50 once the two scanner-visible lanes land.
- The **durable-replay pattern**, once one lane proves it, applies to every remaining single-use
  claim in the inventory.

**Recommendation for the author:** treat class discovery and the ratchet as the headline measures,
keep rows as the ledger, and make an explicit scope decision about the 85 — whether they are all
required, or whether the P1 set plus the scanner-visible surface is the actual goal. That separate
all-85-rows question has been raised twice and remains open.

**2026-08-25 ruling note:** Scoped landing is ruled: Q05 and Q10 may land with their pre-existing
bypasses ticketed and named explicitly **NOT closed**; deny, Q12, Q43, Q14, and Q04 stay blocked.
The separate question above — whether all 85 rows are required — remains open. See
`issues/closed/20260824-are-lanes-being-held-past-the-ruling.md`.
