# Create-only mutation target becomes create/update if expiry is set after insert

**Status:** Closed
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback 2 mutation targeting / `mutationTarget`, expiry columns, generated client types
**Related:** Clique M5 on `snapback2@0.0.24` and `0.0.25`

## Symptom

Both Astra Clique builders needed disappearing messages with a server deadline. The natural code is insert the message, then update `expiresAt`. That made the generated create binding a create/update union (`mutationTarget` no longer pure-create). Computing the deadline before insert restored a create-only target.

The rule may be correct. The first diagnosis is expensive: it shows up after authoring, as a type/certify failure, with no guide example for “deadline belongs on the insert.”

## Evidence

- 0.0.25 run-log `/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/run-log.md` epoch `1789167250`: “expiry set on insert instead of post-insert update preserves create-only mutationTarget typing.”
- 0.0.24 diary M6: “The pure-create mutation target requirement was useful but surprising: inserting then updating an expiry field made the create binding a create/update union.”

## Requested outcome and acceptance

- If the union is required, the first refusal must say so in one sentence (“this insert is no longer create-only because a later update of `expiresAt` shares the binding; set the deadline on insert”) and the expiry / messages guide must show the insert-with-deadline form.
- If a post-insert expiry update can stay create-only for the insert binding, make that compile.
- Close when a tiny schema (messages + optional `expiresAt` + schedule) plus the two authoring orders is a test or a guide snippet a cold builder would hit before Clique M5.

## Resolution — 2026-09-11

A straight-line update addressed by the exact row returned from an earlier
unconditional insert now refines that row's create target. The Rust certificate
and generated `Op` target type both stay create-only; the update remains a
separate certified write site with unchanged authorization and ceilings.
Conditional, repeated, computed, differently addressed, and independent updates
keep their existing update or unresolved target semantics.

The focused cold-builder fixture declares `messages`, optional `expiresAt`, and
`schedule expireMessage`, then compiles both deadline-before-insert and
insert-then-expiry-update mutations. Both produce the exact target
`{ table: "messages", kind: "create", source: { newId: 0 } }`, and a real
generated-client journey accepts each `mutationTarget` as a create binding.

Evidence: the focused compiler/generated-client check passed; the eight core
mutation-target tests passed; compiler TypeScript checking and
`ref-check --verbose` passed. `caps` reports only the two known inherited Snapback 1
source-size reds and no Snapback 2 or guide regression.
