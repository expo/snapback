# LLP 0298: What counts as a durable write — the authorized-effect completion criterion

**Type:** Decision
**Status:** Accepted
**Systems:** Auth, Storage, Server, Proof/gates
**Author:** Claude (Opus 5), commissioned by Charlie Cheever (author ruling
2026-08-23, in session supervising LLP 0283 F-1)
**Date:** 2026-08-23
**Revised:** 2026-08-23 (a — initial ruling)
**Related:** LLP 0058, LLP 0059, LLP 0283,
`issues/20260823-remeasurement-after-detached-action-fence.md`,
`issues/20260823-implementation-sequencing.md`

## The question

The authorized-effect fence program pursues one property:

> Can an ordinary session or scoped-service caller get a durable SQLite write committed after
> their own authority has gone terminal?

Every measurement has answered **FALSE**, and every measurement has been ambiguous about what
"a durable write" means. Two readings were live:

- **Literal** — any row written to SQLite, including *auxiliary* writes: authorization-clock
  advancement, lazy sweeps of already-expired rows, journal and retention bookkeeping.
- **Effect-based** — only durable effects attributable to what the caller asked for.

The ambiguity is not academic. Nearly every guarded path also ticks a clock or triggers a sweep
merely by being *reached*. The pairing-presentation path carries exactly this: a separate
authorization-clock prewrite, flagged in review as "a literal auxiliary-write exposure."

## The ruling

**Effect-based, with a closed and gated boundary.**

The property concerns durable effects **attributable to the caller's request**. Auxiliary writes
are out of scope — but only those meeting *all four* of the following:

1. **Grants no capability and changes no authorization decision.**
2. **Idempotent or monotonic** — a clock tick, or sweeping rows already expired.
3. **Would happen anyway** on the next request from any other caller.
4. **Consequence of the request being processed**, not of what the caller asked for.

**The set of auxiliary write sites is enumerated and gated.** Adding one is a visible, reviewable
change, not a classification made in passing during a review.

## Why not the literal reading

Under it the property is very likely unreachable: we would be fencing bookkeeping that grants
nobody anything, and a retired session causing a clock to advance confers no authority. Worse, a
measurement that permanently answers FALSE stops carrying information — it cannot distinguish
"no progress" from "progress that does not touch bookkeeping," which is precisely the distinction
this program needs, having already recorded one landing sequence with **zero** property movement
and another that closed the top violating path.

## Why the boundary must be closed rather than judged

The obvious failure of the effect-based reading is that "auxiliary" becomes an escape hatch, and
this program already has the cautionary case. The OAuth pairing sweep looks like harmless
bookkeeping. In fact one expired proposal fails pairing-code mint, pairing-code presentation, and
the grant-request inbox **for every user and agent on the database**, and any OAuth child can block
agent-authority termination, application reset, and Sessions-to-dev teardown.

That sweep fails criteria (1) and (2): it changes what other callers can do, and it is not
monotonic. **It stays in scope.** A boundary that would have excluded it is the wrong boundary,
and this is the test any future extension must pass.

## Consequences

- The property is now **reachable**, and "still FALSE" regains its information value.
- Claims must continue to distinguish **route-closed** from **structurally impossible**; this
  ruling narrows *what must be closed*, not *how strongly*.
- The next measurement runs under this reading, and the subset table records which exposures are
  excluded as auxiliary and under which criteria.
- Existing recorded exposures are **not** silently reclassified. Any that would now be excluded
  must be enumerated explicitly, with the criteria cited.

## What this does not do

It does not weaken any landed fence, and it does not make an unfenced application effect
acceptable. It draws the line at bookkeeping that no caller could exploit and that occurs whether
or not the terminal caller made a request. Where that is uncertain for a specific site, the site
stays **in scope** until an enumeration entry justifies otherwise.
