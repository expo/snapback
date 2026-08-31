# snapback2: the compiler infers `provenance` and `site`, but LLP 0329.017 C4 shows they are authored facts

**Status:** Resolved (awaiting orchestrator landing)
**Systems:** snapback2, compiler, certificate
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-30
**Related:** LLP 1002 (open decision 0), LLP 0329.017 C4, LLP 0329.009 G2, `snapback2/packages/compiler/src/lower/`

LLP 0329.017 C4 found three S1 programs that are syntactically identical (`return scan <table>.<index> [<theOnlyArg>]`) and disagree on `provenance` (`Arg` vs `Computed`), and that corpus `site` labels (`board.columns`, `inbox.memberships`) do not follow from program or binding names. Snapback 2's TypeScript compiler (lane B0) infers both. Inference of an authored fact is a silent-wrongness surface of the kind LLP 0329.009 G2 already found once: a refactor of a helper name moves a site id, and a wrong provenance changes the certificate's prefix template without any refusal.

Ruling to implement (LLP 1002 §Open decisions, item 0): either make both explicit annotations in the authored surface (`scan(messages.byConvTime, [conversationId], { take: 50, site: 'thread.page' })`, provenance derived from a declared key origin), or keep inference but refuse with `E_PROVENANCE_AMBIGUOUS` whenever the compiler cannot decide from a single unambiguous rule, and pin `site` to `<module>.<export>.<ordinal>` so it never depends on helper names. Either way, the 17 S1 corpus certificates must stay identical (re-author the fixture if the surface changes).

**Claimed:** 2026-08-30 ~15:15 PT by session snapback-8a [f8c2a2] — implementation in flight on branches `s2/t2-provenance` / `s2/t2-bytes` (worktrees `~/projects/snapback-s2v`, `~/projects/snapback-s2y`), based on wave-1 integration `d6b2eca4e`. Wave-2 dispatch of the 0830 burn should SKIP these two tickets to avoid duplicate lanes.

**Resolution (2026-08-30):** Implemented the keep-inference ruling in commits
`417e664f4` (`Fix compiler provenance and site identity`) and `a66dd0891`
(`Count writes in compiler site ordinals`). Provenance now has
the closed rules recorded in LLP 1002 §2 and refuses unknown or mutable key
origins with `E_PROVENANCE_AMBIGUOUS` plus a compiling direct-origin rewrite.
Read sites are `<module>.<export>.<ordinal>` using the export's read/write source
order and are invariant under helper rename, extraction/inlining, and formatting.
That initial round retained every S1 provenance value; its regenerated corpus
changed only site identity and derived certificate projections/hashes. The
review correction below intentionally changes one provenance under the closed
rules. The orchestrator retains custody of
moving this ticket to `issues/closed/` at landing.

**Blind-review fix round 1 (2026-08-30):** Commit `a7568764e` closes provenance
under immutable aliasing, derives property and `memberOf` provenance from their
actual members while reserving `Shape` for proven row bindings, fixes pasted
rewrite origin and nested-expression source order, reserves callback-write
ordinals, refuses duplicate module basenames, and gives
`E_PROVENANCE_AMBIGUOUS` an accurate discoverable guide page. The real C4 trio
now reproducibly compiles as `Arg` / `Arg` / `Computed`; a second identical-body
trio proves names are irrelevant. Corpus regeneration changed only
`named-send-maintained-unread`: `programs.sendMaintainedUnread.2` and its
certificate prefix changed `Shape` → `Arg` because the helper body is a
transparent object-member identity wrapper; its plan hash changed derivatively,
and every numeric estimate remained identical.

**Blind-review fix round 2 (2026-08-30):** Commit `6a747b1ef` replaces the
remaining exact-AST special cases with one recursive member-path classifier.
Operation composites, assertions, immutable aliases, helper substitutions,
nested object members, ordered spreads, loop/destructuring/specialized bindings,
and row-preserving filters now carry the same origin/ambiguity rules. Update
operands lower once in source order, and ambiguity rewrites are scoped to the
authored read key rather than helper declarations. `E_OP_MODULE_BASENAME` now
distinguishes module-site collisions from reserved `then` paths. Regenerating
all 81 corpus cases produced no diff: no sites, provenance, hashes, or numeric
estimates changed. The blocking suite passed Rust 19/19 + 22/22 (+ two empty
targets), evaluator 81/81, and compiler 75/75; all measured budgets passed. Root
caps retained only the known 205/204 Snapback 1 oversize baseline red, and
`ref-check --verbose` passed with 7,218 refs and zero errors or unchecked
references.

**Blind-review fix round 3 (2026-08-31):** Commits `d7e66cf90` and
`de1e23c72` close all six remaining classes. Collection bindings retain
path-aware alternative element origins; stable `let` bindings, lexical
shadowing, renamed handler composites, and explicit refusal of `orderedPair`
defaults remove binding-form and spelling effects. Recursive provenance,
shape, bound, lowering, substitution, and type-analysis walks now terminate in
an envelope. Identity maps and row-preserving chains retain row proof, while
transformed maps classify their returned elements. Ambiguity rewrites match a
selected argument field, use the sole direct origin, or emit a deliberately
non-lowerable sentinel naming every candidate. Every compiler diagnostic code
has an exact guide record; `E_OP_MODULE_BASENAME` carries its rule.

Final verification passed Rust 19/19 + 22/22 (+ two empty targets), evaluator
81/81, and compiler 83/83. All loop measurements passed; root caps retained
only the inherited 205/204 Snapback 1 oversize red. Both requested diagnostic
guide lookups exited 0. Regenerating all 81 corpus cases produced an empty
diff. Ten final adversarial probes (two per class A–E) all produced their
expected provenance or finite refusal, including a four-helper spread cycle
and a spread of a mapped row projection.
