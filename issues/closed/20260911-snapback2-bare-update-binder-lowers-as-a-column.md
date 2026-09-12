# Snapback 2 a bare `old` / `next` in an update rule lowers as a column named `old`

**Status:** Closed
**Priority:** P3
**Date:** 2026-09-11
**Systems:** `snapback2/packages/compiler/src/quarry/bound-schema.ts` (`bindRuleTerm`, `bindRule`), `parser.ts` (`parseRule`)
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1010 A3 (one-row binder; two-image updates retain old/next); `schema.rs` `RuleTerm::{Field, OldField, NextField}`

## Symptom

Quarry has two spellings for “this row” in a table rule, and a third path that reuses the same name machinery for channels. A **bare** `old` / `next` in an `update (old, next)` rule is lowered as if it were a **column named `old`**, not the old image of the row.

This is usually invisible: authors write `old.conversationId`, not `old`. If the table happens to have a column named `old` or `next`, a bare binder type-checks as that column and the rule can compile meaning the wrong thing.

## The two update styles

One-row (focal) rules use `.field` for the candidate:

```q
update <- .owner = viewer
```

Two-image updates name the before/after rows:

```q
update (old, next) <- old.principal = viewer and next.principal = viewer
```

The parser only allows named bindings on `update` with exactly two names (`parser.ts:408-409`). Those names go into `context.names`, and `old` / `next` are also stashed as `context.old` / `context.next` (`bound-schema.ts:258-260`).

## How a field is supposed to lower

A **member** on a binder (`old.principal`) hits this branch:

```336:340:snapback2/packages/compiler/src/quarry/bound-schema.ts
  if (expr.kind === "member" && expr.base.kind === "name" && context.names.has(expr.base.name)) {
    checkRuleField(context, expr.name, expr.site);
    const method = expr.base.name === context.old ? "oldField" : expr.base.name === context.next ? "nextField" : "field";
    const tag = method === "oldField" ? "OldField" : method === "nextField" ? "NextField" : "Field";
    return { value: { [tag]: expr.name }, kind: "field", field: expr.name, method };
  }
```

So `old.principal` becomes `OldField("principal")`, `next.role` becomes `NextField("role")`. At runtime those mean “the `principal` column of the **previous** row” and “the `role` column of the **incoming** row.”

A **bare** name that is in `context.names` does **not** take that path:

```342:344:snapback2/packages/compiler/src/quarry/bound-schema.ts
  if (expr.kind === "name" && context.names.has(expr.name)) {
    return { value: { Field: expr.name }, kind: "field", field: expr.name, method: "field" };
  }
```

`old` by itself becomes `Field("old")`: “the column named `old` on the candidate row.” That is the same IR tag used for `.owner` in a one-row rule.

The engine’s rule terms are distinct on purpose (`schema.rs`):

```364:370:snapback2/crates/snapback2-core/src/schema.rs
pub enum RuleTerm {
    Field(String),
    OldField(String),
    NextField(String),
    Viewer,
    Literal(Value),
}
```

Mixing them up is not a rename; it is a different read. `OldField` / `NextField` also do not substitute into index prefix proofs (`schema.rs:87`).

Type-checking of a bare name uses `context.args`, which is only set for channels:

```390:390:snapback2/packages/compiler/src/quarry/bound-schema.ts
  if (expr.kind === "name" && context.names.has(expr.name)) return context.args?.get(expr.name);
```

For an update rule `args` is unset, so the bare binder has no term type from that path. Comparison-type checks can therefore miss it; `checkRuleField` only runs on **member** access, not on this bare-name branch.

## Why it is usually harmless

People write `old.conversationId`, not `old`. The chat template does that:

```49:53:snapback2/packages/snapback2/templates/chat/snapback/schema.q
  update (old, next) <- (
    exists memberships[old.conversationId, viewer, 'admin']
    and old.role = 'member'
    and next.role = 'admin'
  )
```

If you wrote `exists memberships[old, viewer]` thinking “the old membership row,” the binder would emit `Field("old")` and look for a **column** `old`. Typical tables don’t have that column, so certify / `checkRuleField` on related paths often refuse. The author then writes `old.id` and it works.

## When it would mean the wrong thing

If the table **does** have a column named `old` or `next`, a bare binder type-checks as that column. Then:

```q
update (old, next) <- exists memberships[old, viewer]
```

does not mean “the previous row’s id.” It means “the **new** row’s `old` column.” The rule can compile and silently authorize (or deny) the wrong thing.

A table that uses the conventional binder names as column names is the collision. Nothing in the language forbids a column `old`.

## Why a blanket refuse is wrong

The same `context.names` + `{ Field: name }` path is **intentional for channels**. Channel publish/subscribe args are packed as a synthetic row (`snapback2-core` `channels.rs`: `Value::Row(args.clone().into())`), so a bare argument name really is a field of that row:

```213:216:snapback2/packages/compiler/src/quarry/bound-schema.ts
  const context: RuleContext = {
    names: new Set(declaration.args.map((arg) => arg.name)),
    args: new Map(declaration.args.map((arg) => [arg.name, arg.type])),
  };
```

A blanket “bare names in `context.names` are illegal” would break channel rules. Channel args must keep using the `Field` path.

## Proposed patch

Refuse only when the bare name **is** the update binder (`context.old` / `context.next`). Require `old.<field>` / `next.<field>` (including `old.id`). Channel args stay on the Field path.

In `bindRuleTerm`, before the generic `context.names` Field lowering:

```ts
  if (expr.kind === "name" && (expr.name === context.old || expr.name === context.next)) {
    refuse(
      expr.site,
      `bare ${expr.name} is the update row, not a column; name a field`,
      `write ${expr.name}.id or ${expr.name}.<column>`,
    );
  }
  if (expr.kind === "name" && context.names.has(expr.name)) {
    return { value: { Field: expr.name }, kind: "field", field: expr.name, method: "field" };
  }
```

Optional: same refuse in `ruleTermType` so comparisons fail at the term-type site with that rewrite instead of a later “cannot compare” or a silent miss.

Do **not** treat a channel argument whose name happens to be `old` as an update binder: `context.old` is only set for `update (old, next)` (`bindRule`). Channel `bindChannel` never sets `context.old` / `context.next`.

## Acceptance

- `update (old, next) <- exists memberships[old, viewer]` is a Quarry rewrite at the `old` site (`old.id` / `old.<column>`), not `Field("old")`.
- `update (old, next) <- old.principal = viewer and next.principal = viewer` still certifies (templates / fixtures).
- `update <- .owner = viewer` still certifies (focal `.field` is unchanged).
- A channel `publish <- room = ...` (bare argument name) still certifies; args remain `Field("room")` against the synthetic args row.
- A table that actually has a column `old` can still use `.old` in a **focal** one-row rule (`update <- .old = ...`). Two-image rules on that table must write `old.id` / `next.old` explicitly; add a fixture so that does not regress.

## Notes

This is a compiler diagnostic, not an engine hole: the IR tags are already correct when authors use `old.field`. The bug is only the bare-name lowering. P3 because the paved templates never write a bare binder, and a colliding column name is rare — but when it happens the rule is wrong rather than refused.

## Resolution — 2026-09-11

The compiler now refuses a bare update-row binder in both rule-term typing and
lowering, at the authored name, with the rewrite `old.id` / `old.<column>`
(using the actual binder name). The check uses the update context, so channel
arguments named `old` or `next` still lower as synthetic-row `Field` terms.
No engine or executable IR change was needed.

Regression coverage in `bound-schema-checks.ts` exercises 48 refusals across
both update positions, custom binder names, colliding/missing columns,
inferred/explicit/named index keys, and comparisons under Boolean composition.
It verifies the diagnostic code, source site, rewrite, and guide. Positive
fixtures assert distinct `OldField` / `NextField` terms (including renamed and
swapped binders), focal `.old` / `.next` access, and bare channel arguments in
comparisons and probes; each accepted schema passes Rust certification.

The pre-fix collision reproduced `Field("old")` and passed Rust certification.
The new rejection regression failed on the original compiler, then passed with
the correction. Focused bound-schema tests and compiler TypeScript checking
pass. LLP 1010 A3 and the packaged rules guide record the corrected contract.
