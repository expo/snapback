# "Production-equivalent" is not a clearing rule without a composition check

Status: open
Date: 2026-08-25
Systems: snapback-engine, snapback-kernel
Related: llp/0303-subject-authority-correlation-policy.decision.md,
  issues/shelved/20260825-lane-completion-checklist.md,
  issues/shelved/20260825-the-critical-path-is-the-shared-surface-not-the-rows.md

## What happened

The `test-support` surface lane triaged 167 items and cleared 166 of them, using the rule that a
helper is safe if it is **production-equivalent or opaque-input-preserving** — production can already
do this, so exposing it to a dependent grants nothing new.

An adversarial review defeated one of the cleared items and, in doing so, the rule:

> `test_support::asset_store_obj` publicly returns `Arc<dyn AssetStore>` under
> `snapback-engine/test-support`. A finalize preflight returns an **owned** ticket with no lifetime
> tied to `LocalSnapback`. So a dependent retains the live prepare ticket, shared-borrows the owner
> through the helper, and calls `wipe_all` on the ticket's backing store.

Neither half is a capability production lacks. Production prepares tickets, and production reaches
the asset store. What production cannot do is **hold the two at once**, because no production code
path ever gets both handles with overlapping lifetimes.

## The rule that failed, and the rule that replaces it

The failed rule evaluates each helper **in isolation**: does this one function hand out authority
production does not have?

The correct question is about **composition**: can a dependent hold a live handle obtained from
route A while reaching the same underlying resource through route B?

> A capability is not production-equivalent merely because production also has it. It is
> production-equivalent only if a dependent cannot compose it with something production cannot reach.

This is the same error as several others in this programme, in a new place. `#[doc(hidden)]` is not a
boundary; a guard on a handle is not a guard on a resource; and now: a per-item safety argument is
not a safety argument about the set. **Every one of these is a claim that holds for one thing and
fails for a pair of things.**

## Scope of the correction

Unknown, and that is the point — 166 items were cleared under the failed rule and the review checked
one composition. The re-audit is dispatched. The expected result is that *more* items fail, and the
number is the deliverable.

Two structural aggravators are worth naming because they will recur:

- **An owned handle with no lifetime tie to its owner** is what makes the composition constructible.
  Where a preflight or preparation returns an owned value, ask what else the caller may hold
  simultaneously. A borrow would have made this uncompilable.
- **`Arc<dyn Trait>` erases the authority.** `AssetStore` exposes writes, deletes, copies and
  `wipe_all`; handing out the trait object hands out all of them. A narrower object, or a handle that
  cannot coexist with a live ticket, closes the composition without removing the test capability.

## Why this ticket exists separately from the lane

The lane will fix its item. The rule was used to clear items in a triage document that other lanes
read, so the correction has to live where triage lives rather than in one lane's commit message.
