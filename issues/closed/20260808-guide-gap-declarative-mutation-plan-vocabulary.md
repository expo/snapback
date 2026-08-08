# guide-gap: the declarative mutation-plan vocabulary is promised but documented nowhere

**Opened:** 2026-08-08 · **Severity:** P2 (documentation)

guide/backend/mutations.md:99-101 introduces `defineMutation` as "the
declarative twin: compose `insert`, `patch`, `delete`, conditions, and a
declared return binding", and getting-started/your-first-backend.md:212
promises "The reference pages carry the complete semantics." Neither is
true: the plan vocabulary has essentially zero reference coverage.

Undocumented exports (packages/snapback-codegen/define.mjs): `insert` :2916,
`patch` :2919, `del` :2920, `get` :2930, `guard` :2936, `letBind` :2942,
`deleteWhere` :2950, `insertEach` :2966, `assertSourceChanged` :2971,
`allocateSequence` :2981, `mutationPlan` :2999, `existingOwner` :3004,
`returnBinding`/`returnChangedCount`/`returnDocument`/`returnLiteral`/
`returnExpr` :3446-3451, the `defineMutation` spec keys (`plan`, `returns`,
`result`, `boundedSkew`) :3500-3519, and the whole expression algebra
(`add`…`concat`, `cond`, `call`, `record`, `field`, `argsRoot`,
`runtimeId`/`runtimeNow`, `authKind`/`authActorKind`/`authIsDelegated`/
`authActualActor`/`authGrantId`/`clientMutationDigest`, :1835-1931).

Guide grep: zero hits for `mutationPlan`, `insertEach`, `letBind`,
`returnDocument`, `assertSourceChanged`; mutations.md never even shows the
`plan:`/`returns:` spec keys.

This matters doubly because declarative plan mutations are the paved path
several other pages route to (standard-patterns, trusted-runtime-values),
and issues/20260808-plan-refusal-codes-not-crosschecked.md already tracks a
semantic seam in the same surface — an agent can neither learn the
vocabulary nor its refusal envelope today.

Ask: a "declarative plan vocabulary" section (or dedicated page)
enumerating steps, return bindings, and expression helpers with CI-verified
snippets, cross-linked from mutations.md and standard-patterns.md; add
retrieval aliases (mutationPlan, letBind, insertEach, return binding).

Found by the 2026-08-08 comprehensive docs review (backend slice).

## Resolution

Fixed 2026-08-08 (docs-review execution, 1284ae8a5). New page
guide/backend/declarative-plans.md carries the complete `defineMutation`
reference — spec keys, all step helpers, all five return bindings, the
grouped expression algebra (including `authActivityActorKind`, which this
ticket's inventory missed), the pinned function library, `outgrewIr`
classes, anti-patterns, and the plan-refusal channel documenting the
CURRENT envelope split (cross-linked to the still-open
plan-refusal-codes-not-crosschecked ticket) — plus the index entry and
cross-links from mutations.md/standard-patterns.md. Two ticket-adjacent
corrections surfaced during verified authoring: an omitted `returns`
defaults to the changed count (not null), and `mutationPlan()` is the
`defineWriteWithActivity` container rather than defineMutation's array
form.
