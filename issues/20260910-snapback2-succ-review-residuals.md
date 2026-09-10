# snapback2: succ review residuals — the repair-paste compile audit and the positional Get test

**Filed:** 2026-09-10 (orchestrator, landing lane `succ`, LLP 1020 A1–A3/A6)
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
