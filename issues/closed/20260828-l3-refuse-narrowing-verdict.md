# L3 verdict: Familiar `ctx.refuse()` narrowing on published 0.1.29

**Status:** confirmed
**Obligation:** LLP 0317 O12 / LLP 0317.000 lane L3
**Candidate:** control-flow shape. **Mechanism corrected in review:** this is
not a contextual-callback limitation but TypeScript's general
**explicit-call-target rule** (microsoft/TypeScript#32695) — for a top-level
`never`-returning call to terminate control flow, *every identifier in the
dotted call target must have an explicit type*. The handler's `ctx` parameter is
unannotated, so `ctx.refuse(...)` does not narrow. A reviewer confirmed an
ordinary non-contextual `const ctx = acquire()` fails identically, while
`const ctx: Ctx = acquire()` narrows.
**Reproduction:** `tests/fixtures/familiar-refuse-narrowing-0.1.29/`

## Verdict

Published `@expo/snapback-codegen@0.1.29` reproduces the lane's strict-null
symptom without declaration skew and without any helper wrapper:

```ts
export const contextuallyTypedDirectCall = query({
  args: { id: v.id("posts") },
  returns: v.string(),
  auth: "public",
  reads: ["posts"],
  handler: async (ctx, args) => {
    const post = await ctx.db.get("posts", args.id);
    if (!post) ctx.refuse("POST_NOT_FOUND");
    return post.body;
    //     ^^^^ TS18047: 'post' is possibly 'null'.
  },
});
```

The same 0.1.29 generated context typechecks when the handler parameter has an
explicit annotation:

```ts
handler: async (ctx: FamiliarQueryContext, args) => {
  const post = await ctx.db.get("posts", args.id);
  if (!post) ctx.refuse("POST_NOT_FOUND");
  return post.body;
}
```

It also typechecks without an annotation when the already-correct `never`
return is placed in syntactically terminating or value-producing control flow:

```ts
if (!post) return ctx.refuse("POST_NOT_FOUND");

const present = post ?? ctx.refuse("POST_NOT_FOUND");
return present.body;
```

This isolates a TypeScript 5.9.3 control-flow limitation around a
never-returning method reached through a contextually typed callback parameter.
An `await` boundary is not the cause: narrowing remains valid across an await
when `ctx` is explicitly annotated. A nested callback reproduces the same
contextual-parameter failure.

## Candidate matrix

| Candidate | Result | Evidence |
|---|---|---|
| Generated-type skew | Not reproduced | `--traceResolution` resolves generated `api.d.ts` → `node_modules/@expo/snapback-codegen/ctx.d.mts` with package ID 0.1.29. A type assertion proves `ReturnType<FamiliarQueryContext["refuse"]>` is `never`. |
| Helper-wrapper widening | Reproduced independently, but not required for O12 | A block-bodied unannotated declaration infers a non-terminating callable and produces TS18047. An inferred expression-bodied arrow has a `never` return type but still does not make its call site terminating in TS 5.9.3; an explicit `(...): never` or `(...) => never` annotation fixes both forms. |
| Control-flow shape | **Confirmed primary reproduction** | The direct inline snippet above fails 10/10 fresh `tsc` processes. Explicit parameter annotation, explicit `return`, and nullish value position are clean 10/10. |
| Editor/tsserver staleness | No compiler evidence | Ten fresh compiler processes produced the same positive and negative results. Editor staleness could have coexisted in the original lane, but it is unnecessary to explain the recorded `tsc` diagnostics. |

The original run artifact retains only the log statements, not the lane's
authored source, so the harness does not claim whether that source also used a
wrapper. The direct contextually typed handler is nevertheless sufficient to
reproduce the exact reported symptom under the exact published declaration.

## Pin and procedure

The fixture lockfile pins:

- `@expo/snapback-codegen@0.1.29`, registry integrity
  `sha512-U+LzIeWcj1CM585Zxapx6mydZnmOBWtiXPoRWbjUNAB5/Q05hF4uWhfDiPgh9rXMhXK4OGqtpFUl/G/itTU6Vg==`
- `@expo/snapback-contract@0.1.29`
- `typescript@5.9.3`

Run:

```sh
cd tests/fixtures/familiar-refuse-narrowing-0.1.29
npm ci
npm test
```

`npm test` regenerates `snapback/generated/server.d.ts` and `api.d.ts` with the
published package, validates exact module resolution, and runs ten consecutive
fresh-process checks of the clean and expected-failure projects. Observed:

```text
published package: @expo/snapback-codegen@0.1.29
generated ctx resolution: node_modules/@expo/snapback-codegen/ctx.d.mts
explicit-context / explicit-return / value-position / annotated-wrapper matrix: 10/10 clean
contextually typed direct ctx.refuse call: TS18047 reproduced 10/10
unannotated declaration and inferred-expression wrappers: TS18047 reproduced 10/10
```

## Product response

Do not change `ctx.d.mts`; `refuse(...): never` is already correct and is the
declaration the generated Familiar context resolves.

The cheapest response is documentation plus an authoring diagnostic or lint
for the failing statement shape. Draft guide sentence:

> In a Familiar handler, write `if (!row) return ctx.refuse("CODE")` or
> `const row = maybeRow ?? ctx.refuse("CODE")`; TypeScript 5.9 may not narrow
> after a bare `if (!row) ctx.refuse("CODE")` when `ctx` is contextually typed.
> If you wrap refusal, give the helper an explicit `: never` return (or an
> explicit `(...) => never` callable type).

No product type change was made in this lane.

## Repository checks

- `npm ci && npm test` in the fixture: pass.
- `./ref-check --verbose`: pass (`326 LLP docs`, `6913 refs`, `0 errors`).
- `node scripts/check-inventories.mjs`: inherited `guide-manifest` red after
  `bun install` repaired the initially missing root dependencies. The remaining
  failures are absent generated demo sources outside L3's file scope:
  `demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json`,
  `demos/todo-v2/snapback/generated/contract/setCompleted.mutation.ts`, and
  `demos/todo-v2/snapback/generated/contract/runtime-links.ts`. Per the lane's
  generated-artifact rule, L3 did not regenerate or hand-edit those files.

---

## Product response (from the corrected mechanism)

Because this is TypeScript's documented rule and not a Snapback declaration
defect — `refuse(): never` is already correct in published 0.1.29 — the fix is
**not** a type change. It is:

1. **A guide sentence** on the Familiar handler page: a bare
   `if (!row) ctx.refuse('X'); return row.field;` will not narrow, and the
   admitted spellings are `return ctx.refuse('X')`, `row ?? ctx.refuse('X')`,
   or an explicitly typed `ctx`.
2. **A lint or generate-time advisory** for the bare-statement shape, which is
   the one a Convex-shaped author reaches for first.

The helper-wrapper trap is the same rule: an expression-bodied arrow that only
calls `ctx.refuse` still needs an explicit `(...) => never` annotation under
TypeScript 5.9.3. The fixture covers both.
