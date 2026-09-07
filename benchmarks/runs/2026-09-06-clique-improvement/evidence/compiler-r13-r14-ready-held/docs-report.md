Docs-only R14 is committed locally as `3a558c2a48c171deddf22815dd775eddcd52db96`, directly atop R13 `251efd3872b99adc05aa0098ed2f6855829032f5`. The commit changes exactly `snapback2/packages/snapback2/guide/quarry.md` and `llp/1002-dev-loop.spec.md`: 38 insertions and one deletion. The 218 compiler files remain byte-equal to the R13 tested, committed and archived files. Protected `evaluator/src/types.ts` remains dirty, untouched and unstaged at SHA256 `afc6bc7ffd25fc007787b10e0fc8bdafbe4ae61cb12f7d2442f2c2df95686618`. This stage adds documentation and a read-only diagnostic handoff; it grants no compiler, package or native-runtime clearance.

The full 20,517-byte R13 report, phase and actual terminal receipt were read before editing. The start receipt is R13 tool45367 exit0/chunkad72ca, with explicit productWritesComplete/compilerWriterReleased. They are copied under `originals/r13/` with the original source and native binding records. The R13 active blind reviewers were not contacted and their outputs were not read. Their immutable compiler remains251efd; this documentation commit does not change their candidate. Root owns prose review, integration, publication and the disposition of the point-key gap.

`llp-context.md` records the llp-orient context: the Snapback2 fence, LLP1000, LLP1002 §2, LLP1017 §3.2, current public Quarry/grammar guides, and the read-only insert snapshot reference into LLP1007. The general fallback behavior is existing R11/R12/R13 implementation being documented, with the original compiled sources and actual value/error observations retained. No new public grammar, private TypeScript callback vocabulary, authored sink policy, native feature, schema, transport or certificate-as-runtime claim was added.

The supplied root documentation context binds commit `2df2a8a09a83223653312b177f039179d19c39ca`. Both supplied hashes were verified against `root-doc-context.json`. The packaged Quarry guide was identical to this lane's pre-edit copy. Root LLP1002 additionally records README H2 keyword topics, authoritative README/collision behavior, the certified operation map shared with certificates.json, internal schedule exclusion, and E_GUIDE_STALE for invalid certificate/seed custody, plus its Revised-header note. Those changes are unrelated to this §2 edit. This lane did not overwrite its entire LLP with root bytes or edit root context. The exact final `prose.patch` was successfully applied to a private copy under `root-context-applied/`; an independent text comparison in `prose-changes.json` proves every newer root paragraph remains. `root-comparison/` preserves the original differences. The same patch can be integrated onto those supplied root bytes without reviving stale §8 prose. This statement is bound to the supplied root commit, not uninspected future main.

The guide's previous single sentence said optional lists require `?? []` or `if` presence narrowing. It now treats those as examples alongside required bounded alternatives, nested nullable alternatives ending in a required list, and expression-containing literal fallbacks. It separates maximum from presence, states the sound maximum across all alternatives and each alternative's own bound, and explains lazy fallback, present-empty bypass, eager earlier captures, retained snapshots and independent Decimal source units/destination conversion. Existing page fanout, public grammar, mutation-read and error-policy prose remains in place. LLP1002 adds the corresponding constraints directly after its existing authored-order/read-site identity paragraph; its new link preserves LLP1017's page-derived loop rule. The Revised header was left untouched to avoid conflict with the newer root history.

The exact inserted/replacement prose follows; `prose.patch` and `prose-changes.json` also retain the exact original text and line positions.

`llp/1002-dev-loop.spec.md`:

> 
> **Bounded list selection in Quarry.** A nullable list's declared maximum and
> proof of presence are independent. A loop may eliminate absence with `if`
> presence narrowing or a bounded required alternative: `values ?? []`,
> `values ?? more`, nested nullable alternatives ending in a required list, or
> `values ?? [expression, ...]`, including effectful literal components. The bound
> of the selection is the maximum across all possible alternatives, with each
> branch retaining its actual declared maximum; a larger fallback is never cut
> to the left alternative's maximum.
> 
> The operands-once and binding-provenance rules above apply to the entire
> selection. A present empty list counts as present and bypasses the fallback.
> Expressions authored inside a fallback evaluate lazily, exactly once in
> authored order when selected; an earlier captured fallback evaluates eagerly
> at its earlier binding. Immutable aliases, object captures, and subsequent uses retain
> the original selected list snapshot, without re-evaluating the selection or
> its components. Source Decimal scales and minor-unit values survive selection
> and capture independently of destination conversions; a destination cannot
> change the captured source facts. Page-derived loop domains remain subject to
> [LLP 1017's complete-fanout rule](1017-cap-and-complete-fanout.rfc.md#32-the-rule).

`snapback2/packages/snapback2/guide/quarry.md`:

> list/page/range/tokens/words result. An optional list's maximum bounds its length
> when present; it does not prove presence. Use `if` presence narrowing or a
> bounded required fallback: `values ?? []`, `values ?? more` with required `more`,
> or `values ?? maybe ?? more` with nullable alternatives ending in a required
> list. A list literal may contain expressions, including effects:
> `values ?? [new, new]` is one example for an id list. Alternatives with maxima
> 3, 5, and 7 have a combined maximum of 7; each alternative keeps its own bound.
> The larger fallback is not truncated to the first list's maximum.
> 
> A present empty list suppresses the fallback. Expressions inside the fallback
> are lazy and evaluate once, in authored order, only when that fallback is
> selected. An earlier binding such as `fallback = [new, new]` evaluates there,
> even if `values ?? fallback` later selects `values`. Immutable aliases and
> captured object fields keep the selected list snapshot for later uses and
> returns. Decimal elements retain their source scale and minor-unit values
> through selection and capture. A write's destination conversion is checked
> separately and does not change those captured source values or their scale.
> 

The prose's examples are bound to existing complete projects, not freshly invented test results. `retained-example-audit.json` records exact source hashes, original and copied paths, complete project/result hashes, actual decoded values or errors, and the existing check-only native binding. Eighteen admitted projects and one refused project are retained; their 72 pre-existing evaluator observations comprise 54 decoded results and 18 errors. These are reused R13 records, not 72 new passes or a new execution run. Eighteen existing owner receipts were copied and their checked input hashes verified, without invoking the owner. The 166 copied evidence files were verified against the R13 evidence manifest wherever listed, and source/project/result hashes were separately matched to the final R13 project bindings.

| Documented behavior | Exact source-bound R13 example directory beneath `originals/r13/projects/` | Retained actual observation |
| --- | --- | --- |
| Required fallback, independent max3/max7 | `candidate3/public captured alias/` | Absent values uses all seven fallback elements; present Decimal3 value4321 returns/writes4321; four provided values refuse E_FANOUT at max3. |
| Nested nullable alternatives | `candidate3/public captured nested alternatives/` | Present middle list of five returns/writes all five; when both nullable inputs are absent, all seven required fallback values survive. |
| Input fields and nested object capture | `candidate3/public captured input fields/`, `candidate3/public captured nested object capture/` | Selected list survives loop writes and the later returned object; present empty suppresses the fallback. |
| Required literal alternative larger than left bound | `candidate3/public returned literal/` | Null selects and returns `[2,3,4,5]`; present empty returns `[]`; an authored failed require remains an error. |
| Lazy division fallback and earlier eager throw | `candidate3/public lazy division fallback false/`, `candidate3/public lazy division fallback true/` | Provided `[7]` bypasses the lazy division by zero; absent input raises E_DIV_ZERO. Earlier captured division raises first on both branches. |
| Lazy allocation fallback | `candidate3/public lazy allocation fallback/` | Absent input returns original `[id-1]`, next id-2; provided `[given]` returns next id-1. |
| Earlier captured fallback and captured field | `candidate3/effectful capture captured fallback/`, `candidate3/effectful capture captured fallback field/` | The earlier two allocations occur even with provided or empty values: next is id-3 in all three cases. |
| Authored object-member order | `candidate3/effectful capture earlier member/` | Earlier ticket uses id-1; absent fallback uses id-2/id-3, next id-4. Present empty skips fallback and next is id-2. |
| Seven effectful literal components, before loop body writes | `candidate3/effectful tuple 7 allocations and body writes/` | Absent input captures id-1 through id-7, stores seven rows using id-8 through id-14, then returns next id-15. Present empty has no writes or fallback allocations and next id-1. |
| Source Decimal minor units through saved tuple | `candidate3/effectful minor units through saved tuple/` | Source4321 is repeated five times in both return and Decimal3 writes; present source2000 remains2000. |
| First error and present-empty bypass | `candidate3/effectful tuple division first error/` | Absent input with zero divisor raises E_DIV_ZERO before later overflow; nonzero divisor exposes E_OVERFLOW. Present empty bypasses both and returns `[]`. |
| Nested effectful fallback capture | `candidate3/clone public nested effectful full objects eager false/`, `candidate3/clone public nested effectful full objects eager true/` | Saved original selection, earlier ID ticket, middle max5 and full body Divmod objects remain correct; the earlier explicit throw remains first. |

Each directory contains exact `snapback/probe.q`, schema, `project.json` and `result.json`; admitted project responses retain Program IR, Quarry output and generated API. No native execution is inferred from the old certificates. These public projects support the guide wording; the private literal-concat operand harness from prior reports is not promoted into a new public recipe. The old raw evaluator omission E_INPUT observations remain among the retained errors. They do not contradict the separately accepted native HTTP Null-completion diagnosis and do not establish an online omission defect. No omission transport work was repeated.

`point-key-diagnosis.md` is the separate read-only handoff. The exact `row = insert records {payload: q}; stored = records[row.id]` source refuses E_PROVENANCE_AMBIGUOUS at `snapback/probe.q:6:5` on both R12 and R13, with the same unknown-origin diagnostic and unchanged-source public rewrite. Quarry emits the insert as a nonnullable row result, while the later closed provenance classifier recognizes `.get` as a row call and does not recover a proven row/member origin from `.insert`. The five relevant production files are byte-equal R12/R13, independently checked in `point-key-source-binding.json`. The guide says an insert yields its row and does not explicitly exclude that row's id from subsequent point reads. The refusal is therefore a concrete public ergonomic gap consistent with conservative rejection of an unmodeled origin, not a documented insert-specific prohibition. It is not repaired or papered over by this prose change.

For this refused source, the saved `project.json` is a failed response; there is no accepted IR/API, evaluator outcome or native result to claim. Actual Git9afc refuses earlier with E_UNBOUND_LOOP, so the comparison does not establish historical R4 runtime behavior or the same later provenance refusal. The original R13 final1 optimistic test expectation and exit1 receipt remain. The separate explicit point-read positive over a selected argument element reads Id given/other at the correct cloned sites and has no read on present empty; its complete IR and finite bare-evaluator observations are retained. The inserted-row capture control's provisional directory name mentioned point reads, but it has no Get and is not counted as read proof. The first invalid `==` point-read experiment and its E_QUARRY_SYNTAX are also retained. These facts do not imply universal unsupported reads after insert. The exact gap already appears in the R13 report/persistent control; no duplicate issue or unsupported workaround was introduced. Root receives the compiler binding/provenance ownership handoff and its untested-shape limits in the diagnosis report.

Validation in this stage was limited to documentation, retained-record hashes, and immutable source custody. The actual original30s ref-check process was PID37177, exit0 after 25.243 seconds, with 411 LLP docs, 7,690 refs across 15,970 files, zero errors and zero unchecked references. Final patch application to the supplied root context and affected `git diff --check` pass. The added LLP1017 link's file and heading were checked directly, and the edited files remain within the existing file bound: Quarry319 lines and LLP1002 1,001 lines. The first patch check applied to the saved initial prose; the final patch was actually applied and independently compared after the small wording refinement. No repeated ref-check was needed after its successful run because the committed docs stayed byte-identical to that validated version. `checks/` retains argv, cwd, PID, explicit30s deadline, actual exit and stdout/stderr hashes. All five bounded subprocess receipts, including the docs commit, exit0 with no timeout. A few exploratory read commands used nonexistent glob/path guesses; those returned ordinary lookup errors, were corrected, and are not counted as successful validation. No compiler/evaluator/type/native process, broad test registration, install, old-runtime/HTTP/benchmark replay or new review was launched.

The source freeze is actual committed bytes. `commit-custody.json` verifies all218 compiler files against the R13 tested archive and manifest, the R14 Git archive and current working files. The only tracked working modification after the docs commit is the protected evaluator file, and the index is empty. `final-source.tar` contains the two committed docs plus those218 unchanged compiler files; it excludes the protected dirty evaluator. Its SHA256 is `00b2b6d667ec7522e4497a7498bde9106b78b198ed7292267f2a8307313f045c`; the220-file `final-source.json` manifest SHA256 is `527d4b1692164202172952f1e161996fd762194f5cdddc565357846698bce027`. `original-docs/` preserves both pre-edit files. `prose-changes.json` binds final local and applied-root document hashes. The old R4 historical-archive discrepancy, original source snapshots, external type errors, initial probes/timeouts and qualified native/value boundaries remain preserved in the complete R13 record; this docs-only stage does not reinterpret them or claim an old suite green.

Durable handoff files are `report.md`, `point-key-diagnosis.md`, `llp-context.md`, `phase.json`, `prose.patch`, `prose-changes.json`, `root-comparison/`, `root-context-applied/`, `retained-example-audit.json`, `retained-evidence-manifest.json`, `point-key-source-binding.json`, `commit-custody.json`, `final-source.json`, `final-source.tar`, and the final evidence manifest/archive. Live stdout.log/stderr.log and recursive archive metadata are excluded from evidence copying and packing. Original source/review/evidence directories remain intact. No push, root-main edit, package change or publication occurred. Root retains final prose disposition and compiler clearance remains subject to its fresh blind reviews of251efd.

The final phase explicitly sets productWritesComplete=true and compilerWriterReleased=true after the documentation source and report are complete. The enclosing R14 CLI session43141 is observed by the supervisor after this author's final answer; no future exit is invented here. The recorded commit subprocess PID46352 exit0 is a distinct receipt and is not substituted for the enclosing CLI terminal.
