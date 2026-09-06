CHANGES_REQUIRED

Fresh blind review of the supplied frozen compiler `6f0c0b4e9de16d49879c631606ae26aa0fc60c72`. Four capture-repair blockers remain: reordered evaluation, an uncaught nested-list conversion error, lost destination conversions, and a helper binding lost through a merge callback. These are distinct from the explicitly disclosed, unchanged mutable-key defect.

I read the governing Snapback2 command sheet, RULES/NOT-DOING, LLP 1000, LLP 1001/1012, and LLP 1002's relevant value/provenance/operand-order requirements; inspected the supplied patches and compiler source; and executed the checks below. I did not consult other reviewers, prior review reports, implementation reports, benchmark files, or sibling review directories. Historical references embedded in the required governing specs were not followed to other reports.

The export has no Git metadata. All 49 postimage blob hashes in `revision.patch` match the supplied files. All 16 entries in `capture-fix.patch` match their current postimages and their e6 preimages reconstructed by reversing that patch in scratch. The tested current compiler copy is byte-identical to the supplied compiler. All 930 supplied files under `snapback2/` remain unchanged. [Integrity results](/Users/ccheever/clique-improvement/reviews/search-compiler-r4/astra/review-work/integrity-results.json).

**1. [P1] Capturing tuple elements and helper arguments reorders earlier operands.**

At [value-conversion.ts:38](/Users/ccheever/clique-improvement/reviews/search-compiler-r4/astra/snapback2/packages/compiler/src/lower/value-conversion.ts:38), `captureTupleValues` moves tuple descendants into preceding statements while leaving non-tuple siblings unevaluated. This supported Quarry program is sufficient:

```q
mutation probe():
  value = {a: new, b: [new]}
  return value
```

With IDs supplied in order `id-1`, `id-2`, the correct result is `{a: id-1, b: [id-2]}`. e6 produces that result. Current produces `{a: id-2, b: [id-1]}`. Its IR first evaluates `__capturedItem0 = NewId`, then constructs the object with a fresh `NewId` for `a` and the already captured ID for `b`.

The new helper argument statements expose the same ordering gap at [operands.ts:16](/Users/ccheever/clique-improvement/reviews/search-compiler-r4/astra/snapback2/packages/compiler/src/lower/operands.ts:16) and [compiler.ts:795](/Users/ccheever/clique-improvement/reviews/search-compiler-r4/astra/snapback2/packages/compiler/src/compiler.ts:795):

```ts
function ident(x: any) { return x; }
// Inside a mutation:
const values = [ctx.newId(), ident(ctx.newId())];
return values;
```

e6 returns `[id-1, id-2]`; current returns `[id-2, id-1]`. Object fields and a directly returned array also reproduce it. A scan prefix followed by `after: ident(ctx.newId())` has the later cursor argument materialized before the earlier prefix input; the prefix recorder changes from the first ID to the second. The cursor's full behavior was inspected in IR, not exercised against storage.

**Execution:** the Quarry example passed project lowering in both versions and was executed with the supplied pure-IR recorder. Three ordinary programs—the nested tuple, helper array, and helper object—were also executed through the actual TypeScript `ClientStore.applyMutation`; all three independently confirm the changed ID allocation. This was evaluator execution with a supplied ID envelope and no certificate, not Rust execution or search qualification. [Quarry results](/Users/ccheever/clique-improvement/reviews/search-compiler-r4/astra/review-work/quarry-probe-results.json), [evaluator results](/Users/ccheever/clique-improvement/reviews/search-compiler-r4/astra/review-work/evaluator-probe-results.json), [operand probes](/Users/ccheever/clique-improvement/reviews/search-compiler-r4/astra/review-work/probe-results.json).

The repair must sequence evaluation across the entire containing expression, including earlier siblings, before expanding captures. Materializing each helper argument once is necessary but insufficient. Preserve capture-before-assignment support while correcting this ordering.

**2. [P1] An immutable list captured through an object field crashes destination conversion.**

At [value-conversion.ts:23](/Users/ccheever/clique-improvement/reviews/search-compiler-r4/astra/snapback2/packages/compiler/src/lower/value-conversion.ts:23), tuple conversion accepts only an immediate `Array` shape. Recursive object conversion passes the field's stored expression as its shape at line 33, which can be a `Variable` referring to an already captured array.

With `records.amounts: [decimal 3] <=4`, this admitted lowering-source body now throws:

```ts
const n = 2;
const amounts = [n, 3];
const row = { amounts };
db.insert(records, row);
return { row, amounts };
```

Actual current result: uncaught `Error: captured tuple conversion has no evaluated components`, rather than an IR program or a typed refusal. `const row = {amounts: ident([n, 3])}` produces the same error. Both sources compile on e6. e6's first example writes `[2000,3000]` but incorrectly also scales the returned capture; the new regression is the compiler crash, not a claim that all e6 semantics were correct.

**Execution:** both versions were invoked through `lowerSource` with declared table metadata; current throws during compilation. The complete inputs and results are `list-alias-decimal` and `helper-in-array-decimal` in [probe results](/Users/ccheever/clique-improvement/reviews/search-compiler-r4/astra/review-work/probe-results.json). These are TypeScript lowering-surface probes, not claims that Quarry accepts `insert records row`.

Nested captured shapes must survive aliases and helper returns, and conversion must use the evaluated field value. Replaying the original initializer would reintroduce the value-capture defect this repair addresses.

**3. [P1] Conditional/coalesced object captures lose their write-destination scaling.**

[type-analysis.ts:373](/Users/ccheever/clique-improvement/reviews/search-compiler-r4/astra/snapback2/packages/compiler/src/type-analysis.ts:373) derives capture conversions by syntax, but has no structural conversion case for conditional or nullish object results. It falls through at line 413 after the destination recheck has been isolated from the source facts. Consequently, preserving the original value also removes the required write conversion.

With a `decimal 2` column `d2`, both examples compile successfully:

```ts
const row = true ? {d2: 2} : {d2: 3};
db.insert(records, row);
return row;
```

```ts
const empty = null;
const row = empty ?? {d2: 2};
db.insert(records, row);
return row;
```

For each, e6 emits a write of `{d2:200}`; current emits `{d2:2}`. Current correctly retains the ordinary return `{d2:2}`, while e6 incorrectly returned `{d2:200}`. The required combined behavior is an unchanged ordinary capture and a write of 200 minor units. Current instead changes the stored amount from 2.00 to 0.02. The emitted integer is a valid Decimal wire value; runtime validation cannot infer and restore the lost source-unit conversion.

**Execution:** `conditional-single-decimal` and `coalesce-single-decimal` were compiled on both versions and executed with the pure-IR write recorder. The two-column variants also demonstrate missing conversions to distinct scales. [Results](/Users/ccheever/clique-improvement/reviews/search-compiler-r4/astra/review-work/probe-results.json). These are lowering-surface executions, not database writes. Carry the evaluated structural shape and conversion through both conditional and coalesced captures; do not restore shared contextual mutation of the initializer.

**4. [P1] A merge callback deletes its enclosing helper's captured parameter.**

[merge.ts:32](/Users/ccheever/clique-improvement/reviews/search-compiler-r4/astra/snapback2/packages/compiler/src/lower/merge.ts:32) clones `variables` but shares `substitutions`. Its new call to `declareBinding` executes [lexical-binding.ts:10](/Users/ccheever/clique-improvement/reviews/search-compiler-r4/astra/snapback2/packages/compiler/src/lower/lexical-binding.ts:10), deleting the parameter's substitution from the enclosing helper environment too.

The independently constructed `helper-merge-shadow-independent` case uses this helper, invoked as `outer(args.term)` with `term = 'café'`:

```ts
function outer(m: string) {
  return {
    page: mergeByIndex([{
      rows: db.scan(memberships.discovery, [ctx.viewer], {take: 3}),
      lane: (m: any) => db.scan(
        docs.search, ['room-1', args.term], {take: 2}
      )
    }], 2, 'page'),
    captured: m
  };
}
```

The callback parameter is intentionally unused, so e6's separate callback-shadow problem does not confound this comparison. Both versions compile. With one supplied membership row `{room:'room-1', principal:'viewer-1'}`, e6 returns `captured: 'café'`; current returns that membership **row** as `captured`. Current lowers the final reference to runtime variable `m` after discarding its helper substitution. The discovery row subsequently occupies that register.

**Execution:** both IR programs were executed by the pure-IR recorder with the same supplied rows. Their recorded scan values remain viewer/room/`café` with Q2000, and neither receives a held descriptor; the independently new defect is the escaped lexical binding and changed return value. [Complete schema, source, IR, and results](/Users/ccheever/clique-improvement/reviews/search-compiler-r4/astra/review-work/held-probe-results.json).

Callback scopes must isolate substitutions as well as variable bindings. Keep the enclosing helper's already evaluated parameter available after lowering a same-name callback.

**What passed, and what remains outside this verdict.**

The source now separates intrinsic expression facts from contextual facts and captures declaration environments. Search Q is taken from the actual key-source expression through `keySource`/`expressionType`, not the indexed field maximum. The supplied 112 focused checks all passed here, including the historical literal-Q, tuple/helper actual-value, ordinary lexical-return, conversion, and held-provenance cases.

An additional independent 20-case matrix checked actual returned captures and emitted `(source,Q)` together: composed `café` (Q4), decomposed `café` (Q5), an astral scalar (Q1), declared Q2000 arguments, optional fallback, object selection/spread, helper values, same-name shadows, and later false writes into a `1073741824`-wide destination. All 20 passed, despite the indexed text maximum being 3. [Matrix results](/Users/ccheever/clique-improvement/reviews/search-compiler-r4/astra/review-work/q-probe-results.json).

Independent held probes confirmed that a captured helper-derived viewer remains viewer-authorized and eligible, while a captured other-principal argument remains ineligible despite a later viewer shadow. Object-member and coalesced-other-principal captures retain their actual values without acquiring a held descriptor. The viewer-object form also remains conservatively ineligible on both versions. These observations do not qualify authority enforcement in an integrated held-search runtime.

The supported mutable scalar case `let x='x'; const key=[x]; x=args.term` retains `key=['x']` and scans `x` on current. Conversely, the disclosed `const key=['x']; key.push('y')` still returns `['x','y']` while scanning only `x`, identically on reconstructed e6 and current. It is an unchanged, explicitly separate mutable-key boundary, **not a newly discovered delta or an additional blocker attributed to this repair**. The probes also observed unchanged limitations in object/list spread destination conversions and nested object tuple-key expansion; I have not promoted them into new-delta findings.

The supplied factual comparisons record full-suite `483 = 300 pass / 183 fail` before and `526 = 343 pass / 183 fail` after, with zero added/removed failures or lost prior passes; five complete ordinary outputs match except timing. The user also supplied the unchanged ordinary71 result, 35 pass/36 fail. I inspected the supplied comparison JSON; I did **not** rerun the full suite, ordinary71, or those five complete-output comparisons. Their unchanged dependency failures are not new compiler regressions. No v5-format implementation or universal compiler/collection readiness is claimed here.

**Exact executed checks.**

All commands below ran from `/Users/ccheever/clique-improvement/reviews/search-compiler-r4/astra`. Scratch scripts and their JSON outputs are retained under `review-work/`; none is a product gate. The current compiler/evaluator copies contain unchanged source, with generated Unicode build output provided only in scratch. The e6 compiler was reconstructed with:

```sh
patch -R -p1 -d review-work/e6 < capture-fix.patch > review-work/reverse-patch.log
```

Unicode tables were generated from the supplied pinned inputs using an unchanged copy of the existing generator:

```sh
node --input-type=module -e 'import {generateUnicodeTables} from "./review-work/unicode/packages/evaluator/unicode-build.mjs"; generateUnicodeTables();'
```

The executed test/check entry points were:

```sh
NODE_PATH="$PWD/review-work/node_modules" bun --no-install review-work/focused.ts
NODE_PATH="$PWD/review-work/node_modules" bun --no-install review-work/probes.ts > review-work/probes.log
NODE_PATH="$PWD/review-work/node_modules" bun --no-install review-work/quarry-probes.ts > review-work/quarry-probes.log
NODE_PATH="$PWD/review-work/node_modules" bun --no-install review-work/evaluator-probes.ts
NODE_PATH="$PWD/review-work/node_modules" bun --no-install review-work/held-probes.ts > review-work/held-probes.log
NODE_PATH="$PWD/review-work/node_modules" bun --no-install review-work/q-probes.ts
NODE_PATH="$PWD/review-work/node_modules" bun --no-install review-work/typechecks.ts > review-work/typechecks.log
python3 review-work/integrity.py
```

Results: 112/112 focused checks; 20/20 independent Q/value checks; 23 two-version lowering probes; 8 two-version held/merge probes; 3 two-version Quarry probes; and 3 two-version actual evaluator probes. The exploratory probes intentionally include failing and unchanged cases; those counts are **not** passing-suite claims. The pure recorder executes values and records scan operands/writes using supplied rows; it does not perform storage, normalization, cursor validation, certification, or authorization.

Cached TypeScript **5.9.2**, Bun **1.3.12**, cached `@types/node` **26.4.0**, and cached esbuild **0.25.9** were used, without installation. `typechecks.ts` ran strict/noEmit ES2022/Bundler checks with skipLibCheck over production roots `compiler.ts`, `project.ts`, `worker.ts`, `bun.d.ts`, then focused roots `quarry-search-checks.ts`, `bun.d.ts`, following their dependencies. Both produced zero diagnostics. [Typecheck results](/Users/ccheever/clique-improvement/reviews/search-compiler-r4/astra/review-work/typecheck-results.json). The evaluator types file matches the explicitly external overlay SHA256 `3591f1e83fc0b0aa4223e290e9958a76c9ca0ab50496983ae1edb56663cb980b`; these checks do not establish a clean-commit build without that dependency.

Setup failures were resolved before the reported runs: initial direct imports lacked generated Unicode tables; a preload redirection attempt did not resolve all imports; and the first typecheck lacked an explicit Node type root. The initial type diagnostics are retained separately. Three initial Quarry spellings were rejected (`insert records row` and `newId()` are not Quarry syntax); corrected spellings and their distinct outcomes are retained in the final Quarry results, with the initial refusals preserved separately.

No Rust build, server, benchmark, full primary-host gate suite, or coherent engine/held-runtime qualification was run. Compiler miscompilations above remain blockers regardless of eventual engine revalidation. Qualification pending under LLP 1001/1012 remains a separate obligation after this scoped compiler repair is correct.
