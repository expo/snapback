# Integration fix 2 report

## Root cause

The failing `validCase` generates the `probe` Action as a module-form
`IbexModule`. The authoring path correctly recognizes `handler.ts` as an
admitted TypeScript handler and validates it with the pinned TypeScript parser,
but it preserves that admitted source on `runtime.IbexModule.source`.

The semantic-generation lane then sent every `IbexModule.source` through Acorn
with `sourceType: 'module'`. Acorn only accepts ECMAScript, so it rejected the
first TypeScript-only construct—the `type Result` alias—at line 2, column 5.
This was a canonicalizer coverage mismatch, not an invalid fixture or a
module-versus-script error.

## Source form

The exact legitimate emitted source form was a closed-script TypeScript handler:

```ts
type Result = { ok: boolean };
const initial: Result = { ok: true };
globalThis.__snapbackHandlers = {
  async probe(): Promise<Result> { return initial; },
};
```

The operation facts were:

- operation: `probe`
- kind: `Action`
- handler form: `module`
- runtime kind: `IbexModule`
- authored source: `handler.ts`

## Fix

`canonicalExecutableSource` still parses JavaScript directly with Acorn first.
If that parser rejects the source, the canonicalizer now tries the pinned
TypeScript compiler, refuses any TypeScript error diagnostic, erases
non-executable type/comment syntax, and parses the emitted JavaScript with
Acorn into the same canonical AST representation.

This preserves the evidence-versus-executable split: the raw TypeScript bytes
remain evidence inputs, while its executable meaning canonicalizes identically
to the type-erased JavaScript. It does not catch-and-skip failures; malformed
TypeScript and invalid emitted JavaScript still produce `CODEGEN_WRITE_FAILED`.

The regression test uses the exact `Result`/`initial`/`probe(): Promise<Result>`
form, asserts equality with its emitted JavaScript form, and separately asserts
that malformed TypeScript refuses.

## Verification

All required commands passed:

- `env -u FORCE_COLOR node packages/snapback-codegen/authoring-validation.test.mjs`
- `env -u FORCE_COLOR node packages/snapback-codegen/semantic-generation-golden.test.mjs`
- `env -u FORCE_COLOR node packages/snapback-codegen/semantic-generation-rotation.test.mjs`
- `env -u FORCE_COLOR npm test --workspace @expo/snapback-codegen`
- `./ref-check --verbose`
- `git diff --check`

Complete codegen package-chain result, verbatim tail:

```text
protected query profile tests passed
retainability profile tests passed
dependency-graph.test.mjs: all cases passed
contract-output-mode.test.mjs: all cases passed
contract-binding-reads.test.mjs: all cases passed
receipt-capability.test.mjs: all cases passed
jobs-authoring.test.mjs: all cases passed
sequence-authoring.test.mjs: declaration, v3 identity, and capability checks passed
provider introspection tests passed
operation-schemas.test.mjs: all cases passed
app-descriptor.test.mjs: all cases passed
app-inspection.test.mjs: all cases passed
remote-service-publication.test.mjs: all cases passed
data-tier-corpus.test.mjs: 37 cases verified; builder-parity assertions passed
✔ auth v1 cross-language crypto vectors remain exact (1.571792ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6.198542
codegen review surface: cold cache, tamper, legacy, custody, failure atomicity, and summaries verified
```

## Golden changes

No golden vector changed and no regeneration was needed. The committed semantic
generation vectors and the full rotation matrix passed unchanged; only the new
exact-form regression test was added.
