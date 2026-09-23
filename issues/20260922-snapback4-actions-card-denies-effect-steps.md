# Snapback 4: the actions card says effects have no `ctx.step`, contradicting the effects card and the runtime

**Status:** Open
**Date:** 2026-09-22
**Scope:** Snapback 4 guide text (`guide actions`); documentation only
**Source:** [Astra max review of LLP 3000.012](../llp/reviews/3000.012-application-still-owns-derived-data.astra.md), "existing guide defect"; confirmed by reading the sources below

The actions card says (`snapback4/crates/snapback4-lang/src/guide/actions.rs:55–58`):

> The engine keeps one typed transition policy for durable external steps, but
> this release wires only actions to it through the existing `_action_steps`
> records. Effects do not gain `ctx.step` or action authority from that internal
> extraction (guide effects).

Two sources contradict it:

- **The effects card**
  (`snapback4/crates/snapback4-lang/src/guide/effects.rs:71–76`) says effects
  use the shared external-step transition policy through their own
  `_effect_steps` records, and that a generated effect handler's context
  carries `ctx.step`.
- **The server runtime** (`snapback4/packages/snapback4/src/server.ts`) gives
  both generated contexts `readonly step: StepRunner`, and Bwork2 and Bwork3b
  moved effects onto the shared step kernel (LLP 3000.009 §10.2).

The sentence about action authority may still be accurate: effects do not gain
action authority. The `ctx.step` clause is stale.

## Fix

Rewrite the actions card's sentence to agree with the effects card:

- effects have their own `_effect_steps` records and `ctx.step`;
- they gain no action authority.

The guide suite compiles every card, so run it after the edit. If LLP
3000.009.000's card edits land first, make this fix as part of them.
