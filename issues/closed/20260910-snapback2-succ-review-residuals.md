# snapback2: succ review residuals — the repair-paste compile audit and the positional Get test

**Filed:** 2026-09-10 (orchestrator, landing lane `succ`, LLP 1020 A1–A3/A6)
**Status:** Closed — 2026-09-11
**From:** `reviews/succ-r6..r8-{grok,codex}.md`

1. **Every generated repair paste should be bound by the compiler, not string-matched.** Four
   review rounds each found one more shape whose pasted fill argument the predecessor schema
   refused (successor-typed enum cases; a raised list/text bound; image/video bounds; a staged
   enum inside a list). `fill_type` now intersects every bound and stages inside wrappers, and
   two shapes are pinned to `repairs.q`, which the compiler lowers under `schema.q`. The durable
   answer is an engine test that generates the paste for every A1/A2 row shape (scalar enum,
   optional enum, list of enums, nested optional list, text/bytes/json/image/video bounds, mixed
   removal + widening + requiredness, disjoint enums) and binds each through the compiler
   against the predecessor schema — `packages/compiler/src/quarry-job-checks.ts` already has the
   lowering harness; the engine side needs a fixture per shape or a generator the check reads.
2. **The Rust positional-Get test does not run the checker.**
   `registry_evolution_tests::regroup_replaces_only_the_owned_projection_without_a_plan`
   hand-builds IR `Get` on `by_recipient` and `read_operator`s it; the owner test does `cli check`
   after the regroup on a fresh client. Certify the Get-shaped read through `Checker` in the
   Rust test too, or say in the report that the owner test is the certification proof.
3. `predecessor_maintain_ids` names the predecessor/successor union; the chat templates duplicate
   `dismissible` instead of importing it (runtime bytes kept it out of the measured tier).

## 2026-09-11 triage

**Priority:** P2. **Disposition:** Open; the named review gaps remain evidence
and cleanup work, not reproduced successor data loss.

Commit `65059922f` improved both areas but did not satisfy their strongest
acceptance. `successor_narrowing.rs::combined_and_truncating_repairs_are_the_fixture_the_compiler_lowers`
generates and text-matches two mixed repair shapes against `repairs.q`, while
`quarry-job-checks.ts::The narrowing refusal's pasted job lowers with its typed
argument, enum quoting included, and certifies` compiles those fixtures. There
is still no generated every-row-shape paste-to-compiler audit covering the
enumerated scalar/wrapper/bound combinations.

Likewise,
`registry_evolution_tests::regroup_replaces_only_the_owned_projection_without_a_plan`
still constructs the positional `Get` IR and calls `read_operator` without a
`Checker` call. Commit `949dcbf86` makes the owner scenario run `cli check` on
a fresh client after install, so the system path has certification evidence,
but the Rust test still does not prove what its comment claims in isolation.
The naming and duplicated template helper in item 3 also remain.

**Remaining acceptance:** feed every generated A1/A2 repair paste through the
real compiler under its predecessor schema (or an equivalent exhaustive
generator), make the Rust positional-Get test call `Checker` or narrow its
claim explicitly to the owner proof, and resolve or split the item-3 cleanup.

## Resolution — 2026-09-11

The engine now pins eleven generated repair families byte-for-byte to
`exhaustive-repairs.q`: scalar and optional enums, enum lists and an optional
list wrapper, text and bytes narrowing, JSON/image/video required fills, a
mixed removal+widening+requiredness change, and a disjoint enum. The compiler
lowers and certifies every pasted job against the predecessor fixture. The
disjoint case is certified against the staged widening that its own first line
requires; it is not misrepresented as compiling before that explicit step.

`regroup_replaces_only_the_owned_projection_without_a_plan` now certifies its
positional `Get` with `Checker` before executing it. The predecessor/successor
projection union is named `replaced_projection_ids`, rather than the misleading
`predecessor_maintain_ids`. The alleged duplicated `dismissible` template helper
is obsolete: one helper remains in `src/store/outbox.ts`, while both templates
only render the already-computed action property.

Verification: the generated-fixture engine test and positional-Get test pass;
the complete compiler suite passes 300/300 on Bun 1.4.0.
