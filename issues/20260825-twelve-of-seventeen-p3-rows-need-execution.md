# Twelve of the seventeen P3 rows do not survive an adversarial read

Status: open
Date: 2026-08-25
Systems: snapback-auth, snapback-engine, snapback-kernel, snapback-sync, snapback-types
Related: issues/20260824-liveness-row-bucket-assignment.md,
  llp/0303-subject-authority-correlation-policy.decision.md,
  issues/20260825-the-critical-path-is-the-shared-surface-not-the-rows

## What was proposed

`issues/20260824-liveness-row-bucket-assignment.md` classifies 17 rows as **P3-LOW** — structurally
bounded in current production code, admitting no durable effect, and therefore closeable "with
documented reasoning and no code."

The bounds were written carefully. Their author stated explicitly: "I did not infer 'impossible'
merely from being unable to find an abusive caller." That is the right discipline and the arguments
read as sound.

## Why they were not accepted

Earlier in this programme a row was cleared by exactly this kind of reasoning — private fields plus
a monotonicity check, therefore a replayed clone must be rejected. A reviewer then executed it:
cloned the verified value, installed both copies into two different databases, and both succeeded,
both writing identical rows. The reasoning was clean and the conclusion was false.

The rule recorded then: **a cleared verdict requires execution. Reasoning may raise a concern; it
may never retire one.** Seventeen rows closing on reasoning alone is exactly the shape that rule
exists to stop.

## The result

An independent adversarial analysis restated each bound as a falsifiable claim, named the assumption
it rests on, and designed the composition that would break it:

| Ranking | Rows |
|---|---|
| **RED** — attempt likely to falsify | F043, F044, F054, F055, F063, F089, F091, F285, F286, F288, C004, C009 (**12**) |
| AMBER | none |
| GREEN — bound looks genuinely strong | F006, F096, F242, F243, F287 (**5**) |

**Twelve of seventeen are RED.** Had the P3 bucket been closed on its reasoning, twelve rows would
have been retired while still defeasible.

The analysis is also stricter than the bucket document in a specific way: F089, F091 and C004 were
argued closed there, and it says all three should face execution instead. F089's own bound concedes
the weakest form — "no production authority consumer of this method was found" — which is a search
result, not a structural bound.

## The distinction that must not be lost

**RED does not mean defect.** The analysis says so itself: charging a failed password attempt may be
entirely intended behaviour. RED means the *stated structural claim* is likely falsifiable, which is
a claim about the argument, not about whether the system is wrong.

And **GREEN does not mean closed.** The analysis declines to clear even its own five: "I would not
clear even these five until their negative attempts execute." F006 must be attempted with two
provider handles against the same SQLite resource; F287 with cloned stages and a second
`LocalSnapback`.

## Execution, in priority order

An executing lane is running the top six. The plan's own ranking, most promising first:

1. **F091** — clone one verified carrier, install into databases A and B. The analysis calls this an
   exact recurrence of the earlier failure shape.
2. **C004** — forged projection subject through public `test-support`, then a durable app mutation.
3. **F089** — public registry output fed straight into `seed_invalidation_retry_episodes_for_test`;
   the simplest durable proof available.
4. **C009** — forged connection generation plus a genuine fence, persisted through manual retry.
5. **F286** — victim input connection with a foreign ACK descriptor/token; the effect is claimed to
   occur before rejection.
6. **F288** — victim input, owned subscription, independently forged descriptor generation.

Then F285, F043, F054, F044, F055, F063, and the five GREEN rows.

Each attempt requires a watched fail-first — shown reaching its assertion rather than dying in
fixture setup. A test that fails during setup proves nothing, and that has fooled this programme
before.

## Provenance

Produced read-only against `e6565f5d97ef3fb3582ec60105a989404d8500f3`. The sandbox correctly refused
the analysis's `git fetch` (it would have written `.git/FETCH_HEAD`) and a `ls-remote` fallback had
no network, so the analysis states it cannot certify that commit was the remote tip and scopes its
findings accordingly. Line numbers may have moved since; targets are to be located by symbol.
