READY

Scoped independent R29 compiler review of frozen candidate **ef88cac15a948418d1f6d620713065ab9b57e40f**, against its actual parent **9995d41a45b61bbebb79b6b239a6b7bddaf6e4ec**. I found no change required in this delta after source inspection, the explicit reuse audit, and the bounded controls below. This is compiler clearance within the supplied scope; the affected type closure still exits **1** with seven inherited evaluator diagnostics.

Reviewer: Codex, known model identity GPT-6, family `astra`. The supervisor retains authoritative native CLI identity and terminal status. No additional model revision is claimed.

I read the supplied governing AGENTS, Snapback2 fence, RULES/NOT-DOING, LLP1000/1002, and packaged Quarry guide before semantic dispatch. Work stayed in the assigned local and remote family directories. Frozen inputs and product sources were not edited. No author/peer review narratives, sibling review directories, native/Rust/build/server/package/benchmark/competitor reruns, or M5 work were used.

The archive comparison establishes nine production compiler paths, one persistent-case path, and LLP1002 as the eleven changed paths. The candidate and parent compiler Git archive PAX comments name the exact commits above. All 229 candidate compiler leaves match both the supplied expanded compiler and the release compiler archive; the parent archive has 227 leaves. [Initial custody](custody-initial.json) records every leaf, hash, archive identity, and changed compiler path. The outer input archive available here was actually inspected: SHA256 `fa51b95c556cb7e307f3fa4571d37761e99f47cb0f361c3459569d1eddbd0545`; input manifest SHA256 `d72bbb8fba4ba3d4c0c5ca5c8dfe8779c270fe1fc041e1a777792c343af1faa9`. All 2,168 manifest leaves matched local and archived bytes. This makes no claim of inspecting the unavailable historical outer archives referenced inside supplied receipts.

The central witness is a real nominal restriction failure in the actual parent. Its checked-private, no-cast operation starts with `let key=args.foreign; key=args.local;`, reads through `key ?? args.key` inside a bounded loop, and assigns `args.foreign` afterward. The supplied parent result reads `local-key`, then `foreign-key`, and returns the held `lefts["foreign-key"]` row with `length:91`, `next:"id-1"`, and no writes. The draft refuses the read with `E_ARGS_TYPE`. I inspected the actual [source and full parent artifacts](input/factual-inputs/remote-complete/projects/base/paired-0/loop_returns_foreign_row/) and independently confirmed its supplied result hashes. The separate direct-local-initializer companion remains an inherited issue relative to f23b; I did not reattribute it using that older base.

The implementation addresses the temporal cause of that witness:

- [loop-origins.ts](input/snapback2/packages/compiler/src/lower/loop-origins.ts) constructs entry cells before checking affected body reads and captures. It joins initial sources with reachable fallthrough/continue backedges only when the static maximum exceeds one. Breaks contribute exits; returns do not contribute backedges or ordinary exits. Exits include the initial state for a possibly skipped loop. The zero-bound exit omits body writes.
- [operation-context.ts](input/snapback2/packages/compiler/src/lower/operation-context.ts) discovers assigned lexical bindings rather than matching identifier spellings indiscriminately. The actual runtime identity of the newly declared iteration binding is excluded from inherited cells. Nested loops can still track assignments to an outer iteration binding within that outer iteration. Nested same-name declarations have separate identities.
- Definite assignments replace reaching sources after lowering the RHS. The RHS and earlier aliases/object captures retain binding-time environments. [branch-bindings.ts](input/snapback2/packages/compiler/src/lower/branch-bindings.ts) merges live branch values while shared exit lists retain branch-specific break/continue states. Nested loop exits feed the enclosing flow. Historical diagnostic candidates remain separate from the sources that can restrict a current read.
- [nominal-targets.ts](input/snapback2/packages/compiler/src/lower/nominal-targets.ts) traverses source/cell graphs with environment or binding identity and the selected member path. An active revisit contributes no additional target while other incoming edges are still explored. Tuple alternatives merge by position. Member selection follows captured sources and authored overrides; it does not consult schema columns to invent missing members.
- Entry cells contain `Computed`, ambiguity, and negative source alternatives. They do not create presence, shape, row, bound, numeric, direct-read, or destination-conversion facts. The positive provenance classifier still rejects direct ambiguous reads. The nominal walk emits no runtime operands. The new origin-planning environment separates diagnostics, runtime binding ledger, source sites, access ordinal, temporaries, recursion state, and mutation counts; collection planning also isolates the flow exit lists.

These observations are supported by the complete-project comparisons, not solely comments in the implementation. All five newly accepted-by-both pairs have byte-identical complete IR, API text, and evaluator results. Their full `lowerProject` output objects are equal after omitting only `ms`, including all source-site entries. There was no new register, read-site, or IR contamination in those pairs. The selected RHS callbacks also assert allocation counts, point-read order, and errors, including unused helper arguments. No evaluator truthiness or native implementation changed.

The required **REUSE** assessment is affirmative, with precise attribution. [Supplied evidence audit](supplied-evidence-audit.json) checks the packaged source files, full IR/API/results, and actual process stdout/stderr hashes. The original 36 project pairs ran on **base/draft**, the original 72 callbacks on **final**, and the later three iteration project controls on **base/draft/release**, with three callbacks on release. I do not describe the original observations as release reruns.

| Supplied actual-parent/draft project transition | Cases |
| --- | ---: |
| Accept → refuse | 9 |
| Refuse → accept | 5 |
| Accept → accept | 13 |
| Refuse → refuse | 9 |

All thirteen accepted pairs have identical complete IR and API text. Twelve have identical serialized results; the unsupported nonBoolean OR case preserves `E_TYPE: expected bool` but differs in error-stack source paths. All 75 supplied callbacks passed. The two lawful fresh-iteration controls were accepted by actual9995, refused by draft, then restored by release with byte-identical complete IR/API/results. Their current-foreign negative control refuses on all three versions.

I compared exact draft/final/release archive leaves. Draft→final changes only persistent cases. Final→release has precisely the production change passing the actual iteration runtime identity to `planLoopOrigins` and excluding it from inherited cells, plus persistent cases and LLP1002. The final persistent-case file is an exact prefix of the release file, so the original callback definitions remain unchanged.

[Reuse inspection](evidence/reuse-inspection.json) resolves all 72 frozen callback names to their actual source objects, preserving source/schema hashes and full source bytes. An independent lexical AST walk found no assignment to the actual for-of iteration binding in the 36 original private project sources or the original private callback sources. The three public Quarry sources containing loops were additionally read directly: `public allocated lazy`, `public allocated eager`, and `public inserted full snapshot`; none assigns `key`. The other selected public sources have no loop. The same walk detects the assignments in all three newly affected iteration controls. Thus the release exclusion is inapplicable to the original sources. This is semantic reuse justified by the exact changed condition and source identities, rather than an assertion of byte repetition on release. Fresh nested-binder controls below additionally exercise that boundary.

New complete-project work comprised **14 sources × parent/candidate = 28 invocations**, in serial shards of 12 and 2. [Comparison](new-project-comparison.json), [first shard inputs](controls-a.json), and [zero-bound inputs](controls-zero.json) retain the exact sources, schemas, and tagged evaluator inputs. Every project directory contains its source, `case.json`, full project response, and, when accepted, complete IR/API, fixture receipts, and evaluator results.

| New source(s) | Actual parent | Candidate | Assessment |
| --- | --- | --- | --- |
| `static_max_1` | Accept | Accept | Complete IR/API/results preserved; no second-entry pollution |
| `static_max_2` | Accept | E_ARGS_TYPE | Parent returns length91 after local then foreign reads |
| `cycle_foreign` | Accept | E_ARGS_TYPE | Foreign origin carried through another binding is retained |
| `cycle_local_generic` | Accept | Accept | Lawful graph cycle preserved |
| `nested_fresh_outer_inner_backedge` | Accept | E_ARGS_TYPE | Fresh outer binder does not hide a foreign inner-loop backedge |
| `nested_fresh_shadow` | Accept | Accept | Separate fresh same-name bindings preserved |
| `conditional_return_exit` | Accept | Accept | Returning foreign branch does not pollute a later iteration |
| `nested_break_postread` | E_ARGS_TYPE | E_ARGS_TYPE | Inner break keeps the foreign post-loop restriction |
| `post_loop_capture_then_reset` | E_ARGS_TYPE | E_ARGS_TYPE | Later reset cannot change an earlier capture |
| `shadowed_domains_reset_sites` | E_ARGS_TYPE | Accept | Definite reset before nested reads restored; local reads and next id1 |
| `static_max_0`, `zero_domain_post_loop` | E_ARGS_DESCRIPTOR | E_ARGS_DESCRIPTOR | Initial argument descriptor max0 is unsupported; retained as first failures |
| `empty_literal_post_loop` | E_ARGS_TYPE | Accept | Valid empty domain keeps the pre-loop local value; returns length11, next id1, one local read, no writes |
| `empty_literal_body_read` | Accept | Accept | Valid static maximum zero; no reads, local key, next id1, no writes |

For the new three foreign-backedge refusals, the actual parent's two-element input returns `selected:"foreign-key"`, row length91, `next:"id-1"`, trace keys `[local-key, foreign-key]`, and no writes. Those sources are all checked private without casts. For example, the complete max-two source is in [parent source](evidence/projects/base/adjacent-a/static_max_2/snapback/probe.ts); its decisive body is:

```ts
let key=args.foreign;
key=args.local;
for(const u of args.values){
  const selected=key??args.key;
  const row=db.get(lefts.byId,selected);
  if(u===args.key)return {selected,row,next:ctx.newId()};
  key=args.foreign;
}
return {next:ctx.newId()};
```

Here `values` has declared maximum two, `foreign` is a `rights` reference, and `local` is a `lefts` reference. The exact fixture sets values to `[local-key,generic-key]`, with `args.key=generic-key`; the two held rows have lengths11 and91. Candidate [full response](evidence/projects/candidate/adjacent-a/static_max_2/full.json) refuses the read key, and contains no IR or API artifacts. Changing the declared maximum to one is the separately executed accepted pair above.

The **12 new selected callbacks** all pass on candidate. Their [exact selection](review-selection.json), [registration/results](evidence/checks-selected/review/insert/0/), and [actual execution receipt](evidence/results/callbacks-review/execution.json) retain the frozen names. They cover R28 foreign→generic and foreign→same-table overwrites, nested branch resets, public nested nullish same-table selection, lawful and wrong-second tuple positions, per-iteration RHS allocation, RHS error before read, nested definite reset, and all three release iteration-binding cases. They ran through the supplied corrected `checks-selected.ts` with a short hash-bound selection JSON. The original runner and original ENAMETOOLONG failures remain supplied unchanged; those original failures occurred before callback Popen. Callback evidence consists of the retained sources/definitions, registration, and assertion results; the supplied callback helper deletes its temporary project directories, so I do not claim extra per-callback full-project dumps survived.

New type work used the supplied normalization scripts unchanged:

| Closure | Files | Actual PID | Actual exit | Result |
| --- | ---: | ---: | ---: | --- |
| Production | 90 | 9759 | 0 | No diagnostics or external-control diagnostics |
| Affected callable tests | 114 | 9824 | 1 | Exactly seven evaluator diagnostics, entire-equal to control and supplied release objects |

The [affected result](evidence/artifacts/test-types/candidate/result.json) preserves every diagnostic's complete file/start/code/message object, along with all source hashes and the full control array. The two runner diagnostics concern missing `halo`/`n2_suffix`; the other five concern `IndexAtom[]` versus `Value[]`. [Post-run verification](evidence/verification-after.json) and the actual [exit1 receipt](evidence/results/types-affected/execution.json) establish equality without filtering foreign errors, duplicating `packages/packages`, or converting the wrapper outcome to zero. This is not package-green.

The governing inbox grant was fully consumed. Its later platform update caused the first capacity dispatch attempt to stop locally on the stale acknowledgment, before SSH. The updated inbox was fully read before proceeding. The three approved handshake helpers remain byte-identical to the supplied templates. The fresh capacity receipt shows actual remote `DISPATCH_READY`, matching full-current-inbox SHA256 `acf1046e1f48edeb9dd67ab81af18feec14ebbc6f4ba15d69d04a0645dc45b8b`, local acknowledgment at readiness, and only then capacity child PID8140. The setup child PID8458 repeated that exchange and verified exact source/runtime/dependency inputs before semantic children. Capacity showed 96 CPUs, load below1, and approximately255GB available memory.

Runtime inputs were pinned Node22.23.2 and Bun1.3.12 with the requested binary hashes, TypeScript5.9.2, and all320 prepared dependency files. PATH was exactly the two pinned tool directories followed by `/usr/bin:/bin`. The protected evaluator/types.ts, generated Unicode, and prepared effects declarations matched their supplied hashes. The compiler's source `effects-lib.d.ts` remained the distinct source file. The setup records retain the full source inventory; 195 common support leaves also match the supplied actual-parent source manifest. Before/after verification covered both constructed source trees, dependencies, and all frozen input leaves. No current-main or replacement checker inputs were introduced.

| New semantic child | PID | Seconds | Exit |
| --- | ---: | ---: | ---: |
| Parent 12-case shard | 8879 | 0.766 | 0 |
| Candidate 12-case shard | 9050 | 0.766 | 0 |
| Candidate 12 callbacks | 9636 | 0.817 | 0 |
| Production types | 9759 | 3.726 | 0 |
| Affected types | 9824 | 4.426 | 1 |
| Parent 2-case zero shard | 10891 | 0.416 | 0 |
| Candidate 2-case zero shard | 11110 | 0.416 | 0 |

Every actual remote child receipt records PID, complete argv, cwd, explicit PATH, tool/input hashes, stdout/stderr hashes, actual exit, and duration. Every child remained under the original30-second deadline and every transport under45 seconds. [Final custody](custody-final.json) verifies the actual readiness/ack exchange for each completed child. Only28 project invocations,12 callbacks, and2 type closures were newly consumed; unused allowance was not exhausted.

Exact executed compiler commands, under the family remote cwd and approved dispatcher, were `bun probe.ts controls-a.json base adjacent-a`, the corresponding `candidate` invocation, `bun probe.ts controls-zero.json base adjacent-zero`, its candidate counterpart, `bun checks-selected.ts candidate insert 0 12 review-selection.json review`, `node production-types.mjs candidate`, and `node test-types.mjs candidate`. The actual pinned executable paths and input digests are in the receipts. Reproduction requires fresh owned receipt/output labels; completed children were not rerun for collection.

Setup/inspection limits are retained rather than erased. The initial local archive-check attempt yielded a session whose final stdout/exit was not recovered through the tool result; its command used a Python3.9-incompatible `tarfile` filter argument. The corrected streaming metadata check succeeded. The first helper upload failed because the owned remote directory did not yet exist; its complete transport failure is retained. The first reuse-inspection source had a syntax error; v2 then deliberately stopped for manual Quarry-loop inspection; v3 preserves those public sources and completes the lexical audit. All three script snapshots and remote failure receipts remain in evidence. Neither inspection correction invoked a project compiler or callback. The initial zero-argument-descriptor refusals were retained and the valid empty-literal clarification used two additional paired cases. Original supplied draft failures, error stacks, runner versions, and type exits remain untouched.

Collection used a bounded1,324,733-byte archive of completed owned outputs, SHA256 `9cdf1d1be8830f18978f29bced98a757dc2dcfbe62384c059e991081be693ad3`. Its [manifest](evidence/evidence-manifest.json) covers743 leaves and excludes itself; all743 leaves and archive/manifest hashes were verified locally. The collection child's completed receipt/stdout/stderr were collected separately afterward and verified in final custody. Parent and candidate source/IR/API/results are locally present. Unchanged dependencies were not recopied for collection. No collection timeout or semantic rerun occurred.

The remaining scope boundaries are explicit. The outside-loop early-return form still refuses in both supplied versions. Optional-reference/null and sorted-any limitations remain separate inherited limits. Positive authority is not inferred from a negative nominal graph. Existing same-table/generic/null selections, R28 lawful overwrites, nested selected members, direct ambiguous refusals, and public/private authoring boundaries are covered by source inspection and the attributed supplied/new controls above. No public grammar, blanket loop refusal, schema fallback, truthiness change, or native change was introduced. Independent native/current-main reconciliation and cumulative product qualification remain outside this review.
