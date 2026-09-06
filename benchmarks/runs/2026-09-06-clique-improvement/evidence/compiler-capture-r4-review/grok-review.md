CHANGES_REQUIRED

Frozen compiler `6f0c0b4e9de16d49879c631606ae26aa0fc60c72` (source treated as immutable; this review edits nothing under `snapback2/`). Governing constraints: Snapback2 `AGENTS.md`, `rules/RULES.md`, `rules/NOT-DOING.md`, LLP 1001 (Unicode search foundation / independent Q; receipt ⊆ trace ⊆ certificate; engine revalidation does not excuse a wrong program), LLP 1012 indexed held search (captured aliases keep the original principal filter; held descriptors only when discovery matches the source rule). Capture-fix.patch is the e6→current isolate; revision.patch is the full foundation1f9 delta. No sibling reviews, implementation reports, or benchmark run files were read.

The lexical-capture repair is real on the supplied paths: unique IR registers, helper arguments evaluated once, search Q taken from the captured source’s declared bound rather than a later write destination or indexed-column max, and `runPure` actuals for the included café / tuple-shadow / decimal-identifier cases match. It is not done. Use-site conversion is wired only through identifier constants. Spreading a captured row, reading `original.d2` into a Decimal column, inserting a captured object whose fields came from a later-assigned `let`, and sending a helper-captured string to an Id column all miscompile or refuse. Those are new holes in this conversion/capture split, not the disclosed mutable-key freeze.

---

## 1. Method (source review vs execution vs supplied evidence)

**Source review (no execution):** capture-fix.patch; `lower/{lexical-binding,value-conversion,variable-statement,operands,helper-expansion,held-search,search-key,expr,cursor,type-analysis,collection-facts,collection-origins,compiler}.ts`; LLP 1001 §Unicode search foundation; LLP 1012 §Indexed held search.

**Executed in this session (not the engine, not the full 526):**

| Check | Command | Result |
|---|---|---|
| Unicode tables | `bun --no-install` `packages/evaluator/unicode-build.mjs` `generateUnicodeTables()` | wrote `packages/evaluator/dist/unicode-tables.ts` |
| Focused 112 | `bun --no-install /tmp/snapback2-capture-review-runner.ts focused` from `packages/compiler` after unicode gen; registers only `registerQuarrySearchChecks` (includes `registerCaptureValueChecks`) | **112 checks, 112 passed, 0 failed** |
| Independent probes | same runner `probes`; `lowerSource` + `runPure` / `lowerProject` | 40 cases; several new miscompilations below |
| Production tsc | cached `typescript@5.9.2` `tsc -p packages/compiler/tsconfig.json` | no diagnostics in capture/lowering files; remaining errors are evaluator `store.ts` `IndexAtom[]` vs `Value[]` (overlay SHA `591f1e83fc0b0aa4223e290e9958a76c9ca0ab50496983ae1edb56663cb980b` declared **external to this commit**) and missing `react` / `expo-*` host types in this snapshot |
| Focused types | inside the 112: `apiConsumerDiagnostics` on generated search pages (`generated search/ordinary merge API checks as a real imported page`, public string API for text minimum) | passed as part of 112/112 |

`runPure` (`capture-value-checks.ts`) is a statement interpreter over emitted IR. It has no SQLite, certification, normalization, or authority proof. Passing `runPure` is not engine qualification. LLP 1001 still binds: a wrong `WordPrefix.source_max` or unscaled Decimal write is a compiler defect even if a later engine check would refuse or rescale.

**Supplied evidence, not re-executed here** (no Rust build, no full 526, no servers): `evidence/full-comparison.json` after 526 = 343 pass / 183 fail, before 483 = 300 / 183; `addedFailures` [], `removedFailures` [], `priorPassesLost` []; 43 `newPasses` are the new capture-value + held-tuple tests. `evidence/ordinary-output-comparison.json`: five complete fixture outputs identical except ms (`quarry-todos`, `quarry-chat`, `quarry-surface`, `quarry-assets`, `effect-es2020`). Prompt’s ordinary 71 = 35 pass / 36 fail is taken as that same evidence record; this session did not rerun that slice. Coherent engine/runtime qualification remains pending.

No v5 format implementation was reviewed (not in this snapshot).

---

## 2. What the repair does get right (executed + source)

The split is the right shape for the historical counterexamples.

- **Intrinsic vs contextual facts.** `recordType` writes destination types only to `contextualTypes`; `expressionTypes` keeps the source’s own type, and string literals keep `[...text].length` (`type-analysis.ts:212-218`). Rechecking a captured initializer uses a throwaway `facts` map (`type-analysis.ts:248-257`) so a later `insert { wide: original }` cannot republish text≤4000 or 1073741824 onto `'café'`.
- **Executed:** Quarry `original = 'café'` then a false `insert records { wide: original }` then `people[original] by search` emits `{source:'café', Q:4}` (`PROBE OK quarry-false-write-then-search`). Focused tests `literal capture has exact Q4 with 4000|1073741824 target none|before|after` passed.
- **Unique lexical bindings.** `declareBinding` allocates `__nameBindingN` when the spelling is already live (`lexical-binding.ts:5-11`); `temporary()` skips identifiers already in the source file (`syntax.ts:243-258`). Focused: nested block / `map` / `reduce` / argument shadows; generated `__helperArgument0` / `__capturedItem1` / `__nBinding2` do not collide with authored names.
- **Helper call-by-value.** `lowerCallValue` evaluates each actual once into `__helperArgumentN` and stores `substitution.value` (`operands.ts:10-33`). Executed: `pair(ctx.newId())` as a **direct scan key** and as a bound variable both yield `['new-id','new-id']` with the next `newId()` = `new-id-2`. (Source review initially suspected `lowerScan`’s default `lowerExpr` operand would re-expand helpers; the `db.scan` expression itself goes through `lowerValue` → `lowerCallValue`, so the scan-key operand is statement-aware. That suspected hole did not reproduce.)
- **Tuple capture-before-assignment of a mutable scalar is preserved.** `let x='x'; const key=[x]; x=args.term; scan(key)` → returned key `['x']`, prefix `{scalar:'x'}`, `x==='café'` (focused test + same shape as evidence `tuple-mutable-source`).
- **Search Q is the declared source bound, not the indexed column max.** `people.text <=3` with `term: text <=2000` keeps `source_max: 2000` through aliases, `??`, object-field `.text`, `term!`, helper tuples, and words-element U=4N=200 (`quarry-search-checks.ts`, all in the 112).
- **Held tuple/direct viewer aliases.** Focused held-tuple matrix `helper∈{0,1} × viewer∈{0,1}` passed; actual discovery prefix is `viewer-1` or `other-1` as authored, not the inner shadow.

These do not make the compiler collection-complete.

---

## 3. Material defects (new relative to this capture/conversion split)

### M1. Spreading a captured row drops every use-site conversion

**Executed.** Same `const n=2; const original={…, d2:n, d3:n, owner:'id'}`.

`db.insert(records, original)` writes `{d2:200, d3:2000, owner: Id "id"}` and returns `{d2:2, d3:2}`.

`db.insert(records, {...original})` writes `{d2:2, d3:2, owner: Field original.owner}` — unscaled decimals and no Id tag.

IR contrast (executed dump): identifier insert emits `Mul(Field original.d2, 100)` / `Mul(Field original.d3, 1000)` / `Literal {Id:"id"}`. Spread insert emits raw `Field original.d2` / `Field original.d3` / `Field original.owner`.

**Source.** Type analysis of an object with a row target does `this.expression(spread, env)` **without** the column target (`type-analysis.ts:315-318`). `captureConversion` only walks property assignments and shorthands, not spreads (`type-analysis.ts:397-405`). Lowering copies `Field { base: original, name }` (`compiler.ts:744-756`) and never calls `convertAtUse` / `convertCapturedValue` except on identifiers (`expr.ts:366-370`).

Helper-returned objects fail the same way: `db.insert(records, {...row(n)})` wrote unscaled `d2:2, d3:2`. Identifier insert of the same helper object is the focused/evidence path that *does* scale.

This is not engine-excusable: the program commits minor-unit 2 into a scale-2 column.

### M2. Field access of a captured object at a Decimal (or other converted) destination is unscaled

**Executed.**

```ts
const n = 2;
const original = { d2: n, d3: n };
db.insert(records, { narrow:'', wide:'', terms:[], d2: original.d2, d3: original.d3, owner:'id' });
```

Writes `{d2:2, d3:2}` (owner correctly `Id "id"` because that literal sits on the insert object). Returned `original` stays `{d2:2, d3:2}`.

`expressionInner` for property access ignores the Decimal target and returns the field’s own int (`type-analysis.ts:263-287`). No `valueConversions` entry is recorded on the property access node. Lowering emits `Field original.d2` with no `Mul`.

Shorthand `{d2, d3}` at the insert **does** scale (`PROBE OK shorthand-decimal-insert`, writes 200/2000), because those are identifiers at the write site. The conversion plan is identifier-shaped, not destination-shaped.

### M3. Captured object whose fields came from a later-assigned `let` is not converted on insert

**Executed.** Mutable scalar capture-before-assignment works for **tuples**. It does not carry conversion for **objects**:

```ts
let n = 2;
const original = { …, d2: n, d3: n, owner: 'id' };
n = 7;
db.insert(records, original);
return { n, original };
```

IR: `Let n=2`; `Const original={d2: Variable n, …}`; `Assign n=7`; `Insert` uses `Field original.d2` **without** `Mul`. `runPure` result: `n===7`, `original.d2===2` (Const snapshotted 2 — ordinary object semantics preserved), writes `{d2:2,d3:2}` (not 200/2000).

Identifier retargeting only runs when `env.constants` has the name (`type-analysis.ts:244-247`). Assigned `let` bindings are deleted from `constants` (`setBinding`, `type-analysis.ts:1192-1200`). Reanalysis of `original`’s object therefore sees `n` as a plain int, never as a Decimal destination, and records no `{scale}`.

Focused tests only use `const n=2` plus an inner `const n=7` shadow, which unique registers fix without needing this conversion path. That is why 112/112 does not catch M3.

### M4. Helper-captured string at an Id destination refuses; a direct alias converts

**Executed.**

```ts
const x = 'café';
const alias = x;
db.insert(records, { …, owner: alias }); // ok, owner Literal {Id:"café"}
```

```ts
function wrap(x: string) { return x; }
const alias = wrap(x);
db.insert(records, { …, owner: alias }); // E_ARGS_ID_SCALAR "an Id position requires an Id scalar, not string" probe.ts:3:141
```

`captureConversion` walks helper returns (`type-analysis.ts:407-412`), but the parameter’s contextual reanalysis does not produce an Id literal conversion the way a constant string initializer does (`expr.ts:372-378`). In scope: helper evaluation + contextual conversions at write destinations. Direct-alias Id was a repair-value case (`evidence/r6-mutation-results.json` `id-destination`); the helper form is untested there and fails now.

### M5. Search Q for a ternary of two declared bounded strings is refused

**Executed** (with `people.search` in scope):

```ts
db.scan(people.search, [args.flag ? args.term : 'x'], { take: 2 })
```

`E_ARGS_TYPE` `wordPrefixes requires present bounded text with its own declared maximum` at the prefix (`PROBE BUG ternary-search-q`).

`??` of the same arms is special-cased to `Math.max` of string maxima (`type-analysis.ts:497-511`) and **does** compile to Q 2000 (`PROBE OK nullish-search-q`). Conditional expressions use `commonType`, which requires JSON-identical types (`type-analysis.ts:333-337, 1215-1218`). `text<=2000` vs literal Q=1 becomes `unknown`, then `search-key.ts:24-28` refuses.

Both arms have a declared bound. LLP 1001: Q is the source expression’s declared maximum, independent of the indexed field. This syntax is not in the supplied examples. It is not the indexed-column-max bug, but it is the same class of “Q is not the actual declared source bound.”

Quarry has no `?:` (`E_QUARRY_SYNTAX expected "]", got "?"`), so the hole is on the TS lowering path that this repair still owns.

---

## 4. Held authorization provenance (object fields)

**Executed.**

```ts
const pack = { who: ctx.viewer };
const original = pack.who;
if (true) {
  const pack = { who: args.other };
  mergeByIndex([{ rows: db.scan(memberships.byPrincipal, [original], { take: 100 }), lane: … }])
}
```

Actual discovery prefix is `{scalar:"viewer-1"}` (value capture works). `held_search` is **absent**. Direct `const who = ctx.viewer; const original = who` is held (focused tests).

`held-search.ts:21-38` `invariant` accepts Literal, `Input Viewer`, or an args variable. `original = pack.who` lowers to `Field { base: pack, name: "who" }`, not Viewer. `resolve` only follows `identityExpression` / `identityEnvironment` on variables, not object fields. Tuple/helper captures get `capturedShape` / helper-argument identity (`operands.ts:22-24`, `variable-statement.ts:64-66`); object fields do not (`value-conversion.ts:40-43` only temps array elements).

This is fail-closed (no false held descriptor, no wrong-principal held read). It is still incomplete against LLP 1012’s “captured aliases retain their original principal filter” for object-shaped captures, which this task listed. Not a substitute for M1–M4.

Using the inner `pack.who` after shadow correctly scans `other-1` and is not held (`PROBE OK held-viewer-via-object-field`).

---

## 5. Disclosed mutable-key boundary — unchanged, not a new delta

**Executed, matches before and current evidence.**

```ts
const key = ['x'];
key.push('y');
db.scan(people.ordinary, key, { take: 2 });
return { key, page };
```

`runPure`: returned `key` is `['x','y']`; scan prefix is `{scalar:'x'}` only. IR: `Const key=['x']`; `Push y`; `Scan prefix Literal "x"` from `tupleItems` (`operands.ts:58-63`), which `captureTupleValues` froze at declaration (`value-conversion.ts:38-51`). `evidence/before-mutation-results.json` and `evidence/r6-mutation-results.json` `tuple-push` are the same program and the same split.

`key.push(args.term)` remains `E_PROVENANCE_AMBIGUOUS` before and after (`repair-value-comparison.json`). Aliased `key` + `push` remains `E_OPAQUE` unaliased-local-collection.

This is the stated concurrent mutable-key repair on a different source. This review does not treat it as a new delta and does not claim collection-mutation readiness.

Related **new** freeze/conversion defects (M1–M3) are not that ticket.

---

## 6. Historical counterexamples — status

| Historical | This snapshot |
|---|---|
| Later false write changed captured café Q4 → 4000 or refused at 1073741824 | **Fixed.** Executed Quarry false-write Q=4; focused 2×3 literal matrix passed. |
| Tuple/helper captured `x`, later shadowed by café, emitted café / Q1 | **Fixed** on supplied matrix (8 tuple-capture tests + helper aliases). Executed `for-of` shadow still scans `{source:'x', Q:1}` with returned loop `x==='café'`. |
| Ordinary tuple / lexical returns wrong | **Fixed** on supplied tests (`ordinary lexical variables survive…`, tuple alias returns `['x']`). |
| Mutable scalar `let x; const key=[x]; x=…` | **Preserved** (focused + evidence `tuple-mutable-source`). |

---

## 7. Independent syntax that is subset-refuse, not a new capture delta

Executed refusals that look like “not in the S1 subset” rather than a broken capture of an admitted form:

- `row.amounts.push(3)` — `E_OPAQUE` expression statement (nested field is not a collection binding).
- `[...key]` as a scan prefix — `SpreadElement is outside the S1 IR`.
- `` [`${args.term}`] `` / `term + ''` as a search key — no declared max (`builtText`); matches existing `docs[room, term + term]` refusal.
- `args.term && 'x'` as a search key — not bounded text.
- `key.concat(['y'])` — helper `key.concat` not in the builtin set.
- `key[0]` element access — outside S1 IR.
- comma / `void` operators — outside the IR.
- Quarry `people[true ? term : 'x']` — parser, not lowering.

`optional-chain` `pair?.text` as a search key compiled with Q 2000 in this snapshot (admitted, not a defect).

---

## 8. Source notes that are not blockers by themselves

- `convertCapturedValue` throws `Error("captured tuple/object conversion has no … shape")` (`value-conversion.ts:25, 29`) instead of `E_OPAQUE`. Not hit in executed probes; still a crash surface if a conversion is recorded without `capturedShape`.
- `cloneEnvironment` / `enterLexicalScope` share `runtimeBindings` (intentional for unique runtime names).
- `runPure` does not implement `Update`; the update-patch probe’s IR **did** emit `Mul(Field original.d2, 100)` — conversion on identifier `original` as a patch. That path is fine; do not read the `runPure` throw as a compiler fail.
- Full 526’s 183 failures are unchanged old-engine / twin / corpus dependencies (`evidence/full-comparison.json`). They are not this repair’s regressions and they are not a pass.

---

## 9. What would make this READY

Minimum, with executed counterexamples as tests (not only the identifier/shadow matrix):

1. **Destination conversions apply to the value used at the write**, including `{...captured}`, `captured.field`, and `insert(captured)` when fields originated in a `let` that is later assigned. Identifier-only `valueConversions` is not that rule. Spread analysis must pass the row/column target or lowering must apply the captured object’s conversion plan to synthesized `Field`s.
2. **Helper-captured strings at Id (and other contextual) destinations** convert or refuse with the same rule as a direct alias; today direct alias compiles and `wrap(x)` refuses `E_ARGS_ID_SCALAR`.
3. **Search Q for a conditional of two declared bounded texts** is `max(Q_true, Q_false)`, analogous to `??` — or an explicit subset refusal that names “ternary search keys,” not `wordPrefixes requires present bounded text`.
4. Keep unique lexical bindings, helper once-eval, café Q=4 despite later writes, tuple capture-before-assignment, and the disclosed mutable-key freeze **unchanged** (the last is someone else’s source).

Held object-field viewer aliases should either follow `identityExpression` to Viewer (and then `held_search`) or be documented as out of the held-shape set; silent drop of `held_search` with a correct Viewer value is fail-closed but incomplete.

Do not ship this as “systematic immutable lexical capture and fact-provenance correctness” while M1–M4 remain. Engine revalidation of Decimal/Id/Q does not make those programs correct.
