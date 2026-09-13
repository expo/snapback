# The critical path is the shared surface, not the rows

Status: open
Date: 2026-08-25
Systems: snapback-auth, snapback-engine, snapback-kernel, snapback-services, snapback-sync
Related: issues/shelved/20260824-test-support-tiering.md,
  issues/shelved/20260824-test-support-bypass-surface-inventory.md,
  llp/0303-subject-authority-correlation-policy.decision.md

## The observation

Nine of 94 actionable rows have landed in roughly 72 hours. That rate is not the problem by
itself. The problem is *why* the rate is what it is.

Five lanes — Q04, Q05, Q10, Q12 and Q14 — each reached a reviewer with a correct fix to the
defect they were assigned, and each was then defeated. Not by a flaw in the fix. By a **route
around it** through a public `*_for_test` constructor reachable from a dependent crate with no
features enabled. Q04 and Q05 were defeated twice each, which is why both were converted from
open-ended fixes into bounded route enumerations.

So the per-row work is largely succeeding, and the per-row *verdicts* are largely failing, for a
reason that is not in any of those rows.

## Why per-lane fixes cannot converge

Each lane closes the routes it can see. The surface is shared, so the routes it does not own stay
open, and the next reviewer walks through one. This produces exactly the pattern observed: a lane
lands a real improvement, gets blocked on a relocated capability, fixes that, and gets blocked on
another. The lane is not going in circles — but the *programme* is, because the same 172-item
surface is being partially re-closed from five directions at once.

`issues/shelved/20260824-test-support-tiering.md` §5 reached the same conclusion from the other end, on
evidence rather than on frustration: both an independent line-level analysis and a pre-registered
estimate "point away from an item-by-item sweep and toward a test architecture change."

## What the tiering analysis settles

Of the 172 class-C items:

- **0** have any documented embedder use. The pre-registered estimate allowed up to 79; the
  line-level analysis resolved that bound to zero. None of this surface is load-bearing API.
- **9 (T1)** are called only inside their defining crate — mechanical demotion.
- **15 (T4)** have no call sites at all — deletion, subject to re-verification, since absence is a
  source-tree conclusion and the analysis flags every one `T4-UNCERTAIN`.
- **148 (T2)** are cross-crate test use — they need the test architecture change, into the existing
  unpublished `snapback-harness` crate, under the four scenario families and the explicit
  must-not-expose list in §5.

## The correction to the milestone set

The milestones were written row-centrically: 7 P1 rows, then 18 P2 rows, then the remaining 50.
That framing implies the rows are the work and the surface is a side quest. The evidence says the
opposite: the rows are cheap and the surface is what makes them un-landable.

M10 was already on the board and already annotated "fixing these per-lane cannot work — the surface
is shared." It sat at 5% and unstaffed while five lanes ground against it. That is the actual
wheel-spinning, and it was visible on our own dashboard.

**M10 is promoted to the critical path.** The row milestones stay, but their estimates are now
understood as gated: they cannot converge faster than the surface closes.

## Sequencing, chosen for contention rather than size

Five row lanes are concurrently editing `snapback-kernel`, `-sync` and `-engine`. A 148-item
migration through those same files would collide with all of them. So the migration starts where it
does not:

1. **T1 + T4 (24 items)** — kernel and engine, but almost entirely deletions and same-crate
   demotions, so the diffs are small and mostly subtractive.
2. **`snapback-auth` (14) + `snapback-services` (2) T2** — proves the harness seam on a small
   population. Neither crate is touched by a running row lane.
3. **The remaining 132**, once the row lanes land.

Step 2 is deliberately small. The seam is the risk, not the volume.

## The failure mode to guard against

A harness that re-exports the same capability under a new name achieves nothing — it relocates the
defect, which is precisely how the five lanes above were defeated. §5's must-not-expose list is the
guard, and it is to be honoured literally: no live handles, no caller-authored authority, no raw
commit attempts, no generic "set trusted state" against a live production owner. An item that
cannot move without widening the harness wants a production ceremony or an inward move instead, and
naming it as blocked is a better outcome than migrating it dishonestly.
