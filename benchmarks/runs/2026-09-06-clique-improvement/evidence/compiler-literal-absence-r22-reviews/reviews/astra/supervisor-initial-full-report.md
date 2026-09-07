READY — scoped compiler literal-absence review of `d3e497acdfd2cbaecbf7c6cb8f7350cb8e63580d` against immediate parent `c73805f6affb01530c7d903c8e22e8a90f49fe48`.

No introduced blocking finding in the reviewed delta and bounded controls. This verdict covers compiler authoring semantics, complete project output, and the selected callable assertions. It does not clear native execution, a client/twin integration graph, current main, packages, publication, or cumulative compiler readiness. No product or original input bytes were edited, and no repair stage was entered. The review was mutually blind: no peer findings or author report was accessed.

Known model identity available to this session: **Codex, based on GPT-6**. A more specific serving-model or native CLI identity was not independently available. The supervisor retains the authoritative terminal/CLI identity.

**Custody and governing material.** I read the supplied exact root and Snapback2 `AGENTS.md`, `rules/RULES.md`, `rules/NOT-DOING.md`, LLP 1000, LLP 1002, and actual packaged `guide/quarry.md` before semantic analysis. I also consulted the relevant engine value/absence and LLP 1017 page/fanout contract. Root Snapback1 gates were not applied to this fenced review.

The actual supplied Git tar headers identify the exact parent and candidate commits. Candidate archive SHA-256 is `0d75334296cc5cdfa8eb31fe9a56534d1feacc514c4f73bb291acf9a4226d342`; parent archive SHA-256 is `5bee6bf8f1e1d0449250f849273a82e4d94b5cf5395f913e99371d049e1bfd7a`. All 224 candidate compiler archive files match both the compiler manifest and snapshot bytes; the parent archive contains 223 files. All 226 final source-custody entries agree, including the LLP and guide. The 740 prepared input entries, including 320 dependency files, also agree. These are byte comparisons, not count-only evidence. No unavailable outer author archive was inspected or claimed inspected. See [source custody](evidence/source-custody.json), [prepared-input and Git-header custody](evidence/prepared-custody.json), and [remote versus local/archive comparison](evidence/remote-custody-comparison.json).

The delta is exactly three production files (`quarry/value-type.ts`, `quarry/narrowing.ts`, `quarry/program.ts`), two test files (`insert-provenance-checks.ts`, new `literal-absence-cases.ts`), and the LLP clarification. The full parent LLP corresponds to the supplied `docs-delta.patch`: one six-line addition. Both guide copies are 15,872 bytes with SHA-256 `7d95ce22d125b066836243947f6ebba958a77a581ca59f70184dee2d0e26ade2`. Unchanged R21 diagnostics and guide implementation were not audited or requalified.

**Exact public regression and attribution.** The newly executed source is the supplied factual case, without simplification:

```q
-- snapback/schema.q
table records:
  length: int
  label: text <=20
  payload: json <=1000
  public
  insert <- allow
```

```q
-- snapback/probe.q
mutation probe():
  original = [2,null]
  for value in original:
    if value != null:
      require value > 1 else LOW
      insert records {length: value, label: 'chosen', payload: {keep: 'row', original}}
  return {original, next: new}
```

The source SHA-256 is `bb3c1585233d7bb4ba98f095db90f71b204267c63271e438ce5745aaa0a3a330`. The fresh parent refuses `E_QUARRY_TYPE` at the ordered comparison: its joined alternatives include fictitious present Text facts from literal absence. The candidate accepts and produces exactly:

```json
{
  "result": {"original": [2, null], "next": "id-2"},
  "rows": [{
    "id": "id-1", "length": 2, "label": "chosen",
    "payload": {"keep": "row", "original": [2, null]}
  }]
}
```

The generated operation result is `{ original: (number | null)[]; next: string; }`. Its complete project IR, API declaration, and full evaluator observation equal the supplied historical dbfe control, including the 30-step trace. The historical execution itself was **not rerun**. This establishes repair of a previously accepted public program that was already refused by the immediate parent; it does not locate the earlier introducing commit. See [fresh parent refusal](evidence/remote/runs/p-core/null-last-full-row/full.json), [candidate IR](evidence/remote/runs/c-core/null-last-full-row/project.ir.json), [API](evidence/remote/runs/c-core/null-last-full-row/api.d.ts), [complete results](evidence/remote/runs/c-core/null-last-full-row/results.json), and [historical correspondence](evidence/analysis.json).

Reversing only the literal to `[null,2]` also changes parent refusal to candidate acceptance, preserving that order in both the returned source and the row payload, with length 2 and next ID 2. The reverse-order refusal was inherited; I do not label its new acceptance a repair of a demonstrated historically accepted program.

The declared `maybe: int ?` control remains accepted in both revisions. `maybe = null` returns `[null,2]`, one complete row, and `id-2`; `maybe = 3` returns `[3,2]`, complete rows in lengths 3 then 2 order, and `id-3`. Its project, API and evaluator output match the parent and supplied historical control exactly.

**Shared join/narrowing audit.** Literal absence is now a distinct `kind: "null"`. Joins retain absence outside flattened present alternatives, recursively join real object fields and collection items, and widen collection maxima independently. `nonNullable` strips optionality from actual alternatives; it does not turn all-null or unknown facts into an int, row, reference, or bounded list. Empty input to the join remains unknown, while a nonempty all-absent input is null. Unknown remains nullable and participates in incompatible joins. The fractional-literal optional bit also survives joins. Making a page nullable retains its item facts and maximum through the collection model. The generated TypeScript, lower-project type analysis, destination conversion, provenance checking, and API generation were inspected as consumers of these facts; the changed metadata is not itself runtime or nominal authority.

Fresh complete-project comparisons exercised the following additional cases. All raw sources, frontend outputs where applicable, complete IR/API, evaluator results/errors, and fixture receipts are retained under the linked run directories.

| Case | Parent → candidate | Complete observation / implication |
|---|---|---|
| Nested `[[2,null],[null,3]]` | `E_QUARRY_TYPE` → accepted | Source unchanged; complete rows of lengths 2 then 3, each retaining the full nested payload; next `id-3`. |
| `[{value:2},{value:null}]` | `E_QUARRY_TYPE` → accepted | Full object array retained; row length 2 with full original payload; next `id-2`. |
| `[divmod(5,2),null]` | `E_QUARRY_UNKNOWN` → accepted | Both the returned list and inserted `payload.part` retain `{quotient:2,remainder:1,sink:"lexicographic-id"}`; payload also retains the complete original list; next `id-2`. |
| Lazy nullable-list fallback containing division and null | `E_QUARRY_TYPE` → accepted | Null selects `[2,null]`; present empty bypasses division by zero and returns `[]`; selected division by zero throws `E_DIV_ZERO`. |
| Earlier captured full Divmod | `E_QUARRY_TYPE` → accepted | Earlier division by zero still throws even with a present empty selected list. Successful return includes the full `{quotient:1,remainder:0,sink:"lexicographic-id"}` object. |
| Mixed Decimal 3 / null / Decimal 2 | refused → refused | No scale is borrowed from the first present alternative. |
| Foreign-table reference / null alternatives | refused → refused | No common collection or presence fact grants the wrong table target. |
| Nested object fields mixing Decimal 3/null/Decimal 2 | refused → refused | Extracting the field and narrowing it does not erase the incompatible Decimal alternative. |
| Unknown JSON member / null / int | refused → refused | Unknown does not acquire numeric authority. |
| `[null,page]`, required bounded query page | `E_QUARRY_UNKNOWN` → accepted | With the explicit held-row fixture: original `[null,[{id:"r",length:9}]]`, chosen complete row list, count and length 1, no writes. API retains `(Page<RecordsRow> \| null)[]` and the outer possible null return. |

The three composite results above were compared as complete result objects **and complete inserted rows**, not just quotient or length projections: [comparison](evidence/complete-composite-comparison.json), [composite run](evidence/remote/runs/c-composites), [fallback/eager run](evidence/remote/runs/c-lazy), [new absence/page controls](evidence/remote/runs/c-absence). The page observation uses the frozen evaluator fixture adaptation; it is not native fanout certification.

Seven selected new registered callbacks additionally asserted all-null count and source preservation, captured-null fallback ID allocation, Decimal source/comparison, and refusals for mixed whole units, mixed currencies, real text alternatives, and missing presence. The Decimal success preserves source `[null,4321]` and stored `d3:4321`; input 500 fails the `> 1` comparison at scale 3. Null does not authorize raw-unit arithmetic or a destination conversion. The all-null count returns `{original:[null,null],size:2,next:"id-1"}` without writes. Captured null followed by `?? new` returns `{missing:null,value:"id-1",next:"id-2"}`.

Eight existing registered callbacks were executed on **both** parent and candidate. Their complete project/API and successful evaluator observations match, and their expected error messages match. They cover page count, nested nullable maxima, mixed Decimal API, optional mixed-return absence, lazy/eager ID allocation, unknown-element member refusal, and retained foreign nominal targets. In the nested maximum control, actual IR retains separate `ArgList` bounds `values:3`, `maybe:5`, `more:7`; fallback rows of length 7 or 5 are not truncated. Present empty bypasses selection of the fallback. Lazy ID fallback leaves next `id-1` when bypassed; an earlier eager `[new,new]` leaves next `id-3`. Mixed Decimal and nullable return consumers reject assignments that would erase the alternative brand or null. These are 23 actual callback invocations (7 new plus 8 existing on each revision), all passing. [Observed callback projects, evaluations and consumers](evidence/remote/runs), [exact correspondence](evidence/analysis.json).

The callback harness uses observation wrappers around the original exported lowering/evaluator/API-consumer functions, delegates to each original function once, preserves return values and throws, and records the temporary source/output before the unchanged test helper deletes it. No checker, compiler source, evaluator source, or assertion was replaced. The unmodified registered callbacks run their own assertions.

**Private composite keys remain a separate control.** The unchanged private captured `[null,2]` and `[2,null]` tuples compile in both revisions. The supplied explicit ordinary-index receipt is used; null itself grants no authority. The first produces key `[null,2000]`, returns the unscaled source tuple `[null,2]`, returns and writes the full row `{id:"id-1",d3:null,e3:2000,payload:{keep:"row"}}`, and returns next `id-2`. The reversed case produces key `[2000,null]`, source `[2,null]`, and full row `{id:"id-1",d3:2000,e3:null,payload:{keep:"row"}}`, again next `id-2`. Both complete observations, including 40-step traces, IR and API match the immediate parent and supplied historical controls. This is preservation of established destination conversion and receipt-backed lookup, not new reference authority. See [parent private controls](evidence/remote/runs/p-lazy), [candidate private controls](evidence/remote/runs/c-lazy).

**Limits and inherited behavior.** The same-table reference/null loop remains refused: parent `E_QUARRY_UNKNOWN`, candidate `E_PROVENANCE_AMBIGUOUS`. The unscaled fractional-list case remains refused, moving from parent `E_DECIMAL_SCALE` diagnostics to candidate `E_QUARRY_TYPE`. These newly measured stage changes are not accepted regressions or proof of authority. Captured text/null keys, required null keys, and optional-element declaration syntax remain supplied limitations; those particular full projects were not newly rerun. The inherited effectful `box.original` provenance gap remains separately queued and was not relabeled or repaired.

An additional all-null probe places `return value + 1` inside `if value != null` over `[null,null]`. **Both revisions accept that unreachable body and emit identical IR/API.** Replaying the saved full projects on each revision skips the body and returns `[null,null]`, with no writes and identical 16-step traces. Thus I do not claim that all-null programs containing syntactic arithmetic are universally refused. This is inherited unreachable-code acceptance, not a newly reachable numeric use. Companion all-null member, count-of-element, and table-key probes refuse on both revisions. [Parent source/IR](evidence/remote/runs/p-absence/review-all-null-numeric), [candidate source/IR](evidence/remote/runs/c-absence/review-all-null-numeric), [both replays](evidence/remote/runs).

**Execution, failures and evidence limits.** The exact supervisor inbox admission was consumed at the recorded boundary before dispatch: [admission](evidence/admission-consumed.md). Fresh capacity was captured at 10:57:02 UTC: 96 CPUs, load average 2.47/1.60/1.29, about 255 GB available memory as reported in kB, and CPU pressure avg10 0.00. The final one-minute load was 3.28. Shared admitted original native scale work remained explicit; no quiet-host assumption was made and no scale file or foreign process was accessed or interrupted.

Every substantive compiler/type/evaluator child ran only under `/home/ccheever/clique-reviews/compiler-literal-absence-r22-d3e497-f515f287bd/astra`, with candidate and parent made as **full copies** of the supplied snapshot. Only the parent's compiler package was replaced with its actual Git archive. The core `ir-contract.json`, evaluator, runtime support, generated Unicode and prepared effects declaration remained present and byte-identical. All temporary callback projects used the exclusive directory's `tmp` via `TMPDIR`.

The actual executable was pinned Bun 1.3.12 (SHA-256 `92a1cd8b6185f676010bb18e767dfc65c772273e79ae9984480843261939eeaa`); pinned Node 22.23.2 (SHA-256 `3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327`) was available and hashed. PATH was exactly the pinned Node bin, pinned Bun bin, `/usr/bin:/bin`. TypeScript was the supplied 5.9.2. Protected evaluator `types.ts` remains `afc6bc7ffd25fc007787b10e0fc8bdafbe4ae61cb12f7d2442f2c2df95686618`; generated Unicode remains `9eccdccd99e9b936a40dcbf8ae63c55d980086df1ae71f92019f9ab040f6a521`; prepared effects remains `13dd9d1f06641596a4c6ac1c080b3f45f083485baa55a4a378d5b8eba68b311d`. Compiler-source `effects-lib.d.ts` is a separate verified file.

The new production type check includes 87 source/support files and has zero diagnostics. The candidate affected graph includes 109 source/support files and fails with seven evaluator diagnostics; the parent includes 108 and fails with the exact same seven. Their file, offset, code and message also match the supplied control. Two errors concern missing `TraceRange.halo/n2_suffix`, and five concern `IndexAtom[]` versus `Value[]`. Neither failure was repaired or converted to a pass. [Candidate failure](evidence/remote/runs/c-types-affected/result.json), [parent failure](evidence/remote/runs/p-types-affected/result.json), [comparison](evidence/analysis.json).

There were 20 actual substantive children, all under the original 30-second subprocess deadline, with no overlap in their recorded execution intervals and no timeout. The maximum was 3.263242 seconds. The only nonzero children were candidate affected types (PID 3969453, exit 1, 3.263242 seconds) and parent affected types (PID 3970451, exit 1, 3.231539 seconds). All 31 transport calls retained the independent original 45-second limit; maximum 5.434240 seconds, no timeout. Three early SSH transports overlapped while returning asynchronously, but their actual compiler children did not overlap; subsequent dispatch waited for each transport to finish. This distinction is visible in the recorded timestamps rather than hidden in a serial claim. No deadline was expanded.

Each child's actual PID, cwd, PATH, argv, executable identity, harness/input hashes, source manifest binding, stdout, stderr, exit and duration is retained in its run directory. The first affected-type errors and full output are retained. Local source lookup mistakes (`numeric.ts` and `test-support.ts`, neither present) were read-only lookup failures, not compiler failures. A missing brace in an observer-harness draft was caught by source inspection after upload and corrected **before execution**; that draft and the hash-verified original executed harness are retained in `harness/versions`. There was no failed semantic harness run disguised by a retry.

Recorded reproductions are the argv in each `process.json` and transport receipt; the full sources are alongside the outputs. For example, the original review dispatches were:

```sh
python3 harness/dispatch.py p-core parent projects null-last-full-row null-first-full-row declared-optional-full-row
python3 harness/dispatch.py c-core candidate projects null-last-full-row null-first-full-row declared-optional-full-row
python3 harness/dispatch.py c-composites candidate projects nested-literal-lists object-field-literals full-divmod-null
```

The dispatch resolves the pinned tool and private tree and gives every child its own 30-second supervisor; a separately admitted repetition must use a fresh output label because existing evidence directories are never overwritten. The 21 fresh paired projects yield parent 4 accepted/17 refused and candidate 12 accepted/9 refused; those totals are an inventory, not the verdict. The full behavior and attribution above determine the conclusion.

Supplied author observations—exit 0/chunk 739425 and release-verified final report; 30 projects with parent 5 accepted/25 refused and candidate 18 accepted/12 refused; four historical comparisons; 44 callbacks; production/affected type observations; 24 children with maximum 4.274921 seconds and 30 transports with maximum 16.085853 seconds—remain **supplied evidence**, not new review passes. Only the four frozen historical complete outputs were reused for correspondence; no historical compiler battery was rerun because of the new hash.

All 744 files in the final remote evidence manifest were collected locally and compared by hash and size. No dependency recopy was needed for evidence collection. Local snapshot, original remote inputs, both execution trees, and tool hashes are unchanged after execution. Every recorded child had exited at final collection. [Final remote custody and PID checks](evidence/remote/finish.json), [collected evidence manifest](evidence/remote/remote-evidence-manifest.json), [complete analysis and timing inventory](evidence/analysis.json). Manifests exclude themselves. No install, global PATH/credential change, native/Rust/server/package build, publication, benchmark, competitor rerun, or moving-main reconciliation was performed.
