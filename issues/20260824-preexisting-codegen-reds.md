# Two pre-existing codegen reds observed on `origin/main` at 941e965ad

Status: open
Filed: 2026-08-24
Area: packages/snapback-codegen

Both reproduce with the working tree reverted to `origin/main`'s
`packages/` content, so neither belongs to
`seth/knockoff-shared-development-auth`.

## 1. `export { ... };` with no module specifier crashes the builder walk

`node --test packages/snapback-codegen/application-auth-bootstrap.test.mjs`
fails at "familiar defaults durable custody and refuses the weaker grade
before publication" with:

```
CODEGEN_MODULE_EVALUATION_FAILED: Cannot read properties of undefined (reading 'kind')
  at Object.isStringLiteral (typescript.js)
  at resolveExport (packages/snapback-codegen/index.mjs)
```

`resolveExport` reads `ts.isStringLiteral(statement.moduleSpecifier)` for every
`ExportDeclaration`. A local re-export — `export { allow, defineSchema, v };`,
which `packages/snapback-codegen/familiar.mjs` itself uses — has no
`moduleSpecifier`, so the call receives `undefined` and throws inside
TypeScript rather than resolving the binding.

Next action: guard the specifier read (`statement.moduleSpecifier !== undefined
&& ts.isStringLiteral(...)`) and add a familiar-profile regression fixture whose
schema resolves a builder through a specifier-less re-export.

## 2. The embedded Rust schema-manifest fixture is stale

`node --test packages/snapback-codegen/authoring-validation.test.mjs` (~3 min)
fails with `actual codegen schema manifest drifted from the Rust embedded
fixture`.

Next action: identify which side moved — the JS manifest projection or the
embedded Rust fixture — and regenerate the stale one. Until then this file
cannot gate anything downstream of it.
