# LLP 1018 move three — Quarry binding-hygiene lane review (codex `gpt-5.6-sol`, xhigh, read-only, blind)

**Change:** `s2/clique-quarry-collision` — generated table bindings `<name>$table`, one printing helper, helper-name refusals at the Quarry site. Round 1 reviewed the lane's first commit (cd4cc1d45 pre-rebase; 37731e373 on main); round 2 the effect-name fix (07a18712e pre-rebase; c392dd5a6 on main).
**Implementer:** codex `gpt-5.6-sol` at xhigh (lane), effect-name fix by the orchestrator.
**Orchestrator:** Claude Fable 5.1, session `session_01N6HHCXSkeacu8sJfsUH38L`.
**Provenance:** every review below was actually received from the named model; verbatim text per round; the two reviewers never saw each other's reviews.

| Round | Reviewed | Verdict |
|---|---|---|
| 1 | the slice | VERDICT: NOT READY (1 MATERIAL) |
| 2 | the effect-name fix (targeted) | VERDICT: READY |

## Round 1 (verbatim)

- **MATERIAL — Effect names remain able to collide with generated bindings.** [`program.ts:95`](/Users/ccheever/projects/snapback-worktrees/clique-quarry-collision/snapback2/packages/compiler/src/quarry/program.ts:95) validates only `program.name`; it never validates effect names against the Snapback helper set or `orderedPair`. Because [`parser.ts:313`](/Users/ccheever/projects/snapback-worktrees/clique-quarry-collision/snapback2/packages/compiler/src/quarry/parser.ts:313) accepts names such as `range` and `orderedPair`, `effect range from delivery` produces duplicate `range` imports at [`program.ts:82`](/Users/ccheever/projects/snapback-worktrees/clique-quarry-collision/snapback2/packages/compiler/src/quarry/program.ts:82) and [`program.ts:84`](/Users/ccheever/projects/snapback-worktrees/clique-quarry-collision/snapback2/packages/compiler/src/quarry/program.ts:84); `effect orderedPair` conflicts with [`program.ts:86`](/Users/ccheever/projects/snapback-worktrees/clique-quarry-collision/snapback2/packages/compiler/src/quarry/program.ts:86). These reach generated TypeScript as `E_OPAQUE`, not a Quarry-family declaration-site rename. Validate effects at `effect.site` or alias effect imports, with a regression.

- **REFUTED-RISK — Raw table operands.** Program arguments, recurse/walk, dereferences, reads, merge lanes, aggregates, writes, indexed writes, and post-write reads all route through [`tableBinding()`](/Users/ccheever/projects/snapback-worktrees/clique-quarry-collision/snapback2/packages/compiler/src/quarry/program.ts:124). Schema-side raw references remain correct same-module bindings; recursive `typeCode()` propagates the alias callback for program argument refs at [`schema.ts:257`](/Users/ccheever/projects/snapback-worktrees/clique-quarry-collision/snapback2/packages/compiler/src/quarry/schema.ts:257).

- **REFUTED-RISK — Downstream identity and `$` leakage.** Aliased imports are resolved by exported table name while keyed under the local alias at [`project.ts:651`](/Users/ccheever/projects/snapback-worktrees/clique-quarry-collision/snapback2/packages/compiler/src/project.ts:651). API inference then returns the authored `TableInfo.name`, not identifier text, at [`project-api-types.ts:728`](/Users/ccheever/projects/snapback-worktrees/clique-quarry-collision/snapback2/packages/compiler/src/project-api-types.ts:728). Provenance remapping is line-marker based, while cap sites and where repairs operate on authored Quarry ASTs.

- **REFUTED-RISK — Operation-side refusal and certificate identity.** Operation collisions do receive a Quarry family, declaration site, rename rewrite, and `quarry/names` page. Certificate byte identity is plausible: aliases normalize back to authored table names before IR lowering, and access identities remain lexical ordinals. No builds or tests were run, as requested.

VERDICT: NOT READY (1 MATERIAL)

## Round 2 (verbatim, targeted)

MATERIAL or MINOR findings.

- REFUTED-RISK — [program.ts:98](/Users/ccheever/projects/snapback-worktrees/clique-quarry-collision/snapback2/packages/compiler/src/quarry/program.ts:98): effect names are refused before code generation against both the shared import-binding set and `orderedPair`, at `effect.site`, with a rename rewrite.
- REFUTED-RISK — [quarry-program-checks.ts:111](/Users/ccheever/projects/snapback-worktrees/clique-quarry-collision/snapback2/packages/compiler/src/quarry-program-checks.ts:111): regressions cover both `effect range` and `effect orderedPair`.
- REFUTED-RISK — [program.ts:132](/Users/ccheever/projects/snapback-worktrees/clique-quarry-collision/snapback2/packages/compiler/src/quarry/program.ts:132): the corrected `@ref` resolves to LLP 1004’s implementation record and its generated-binding note.

VERDICT: READY
