# I over-escalated five P3 rows to P1-SHIP

Status: open
Date: 2026-08-25
Systems: snapback-engine, snapback-sync, snapback-kernel
Related: issues/20260825-twelve-of-seventeen-p3-rows-need-execution.md,
  issues/20260824-p1-ship-rows-enumerated.md,
  llp/0303-subject-authority-correlation-policy.decision.md

## What I did

A lane executed falsification attempts against six P3-LOW rows. All six failed. It promoted five to
**P1-SHIP** and one (F089) to P2-POLICY. **I accepted all six reclassifications without applying the
programme's own P1 definition**, and reported "every P1-SHIP row is now staffed or landed" on that
basis.

## What was wrong

An independent review applied the definition from `issues/20260824-p1-ship-rows-enumerated.md` —
*obvious predicate, existing helper, **no legitimate cross-principal use**, production planner that
takes another user's id* — and none of the five meets it.

| Row | Cross-principal durable effect? | Intended behaviour? | Correct bucket |
|---|---|---|---|
| F091 | **No** — own user, cloned own database | Yes — a reusable session | P3, or retarget `Clone` of `PreparedBearerAuthority` as its own row |
| F288 re-point | **No** | Yes — resume re-points by design | drop from the ship list |
| F286 discharge | **No** — B ACKs B | Yes — the token binds the generation | drop "foreign discharge" |
| F286/F288 `last_seen` | In-memory liveness only | Keepalive; the id is not derived from the act | **P2** (Q01/Q33), like F283 |
| C004 | New misattributed row, but via `test-support` | No | **P2**, with F089/Q17 |
| C009 generation | Own retry episode | Echoes the reserved descriptor; production already derives it | **P2** (Q33) |

The tell was available and I missed it: **F089 is the control.** The same lane, in the same report,
declined to promote F089 to P1 despite a RED with a durable write, because it went through
`test-support`. The distinction existed in the evidence I was reading; I applied it to one row and
not the other five.

## Why this mattered

Not because the rows are fine — they are not, and several still want DERIVE under LLP 0303 Q17/Q33.
Because a false ship-blocker **starves the real ones**. The review put it exactly right:

> I would not close F286's wire `connection_id` or C004's test-support rebuild as "fine forever". I
> would take them off the P1-SHIP queue so they stop starving actual owner-parameter holes.

P1-SHIP is a scheduling signal. Inflating it degrades the signal for the seven rows that genuinely
carry a production planner taking another user's id.

## Corrected state

- **P1-SHIP returns to 7**, the originally enumerated set. My claim that "12 of 12 P1-SHIP rows are
  staffed" counted five rows that are not P1. The genuinely-P1 work in flight — F053, F183, F185 —
  is unaffected; those were in the original seven.
- **The five move to P2-POLICY**, not off the list. Actionable stays **123**; this is a severity
  correction, not a count correction.
- The executed exploits and characterization tests landed in `564267ea1` remain valid and valuable.
  What was wrong was the severity I attached to them, not the evidence.

## The general lesson

The falsification result answered *"is the stated structural bound true?"* — it was not. I read that
as answering *"is this a ship-blocking defect?"*, which is a different question with a different
test: **does the effect cross a principal boundary?**

The adversarial analysis that designed those attempts had warned about exactly this, in a sentence I
quoted approvingly and then failed to apply:

> RED does not necessarily mean the behavior is an unacceptable security policy — for example,
> charging a failed password attempt may be intended.

Every count in this inventory has now been checked by someone other than its author. This is the
first *judgement* to get the same treatment, and it did not survive either.
