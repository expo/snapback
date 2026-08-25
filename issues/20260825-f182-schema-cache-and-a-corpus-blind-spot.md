# F182 has a runtime route the row-attack corpus cannot see

- Status: open
- Created: 2026-08-25
- Area: agents-mode schema cache; row-attack corpus coverage
- Found by: the LLP 0311 blast-radius analysis

## The row

The row-attack corpus measures **F182 CLOSED** at current `main`, and that measurement is correct for
what it tests. The compile-time forgery route is genuinely gone: the API no longer accepts a
caller-selected `AgentsMode` and the partial primitives are private, so a dependent crate cannot
construct the mode it wants.

**There is a second route the corpus cannot reach.** A handle opened while the mode is `Open` retains
that value in `self.schema`. If another handle then activates `Disabled`, the first handle can still
derive the stale `Open` *inside a later transaction* — `register_agent_principal_with_class` reads the
mode from the cached schema rather than from the resource. A freshly opened post-activation handle is
safe; a long-lived pre-activation one is not.

This is the "a durable record consulted only at acquisition is a cache" shape, one level down. It is
**not** caused by `AuthorizationInterlockState` and is independent of the handle-versus-resource
interlock defect in `issues/20260825-a-second-database-handle-publishes-without-the-interlock.md`.
F182 needs a resource-derived, in-transaction mode read.

## The instrument limitation, which matters more than the row

The corpus is a **compile-fail** corpus. Every witness asserts that an attack expression fails to
compile, at its marked expression, with an expected diagnostic. That is a strong instrument for the
forgery half of this defect class — can a dependent *construct* the authority — and it is blind to the
half that needs two handles, an ordering, and a clock.

So the corpus's verdict should be read precisely:

> **CLOSED** means "no dependent crate can construct this authority."
> It does **not** mean "no schedule of legitimate calls can reach this effect."

Twelve of the thirteen rows measured or claimed closed do not depend on that distinction — LLP 0311
checked each one and found they reject a mismatched carrier, issuer graph or `DatabaseBinding` at the
*consuming* operation, which is a runtime check. F182 is the one where the distinction bites.

## What to do

1. **Close F182 properly**: derive the agents mode from the resource inside the transaction that acts
   on it, not from `self.schema` captured at open.
2. **Add a runtime dimension to the corpus**, or mark rows that need one. A row whose defect requires
   an ordering between two handles cannot be certified by a compile-fail witness alone. Until then,
   report F182 as *compile-closed, runtime-open* rather than closed.
3. When counting measured rows, treat F182 as **not** firmly measured. The honest count at the time of
   filing is **12 firmly measured plus F182 disputed**, not 13.

## Why this is filed rather than fixed

The fix is a real change to how agents mode is read on a hot path, and it deserves its own lane and
review rather than being folded into the interlock work that surfaced it.

Related: `llp/0311-authorization-interlock-resource-binding.rfc.md`,
`issues/20260825-a-second-database-handle-publishes-without-the-interlock.md`,
LLP 0303 revision (s).
