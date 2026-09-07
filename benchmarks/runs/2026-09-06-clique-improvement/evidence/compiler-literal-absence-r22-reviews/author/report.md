# R22 — literal absence retains no fictitious present representation

Frozen compiler commit **d3e497acdfd2cbaecbf7c6cb8f7350cb8e63580d**, directly atop R21 **c73805f6affb01530c7d903c8e22e8a90f49fe48**. The exact public `[2,null]` regression is repaired. Both literal orders now execute the narrowed loop with unchanged source values, complete rows and ID order. This is a compiler checkpoint; it is not native/runtime/package clearance or permission to land the standalone compiler on main.

Same sole author: native gpt-6-astra/xhigh, UUID `01a078aa-b57c-7b33-ac65-6b67d2f302eb`, actual launch tool57914 / native PID29351 (`launch-identity.json`). R21 actual tool33616 exit0/chunkf86ad9 and explicit release were read before source edits. Root owns final review, integration and publication. No other writer/reviewer was launched; no later live review material was accessed. The inherited effectful `box.original` task remains queued after this released stage.

## Orientation, authorization and original custody

`orientation.md` records use of llp-orient, the Snapback2 fence/AGENTS, rules and NOT-DOING, LLP1000, the relevant LLP1002 authored/capture/numeric/provenance/operand and diagnostic sections, LLP1011 presence narrowing and LLP1017 complete-fanout rule, and the actual packaged Quarry/grammar guide. This repair changes internal facts, not public grammar or native proof policy.

Both complete **closed** R20 reports were consumed at R21 closure, with actual read/hash/terminal verification retained there. Their exact fixtures and full source/schema/IR/API/value/refusal records were inspected again for R22. `original-verification.json` binds this reused full consumption and independently rechecks both report and terminal identities. Astra's18,534-byte report SHA `9a03410e155a0edf6d6219abcb6ad225317aa9a63e031d4f454f88d3d3229019`, actual46712 exit0/chunk094f06, is **CHANGES_REQUIRED** for the introduced P2. Grok's21,332-byte report SHA `6ff9f6c242251c451c62c6b4a54057fd8d4e3cbf413eef23fe0d956de31f14fd`, completed continuation42910 exit0/chunkaf3a60, is scopedREADY and did not exercise this narrowed literal-null case. Its earlier58773 exit0 without a verdict remains a distinct incomplete run. Original report/duration/terminal corrections were not rewritten.

The original packet remains under `../compiler-diagnostic-dx-r21/r20-closed-reviews/astra/evidence/`. R22 copied190 immutable leaves from its `parent`/`candidate` `null-rows`, `nullable-literals`, and `fixed` groups into `originals/`; `originals-manifest.json` records exact source paths, bytes and hashes. Every copied leaf still equals its original. No reviewer snapshot was edited. Historical review `parent` means **dbfe6f559f173406392a518918b697153efa3c9a**; review `candidate` means **4dd55df98e20a3e8037a6f3f5f5ba9337a4c06be**. The actual R22 parent is **c738**, not either renamed historical tree.

`workload-request.json` and `pre-dispatch-binding.json` were written before dispatch. Semantic execution waited for the explicit supervisor-inbox admission of the exact private source/tool request: four parent shards, up to12 adjacent shards, eight selected callback processes and two type closures, original30-second children/45-second transport. Admission recorded shared scale/Unicode workload; no quiet-host assumption was made.

## Exact defect and before/after

Schema and full original source are retained in `originals/parent/null-rows/null-last-full-row/snapback/`. The schema declares `records.length: int`, `label: text <=20`, `payload: json <=1000`, public reads and allowed inserts.

```q
mutation probe():
  original = [2,null]
  for value in original:
    if value != null:
      require value > 1 else LOW
      insert records {length: value, label: 'chosen', payload: {keep: 'row', original}}
  return {original, next: new}
```

Historical dbfe accepted. Historical4dd and freshly executed c738 refuse **E_QUARRY_TYPE**, `selected alternatives do not prove one numeric representation or nominal type`, at `snapback/probe.q:5:21`, before program IR/API. R22's first source-bound parent process was `parent-originals`, PID3934920, exit0/0.615427151s: exit0 records observations including these refusals, not seven passing compilations. Full refusal and generated frontend results are in `remote-complete/projects/base/originals/null-last-full-row/`.

The compiler had assigned literal null the metadata `text <=1 ?`. R20's all-element join correctly retained every present alternative, but this fictitious text branch then survived `if value != null`. A real int list became a purported int/text alternative. Dropping all mismatches or reverting all-element joins would conceal genuine incompatible numeric/nominal alternatives.

The candidate produces the full result and row:

```json
{
  "result": {"original": [2, null], "next": "id-2"},
  "writes": [{
    "table": "records", "id": "id-1",
    "row": {"id": "id-1", "length": 2, "label": "chosen",
            "payload": {"keep": "row", "original": [2, null]}}
  }]
}
```

The complete actual IR-tagged evaluator result, trace, full row and API/ProjectJson are in `remote-complete/projects/draft1/originals/null-last-full-row/`. `verify-behavior.ts` compares **the entire successful lowerProject response except ms, and the entire evaluator observation**, against dbfe's retained exact result. They match, including the30-step trace, not just selected numeric fields. The generated return type is `{ original: (number | null)[]; next: string; }`. A TypeScript consumer accepts null-bearing arrays and rejects assignment to `number[]`.

The reverse `[null,2]` public narrowed source now succeeds, retaining its authored order. Its old dbfe refusal (`E_QUARRY_UNKNOWN`, nominal text versus int) was **inherited**, whereas the `[2,null]` regression was introduced in R20. c738 has the R20 `E_QUARRY_TYPE` refusal for both. The reverse full-row companion stores length2 with payload `[null,2]` and returns nextid2. No old reverse-order execution is fabricated.

`[maybe,2]`, `maybe: int ?`, remains accepted on both c738 and the candidate: Null writes one full length2 row then nextid2; Int3 writes length3 and length2 rows, preserving `[3,2]` in both payloads, then nextid3. Its full candidate output and evaluator observation match historical dbfe exactly. Private fixed-key `[null,2]` and `[2,null]` remain distinct controls: source keys retain2, while Decimal3 lookup keys are `[Null,Int(2000)]` and `[Int(2000),Null]`, provenanceConst, site`probe.probe.1`, full stored/read rows preserved. Both complete current-parent/candidate outputs also match retained R20 candidate controls.

## Implementation and persistent controls

Six committed files (`commit.json`, `combined.patch`):

- `quarry/value-type.ts`: a compiler-internal `null` fact represents absence without a present type. Shared joining separates outer presence from present alternatives before joining, preserving nullable wrappers when flattening. Recursive collection/object joining keeps maxima, fields, real units and nominal targets. All-null input remains null; an empty set of element facts remains unknown. Numeric literal metadata can retain optionality; a nullable page retains its bounded collection representation. Unknown facts remain unknown.
- `quarry/program.ts`: null literals produce that fact rather than optional text. Generated expression text and authored evaluation order are unchanged. An absence-only captured left operand selects the fallback's type through the existing coalescing path.
- `quarry/narrowing.ts`: then-branch narrowing uses the same nonnullable operation as joins, on the cloned binding identity. It removes absence while retaining every real present alternative. It adds no conjunction/else narrowing or new object-field grammar.
- `literal-absence-cases.ts` and the existing `insert-provenance-checks.ts` registration:20 persistent complete-project value/refusal cases, including full returned/stored rows. No new test gate, harness registry, package configuration or public profile.
- LLP1002 §2 clarifies that literal absence supplies no present numeric/member/nominal authority and adds no optional-element declaration syntax.

All44 selected callbacks passed:20 new controls and24 existing affected controls, in eight serial child processes. The new set covers both exact full-row orders, captured null, declared optional-int, nested lists, object-member joins, absent objects, all-null count, captured null fallback allocation, lazy/present-empty bypass, eager earlier failure/capture, first requirement before later division, full Divmod objects, Decimal source units/comparison, mixed Decimal/whole/currency refusals, real text alternatives, missing presence and foreign targets. Full rows are compared with the existing evaluator-backed test helper; no quotient-only or success-only assertion substitutes for row/value checks.

Existing selected controls cover R20 page count, truthful mixed/same-scale API results, nominal fallback refusal, nested maxima3/5/7, nested length/capture, lazy/eager allocations, optional mixed result absence, currency mismatch, six count/length comparison companions, ordinary public inserted snapshot/read, both nullable private fixed-key orders and helper operand ordering, and four R21 diagnostic/artifact-refusal/corrected-source controls. These are44 specific callback invocations, not a full registration or historical825/1009 result. `callback-ledger.json` lists the exact names and actual outcomes.

## Adjacent observations and preserved limits

There are30 exact public/private parent/candidate source/schema pairs: parent5 accepted/25 refused; candidate18 accepted/12 refused. These are60 compiler observations, **not60 passes**. The expected value/refusal assertions and separate complete-response comparisons are recorded independently. `source-value-comparison.json` binds every source hash, full output hash, diagnostics and actual execution result/error; `remote-complete/behavior-comparison.json` binds cross-version equality and consumer/bound checks.

- Nested `[[2,null],[null,3]]` keeps outer/inner maxima2, writes complete length2/length3 rows with the unchanged nested original in payloads, and returns nextid3. Joined object fields `{value:2}`/`{value:null}` and an absent object `[null,{value:2}]` preserve full captured objects and nextid2.
- `[divmod(5,2),null]` retains `{quotient:2,remainder:1,sink:"lexicographic-id"}` in the complete returned and stored objects. It inserts once and returns nextid2.
- `values ?? [divmod(2,zero).quotient,null]` is lazy: absent/zero1 yields `[2,null]`; present-empty/zero0 yields `[]`; absent/zero0 throws `E_DIV_ZERO`. The retained loop maxima are2 and3, not a truncation of the declared3. Persistent coverage also verifies a provided nonempty list skips the division.
- An earlier `divmod(1,zero)` throws first even with present-empty or absent list selection. With zero1 its entire Divmod object is returned unchanged. A narrowed `[0,null]` requirement fails with `E_REQUIRE` before later division by zero.
- `[null,value]` for Decimal3 preserves4321 in source/return/storage and refuses selected500 at the authored `>1` requirement. Its generated type is `(Decimal<3> | null)[]`; consumer checks preserve Null. Actual mixed Decimal3/Decimal2, Decimal3/int and USD/EUR alternatives still refuse `E_QUARRY_TYPE`, rather than comparing raw minor units as whole units.
- An actual text member in `[2,null,'bad']` remains an incompatible present alternative after narrowing. Missing presence still refuses; the frontend now correctly names present operands, and the independent checked write error remains. R21 recovery never exposes partial project/API artifacts on a refusal.
- A known foreign table branch is not erased by null, a general ID, collection cardinality or length. Both the retained general-ID/foreign-list join and the new scalar reference/null/foreign loop refuse. No native authorization bypass is claimed.
- Same-table `[left,null]` through a narrowed loop is still refused. c738 stops earlier with `E_QUARRY_UNKNOWN`; the candidate reaches `E_PROVENANCE_AMBIGUOUS` at the read, listing `args.left`. R22 does not claim an old accepted source or weaken that read-key authority rule. A captured text key list with null remains `E_QUARRY_UNKNOWN`; it is not equivalent to a direct Id literal. Required captured-null keys remain refused.
- `[null,2.5]` without a known source Decimal scale remains unsupported. Parent records three `E_DECIMAL_SCALE` diagnostics; the candidate refuses earlier with `E_QUARRY_TYPE` at the destination member (`decimal literal is nominally different`). No value/IR execution is invented for either. `[int ?] <=3` declaration syntax remains refused with the original placement/syntax diagnostics.
- All-null `[null,null]` still counts2 and returns its exact nulls; it gains no present element authority. No unknown JSON collection bound, schema/table-column fallback or destination-derived source fact was added.

The inherited effectful `box.original` joined-ID provenance issue was not repaired or replayed. Its earlier refused artifacts remain the authority for that separate queued stage. Other inherited same-table/null or fractional limitations above are scoped observations, not hidden passes or grammar cuts.

## Runtime, types and evidence limits

Actual value/error observations use the frozen adapted TypeScript evaluator, not native execution. The private probe changes ordinary schema index `components: [Column]` into the existing evaluator's `columns` shape, then uses `ClientStore.applyMutation` with exact empty or constructed receipts, schema hash, explicit arguments and ordered `id-1…id-64`. The adapted schema and receipts are saved beside each complete project. Fixed-key absence receipts are constructed fixtures, not native-issued authority. This is the same deliberately scoped harness used by the retained review. No native checker, Rust build, server, HTTP, package build, publication, installed014, benchmark or competitor process ran. No current-main compatibility adapter was introduced.

Production type closure:87 files, TypeScript5.9.2, **zero diagnostics**, with zero dependency-only control diagnostics. Affected test closure:109 files, **seven external evaluator errors**, exactly equal to its independent dependency-only control and R21's actual release error list. They concern runner TraceRange `halo`/`n2_suffix` and store IndexAtom/Value compatibility. `type-comparison.json` contains every exact error. The affected closure exits1; it is not package-green. No evaluator declaration, dependency or ambient workaround was edited.

The first production snapshot was tagged`draft1`; final differs only in test registration/new cases and the LLP paragraph. `verify-behavior.ts`, executed on pinned Bun, verifies all87 actual production input files are byte-identical between draft1 and final before reusing their complete project/value observations. The44 callbacks and both type closures execute against the actual final snapshot. The two new API-consumer positive/negative pairs also use the final compiler's helper. This is explicit semantic-input reuse; no earlier result is relabeled as a new execution.

All24 actual remote child processes are serial:19 Node/Bun semantic/type/consumer processes and5 setup/snapshot/freeze/pack processes. Every actual child retains30seconds; maximum **4.274920528s**, no timeout. The only nonzero child is final-test-types PID3941852, exit1 for the seven errors above. All30 SSH/SCP transports retain45seconds; maximum **16.085852833s**, no timeout or connection/transfer failure. One SSH transport exits1 because it propagates that known test-type child exit, not because transfer failed. Commands, actual PIDs/cwds, PATH, deadlines, timing, stdout/stderr and input/output hashes are in `process-ledger.json` and `transport-ledger.json`. A probe exit0 is never counted as all its cases passing.

Private EPYC directory: `/home/ccheever/clique-revisions/compiler-literal-absence-r22-20260907T102115Z-0296f963`. Pinned Node22.23.2 SHA `3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327`; Bun1.3.12 SHA `92a1cd8b6185f676010bb18e767dfc65c772273e79ae9984480843261939eeaa`. Both binaries were independently hashed; PATH is command-local. All320 prepared dependency leaves and generated Unicode/effects declarations match the previous frozen source hashes; no install or replacement occurred. The initial c738 Git archive SHA is `cff1f69656f8e529ddda046718ba4e4d99e51b1ef182e0a1845ef9214114fd6b`.

Final source/support binding:420 files plus320 dependencies =740 manifest entries; digest `fe3144fbd266f04608d3784cbdf9c7ea0a41358bc8f157644ef281cc2a345825`; manifest SHA `192d892e7db682cee606d91ea128bc00ca1b6de211c3238b39c889c44a37271f`. See `remote-complete/final-input-binding.json`. The collected evidence archive has563 completed files, SHA `b4bb79c80ec9749e3e0b3b520c7c4aa23628bceb5ebde9689533eae77ae25bb7`; every archived member verifies. The final pack's own completed receipt is in the local transport stdout because it cannot include its unfinished receipt. No live author logs or dependency tree were packed.

## First drafts and failures retained

No original refused result was replaced with a pass. All original c738 refusals, each candidate refusal and runtime error, historical parent exceptions from the copied fixed group, and their complete source bytes remain. Original review/setup/transport/type failures and report/terminal corrections remain in the closed packet; they were not replayed or retrospectively requalified.

The first persistent-test source draft used JSON serialization for an object literal, which would quote field keys outside the intended Quarry test spelling. It was corrected before any test invocation by specifying the actual public literal text; `literal-absence-cases-first-draft.ts` and `fixture-draft-correction.json` preserve that preparation change. There was no failed semantic run of that draft. All actual persistent invocations passed on the first executed candidate.

Local read-only lookup mistakes are retained in the author log: a nonexistent `quarry/types.ts`, an incorrectly assumed `evidence/remote` path in the copied packet (actual groups are one level higher), no matches while listing symlinked LLP folders, and a `git diff` accidentally run from the external evidence directory (exit129). These did not edit source or execute semantics. Broad output truncation prompted narrower reads; no full-consumption claim rests on a truncated excerpt. There was no installation, retry with an extended deadline, source substitution, native invocation or foreign process interruption.

## Frozen source and release

Commit **d3e497acdfd2cbaecbf7c6cb8f7350cb8e63580d** contains only the six authorized compiler/test/LLP files. R21 diagnostic behavior and its guide concision remain frozen separately. The actual packaged guide is byte-identical to c738, **15,872 bytes**, SHA `7d95ce22d125b066836243947f6ebba958a77a581ca59f70184dee2d0e26ade2`; all existing executable snippets and public guidance remain unchanged. The only documentation delta is the six-line governing LLP clarification. Scoped refs and whitespace checks pass; maximum compiler code-file length remains1,468. No whole legacy gate or complete registration was substituted for affected checks.

The actual committed Git archive (`committed-source.tar`) has224 compiler files plus the unchanged guide and governing LLP,226 members total. Archive SHA **d2a3a00607411b65ea507379afaad07fe3f8452b418c46e58b70d354a0e174ab**; committed manifest SHA **99776fa4a9500f66d75a8daaccf8cd03d84bbe7b3ab21b2627d19bddf6d8b87c**. Every byte matches actual Git, working files and the final tested snapshot (`committed-source-binding.json`). Protected dirty `snapback2/packages/evaluator/src/types.ts` remains **afc6bc7ffd25fc007787b10e0fc8bdafbe4ae61cb12f7d2442f2c2df95686618**, unchanged, unstaged and uncommitted; its index and parent/new commit bytes agree. It is the only remaining worktree modification.

`phase.json` records productWritesComplete/compilerWriterReleased and report/source bindings after final report completion. The outer author CLI terminal must be observed by the supervisor after this response; no future exit is predeclared. The author stops here. Fresh review and any successor source repair are root-owned; no overall compiler/native/package clearance, main push, standalone landing or publication is claimed.
