# S2 TypeScript front-end spike report

## Verdict

**FAIL, reportable.** The front end proves the encouraging part of the hypothesis:
ordinary TypeScript can reproduce every S1 program and certificate, and the eight
known-bad first attempts can be refused with usable rewrites. It does not clear the
brief's full gauntlet gate. Of the 27 numbered gauntlet shapes that contain code,
18 lower unchanged or after the compiler's mechanical rewrite (66.7%), below 70%.
Only two of the three mechanical rewrites are literally one-line edits, so the
strict one-line reading is 17/27 (63.0%). There are also genuine language/IR gaps:
S1 has a scalar write key and cannot faithfully encode the composite-key callback
upserts used by two gauntlet shapes, and a few accepted gauntlet helpers need
name-specific compiler knowledge.

The narrower population of actual data-program snippets is 16/21 (76.2%), but that
is not the denominator stated by the brief and is not used to claim PASS.

## What was built

`frontend-ts` uses the TypeScript 5.9 compiler API under Bun. It parses and
type-checks each input against the shipped `noLib` environment, lowers every
exported `query` or `mutation` into S1 JSON, and invokes the real Rust `Checker`
through the added `cargo run --bin check` adapter. The adapter has two schema modes:
the original spike schema for certificate-equality tests and a synthetic public
schema for gauntlet snippets whose complete schemas were not included in the
reviews. Admission rules were not reimplemented in TypeScript.

The custom library omits `Date`, `Math.random`, `fetch`, `setTimeout`, and `eval`.
An AST policy pass refuses `while`, ambient time, recursion, `async`/`await`, and
other unsupported syntax before lowering. Every front-end refusal has a family,
source span, message, and full rewritten source.

The lowerer covers bounded scans and point reads, writes, conditions, bounded
loops, range loops, bounded traversal, object/array shaping, optional access and
nullish coalescing, stable field sorts, expression callbacks for `map`, `flatMap`,
`filter`, `reduce`, and `some`, module-local pure expression helpers, and basic
bounded `Map`/`Set` use. Scalar-key update/upsert callbacks lower to an explicit
point read followed by the corresponding S1 write flow, so their callback row is
not an unbound runtime variable.

## S1 equality and first attempts

All **17/17** S1 programs were re-authored in one ordinary TypeScript module.
For every program:

- canonical lowered JSON is identical to the hand-authored corpus `Program`;
- the candidate and corpus programs both pass the Rust checker; and
- canonical certificate JSON is identical (**17/17 certificates**).

All **8/8** required first attempts refuse with the expected family. Each
diagnostic has a non-empty exact span; applying its supplied rewrite verbatim
produces TypeScript that lowers and passes the Rust checker under the fixture
schema.

The diagnostic catalogue actually exercised by those fixtures plus the bound
fixture is:

| Family | Emissions | Exercised case / rewrite |
| --- | ---: | --- |
| `E_UNBOUND_SCAN` | 2 | direct and helper-wrapped scans; add `take: 50` |
| `E_UNBOUND_LOOP` | 1 | `body.split(" ")` feeding reads; use bounded `mentionTokens(body)` |
| `E_UNBOUND_COUNT` | 1 | count over an unbounded scan; bound the scan and use `countCapped()` |
| `E_STRUCTURAL_COUNT` | 2 | owner-only loop tally and hidden-rule rank; read the maintained aggregate |
| `E_AMBIENT_TIME` | 1 | `Date.now()`; bind `ctx` and use `ctx.now()` |
| `E_OPAQUE` | 1 | bounded-looking `while`; rewrite as `for` over `range(0, N)` |
| `E_BOUND` | 1 | excessive nested population product; reduce the largest literal `take` |

Three additional admitted-surface programs exercise bounded `Map`/`Set`, callback
update, and scalar-key callback upsert; all three lower and certify.

## Gauntlet

The evaluator extracted all fifteen numbered shapes from each r3 review and used
their TypeScript blocks without source edits on the first attempt. Three Fable
shapes contain prose but no TypeScript, leaving 27 code-bearing shapes.

| Outcome | All 30 numbered shapes | 27 code-bearing shapes |
| --- | ---: | ---: |
| Unchanged | 15 | 15 |
| Mechanical rewrite | 3 | 3 |
| Refused | 12 | 9 |
| Unchanged or mechanical | 18 | 18 (66.7%) |

The mechanical cases are one `E_BOUND` literal reduction, one malformed
`schema (generation N+1):` label normalization, and one `Date.now()` conversion.
The clock conversion is conceptually mechanical but changes both the handler
binding and call site, so it is not counted under the stricter one-line result.

Among the 21 shapes that actually contain an exported data program, 13 lower
unchanged, three mechanically, and five refuse. The five refusals are the two
asset-service seams, `intersectById`, and two composite-identity write shapes.
The other four code-bearing refusals are three client-side async examples and a
time-dependent rule. Treating those as outside this front end explains the 76.2%
secondary number but does not change the brief's result.

## Widening and narrowing relative to LLP 0329.014.000 §4.1

No S1 IR variants were added. A few ordinary TypeScript conveniences used by the
gauntlet were admitted and desugared: optional chaining, `??`, spreads, ternary
expressions, expression-bodied handlers, and library forms such as `top`,
`mergeByTime`, and `orderedPair`. Schema/rule declarations are type-checked but
left to their own compiler; a module containing only those declarations emits no
data program.

The spike narrows the proposed subset in these places:

- S1 write statements have one scalar key. Composite-identity `update`/`upsert`
  cannot be made executable without extending the IR/schema identity model or
  guessing field names, so the front end refuses them instead of emitting an IR
  that merely passes static checking and fails in the interpreter.
- `Map`/`Set` are lowered to bounded S1 arrays and loops for constructors,
  `get`/`has`/`set`/`add`/`size`. Map initializers must be literal pairs, and
  general Map/Set iteration or returning their native collection identity is not
  implemented. This avoids adding collection-specific IR operations but is less
  than §4.1's unqualified `Map`/`Set` admission.
- Destructuring is limited to operation-context binding and the `orderedPair`
  idiom. Array-method callbacks and inlined pure helpers must have a single
  expression body. General recursive helpers remain refused.
- Arithmetic is the S1 set (`+`, `-`, `*`, comparisons, and the explicit
  deterministic `divmod` form), not every JavaScript arithmetic operator.

The gauntlet ambient declarations also expose an operation-specific hazard.
`memberOf` and normalization/library names that have no module-local body need
compiler recognizers to lower. That is acceptable as a future versioned standard
library, but in this spike it is exactly the kind of operation-specific rule the
FAIL clause warns about. `db.consumeAssetGrant`, `db.media.issueDelivery`, and
`intersectById` are refused rather than assigned invented semantics.

## Hazard answer

The ordinary-TypeScript hazard is **real but bounded**. The strongest evidence is
positive: 17/17 independently re-authored programs produce structurally identical
IR and certificates, and 8/8 realistic mistakes receive rewrites that
actually compile and certify. For data-program-shaped gauntlet inputs, 76.2% are
accepted unchanged or mechanically.

The negative evidence prevents a v0.1 claim: the prescribed all-code gauntlet is
66.7% (or 63.0% under literal one-line accounting), composite identities do not
fit S1 writes, and several attractive library calls need a specified standard
library rather than ad hoc recognizers. The likely next move is small and
concrete: give write keys/index identity an explicit IR representation, specify
the pure collection/merge/intersection library, and rerun the exact same corpus.

## Verification

Run from `spikes/bounded-programs/frontend-ts/`:

```sh
bun run check
bun run test
```

The final front-end run reported 17 S1 programs, 17 identical certificates,
8 lowering rewrites, three extra subset-surface programs, all seven diagnostic
families, and gauntlet counts `15 unchanged / 3 mechanical / 12 refused`.

Run from `spikes/bounded-programs/`:

```sh
cargo test
```

The Rust suite passes: **7 passed, 0 failed**.
