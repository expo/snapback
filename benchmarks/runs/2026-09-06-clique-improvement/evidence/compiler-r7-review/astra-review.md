CHANGES_REQUIRED

Immutable compiler `aa18e57a084fb2719625cab206dcc38695220d98` has two independently reproduced regressions against `e65f12eda0c51d821cbd7a95fd2392d2caffe1ee`, plus inherited accepted-program failures in representation and operand evaluation. The repair fixes substantial parts of the supplied counterexamples, but does not establish the requested authoring semantics or whole-compiler readiness.

This is a fresh blind review of the supplied archive. I read [Snapback2 instructions](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra/snapback2/AGENTS.md), `rules/RULES.md`, `rules/NOT-DOING.md`, LLP1000, relevant [LLP1001](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra/llp/1001-query-engine.spec.md), [LLP1002](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra/llp/1002-dev-loop.spec.md), [LLP1012](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra/llp/1012-local-first-v1.spec.md), and current Quarry, grammar, live-query, auth and offline guides under `snapback2/packages/snapback2/guide`. I inspected the 64-file foundation delta in `revision.patch`, the 15-file e65 delta in `repair.patch`, and the affected lowering, analysis, descriptor, schema, project, search and authorization paths. No peer review, narrative reviewer report, implementation report, moving worktree or benchmark was used. No product file was changed.

All new sources, project outputs including IR, evaluator contexts, actual values/writes/errors, scripts and deadlines are retained at [astra-evidence-aa18e57](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57). `candidate`, `baseline`, and `foundation` below mean aa18, reconstructed e65, and reconstructed `1f9b4b95c54ba7a5a9d0ece41e9463b29078cfa4` compiler respectively. Attribution is based on executing identical retained sources through those compiler copies with the same evaluator. It is compiler attribution, not a claim that three historical integrated runtimes were reconstructed.

**1. P1 — helper callback bindings overwrite live caller registers; regression from e65.**

[helper-expansion.ts:23](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra/snapback2/packages/compiler/src/lower/helper-expansion.ts:23) correctly separates helper lexical lookup from caller lookup, but empties the maps used by [declareBinding:5](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra/snapback2/packages/compiler/src/lower/lexical-binding.ts:5) to detect name collisions. The caller's IR registers remain live. A callback inside the helper consequently receives the caller's register spelling. Both map and reduce overwrite it.

Complete checked-private project: [schema.ts](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/helper-overwrites-const/snapback/schema.ts), [probe.ts](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/helper-overwrites-const/snapback/probe.ts):

```ts
import {mutation} from 'snapback2';
function values(xs:number[]){return xs.map(x=>x);}
export const probe=mutation({},({ctx})=>{
  const x=7;
  const result=values([3]);
  return {result,x};
});
```

`lowerProject(root, {authoring:'any'})` succeeds. Actual ClientStore result is `{result:[3],x:3}`; expected and e65 result is `{result:[3],x:7}`. Candidate IR declares `x=7` then emits the helper's `For.binding="x"`. The foundation also returns `x:3`: this is a **reintroduced defect relative to e65**, not a claim that the foundation was sound. [Candidate project/IR](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/helper-overwrites-const/candidate.project.json), [candidate result](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/helper-overwrites-const/candidate.result.json), [e65 result](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/helper-overwrites-const/baseline.result.json), [foundation result](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/helper-overwrites-const/foundation.result.json).

Adjacent complete witnesses reproduce this with [reduce](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/helper-overwrites-reduce/snapback/probe.ts), and with a callback named `term` overwriting an operation argument declared `t.text(1)`: input `"x"` becomes returned `"long"`; e65 preserves `"x"`. [Argument result](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/helper-overwrites-arg/candidate.result.json). That also defeats custody of the argument's original value and bound. I have not demonstrated a held-authorization exploit from this collision. Preserve declaration-scope name resolution while allocating runtime binding identities independently of those cleared maps. These are complete checked-private TypeScript witnesses; they do not introduce public Quarry helper syntax.

**2. P1 — public Quarry scalar nullish capture converts a whole-unit fallback twice; inherited from e65, introduced since foundation.**

Complete public project, compiled through default `lowerProject` with no private option: [schema.q](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/join-probes-v2/scalar/snapback/schema.q), [probe.q](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/join-probes-v2/scalar/snapback/probe.q). The schema declares optional `d3: decimal 3`, optional `amounts: [decimal 3] <=20`, public read and allowed insert. The exact operation is:

```quarry
mutation probe(amount: decimal 3 ?):
  captured = amount ?? 2
  insert records {d3: captured}
  return captured
```

For `amount=Null`, candidate and e65 both return IR `Int(2000)` but **write `d3=Int(2000000)`**. Decimal3 representation of the fallback 2 is 2000. Foundation returns and writes 2000. With a present `Int(4321)`, all three return and write 4321. [Candidate actual](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/join-probes-v2/scalar/candidate.result.json), [e65 actual](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/join-probes-v2/scalar/baseline.result.json), [foundation actual](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/join-probes-v2/scalar/foundation.result.json).

The adjacent [fallback `9007199255`](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/join-probes-v2/scalar-overflow-real/snapback/probe.q) compiles successfully but candidate/e65 throw `E_OVERFLOW: 9007199255000000 is outside the i53 value model`. Foundation writes the valid `9007199255000`. This is an observable false refusal as well as a wrong stored value. [Actual overflow](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/join-probes-v2/scalar-overflow-real/candidate.result.json).

At [captureConversion:445](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra/snapback2/packages/compiler/src/type-analysis.ts:445), the structural whole-unit conversion returns before the numeric-literal comparison checks whether contextual analysis already scaled that literal. The selected nullish branch consequently receives another multiplication in the destination conversion. [Candidate IR](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/join-probes-v2/scalar/candidate.project.json) retains both the already-scaled fallback and the later multiply. Conversion must be based on the captured representation actually produced, while preserving original source facts for subsequent uses.

**3. P1 — nullish list joins lose fallback representation through accepted producers; inherited in both e65 and foundation.**

Complete checked-private project: [schema.ts](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/nullish-producer-wrongscale/snapback/schema.ts), [probe.ts](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/nullish-producer-wrongscale/snapback/probe.ts):

```ts
import {mutation,t} from 'snapback2';
import {records} from './schema';
export const probe=mutation({
  values:t.optional(t.list(t.decimal(3),{max:3})),
  wrong:t.list(t.decimal(2),{max:3})
},({args,db})=>{
  const original=args.values??args.wrong;
  const amounts=original.slice(0,3);
  db.insert(records,{id:'record',amounts});
  return original;
});
```

The destination `amounts` is a list of Decimal3. With `values=Null` and `wrong=[Int(321)]`, all three compilers accept and all three actual executions **write `[321]` into Decimal3**. This incompatible Decimal2 source should refuse `E_DECIMAL_SCALE`; silently changing its interpretation is not a conversion policy. [Candidate actual](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/nullish-producer-wrongscale/candidate.result.json), [e65 actual](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/nullish-producer-wrongscale/baseline.result.json), [foundation actual](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/nullish-producer-wrongscale/foundation.result.json).

Replacing the fallback with literal `[2,3]` also compiles, returns original `[2,3]`, and writes `[2,3]` instead of `[2000,3000]`. Independently extended complete projects establish the same failure after `slice(0,3)` followed by identity `map`, `filter`, `flatMap(x=>[x])`, and `map(x=>({v:x})).map(x=>x.v)`, for both fallback origins, on all three compiler versions. Present Decimal3 `[4321]` stays `[4321]`. [Exact matrix sources and per-version IR/results](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/join-probes-v2), [compact observations](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/observations-summary.json).

[The non-string `??` join:615](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra/snapback2/packages/compiler/src/type-analysis.ts:615) returns the left type without joining the right representation; [producer-types.ts:40](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra/snapback2/packages/compiler/src/producer-types.ts:40) then carries that list element type through producers. Destination-specific choice handling can repair direct uses, but the producer path has discarded the alternative. Preserve original representation alternatives across the join and every subsequent producer, or refuse the unproved destination.

Qualification: direct public nullish-list assignment and field controls convert whole-unit lists correctly and refuse incompatible-scale/int list sources. Initial private map/filter/flatMap probes without the bounding slice refuse `E_UNBOUND_LOOP`. The attempted complete-project concat and growing-array reduction variants also refuse, including TypeScript declaration errors. They are retained as refusals, not counted as accepted wrong-value witnesses. This finding establishes the listed checked-private producer paths, not public map/spread syntax.

**4. P2 — accepted collection calls still erase authored operands and change first failure; inherited in e65 and foundation.**

[lowerArrayMethod:787](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra/snapback2/packages/compiler/src/lower/expr.ts:787) handles the callback and, for reduce, initialization, but neither evaluates nor rejects remaining call operands. Complete checked-private [effect witness](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/map-thisarg-effect/snapback/probe.ts):

```ts
import {mutation} from 'snapback2';
export const probe=mutation({},({ctx})=>{
  const items:any=[1,2];
  const result=items.map((n:number)=>n,ctx.newId());
  return {result,next:ctx.newId()};
});
```

All three versions accept and return `{result:[1,2],next:"id-1"}`, proving the authored second argument did not run; its evaluation requires `next:"id-2"`. In the [companion project](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/map-thisarg-first-failure/snapback/probe.ts), `items.map((n:number)=>args.big+1,divmod(1,args.zero))`, with `big=9007199254740991` and `zero=0`, throws **E_OVERFLOW**, whereas evaluating the call arguments before the callback requires **E_DIV_ZERO**. [Actual result](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/map-thisarg-first-failure/candidate.result.json). This does not depend on whether the arrow uses its JavaScript `thisArg`.

Both complete projects intentionally type the receiver `any`; checked-private `lowerProject` accepts them. If this argument form is outside the supported lowering subset, refuse it explicitly. Successful lowering must not silently erase it. Adjacent lowerSource-only `reduce` extra-argument and value-`.require` observations are retained, but this report's complete witness and attribution rest on map. No public Quarry form is claimed.

**5. P2 — a bodyless range declaration now reaches native domain lowering and drops its third operand; regression from e65.**

Complete checked-private [probe.ts](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/range-ignored-third/snapback/probe.ts):

```ts
import {mutation,t,divmod} from 'snapback2';
declare function range(a:number,b:number,c:unknown):number[];
export const probe=mutation({zero:t.int()},({args,ctx})=>{
  for(const n of range(0,1,divmod(1,args.zero))){const value=n;}
  return ctx.newId();
});
```

With `zero=0`, candidate accepts and returns `id-1`; its IR contains the literal range and no division. e65 and foundation both refuse `E_OPAQUE: helper must be a single pure return expression`. [Candidate project/IR](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/range-ignored-third/candidate.project.json), [candidate actual](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/range-ignored-third/candidate.result.json), [e65 refusal](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/witnesses/range-ignored-third/baseline.result.json).

The new [bodyless-helper return:17](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra/snapback2/packages/compiler/src/lower/helper-expansion.ts:17) admits fallback to [range domain lowering:220](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra/snapback2/packages/compiler/src/lower/expr.ts:220), which reads only the first two endpoints and checks no arity. Refusal is a valid resolution; accepting this call while omitting its throwing operand is not. The ambient declaration is part of the complete private witness, not invented public range syntax.

**Coverage and repaired controls.**

The review follows expression ordering through scalar/binary/unary and short-circuit expressions, literals, arrays/objects, fields, spreads, helper argument captures, assignments and joins, collection producers, reductions, scan operands, writes and merge/domain entry paths. Actual observations cover both branches where supplied by the harness, original returned values as well as destination rows, allocations and competing failures. This is systematic path review with bounded witnesses, not an exhaustive proof of every accepted program.

| Path | Actual candidate observations and boundary |
| --- | --- |
| Authored numeric-key order | The retained nested source authors `"10"` before `"2"`. Explicit lookup in that source order yields `id-1`, `id-2`, then `id-3`; the error companion produces E_DIV_ZERO first. No inference from JavaScript key enumeration or JSON ordering. |
| Unicode order | The source authors U+10000 before U+E000. Explicit source-order lookup yields `id-1`, `id-2`; the competing-error case produces E_DIV_ZERO. Canonical scalar ordering and UTF-16 sorting are not used as the oracle. |
| Fields, spreads and immutable sources | Retained aliased/nested/override cases and new reordered/duplicate-key effects exercise values and failure order. Captured-source/list/field controls retain whole values while destination rows receive scaled values; same-scale minor-unit values stay unchanged. |
| Map, concat, slice, flatMap | Without the nullish join in finding 3, whole-unit chains return `[2,3]` and write `[2000,3000]`; nested wrong-scale map/slice/flatMap refuse. Three-segment builtin concat and array spread return `[2,3,4]` and write `[2000,3000,4000]`. The original argument-origin concat continues to refuse E_DECIMAL_SCALE in candidate and e65. |
| Assignment and joins | Scalar/tuple/field branch controls run both branches; mutable mixed-representation assignments retain their refusal. Direct public list fallback/field controls preserve source values and destination conversion. Findings 2–3 delimit the remaining nullish defects. |
| Helper declaration scope | The supplied free-module-variable source now returns its declaration's `2`, rather than the caller shadow's `7`; the no-shadow control also returns `2`. Finding 1 shows that lexical resolution alone does not guarantee runtime binding identity. |
| Requirements and reduction order | Dynamic `db.require` code operands now refuse E_OPAQUE; literal/default controls remain admitted in affected checks. The scan-reduce replay records cursor `after=id-1`, initial/result `id-2`, and next `id-3`. Adjacent before/after ordering, slice competing errors, empty reduction initialization failure, and array receiver checks exercise actual evaluation. Findings 4–5 expose other accepted operands still omitted. |
| Bounds, Q and held descriptors | Dedicated selection passed 32/32 assertions for independent Q through captures/helpers/shadows, held eligibility/scope exclusions, and finite search/words source bounds. These are compiler/descriptor assertions. No integrated held-search authorization execution is claimed. |

[Explicit source-order assertions](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/scripts/verify-observations.py) and [verified observations](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/verified-observations.json) bind these numeric/Unicode checks to retained actual results. Raw original and adjacent probe outputs remain in `original/`, `adjacent/`, and `followup/`. There are 69 original-source observations per candidate/e65 run, 55 adjacent observations per version in the corrected follow-up, 19 public project attempts per version, eight complete private witnesses per version, and sixteen final join project attempts per version. These counts include refusals and setup failures; they are not pass totals. The initial variants remain beside the corrected variants.

Several original raw insert fixtures omit `id` and hit the evaluator's `E_SCHEMA: records row lacks id`; those results are preserved and do not prove destination values. Destination claims above use successful id-bearing controls, complete projects, or the separately identified supplied replay evidence. Quoted numeric/Unicode field, spread and ternary attempts in public Quarry refuse `E_QUARRY_SYNTAX`; their private counterparts do not establish public syntax. The retained concat sources distinguish native builtin `concat(...)` from attempted `.concat(...)` forms; no unsupported public method syntax is inferred from the problem's shorthand.

**Whole-compiler readiness boundary.**

The separately queued descriptor-origin defects supplied with the task remain outside this representation repair: an import-equals alias named `scalar` can bypass the ambient legacy binding guard; local/imported/owner factories named `text` or `int` can acquire native meaning from callee leaf spelling, dropping returned Text constraints or changing the type. These are supplied complete checked-private project witnesses. Public format forms have scoped native proof. I did not reclassify them as public language defects, infer a second authoring profile, or inspect another writer's tree. Their e65/foundation execution attribution in this fresh review is **untested/unknown**. The supplied 288/288 descriptor controls in both versions do not close this known boundary. Even resolving findings 1–5 would not alone justify a whole-compiler READY verdict.

**Commands, custody and qualification.**

Run these from the durable evidence directory. The supervisor records the actual command, deadline, process result, elapsed time and stdout/stderr. Each compiler version uses the same retained sources and candidate evaluator; no program IR is rewritten for execution.

```sh
cd '/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57'
python3 scripts/run.py repro-private-candidate 30 . bun --no-install scripts/witnesses.ts candidate
python3 scripts/run.py repro-private-e65 30 . bun --no-install scripts/witnesses.ts baseline
python3 scripts/run.py repro-private-foundation 30 . bun --no-install scripts/witnesses.ts foundation
python3 scripts/run.py repro-joins-candidate 30 . bun --no-install scripts/join-probes-v2.ts candidate
python3 scripts/run.py repro-joins-e65 30 . bun --no-install scripts/join-probes-v2.ts baseline
python3 scripts/run.py repro-joins-foundation 30 . bun --no-install scripts/join-probes-v2.ts foundation
python3 scripts/summarize.py
python3 scripts/verify-observations.py
python3 scripts/verify-custody.py
```

`witnesses.ts` and `join-probes-v2.ts` preserve full schema/operation sources, source SHA-256, compiler project/IR, execution context, ordinary runtime-schema adapter and raw ClientStore result or error. Their process exit zero means the observation script completed, **not** that the product passed the expected semantics. `verify-observations.py` explicitly verifies the reported defects and source-order controls. Additional runnable scripts retain the original replay, public attempts, adjacent probes, focused checks, selected checks and Unicode preparation.

Reconstruction used private copies and reverse application only: `patch --batch --fuzz=0 -R -p1 -d <baseline> -i <snapshot>/repair.patch`, and separately `patch --batch --fuzz=0 -R -p1 -d <foundation> -i <snapshot>/revision.patch`. Both exit zero. [Final custody](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/final-custody.json) verifies all 2,634 manifested snapshot files unchanged, all 204 candidate compiler files, all 202 e65 compiler files, and every old Git-blob prefix in both patches (15 repair, 64 foundation paths, including absence for added files). The blob verification computes hashes directly; no Git checkout or machine commit search occurred. [Initial custody](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/custody.json) also binds all 295 factual input files and 580 dependency files. The factual manifest identifies the inputs as R6 and explicitly excludes narrative reviews.

The supplied 204-file archive identifier is SHA-256 `b6c2558136bc0888670c8bfce15b348baf97a75fcfe2477cfddf95856bfd0ba8`. Its constituent source bytes match the manifest; the tar container itself is not present in this snapshot, so I did not independently recompute that container hash. An initial custody check that assumed the tar existed failed with FileNotFoundError; its script and [error log](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/custody-v1-missing-archive.log) are retained as a harness assumption failure, not a product defect.

The **actual evaluator `src/types.ts` overlay SHA-256** is independently verified as `afc6bc7ffd25fc007787b10e0fc8bdafbe4ae61cb12f7d2442f2c2df95686618`. This is the file hash, not a directory hash. These executions use the supplied evaluator plus that overlay, with only ordinary schema indexes adapted from `components:[{Column:...}]` to its legacy `columns` shape. The emitted programs remain untouched; this adapter does not implement new search IR. Unicode data was generated only in scratch, with exact input hashes and identical generated artifact hash retained in [generated-custody.json](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/generated-custody.json). No effects, Rust or server build was needed for these witnesses.

| Independent local run | Result at original deadline |
| --- | --- |
| Candidate focused registration | **Timed out at 30.030s**, after 469 logged passes; no final pass total. |
| e65 focused registration | **423/423**, 28.236s, 30s deadline. |
| Candidate affected selection | **173/173**, 19.982s, 30s deadline. This script's predicate selects 173; it is not relabeled as the supplied 174-test selection. |
| Candidate broad search selection | **Timed out at 30.041s**, 168 logged passes; not qualified as a completed suite. |
| Candidate dedicated Q/held selection | **32/32**, 13.109s, 30s deadline. |
| Candidate production compiler types | Passed in 6.958s, 30s deadline; cached TypeScript **5.9.2**, production-only config retained. |
| Complete private witnesses | All three observation runs completed; actual failures/differences reported above. |
| Final join matrix | Candidate 5.248s, e65 3.044s, foundation completed within 30s; accepted results and refusals retained individually. |

Tooling was Bun **1.3.12** with `--no-install` and cached TS5.9.2. [Production config](/Users/ccheever/clique-improvement/reviews/search-compiler-r7/astra-evidence-aa18e57/production.tsconfig.json) excludes checks/test files; it is not full-package typing. Original deadlines were retained, and timeouts were not rerun with extended budgets or renamed passes.

Separately supplied factual evidence reports focused **595/595 versus 423/423**, 172 additions, 288/288 descriptor controls in both versions, production types green, and final original-60s full registration **1009/815 pass/194 fail versus 837/643 pass/194 fail**, with identical failing names and normalized first-line messages. It retains all 183 historical plus 11 shared declaration/setup failures. The earlier 193 versus final 194 discrepancy is F18 declaration availability in **both** versions, not a candidate delta. Eleven complete ordinary/search outputs match except top-level `ms`; 316 producer observations use identical sources, and full original actual-value replays are retained under snapshot `evidence/`. I inspected those factual comparisons and did not repeat the old-dependency full registration merely to decide this verdict.

The supplied independent byte-identical local supervision reports 174 affected passes in 8.445s, production types in 5.606s, values in 12.625s, and a retained 30s full-focused timeout; M5 reports the final 595-pass run at its original 30s deadline. These supplied successes and my local timeouts are distinct observations. None resolves the complete counterexamples above. No Cargo, full Rust, server, benchmark, integrated-runtime or full-package qualification was performed or inferred. Historical runtime/package failures are not final integrated qualification. Attribution for any path not actually run against a reconstructed baseline remains unknown.
