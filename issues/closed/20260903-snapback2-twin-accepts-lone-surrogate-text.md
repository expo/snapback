# snapback2: the TypeScript twin and seed validator accept a lone-surrogate string the server refuses

**Opened:** 2026-09-03 (row-width lane re-review, minor parity gap)
**Area:** `snapback2/packages/evaluator/src/value-runtime.ts` (text validation),
`snapback2/packages/compiler/src/project-seed.ts`

Text values now refuse C0 control characters other than tab, newline, and
carriage return in both runtimes (`fc450e4cc`). One JavaScript-only case
remains: a string containing a lone UTF-16 surrogate passes the twin's and
the seed validator's checks (JavaScript strings admit it) but is refused by
the server at JSON parse time (Rust strings cannot hold it). The predicted
local outcome therefore differs from the committed one for that input.

Fix: refuse a string that is not well-formed (`String.prototype.isWellFormed()`
is available in Bun and Node 20+) at the same validation sites with the same
`E_INPUT` wording, and pin it in the evaluator and seed tests beside the
control-character cases.

## 2026-09-11 triage

**Priority:** P2. **Disposition:** Open, narrowed to seed validation; the twin
half is fixed.

Commit `799ba19a6` routed twin text through `value-runtime.ts::scalarText`,
which calls `unicode.ts::scalarLength` and refuses an unpaired surrogate as
`E_INPUT: invalid Unicode scalar text`. The 2026-09-11 evaluator suite passed;
its recursive admission check in `test-indexed.ts` includes
`{ String: '\uD800' }` and expects that exact refusal.

The seed path remains divergent. `project-seed.ts::seedValueMismatch` still
uses `[...value].length` plus only `disallowedTextControlCodePoint`; neither
rejects a lone surrogate. The 2026-09-11 temporary
`triage-compiler-probe.test.ts` called exported `validateSeedRow` for
`body: { Text: { max: 4 } }` with `"\uD800"` and observed an empty diagnostics
array. The bounded probe passed and was then removed.

Repeat from `snapback2/packages/compiler` at baseline `15c134d056` with Bun
1.3.14 on macOS by placing this temporary Bun test beside `project-seed.ts`
and running `bun test src/triage-compiler-probe.test.ts`:

```ts
const source = "export default {};\n";
const sourceFile = ts.createSourceFile("snapback/seed.ts", source, ts.ScriptTarget.ES2022, true);
const diagnostics: FrontendDiagnostic[] = [];
validateSeedRow(
  { sourceFile, source, fileName: "snapback/seed.ts" }, sourceFile,
  "docs", 0, { id: "doc-1", body: "\uD800" },
  { id: "Id", body: { Text: { max: 4 } } }, diagnostics,
);
expect(diagnostics).toEqual([]);
```

The imports are `typescript`, `validateSeedRow` from `./project-seed`, and
`FrontendDiagnostic` from `./ir`. The empty array is the reproduced defect,
not the desired assertion after a fix.

**Remaining acceptance:** make seed text require well-formed Unicode scalars,
with recursive Optional/List coverage and the same stable seed diagnostic,
and add a seed regression beside the evaluator case. No twin runtime work
remains.

## Resolution — 2026-09-11

**Status:** Closed. Seed text validation now scans UTF-16 explicitly and
refuses either half of an unpaired surrogate as `E_SEED_VALUE` with the stable
`contains invalid Unicode scalar text` message. The same scan counts valid
supplementary characters as one scalar for the declared text maximum.

`seed text rejects unpaired surrogates through optional and list values` pins
the direct Text, Optional<Text>, and List<Text> paths (including the nested
list index in the refusal). Together with the existing evaluator recursive
`E_INPUT: invalid Unicode scalar text` assertion from `799ba19a6`, both
JavaScript admission paths now match the server's scalar-only value domain.
