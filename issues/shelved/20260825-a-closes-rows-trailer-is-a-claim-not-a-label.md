# A `Closes-rows:` trailer is a claim, and three of four were false

Status: open
Date: 2026-08-25
Systems: snapback-kernel, snapback-sync, snapback-engine, snapback-server
Related: llp/0303-subject-authority-correlation-policy.decision.md,
  issues/shelved/20260824-landings-must-name-the-rows-they-close.md,
  issues/shelved/20260825-lane-completion-checklist.md,
  issues/shelved/20260825-production-equivalent-is-not-a-clearing-rule.md

## What happened

The `Closes-rows:` trailer was introduced so this programme's completion count would be a `git log`
query rather than archaeology, after four successive published counts had to be corrected.

A lane produced four commits, each carrying exactly one row's trailer — mechanically perfect. An
adversarial review of all four found that **only one of them closes its named row**:

| Commit | Trailer | Verdict |
|---|---|---|
| `fix(auth): derive projections from database receivers` | F094 | **false** — raw rebuild attack compiles under a unified `test-support` graph |
| `fix(auth): derive agent registration mode` | F182 | **false** — two public partial APIs compose into the whole registration effect |
| `fix(live): derive transport subscribe from connection act` | F283 | **false** — the deleted factory is reachable by passing `None` for the optional generation |
| `fix(admin): derive secret-read registry from operator` | F297 | **accurate** |

## Why this matters more than a failed review round

Every other failure mode in this programme is *self-announcing*: a lane is rejected, the row stays
open, the count is unchanged. This one is silent. A false trailer **increments the count**. Had these
four landed without review, the programme would have reported four rows closed, three of which are
open, and no later process would have caught it — the trailer is exactly what a later process would
consult.

Five earlier counts in this programme were over-counts corrected downward. This is the mechanism by
which the *next* over-count would have happened, and it would have been invisible rather than merely
wrong.

## The rule

> A `Closes-rows:` trailer is a claim of the same weight as the fix itself. It may be written only
> after the row's attack has been executed and watched to refuse, and it counts toward the programme
> total only once a review has verified it.

Concretely:

- Lanes write no trailer for a row whose refusal they have not executed. **A row with a witness and
  no trailer is worth more than a trailer with no witness.**
- The completion count includes review-verified trailers only. Unreviewed trailers are pending, not
  closed.
- Reviews must check the trailer explicitly, per row, and say which rows the commit actually closes.
  The review that caught this did so because it was asked to evaluate four named rows; a review asked
  only "is this change correct?" would have passed three false trailers.

## A second-order consequence worth keeping

Because each row sat in its own commit, the one accurate row was **harvestable**: F297 is being
extracted onto a clean base and landed on its own rather than waiting for the other three. One row per
commit was adopted for traceability, and it turns out to also be what makes partial success
recoverable. Keep it.
