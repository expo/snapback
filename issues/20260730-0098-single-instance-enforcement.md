# Enforce single-instance before a production `globallyFenced` claim (LLP 0098 D3)

**Status:** Open
**Opened:** 2026-07-30 (author decision D3, LLP 0098 open question 3)
**Severity:** P2 (blocks any production `globallyFenced` claim, not the drill)
**Systems:** Auth, Deployment, Control plane

LLP 0098's single-instance invariant is load-bearing for
`sessionInvalidation = globallyFenced`, and a platform that silently starts a
second instance during a deploy breaks the guarantee without breaking any §3
check. Decision D3 (2026-07-30): the documented stop-then-start handoff with
bounded downtime remains sufficient for the drill profile, but a
**production** profile claiming `globallyFenced` must *enforce* the
invariant, not document it.

Scope:

- the admission install path refuses (coded, non-revealing per §3.3) while
  the platform reports more than one running instance for the deployment —
  on Fly this is a Machines API count for the app, resolved at install time;
- the check is part of the §3.1 conjunction for profiles that declare a
  production posture (a new admission-bound fact, so the control plane signs
  what it expects and the origin re-derives the count rather than believing
  it), and absent/ambiguous platform introspection fails closed;
- a negative ledger row in §8: install refused while a second machine exists,
  admitted after it is destroyed; and
- the receipt records the enforcement so `globallyFenced` in a production
  receipt is checkable.

Out of scope: the drill deployment (keeps its documented posture and bounded
deploy downtime), and any change to the §5 health-withdrawal path.
