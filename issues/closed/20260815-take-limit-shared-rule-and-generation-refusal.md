# Take-limit rules are duplicated literals across codegen/client/runtime, and an over-limit literal `take()` is silently declined instead of refused at generation time

**Filed:** 2026-08-15 · **Source:** Clique 0.1.21 exploratory sweep synthesis
(Diary 0078 M3; residual of the generated-artifact toolchain seam whose other
three defects closed 2026-08-15 in `bd59f1b59`) ·
**Systems:** Codegen, Contract, Client, Runtime

## Problem

Diary 0078 (Familiar pilot, M3): a generated `take(4096)` was accepted at
generation time and turned message subscriptions into runtime 400 refusals
against the 1024 ceiling. "The refusal was useful and structured; accepting
the impossible query at generation time was not."

Two seams underlie this:

1. **No shared source for the limit.** The 1024 relational-take ceiling (and
   the 1024 summed-batch ceiling) is a repeated literal:
   - `packages/snapback-codegen/define.mjs:2943` (`take must be 0..1024`),
     `:3037` (summed batch take), `:3288` (relational take);
   - `src/manifest.rs:5390`, `:6189`, `:6236`, `:6293` and
     `src/storage.rs:5430` (runtime enforcement).
   The operation-name grammar got exactly the right treatment in the same
   wave (`@expo/snapback-contract/operation-name`, imported by codegen and
   client); the limit rules did not.

2. **Silent decline instead of refusal.** The inline-handler static
   classifier (`packages/snapback-codegen/inline-handlers.mjs:798`) returns
   `null` for a literal take > 1024 rather than emitting a structured
   generation-time diagnostic, so an impossible-by-construction query
   generates cleanly and only fails when the runtime refuses it. This is the
   exact failure the diary hit.

## Suggested fix

- Add a `@expo/snapback-contract/limits` module (mjs + d.mts, mirroring
  `operation-name`) exporting the relational-take and summed-batch-take
  ceilings; import it at every codegen validation site and any client-side
  admission site that checks take.
- Make the inline-handler path emit a structured generation-time diagnostic
  for a literal take beyond the ceiling instead of silently declining
  classification.
- Keep the Rust runtime enforcement as-is behaviorally, but add a parity
  check (following whatever cross-language constant-sync precedent the repo
  already uses) so the Rust literals cannot drift from the contract module
  silently.
- Regression test: generation of an explicit and a Familiar/inline graph
  containing `take(4096)` must produce a structured refusal naming the
  ceiling, not a generated artifact.

Also confirm the published 0.1.21 closure's generation-time behavior for the
repro so the next qualified release note can claim the seam closed.

## Resolution (2026-08-15)

Closed by the concurrent-fleet landing `34d98f489`
(`fix(codegen): refuse literal take beyond the shared relational ceiling`)
plus the `@expo/snapback-contract/limits` module it rides on:

- `packages/snapback-contract/limits.mjs` / `limits.d.mts` export
  `RELATIONAL_TAKE_CEILING` and `SNAPSHOT_BATCH_SUMMED_TAKE_CEILING` (1024)
  with @refs to LLP 0080 §1, LLP 0110 §11, and LLP 0135 §2.1; codegen
  validation sites import them instead of repeating the literal.
- `packages/snapback-contract/limits.test.mjs` pins the JS constants against
  the Rust enforcement sites so the literals cannot drift silently.
- The inline-handler path refuses an over-ceiling literal take at generation
  time via `queryChainProblem` with an authored source span and structured
  bound facts (no silent decline), and the plain-join classifier is
  documented as not being a second validation lane.
- `scripts/check-package-test-inventory.mjs` 287→288 records the parity
  guard and refusal coverage.

A duplicate implementation from this supervised run (same shape: limits
module, longest-site imports, structured Familiar refusal
`SNAPBACK_AUTHORING_RELATIONAL_TAKE_CEILING_EXCEEDED`, explicit+Familiar
`take(4096)` refusal tests) was verified green in its worktree and then
discarded in favor of the first-to-main landing per the concurrent-fleet
convention. This file records the closure since the code landing did not
carry the ticket.
