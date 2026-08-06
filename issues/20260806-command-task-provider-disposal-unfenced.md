# Provider disposal does not fence in-flight command tasks, and a closed-provider mutation reports false ambiguity

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Systems:** React/Expo, Assets, Client
**Date:** 2026-08-06
**Related:** LLP 0180 §Mutation ambiguity / §Cancellation, LLP 0114 (named
projection lifecycle discipline), `issues/20260806-g3-command-lane-plan.md`

## Summary

Two adjacent gaps found while reviewing the landed LLP 0180 command engine
(`packages/snapback-client/commands.mjs`, `packages/snapback-react/index.mjs`).

**1. No disposal fence.** `commandClientFor(provider)`
(`packages/snapback-react/index.mjs:3406`) is a bare `WeakMap` entry. It holds
no set of active tasks, registers no auth-barrier participant, and exposes no
`dispose`. Compare `assetRegistryFor(provider)` immediately below it
(`:3421`), which registers `snapback-react-assets:${providerInstanceId}` and
returns a `dispose`. Consequences when a provider is closed or unmounted while
a command task is `preparing`/`transferring`:

- nothing settles the task; its `done` promise stays pending until the asset
  child happens to settle on its own. The asset barrier's `blank()` blanks
  upload *stores*, not the in-flight asset task the command adopted, so there
  is no path that guarantees settlement.
- the caller has no way to observe the leak: there is no command-registry
  inspection counterpart to `provider.inspection()`, so a leaked task is
  invisible to the same tests that pin every other resource returning to zero.

**2. False ambiguity on a provably un-dispatched mutation.**
`commandClientFor`'s `invokeMutation` delegates to
`provider.registry.runCommandMutation(...)`, which throws
`SNAPBACK_REACT_PROVIDER_CLOSED` synchronously when the provider is terminal
(`packages/snapback-react/index.mjs:1170`). The command engine sets
`#mutationInvoked = true` *before* the call
(`packages/snapback-client/commands.mjs:351`), and its `provedRefusal`
predicate (`:375-382`) does not recognize that code, so the task settles
`ambiguous` with `SNAPBACK_COMMAND_MUTATION_AMBIGUOUS` — "command mutation
began but no settlement proof was received" — and residue
`unattached: 'unknown'`, for a mutation that provably never left the client.

LLP 0180 §Mutation ambiguity scopes ambiguity to "once mutation invocation
begins"; a local pre-dispatch refusal has not begun. Reporting it as ambiguous
is over-claiming uncertainty in exactly the direction the residue contract
exists to avoid: a caller cannot distinguish "we never sent it" from "we sent
it and lost the answer", and the finalized asset is described as possibly
attached when it certainly is not.

## Fix

For (2), the engine already has the right seam: it treats
`error.effectCommitted === false` as proof of refusal. The minimal change is
for the React adapter to mark its pre-dispatch refusals accordingly (or for
`runCommandMutation`'s terminal-provider diagnostic to carry
`details.effectCommitted: false`), which turns the outcome into `failed` with
`unattached: 'inferred'`. Add a test for it — no such case exists today.

For (1), give `commandClientFor` the same shape `assetRegistryFor` has: a live
task set, a `dispose` that settles every active task with a *distinct*
diagnostic (provider closed, not authority replaced — LLP 0180 §Authority and
replacement makes those different facts), and an inspection counter so the
zero-resource assertions can see command tasks at all.

Not introduced by any single landing; both are properties of the engine as
first landed in `17e7ca8ca`. Filed rather than fixed here to keep the G3
reduce-and-reland scoped to porting coverage onto that engine rather than
changing its lifecycle design.
