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

## Resolution

Resolved 2026-08-15.

- `@expo/snapback-contract/limits` (mjs + d.mts, `./limits` subpath) is the
  canonical source: `RELATIONAL_TAKE_CEILING` and
  `SNAPSHOT_BATCH_SUMMED_TAKE_CEILING`, both 1024, with the governing LLP
  references.
- The silent decline is fixed: `inline-handlers.mjs` imports the ceiling, and
  a literal `take()` beyond it is now a source-attributed
  `SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN` refusal carrying
  `ceiling`/`limit`/`observed` facts, before any artifact is emitted. The
  plain-join classifier no longer swallows the case. Regressions: an explicit
  and a Familiar graph with `take(4096)` must refuse atomically
  (`authoring-validation.test.mjs`, `familiar-phase-b.test.mjs`).
- **Deliberate deviation from the suggested fix:** `define.mjs` keeps its
  three 1024 literals instead of importing the contract module. `define.mjs`
  participates in every explicit-profile app's authored module graph, so the
  import adds a graph label and rotates `authoredSourceHash` (activation
  identity) for every explicit demo — a full generated-artifact +
  publication-receipt re-mint cascade for zero behavior change. Its literals
  are instead parity-locked by `packages/snapback-contract/limits.test.mjs`,
  the same guard that locks the Rust enforcement literals
  (`src/manifest.rs`, `src/storage.rs`) without changing runtime behavior.
  Verified: regeneration of `demos/todo/snapback` is byte-identical under
  this change (no artifact rotation beyond the pre-existing main drift
  tracked in `issues/20260815-artifact-schemas-v0-committed-output-drift.md`).
- Client survey: no client-side relational `take` admission exists
  (`local-read-admission.mjs` and the IR evaluator have no take check), so
  there was nothing to converge there; the server refusal remains the runtime
  authority.
- Published-closure confirmation: `@expo/snapback-codegen@0.1.21`'s
  `inline-handlers.mjs` line 778 has the silent `> 1_024` decline, so the
  Diary 0078 M3 repro is real on the published closure; its explicit-profile
  `define.mjs` already asserted 0..1024. The seam closes at the next
  qualified release.
