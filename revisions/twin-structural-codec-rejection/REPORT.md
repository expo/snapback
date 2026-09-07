**REJECTED FOR SIZE — isolated evidence checkpoint; writer release follows this report.**

Commit `b1c9e956235939a721fe56d0851a72611897a782` is clean on `s2/clique-structural-codec` in `/Users/ccheever/projects/snapback-worktrees/clique-structural-codec`, with parent `0ecd6015a7a1f0c291a224baef37f832b6b3154a`. Only four evaluator files changed. No push, main landing, native/compiler/Unicode edit, other-worktree import, resident population or second codec/size variant occurred. Root deliberately selected this broader experiment despite the prior negative design recommendation; this result does not relabel that recommendation.

The ONE unchanged full-entry measurement produced **231,755 minified bytes / 76,335 Node gzip9 bytes**, actual gate exit **1**. It is **10,335 bytes over 66,000**, target 64,000, and **520 gzip bytes above the historical 82c43 anchor of 75,815**. The selected 0ecd parent was intentionally not measured; neither +520 gzip nor +1,434 minified is claimed as an isolated measured delta against 0ecd. Under Root's explicit conservative comparison rule the candidate is rejected. Do not carry it forward for hypothetical startup or resident benefits. Earlier 75,815 and rejected Unicode 76,300 measurements and original movement/deadline failures remain failures in their original records.

**What was replaced.** All paths below are under `snapback2/packages/evaluator/src/`:

| File | Actual replacement | Final newline-compatible count |
| --- | --- | ---: |
| `value-runtime.ts` | `validateWriteRow`, `validateTypedValue`, `assertValue`, `rowFromWire`, `valueFromWire` are thin boundary calls into the codec. The old `inspectValue`, `validateType`, asset descriptor/list traversal, asset validation and `tagJson` implementations are deleted. The public write adapter retains the original `schema.tables` dereference. | 358 |
| `certificate-identity.ts` | Deletes private `known/pick/struct/node`, recursive Column/Arg normalization, sorted-map/deep reconstruction and the old fixed constructor callbacks. A finite source grammar describes canonical constructors. Public root skip/refusal sequencing and three named one-call adapters remain; their constructor work executes only in the codec. | 129 |
| `structural-codec.ts` | New shared list/map/record/variant/default/omission engine with explicit tagged inspection → reserved-principal → refinement, wire construction, asset path/list policy and canonical policies. Schema/auth validate-only records inspect keys without prematurely reading values. | 268 |
| `test.ts` | Adds 54 lines of fixed-parent refusal, wire/asset, own-key/sparse-array and runtime-native root-order controls. Keeps the existing direct Bun entry and all prior assertions. | 1125 |

The exact owned diff is `owned-source.patch`; `source-removal-inventory.json` distinguishes deleted semantic bodies from retained public/named adapters. Production source is **2,684 bytes smaller**: value-runtime −12,155; certificate-identity −7,819; new codec +17,290. The production diff is 390 inserted / 555 deleted lines; the test adds 54 lines. These are source counts, not compressed savings.

The actual full-build `bytesInOutput` contributions are value-runtime **12,372 → 6,362**, certificate-identity **7,779 → 6,441**, and new codec **8,804**. Other tiny output differences in unchanged sources reflect bundler output, not source rewrites. The codec and retained grammar/adapters replace less minified mass than they add. These contributions are **not additive gzip attribution**; only the full measurement establishes the rejection. Complete attribution is `final-byte-delta.json` and `final-evidence/final-byte-attribution.json`.

**Boundary and ownership treatment.** The grammar is finite source data, not a second normalized schema/program, compiled AST cache, input registry or public API. Every grammar/engine/adapter byte is in the measured graph. Schema descriptors are consumed directly. Tagged validation retains the observable complete shape/scalar pass before reserved refusal and type refinement; wire conversion retains source-field order before row schema completion. This is not a claim that every input now needs only one traversal: Text/Enum wire admission and later row admission remain where their refusal ordering requires them.

Canonical output order remains distinct from validation order, including Scan.take before prefix. Known fields, omitted/default/zero values, Arg min/format checks, category-specific opaque versus deep-sorted fallback and the required 0ecd unknown-domain wrapper are retained. The existing five fallback controls pass. Row/Map, application Bytes-shaped JSON, own `__proto__`, astral keys, sparse array length/holes and exact omission/null behavior remain distinct. Public/custom JSON isolation stays with existing adapters and RowImage ownership; no current raw/tagged body mirror, full receipt pool, historical-key body backlink, owner registry or warm history scan was introduced.

Static forms, field-name arrays and transform maps live with their module and have constant multiplicity independent of rows/history. The engine creates temporary forms, child callbacks and context objects on the active recursive path; wire/canonical construction overlaps input and new output until return. Existing asset-list id arrays/Sets remain bounded by the admitted input. These transient allocations and recursion overhead are real costs; no allocation-neutrality, startup, resident, phone or whole-store 8 MiB claim is made. The grammar retains no input after a call. Existing current/effective RowImage, body-free ImageKeys and PreparedRange nominal identity/lifetimes and format5 logical slot charges are untouched. Built cross-arm identity, equal refresh/no-revision, rollback, loss/purge and cold controls passed.

**Before/after evidence and corrections.** The actual parent capture preceded production edits: Node PID3989587, 0.465244 seconds under a new 10-second external bound, 2,413 policy cases plus 250 metadata-inclusive canonical entries. Full output SHA `13b1dfb04b7cb003b94969342762b6c48ca1007904b8e2ed913c002b438fb648`. This is not 250 modeled corpus tests. Candidate1 initially matched that entire file exactly.

Twelve later root/read-order cases were explicitly added and run on immutable parent and candidate1; they are **post-edit observations against a frozen parent**, not retrospectively called pre-edit baseline. They exposed four differences: null/undefined schema became E_SCHEMA instead of native TypeError, and schema/auth shape checking read field values too early. Both source problems were fixed, with complete original outputs in `root-evidence/` and `root-comparison.json`.

A bounded Bun run of the same frozen bundles showed those four differences plus eleven native JSC message source-expression fragments. Root explicitly allowed only those eleven message-only fragments, not other errors/order changes. The already prepared minimal native call-site adapters and shared sequence policies retained all observed text without restoring an old recursive body or parallel walker. Final candidate3 compares **byte-for-byte equal on each runtime's complete 2,425-case file**:

- Node parent/final SHA `d34a7f0fa335ac7c402fb284ed944ac8f2730cb04aa7cef8b2b2dcd7d3222475`.
- Bun parent/final SHA `a186b510211406e22ff4cc0b538210c0732e186291e243ea8d8b3f9281471fc6`.

The complete files include outputs, error name/code/path/message and input-after state. No values/errors were normalized away. Candidate1's original fifteen Bun differences remain in `bun-diagnostic/` and `bun-diagnostic-comparison.json`. Final equality is scoped to these concrete inputs, not a universal promise about JSC-rendered source text.

The first parent capture failed in source custody before the policy child because a metafile JSON import-attribute suffix was treated as a filename. Its scripts, partial artifacts and PID3988393/exit1 remain retained; only the capture path resolver changed for the successful retry. A local archive extraction initially used an unsupported Python `filter` argument; the archive was preserved and extracted after path validation with the installed API. An unexecuted candidate2 setup script had an incorrect donor literal after mechanical path substitution; that frozen packet remains and candidate3 uses the exact verified donor. The intermediate new test used Node-native text inside a Bun entry; its corrected test compares the exact original native `schema.tables` operation on the current runtime, while fixed typed errors and external full-output oracles stay strict. No invalid full-suite run was relabeled green.

**Affected qualification.** The exact argument vectors/selectors are in `candidate3-commands.json`; complete logs, launches and terminals are in `candidate3-evidence/candidate3-checks/`. All thirteen serial commands returned 0. Package build finished before dependent built-public tests.

| Command/group | Result | Elapsed / original containment |
| --- | --- | --- |
| Matched Node policy capture | Full raw equality, 2,425 + canonical entries | 0.515s / 10s external |
| Matched Bun policy execution | Full raw equality, same inputs | 0.215s / 10s external |
| `node build.mjs` | Package and strict declaration typing pass | 3.121s / 120s external |
| `bun src/test.ts` | 225 modeled pass; 24 asserted server-only refusals; 2 visibility; all indexed/merge assertions | 6.881s / 120s external; **no original internal file deadline** |
| Public protocol | 9/9 | 0.516s |
| SQLite/projection/reset | 8/8 | 0.566s |
| Retention/outbox/purge | 10/10 | 0.415s |
| Bytes/lease/view-once | 7/7 | 0.616s |
| Carrier admission/immutable keys/cross-arm identity | 14/14 | 1.017s |
| Whole original cap and reset controls | 2/2, unchanged 524,286 population and recovery assertions | 2.020s |
| Whole original movement unit, once | 43/43 | 5.679s |
| Twin/cursor/partial movement | 14/14 | 4.275s |
| Public held/conditional query shapes | 22/22 | 1.067s |

Every public group used unchanged `node --test --test-timeout=10000` with its separate original 30-second outer containment: **129/129 selected public tests**, no reduced populations or sharding. Full evaluator already ran the unchanged Unicode foundation: 20,034 normalization rows plus unlisted scalars, 1,512 C/S folds, boundary/null/astral/metering controls, Q2000/100-scope and index mutation/reference oracles. It was not rerun separately. The 10-second original historical movement failures remain distinct from this source-bound Linux pass.

Local stable checks were separate: caps PID17446 **3.736s/30s**, refs PID17524 **12.591s/120s** (411 LLP docs, 7,682 refs, zero errors/unchecked), diff PID17593 **0.257s/10s**, all exit0. New source was included in the actual caps input via intent-to-add before the check; counts use `split("\n")`, not the earlier historical splitlines assumption.

Portable execution was in the exclusive EPYC directory `/home/ccheever/clique-tooling/search-structural-codec-0ecd-20260907T1130Z-01a07649`, using pinned Node22.23.2, Bun1.3.12 and esbuild0.25.9. All 23,974 dependency records, including symlink targets and containment, were verified in donor and copy; no install. Fresh shared-host capacity observations are in the command/host receipts; they are host protection, not resident measurements or a quiet-host claim. Model receipt records actual gpt-6-astra/xhigh, UUID01a07649-dd08-7990-8d16-16a76e09ffbc, author PID76756.

The existing Linux26c9 checker SHA `2f3cd93ccbff5902465f2514e61d8cf6fedf76228ad8e7abafe02ed5f1959175` was verified and used only in its existing `check --ir --json` role with the immutable native corpus. The valid native/certified initial fixtures are distinct from synthetic malformed, queued-overlay or adversarial later frames. No native owner was built or launched. The branch's whole ir-contract v2 versus runtime v5 mismatch remains a known integration limitation: the unchanged systemPrincipalId field and explicit Runner/corpus identities support this scoped dependency use, not whole-file/native-main qualification.

**Final measurement and frozen custody.** Exact command: pinned Node with `--import final-measure-import.mjs build.mjs --measure-twin`, original 60-second outer bound. Node PID4017409 ran 12:23:12.536706–12:23:13.052143Z, **0.515445s, exit1**. The existing hook changed only external source/manifest/evidence path literals (`measurement-method-diff.txt`); entry/options/compressor/exports are unchanged. No parent measurement, alternative compressor, narrowed roots or repeat was run.

- Complete bundle SHA `9a03c998c6cb40c0078cb7d87d8f0061f3faf66ec7485ed4d65d76738d142c5e`; actual 231,755 bytes.
- Exact 395-byte five-root stdin SHA `3ba527bb0fe022dcaab8b54a20055fe1484cf1a11e1d4744f54e1739d489d2ac`.
- All **51 physical measured inputs + stdin** verified in `final-evidence/`; Unicode decoder/data and every required custom adapter are included.
- `source-checkpoint.json` SHA `d38a4c3e8b1d4e5d5d77afe456d69487b4a78e2af6e2c356350c645834903981` binds the clean commit, four owned snapshots, protected types, all 695 physical/symlink preparation records and every important result artifact.
- All 695 source records resolve to existing immutable local copies; no redundant whole graph re-export. Classification: 412 matching local regular sources, 2 template symlink target records, 1 pinned generated Unicode leaf and 280 native corpus files. The earlier generic nonLocalInputs label included the symlinks; it did not establish their absence.
- All **153 built artifact files** and **151 source-map inputs** were independently hash-verified against the source preparation and retained public build archive. `candidate3-build-verification.json` and `source-copy-resolution.json` record this.
- Protected `types.ts` remains `afc6bc7ffd25fc007787b10e0fc8bdafbe4ae61cb12f7d2442f2c2df95686618`. Official Unicode inputs, generator/decoder/lookup code and generated payload are unchanged.

No production bytes changed after the candidate3 checks or measurement, or after the committed source checkpoint. `owned-source.patch`, exact command terminals and raw first failures are retained. Governing LLP1001/1012/1013 boundaries and LLP1006 asset rules were oriented and cited; no rejected-experiment design prose was added to product. Root owns integration/docs and any later choice. Fresh independent review remains necessary if any part of this candidate is ever retained; passing affected checks does not qualify size, current resident memory, publication or main integration.

The fixed limits remain 66,000/64,000 gzip, format5 S524,288 with the original 524,286 absence controls, 1M steps / 4 MiB closure / 8 MiB execution heap / 1 MiB output, exact Unicode17/Q2000/100 scopes/4N and Exact2 deferral. This stage ends with the rejected isolated checkpoint; no successor implementation is authorized here. **WRITER RELEASED** after final response; the supervisor records the actual launcher terminal/PID absence afterward, not this report.
