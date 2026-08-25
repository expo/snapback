# Integrating a long-lived lane: four resolution hazards, learned the hard way

Status: Closed
Created: 2026-08-23
Related: issues/20260823-implementation-sequencing.md

## Why

Integrating a six-commit fence lane against a `main` that had meanwhile absorbed an overlapping
test-probe lane produced **three separate defects in my own conflict resolution**, each discovered
only by the next verification step. None reached `main`, but each cost a cycle. Recording the
hazards because they are mechanical, general, and cheap to avoid.

## 1. `git merge-tree` predicts the MERGE, not the REBASE

Before starting I ran `git merge-tree` against current `main` and it predicted **zero conflict
hunks**. The rebase then conflicted on four separate commits.

That is not a contradiction: `merge-tree` evaluates the *final* three-way merge, while `rebase`
replays each commit against the new base, so **intermediate states conflict even when the end state
would not**. A clean `merge-tree` is evidence about the destination, not about the journey.

## 2. "Keep both sides" is right for source, wrong for generated files, wrong for manifest keys

The conflicts were genuinely additive — both lanes added different items in the same regions — so
keeping both sides is the correct instinct for Rust source. Applied indiscriminately it caused:

- **Generated projections**: 1,406 conflict hunks in `guide/reference/diagnostics-registry.json`
  were "resolved" by concatenation, producing a corrupt registry. Generated artifacts must be
  **regenerated from source**, never merged. Resolve them any way that parses, then run the
  generators and confirm `check-inventories` passes.
- **Cargo manifest**: both sides defined the `test-support` feature, so the union produced a
  **duplicate key**, which fails the *entire workspace* with
  `error: failed to load manifest for workspace member` — every crate, not just the one edited.
  The correct resolution is the **superset value**, not both lines. Verify with
  `cargo metadata --no-deps` before trusting any build result.
- **Same-item edits**: both sides had modified `impl Drop for AuthorizedEffectReservation` — one
  removing a registry entry, the other releasing a test probe. Union kept **two impls** of the same
  trait. This is not "both added"; it is "both changed the same thing", and it needs one merged
  body containing both effects.

## 3. Global brace balance does not mean the file parses

After one resolution the file had `braces: 0` and zero conflict markers, and still failed with
`unexpected closing delimiter`. A duplicated block plus a dropped one balances globally while being
locally wrong. **Only the compiler is evidence.**

## 4. Delegate large semantic merges

After the third repair it was clear that hand-editing large overlapping Rust regions over ssh was
the wrong tool. The work went to an implementation lane that can compile and test iteratively,
carrying the resolution facts already established. That should have been the first move, not the
fourth.

## Checklist for next time

1. Expect a rebase to conflict even when `merge-tree` is clean.
2. Classify every conflicted path before resolving: **source** (semantic merge), **generated**
   (regenerate), **manifest** (superset, then `cargo metadata`).
3. After any bulk resolution, check for duplicated `impl`/`fn` definitions before building.
4. Compile before believing any structural check.
5. If two files need more than a couple of hand merges, delegate to a lane with the facts you have.

## Resolution

Closed 2026-08-25. Practice note captured (merge-tree vs rebase, generated
files vs source, Cargo feature keys, same-item edits). No remaining
engineering item; the living process note for the fence program is
`issues/20260823-implementation-sequencing.md`.
