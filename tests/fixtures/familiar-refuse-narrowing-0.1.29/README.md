# Familiar `ctx.refuse()` narrowing reproduction (Snapback 0.1.29)

This fixture pins `@expo/snapback-codegen@0.1.29` and its TypeScript 5.9.3
compiler, generates a Familiar-profile context from `snapback/`, and runs a
strict `tsc --noEmit` candidate matrix.

Run it with:

```sh
npm ci
npm test
```

The runner verifies that generated `api.d.ts` resolves
`@expo/snapback-codegen/ctx` to the installed 0.1.29 `ctx.d.mts`, proves the
generated `FamiliarQueryContext["refuse"]` return is `never`, and starts a
fresh compiler process for each of ten consecutive runs.

The primary failing shape is `matrix/control-flow-bad.ts`: TypeScript does not
treat a call through the contextually typed callback parameter as terminating
control flow. An explicit `FamiliarQueryContext` annotation, `return
ctx.refuse(...)`, or using the refusal in value position restores narrowing.

The separate helper-wrapper trap also reproduces. Both a block-bodied function
declaration with no `: never` annotation and an expression-bodied arrow whose
function variable lacks an explicit `(...) => never` type fail to narrow at the
call site under TypeScript 5.9.3. `matrix/helper-wrapper-good.ts` contains the
two explicit-return-type repairs.
