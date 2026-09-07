Astra independent review — frozen range preparation and cumulative R8

Correctness/ownership verdict: **NEEDS_CHANGES**. One reproducible P2 defect remains in generic database replacement: metadata is split before JSON normalization, so an existing child changed to `undefined` fails, and trailing array holes silently disappear. It occurs in the R8 baseline, direct parent, and current snapshot; it is not introduced by the new range preparation. The requested cumulative review explicitly does not trust the base. I found no additional blocking defect introduced by the 15-path direct change.

The separate size result is **75,799 gzip bytes: FAIL**, 9,799 above the 66,000 ceiling. Correcting the finding below would not change that qualification. Integrated native/compiler/main, resident, phone, and publication qualification remain pending.

**Scope and custody**

I read `../packet/context.md` in full before reviewing source. I used only the immutable packet, its supplied contracts/source/tests/raw evidence, and small diagnostics written in this reviewer directory. I did not read peer/prior reviews, the excluded issue narrative, author reports/design narratives, a moving worktree, or benchmark application context. I used no subagents and ran no build, installation, test suite, native checker, remote command, resident workload, or device check.

The exact snapshots are:

| Role | Commit |
| --- | --- |
| Current | `23a0e54e82106ae28090bd379e197fcb0f7717d6` |
| Direct parent | `2ce04895fa833ef40d8aad4e06b86c4ddae29a8c` |
| R8 baseline | `e1c6e2b79a9e13ceb363f647f52807218aa2b57a` |
| Supplied native reference | `26c9fd5e0d3922ce7680493c0e8f7371f4793d59` |

I verified the packet manifest SHA-256 as `8829ed3761adbda7f0277c63e985e04592f29e8b569b8bbc8bc1ce02494e7af3` and verified every one of its 2,261 file records. I independently mapped and hashed all 694 candidate3 source-manifest entries against the exported source and supplied native corpus: zero missing entries or mismatches. The measurement metafile has 50 implementation/data inputs plus `<stdin>`; all 50 match the frozen export byte for byte. The corresponding results are in [source-graph-verification.json](source-graph-verification.json). These checks establish correspondence, not independent execution of the captured builds.

I reviewed the direct and cumulative source changes and followed the current execution graph through checked delivery admission, range preparation, indexed coverage, carrier fact custody and projection, Twin hydration/evaluation, and public offline result selection. Supporting review covered Unicode/search admission, typed index bounds, ordered/posting/prefix structures, certificate/cursor fences, row-image adapters, swap journaling, and carrier publication. The source guidance included both applicable AGENTS files, RULES/NOT-DOING, LLP 1000/1001/1011/1012/1013, and the supplied offline/live guides. The packet's explicit current contracts govern where older prose differs.

**P2 — Normalize generic replacements before splitting metadata children**

Source: [projection.ts](../packet/source/snapback2/packages/snapback2/src/store/projection.ts), lines 39–47 and 60–64; [metadata.ts](../packet/source/snapback2/packages/snapback2/src/store/metadata.ts), lines 9–19. Public reachability: [sqlite.ts](../packet/source/snapback2/packages/snapback2/src/store/sqlite.ts), lines 101–105; the IndexedDB carrier calls the same preparation at [indexeddb.ts](../packet/source/snapback2/packages/snapback2/src/store/indexeddb.ts), lines 137–142.

The contract is explicit in `projectState` lines 12–14, LLP 1013 §3, and the existing `sqlite.test.ts` round-trip test at lines 30–60: generic replacements have the JSON wire form, omit undefined object fields, retain null, and turn undefined array slots into null. Future metadata roots are deliberately included in this contract. The existing test explicitly sends raw JS values containing undefined through direct backend replacement before common-store normalization.

`ProjectionCache.prepare` takes raw state directly on generic replacement. `metadata(state)` enumerates an object's raw own children and gives an array root an empty-array header. The `put` closure then normalizes each child independently. If a child is `undefined`, it skips it only when the key was never committed; for an existing key it calls `JSON.parse(undefined)`. In addition, enumerating array keys cannot retain trailing holes or array length. The public `projectState(state)` normalizes the whole state first and produces the required result, so these two projection paths disagree.

Independent results, identical in all three snapshots:

| Replacement of `futureMetadata` | Required normalized result | Actual cached projection |
| --- | --- | --- |
| `{a:1,b:2}` → `{a:undefined,b:2}` | `{b:2}` | `SyntaxError` parsing undefined |
| `['a','b']` → `[undefined,'b']` | `[null,'b']` | `SyntaxError` parsing undefined |
| `['a']` → `new Array(3)` | `[null,null,null]` | `[]`, length 0 |
| `[]` → `[undefined,'b']` | `[null,'b']` | JSON-equivalent result; control case succeeds |

The public `SqliteBackend` diagnostic independently confirms reachability in current source. For the object-child case it returns `E_OFFLINE_CARRIER`, starts zero replacement transactions, and reopening returns the previous `{a:1,b:2}`. For the trailing-hole case it completes one replacement transaction, then reopening returns `[]`. That diagnostic uses a synthetic transactional Map driver and the exact exported backend code; it does not claim real SQLite execution. The identical projection defect is shared with IndexedDB by source inspection; I did not execute an IndexedDB implementation.

Impact: a valid generic replacement can fail with a misleading carrier-opening error or successfully persist different metadata. The failure case leaves the prior baseline intact; I am not claiming partial transaction publication. The silent array-length loss is a cold-state correctness error. The normal `PersistentRangeStore` commit path generally normalizes state upstream, which limits exposure, but the public backend replacement seam and its explicit normalization contract remain affected.

Attribution: **inherited before R8**, present in `r8-before`, `before`, and `source`. The new root-to-child ownership index fixes a different deletion problem and does not fix this normalization defect. The existing tests cover fresh undefined children and nested arrays inside a child value, but not an already persisted child becoming undefined or a metadata-root array ending in holes.

Required correction: normalize the generic full replacement before discovering/splitting entries, or otherwise implement exactly the same omission and array semantics as `projectState`. Do not merely skip every undefined child: that would retain an old committed key unless it also becomes a removal, and would still lose array length. Preserve the journal-bounded warm path and the keys-only committed baseline. Add regression coverage for the three failing transitions through direct replacement and cold reopening, including a failed publication followed by retry. No packet source was changed during this review.

Reproduction sources and results are preserved here:

- [projection-probe.ts](projection-probe.ts), [projection-runs.json](projection-runs.json), and the three `projection-*.stdout.json` files compare application of the exact source delta with `unprojectState(projectState(next))` in R8 baseline, parent, and current.
- [backend-probe.ts](backend-probe.ts), [backend-run.json](backend-run.json), and [backend.stdout.json](backend.stdout.json) exercise current public backend replacement and reopening with the synthetic driver.

**Direct range preparation and ownership assessment**

The core separation is sound in the paths reviewed. [range-preparation.ts](../packet/source/snapback2/packages/evaluator/src/range-preparation.ts) retains immutable typed parameter meaning, schema identity, and exact issuing scan identity. It does not retain a row pool, membership owner, authority map, callback, or program backlink. `RangeReceipt` separately owns membership/halo/eviction fields and carries a private nominal association with that core. Raw objects do not gain trust from being frozen or having a matching public shape. Public receipt conversions clone into independently mutable DTOs.

The derived-prefix path obtains Q from the matching issuing scan, including table/index, prefix width, and derived-slot shape. A different schema or scan identity causes re-admission; an unbound derived Q cannot use the prepared shortcut. Raw source spelling remains distinct from normalized logical token meaning. The first wire pass tags every range's fields before the second pass validates complete bounds, preserving the multi-range refusal order. Typed suffix width/domain/order checks still go through the established index routines. The supplied 42-case parent/current bound-parity diagnostic reports identical results, but does not establish exhaustiveness for every malformed input.

`RangeReceipt` defines enumerable own fields rather than assigning through the prototype setter; an own `__proto__` survives without changing the prototype. The transitive `immutable` walk visits nested children even if an outer wrapper is already frozen. Private associations survive the intended synchronous ESM arms through the existing `image-runtime.mjs` module. Build routing includes normal client/carrier arms, nested Expo witness with its relative import, and test arms. The module is not a new package export or global registry; the full-runtime measurement continues to inline these bodies and Unicode data.

[CoverageIndex.set](../packet/source/snapback2/packages/evaluator/src/coverage.ts), lines 50–115, constructs and validates the next ranges, issuing positions, absences, and verdicts before removing an old owner. Membership, expected positions, loss sets, extents, last positions, exact counts, and span ownership remain separate from shared parameter data. The semantic-equal branch compares those retained meanings, then adopts only the incoming immutable `value`/`logical` references on the existing range owners. It neither removes/re-adds counts nor reports a semantic change. This fixes candidate2's obsolete equal-FULL/replay parameter reference without discarding movement/loss history.

I independently compared the captured semantic snapshots: initial, warm, equal FULL, replay, and cold have identical rows, revisions, exact counts, groups/spans, expected positions, and loss sets. They all share the current parameters/logical meaning and current RowImage; cumulative parameter constructions are 1, 1, 2, 3, 4, with zero during hydration. The native halo fixture has empty absence/verdict maps, so this does not demonstrate nonempty authority behavior. The indexed tests separately exercise disagreement/count replacement and failed owner replacement; the source preserves their owner-based bookkeeping.

The new `MetadataKeys` keeps one root-to-encoded-child-key map, with no parallel flat ownership set or payload cache. Changed-root reconciliation inspects that root's committed children and removes them when the root disappears, becomes scalar/null, or shrinks. Key ownership advances only through the callback after successful SQLite/IndexedDB commit; aborts keep the prior baseline. Empty roots and close release their keys. Normal journal changes avoid scanning unrelated child history. The supplied raw parent reset diagnostic demonstrates the previous stale `superseded` children after a successful clear and cold reopening; the new reconciliation and reset regression address that defect. This positive conclusion is distinct from P2 above.

**Cumulative R8 and current execution graph assessment**

The following conclusions come from static tracing and the specifically attributed captured evidence, not from a new integrated run:

| Area | Current behavior checked |
| --- | --- |
| Row ownership and JSON boundary | Nominal immutable `RowImage` is shared by carrier/effective current rows where semantically equal. Optional omission remains distinct from explicit null via sparse outward adaptation; generic inputs are cloned and validated. `ImageKeys` retains immutable index assertions without row bodies. Projection no longer retains serialized row payloads. Body collection does not erase still-owned historical key proofs. |
| FULL replacement and movement | Coverage takes every interior issuing position from the answer's immutable proof keys. The ordinary fallback is explicitly guarded by `answer.nextSeq !== undefined` and `state.rowSeq[key] === answer.nextSeq` in `twin-store.ts` lines 193–204; a conditional answer sequence is not substituted. Missing custody produces a coverage hole/FULL requirement instead of reconstructing historical positions from moved current bodies. |
| Complete extents and all IDs | Closed extent constraints are retained and queried beyond current receipt members. Ordinary and timed enrollment preserve scope, bounds, normalized prefix and sequence; absence outside a scoped extent is not promoted to primary-key absence. Indexed incoming positives and retained extents handle unknown IDs, nonmembers, moved rows, same-sequence contradictions and both arrival orders. |
| Atomicity and batch behavior | Fact preflight considers eligible images across the swap before refresh publication and does not let a later version hide an earlier conflicting assertion. SwapJournal retains rollback custody across failed backend publication. Extent/row/verdict proofs and output state are published together. Scoped holes dominate overlays without becoming global tombstones; outbox/overlay recovery is retained on reset. |
| Clocks and conditionals | Durable sequence remains primary. Present readTime is signed, safe, exact, and rejects negative zero; equal-sequence advancement is tied to checked timed query custody. Older frames are stale, identical replay is stable, and a newer checked clock can replace a timed result. Missing ordinary conditional proof requests one FULL while preserving healthy state. Clock-only frames do not advance log watermark or retirement evidence merely by advancing time; explicit durable facts remain meaningful. |
| Coverage and public result | Loss of returned/interior/halo positions invalidates the appropriate coverage; overlays alone cannot manufacture an Exhausted receipt from Limit. Immutable held suffixes and expected positions survive warm/cold reconstruction. `answerOffline` obtains local evaluation for non-retained answers, and `offlineView` uses that result, including `partial`, so a stale cached capped answer cannot conceal moved-row coverage loss. Retained answers use their held semantics. |
| Query/cursor/authority fences | Program/certificate generation, schema, principal/authority, bindings, row/overlay revisions and incarnation continue to fence evaluation and h1 local continuation. Search-only argument normalization does not replace ordinary uses of the raw argument. h1 is consumed locally; opaque server cursors retain their separate behavior. Coverage absence/verdict agreement remains separate from row presence and scoped extent facts. |
| Search and execution limits | Unicode 17 data and the NFC(simpleFold(NFC)) C/S-fold contract remain pinned. Query Q and field N are independent, derived word work is bounded at 4N, wrapped Scan/index keys are validated, and words execution now charges bounded work/scratch. Directory discovery is bounded separately from posting traversal. The v5 Runner constants stay explicit; the branch ir-contract contributes systemPrincipalId rather than silently supplying an older runtime identity. |
| Logical capacity and physical ownership | `S = 524288`, fact format 5, proof/key/extent charges, and the original 524286-negative saturation setup remain intact. Removing duplicate bodies, parameter copies, or payload strings does not buy logical fact slots. There is no replacement combined live-metadata-plus-S acceptance gate. Extent/positive indexes and prefix/posting structures retain indexed lookup and cleanup rather than a warm all-scope/history fallback. |

The cumulative fixes align with the supplied historical raw counterexamples: current effective rows adopt a new equal authenticated image without semantic revision churn; projection retains keys rather than serialized body strings; sparse optional own-property handling survives raw/cold adaptation; immutable interior positions repair delayed FULL replacement; and local partial evaluation is exposed through the public offline result. The historical raw probe outputs are observations about their captured earlier inputs, not failures newly rerun against this snapshot.

The governing fixed execution budgets remain 1,000,000 steps, 4 MiB closure bytes, 8 MiB execution heap, and 1 MiB output. Q=2000 and 100-scope discovery are independent search bounds. This review grants no increase to any of these limits and does not count physical reference sharing as evidence of budget headroom.

The integration prose still needs reconciliation. LLP 1013 lines 272–277 describes the immutable previous-state hint as the reason unchanged history avoids work, while current `ProjectionCache` uses the journal and ignores `_previous`; it should document root-indexed committed key ownership and generic rewrite behavior. Older budget/timed-only descriptions likewise cannot replace this packet's current contracts. I treat this as documentation work remaining for integration, not another demonstrated runtime failure.

**Actual checks and limits of supplied evidence**

Reviewer execution was limited to hash/static checks and four tiny source diagnostics. The three projection runs used Bun 1.3.12 with a 10-second outer limit and completed in 0.025443, 0.025766, and 0.025524 seconds. The backend diagnostic completed in 0.072910 seconds with the same limit. All launcher exits were zero and stderr was empty because the diagnostics record expected/actual values and caught failures rather than treating them as process crashes. These are defect observations, not four passing product tests.

The exact local Bun SHA-256 is `39e644cea4e6db24a3af36013695655d6f789b4b98f1f13bacb882ac6e5c3c18`. I also verified the supplied local Node 22.23.2 binary hash, `18e387c90ab8a8400183e8bdd396376e1e875b91b4c874b894dcade7b35bf572`; I did not use it to run a product build or suite. Probe code, arguments, elapsed times, output, runtime hashes, packet/source hashes and report custody are preserved in this directory.

The packet records these executions; I inspected them without rerunning them:

| Captured execution | Result and attribution |
| --- | --- |
| Candidate2 package build / evaluator | Exit 0; 3.171829 / 6.580285 seconds, each at 120-second outer deadline. |
| Candidate2 focused store / Twin / public projection | 44 / 12 / 13 passes; 1.617144 / 1.116822 / 1.016529 seconds. |
| Candidate2 delayed FULL / image | 1 / 2 passes; 0.264817 / 0.315088 seconds. |
| Candidate2 SQLite | Original run: 4 pass, 1 fail, exit 1 at the reset regression's wrong `.list` API. The exact two `.all` substitutions then pass that one test in 0.365045 seconds using the captured emitted arms. This is a preserved setup/test API failure, not an original all-pass run. |
| Candidate2 cap / movement | 2 / 43 passes, 2.019181 / 5.578151 seconds. Original Node internal test timeout remains 10 seconds, outer 30 seconds. The saturated input remains 524286 negatives. |
| Candidate2 sharing | Exit 1: equal FULL/replay did not share current coverage parameters although current RowImage sharing remained true. |
| Candidate3 package build | Exit 0, 3.171851 seconds, outer 120 seconds. |
| Candidate3 evaluator | First helper invocation omitted checker arguments and failed with Python IndexError before launching the evaluator. Corrected invocation against unchanged source exits 0 in 6.580799 seconds, outer 120 seconds. The captured evaluator summary has 225 passed cases, 24 server-only and 0 failed, with normalization/indexed/search checks. |
| Candidate3 sharing / semantic derivative | Both exit 0, 0.164350 / 0.164597 seconds, outer 15 seconds. Same original sharing frames plus the separately recorded semantic comparison; no heap or latency inference. |
| Candidate3 coverage refresh / Twin | 5 / 12 passes, 0.515372 / 1.066832 seconds, Node internal 10-second and outer 30-second limits. |
| Parent/current range parity | The supplied 42 cases have identical recorded outputs. No new range parity run was performed here. |

Candidate2 cap/movement and other retained checks are reused evidence, not candidate3 reruns. The captured source comparison limits candidate2→candidate3 to `coverage.ts`, `range-preparation.ts`, `test-indexed.ts`, and `sqlite.test.ts`; the last adopts the exact `.all` API correction. That correspondence and the targeted candidate3 reruns support the reuse, but do not turn it into a complete candidate3 suite execution.

The supplied native checker hash is `2f3cd93ccbff5902465f2514e61d8cf6fedf76228ad8e7abafe02ed5f1959175`; corpus correspondence covers the supplied 280 native inputs. Native fixture provenance and captured cross-checks do not establish integrated branch compiler/main correctness. I did not execute that checker. Real Node SQLite evidence belongs to the supplied capture; fake IndexedDB remains fake, and my Map-driver diagnostic establishes JS seam behavior only. No candidate3 resident execution exists, and constructor/reference counts do not measure heap retention or user latency.

**Separate code-size and integration result**

The exact original five-root boundary is preserved in [final-entry.ts](../packet/evidence/candidate3/measurement/final-entry.ts): Twin/local helpers/types, PersistentRangeStore, OfflineRuntime/offlineView, carrier projection, and receipt protocol. The measured graph includes the adapters, data, and private preparation bodies; there is no narrower replacement boundary or measurement-only export substitution.

Pinned Node 22.23.2 `gzipSync(level:9)` with esbuild 0.25.9 records current **231,741 minified / 75,799 gzip**, compared with parent **227,718 / 74,399**. Both fail the 66,000 ceiling; the target is 64,000. This stage adds **4,023 minified / 1,400 gzip**. The final measure command correctly exits 1. Minified `bytesInOutput` attribution includes range preparation +4,692, coverage −1,052, protocol −916, metadata +659, and range store +653; these are not additive gzip contributions.

I make no quantified size-saving claim from shared references, removed runtime copies, narrower roots, or constructor counts. A redesign would need an actual removable implementation/state body and an explicit account of the validation, ownership or fact-retention semantics being moved or lost. No such redesign is qualified by this review.

The remaining correctness action is the P2 generic replacement normalization fix and its targeted regression coverage. Size reduction and the pending integrated/native/compiler/main/resident/phone/publication work are independent requirements. The reviewed direct parameter-sharing repair is supported by source and bounded evidence, but the full current correctness verdict cannot be READY with the reproduced inherited carrier defect outstanding.

NEEDS_CHANGES
