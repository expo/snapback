# Search foundation handoff

Committed **69060c4b1f83c2962ce2b406ff15bd37b598c84b**, base **62fa434d842e4cefd8656d5fe18aaf2b567a6690**, branch `s2/clique-search-foundation`. Local worktree is clean; no push/publication. Root integrated only this foundation as1f9b4b95c. Test-only harness484a0ee1 was separately cherry-picked as1c247a9a859433ad0fa695a9992be8ed8c255b47 for proof; root already carries it. [Exact committed file hashes](committed-inputs.json).

## Scope and frozen contract

One shared Unicode17 AOT foundation plus existing LLP/rules decisions. Required/optional text fields normalize independently; null contributes nothing. `NFC(simpleFold(NFC(s)))`, C/S mappings, White_Space union General_Category P* boundaries, exact scalar behavior. Query token occurrences counted before dedup, Q independent of indexed raw field maxima. Search wrappers preserve existing Text C0 restriction; primitive normalization remains total on valid scalars. Source descriptors stay original text, logical equality/coverage use normalized meaning.

Rust public `unicode`/`search_key`; TS evaluator `unicode.ts`/`search-key.ts`. `IndexComponent=Column(String)|WordPrefixes{fields,contract}`; `IndexKeyExpr=Scalar(Expr)|WordPrefix{source,contract,source_max}`; `IndexAtom=Scalar(Value)|WordPrefix{contract,source}`. Contract string `u17-nfc-scf-nfc-wsp-p`. No application Value variant. `prepare_index_atom`/`prepareIndexAtom`, key equality/tuple containment, scalar-only ordering, strict canonical tagged JSON decoder. Derived `ca` receipt does not cover `cat`. Descriptor max canonical UTF8 bytes `4Q+63`. Max implementation scalar count0x3fffffff; U=4N. Shared modeled normalization steps `166Q+1028+ceil(Q/32)`; scratch `96Q+3108+24ceil(Q/32)` excluding input/final output/static tables, using maximum processed N over a reused normalizer. Tokens/dedup/postings/comparison allocations and full heap accounting remain downstream.

Five unchanged official UCD files with SHA256SUMS+LICENSE; both build generators verify hashes and yield table digest **29bb626cbddaec2bce2cc1efcac329a9ea07ee725322155b791005cd7781b9e8**. Rust generator runs via one7-line build.rs and imported unicode_build.rs; JS generator extends existing package build. Generated OUT_DIR/evaluator dist files ignored. No runtime generator/new Unicode crate/gate/registry/repository design document. Active Index.columns/IR/ASCII words are deliberately unchanged until coherent integration.

Existing LLP1000/1001/1011/1012, RULES and NOT-DOING record CURRENT session-delegated indexed search, total34000gzip (30000target), Exact2 deferral and build.rs exception. No fabricated historic author ruling. No final guide changes; parent owns coherent paved-surface amendment when activated.

## Verification

M5 own isolated worktree; no existing test/application lane altered. Explicit Node22.23.2 executable from native verification prefix.

- `scripts/test.sh` on frozen source plus test harness: **753 native tests passed,4 existing skipped**, doctests pass; evaluator202pass plus24server-only and2visibility; new Unicode suite20034officialrows,1512C/Sfolds, all valid scalar identities/boundaries; compiler strict check and400checks pass. Full run129.57s exited1 solely because two owner test files hit their existing10s file limit during initial build/setup. [Full retained log](foundation-node22-tests.log).
- Exact affected rerun, unchanged10s and default concurrency: `node --test --test-timeout=10000 tests/local-data-recovery.test.ts tests/real-owner.test.ts` => **22/22 pass,9.16s**, after warmed binary. [Log](foundation-node22-owner-warm.log). No deadlines or product code changed. The initial failure is retained, not relabeled full-script green.
- `node scripts/measure.mjs --check` => **PASS**,55.99s. Warm build29.48s, incremental2.25s, installed consumer18.86s, product check.774s, doctor.319/.029s, init-to-dev1.278s; all existing limits pass. [Log](foundation-measure.log). Earlier fresh generated core build15.51s used warmed dependencies; final immediate no-op Cargo core build0.10s (Cargo0.06s). No fully cold dependency build claim.
- Ref-check:411docs/7645refs/15886files,0errors. Caps:4482sourcefiles, v1baseline204 unchanged, RULES596words, five checks. Every source<=1500. `git diff --check` pass.
- Existing root `check-inventories` failed inherited v1 inventory/generated artifact drift (scripts/caps.test.mjs already in base; missing ignored demo/trusted-runtime artifacts; stale diagnostics/client projections). No changed v1 implementation/generator/guide inputs. Not repaired across the Snapback2 fence.

## Independent reviews

[Astra review](../../reviews/search-foundation/69060c4b1/astra-review.md): **READY, no material findings**. Fresh CLI configured gpt-6-astra/xhigh; session01a07645-66b3-71f0-a7fa-531d61ebbb59, launcherPID99795/nativePID99799, tool13701. Report conservatively says exact serving variant unavailable; preserved verbatim. Independently tested official conformance,4000mixedUCDstrings, all1,112,064validscalars, pinned hashes and bounds.

[Grok review](../../reviews/search-foundation/69060c4b1/grok-review.md): **READY, no material findings**, configured Grok4.6/xhigh, M5 tool29402, recorded launcherPID31003, exit0. Original stdout and exact extracted final response retained beside the report. Neither reviewer read the other review/coding notes. Both bind69060 against62fa; no foundation repair is required. Hermes/Expo canonical JSON conformance and all integrated limits remain explicit downstream qualification.

## Byte audit and remaining lanes

At62fa (does NOT include21b21abd3), esbuild0.25.9/Node22.23.2/gzip9: existing twin22,004gzip; all-export foundation10,859; additive combined32,277. [Audit](foundation-sizes.json). These are implementation bytes, not integrated qualification. Full candidate must include integrated cursor changes, all Unicode/decoding/index/bridge/prediction/local cursor code and stay<=34000, target30000. Required bytes cannot be moved out of measurement.

Downstream active contracts now agreed: Index.components; every Scan.prefix wrapped IndexKeyExpr; ordinary Read.key remains Expr[]; receipt/trace range prefixes IndexAtom[]; points/suffixes/bounds remain ordinary values. Model identity i53-codepoint-bytes-unicode-search-v3; evaluator bounded-spike-rust-search-2. Compiler owns compiler IR/lowering, engine Rust/schema/certificate/receipt/export, twin evaluator/types/hash/receipt/client/store. Merge.held_search follows accepted compiler proposal; before/range lanes are ineligible for alternate held execution and retain ordinary replay. Engine certifier verifies metadata against actual source rule/discovery/merge.

Parent owns consolidated prose/integration. Engine native postings/GC/write ledger/pooling/ScopeTouch, compiler authoring/held descriptor, and twin persistent indexes/negative overlays/readable directory/h1 cursors remain implementation/qualification work. No search capability, maximum integrated closure/heap,100k latency, phone memory/cold-restart or final bundle claim is made by this foundation.
