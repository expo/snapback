# Independent review: frozen 23a0 vs 2ce, and cumulative e1c6 R8 graph

**Reviewer:** grok
**Frozen commit:** `23a0e54e82106ae28090bd379e197fcb0f7717d6`
**Direct parent:** `2ce04895fa833ef40d8aad4e06b86c4ddae29a8c`
**R8 base:** `e1c6e2b79a9e13ceb363f647f52807218aa2b57a`
**Packet SHA-256:** `8829ed3761adbda7f0277c63e985e04592f29e8b569b8bbc8bc1ce02494e7af3` (matches supervisor prelaunch and this prompt)
**Native reference named, not re-run:** `26c9fd5e0d3922ce7680493c0e8f7371f4793d59`

## Verdict

**READY** for correctness and ownership of frozen 23a0, including the unlanded R8 execution graph from e1c6 through 4e927 and successors.

This is not a landing, size, native-integration, compiler/main, resident, phone, or publication verdict.

## Size (not waived)

Pinned Node 22.23.2, `gzipSync({level:9})`, esbuild 0.25.9, five-root `evidence/candidate3/measurement/final-entry.ts` (unchanged from parent):

| | minified | gzip |
|---|---:|---:|
| Parent 2ce | 227718 | 74399 |
| Frozen 23a0 | 231741 | **75799** |
| Delta | +4023 | +1400 |
| Ceiling | | 66000 (target 64000) |
| Over ceiling | | **9799 FAIL** |

bytesInOutput are not additive gzip. New `range-preparation.ts` is 4692 min; coverage −1052; protocol −916; metadata +659; range-store +653.

Shared `PreparedRange` / `RangeReceipt` references do not subtract logical facts and are not a gzip saving. A size redesign would have to delete actual bodies (the new preparation module, root-to-child metadata ownership, or inlined adapters) and pay the corresponding semantic cost (re-preparation, stale metadata children, or a new exported root). That is out of scope for this correctness review and would not by itself grant landing.

Parent 227718/74399 also failed the ceiling. This stage does not repair it.

---

## What was reviewed

Packet-only. `source/`, `before/`, `r8-before/` treated as independent committed exports. No peer reports, author narrative, moving worktree, or benchmark app. No subagents, installs, builds, native servers, resident runs, or repeated size/cap/movement suites.

Read: `context.md`; AGENTS / snapback2 AGENTS; RULES / NOT-DOING; LLP 1000, 1001 (Unicode/search + binds), 1011, 1012 (indexed held search + envelope), 1013 §3 (sqlite/projection); contracts (clock, capacity 524288, ordinary-conditional addendum); package `guide/offline.md` and `guide/live-query.md`; the 15-path `direct-delta.patch`; the 39-path `cumulative-r8-delta.patch`; owned sources listed below; closed issue `20260906-snapback2-indexed-coverage-replacement-atomicity.md` (in the cumulative patch; names parent `4e927c26df5b1cec4f2ce885f9521474586b54a3`); evidence (metadata probe, candidate2 sharing fail, candidate3 sharing/semantic pass, byte attribution, accounting equality, candidate2-to3 reuse, historical image/R3 probes).

Line cap: `range-store.ts` 1498, `test-indexed.ts` 1454, `range-preparation.ts` 177, `coverage.ts` 196, `carrier-index.ts` 190. No owned file exceeds 1500. No new public export in `packages/snapback2/src/index.ts`. `range-preparation` is wired only through the existing private image-runtime ESM (`build.mjs` `imageModules` + `image-runtime.ts`). No new gate or global brand registry.

---

## Direct change 2ce → 23a0 (15 owned paths)

The stage introduces one immutable typed range meaning (`PreparedRange`) and a nominal owner leaf (`RangeReceipt`) shared by protocol, carrier, and `CoverageIndex`. Metadata projection replaces a flat presence set with `Map<root, Set<encoded child key>>`.

### Range preparation, receipts, isolation

`PreparedRange` holds parameter metadata only: site, table, index, prefix, order, take, rule hash, typed bounds, component lists, schema identity hash, issuing-scan identity. It does not hold membership, row pool, schema/program/owner backlink, or authority callbacks.

Construction:

- `Object.defineProperty` for own enumerable fields, then `Object.setPrototypeOf(this, Object.prototype)`, then deep `immutable()`. This is the ImageKeys/RowImage pattern. Object.assign/`[[Set]]` would treat own `__proto__` as the prototype setter; defineProperty/`CopyDataProperties` keep it as an own data property. Indexed tests cover a generic raw owner with enumerable own `__proto__`, JSON round-trip equality, and isolation from later mutation of the source object.
- `clone` is `JSON.parse(JSON.stringify)` (existing `value-runtime`). Public `tagReceipt` is `clone(prepareReceipt(...))`: recursively isolated plain DTOs; private `#prepared` does not escape. `toClosureReceipt` likewise JSON-clones after tagging (pre-existing `toClosureReceipt` already cloned rows; it remains the public adapter, not a new API).
- `RangeReceipt.change` may only touch membership spelling (`rowIds`/`row_ids`, `haloId`/`halo`, `evictedIds`/`evicted_ids`, `heldSuffix`/`held_suffix`). Parameter edits throw `range parameter changes require admission`.
- Swap journal and Twin `isolate` treat `RangeReceipt` as a leaf, matching `RowImage`/`ImageKeys`. Frozen receipts are not proxied; eviction uses `RangeReceipt.change(raw(range), …)` and writes a new leaf. Journal rollback restores the previous object identity (indexed test).

Wire vs evaluator spelling is explicit: `wire=true` receipts keep original enumerable source fields; `RangeReceipt.tagged` builds snake_case evaluator receipts from `prepared.value` plus membership. `prepareReceipt` returns both, with wire ranges on `preparedDeliveryRanges`. Offline commit attaches those ranges only when every element still has the wire brand and `canonical` (imageCanonical) matches the JSON wire receipt; otherwise it throws. That is the same prepared-vs-wire check already used for `preparedDeliveryRows`.

Admission order is preserved:

1. First map: field/atom tagging + `prepareRange` (issuing-Q / site shape) for every range.
2. Second map: `PreparedRange.finish` → `prepareScanBounds` (suffix width / gt-lte types).

A two-range fixture with a width error on range 0 and an atom-shape error on range 1 still fails on the atom (`tagReceipt` test). Owner maps are not mutated until the whole vector prepares. Coverage `set` still prepares/validates all incoming ranges, absences (`wireJson` then dedup), and boolean verdicts before deleting the previous owner.

Issuing-Q: derived `WordPrefix` ranges require an exact scan site (table/index/shape and `canonicalJson` identity, which includes `source_max`). Ordinary ranges do not borrow Q. `matches()` compares schema sha256 and that site identity; a smaller `source_max` or omitted program refuses. `held_suffix` is re-checked on reuse; prefix/bounds stay frozen on the receipt.

`prepareScanBounds` uses `prefix.length` only for suffix width. Using source atoms vs logical prefix is equivalent. Carrier `missingBounds=true` matches the previous `value ?? null` historical path; public `prepareReceipt` defaults `missingBounds=false`. The envelope decoder already requires `after`/`before`/`gt`/`gte`/`lt`/`lte` on live ranges.

### Coverage equal-FULL rebind (candidate3 vs candidate2)

Candidate2 built sharing failed equal FULL/replay: `RowImage` still shared, coverage kept the obsolete parameter object. Candidate3 only rebinds on the existing semantic-equal path:

```
old.ranges[i].value = ranges[i].value
old.ranges[i].logical = ranges[i].logical
return []
```

Equality already requires identical identity, expected positions, lost set, extent, last, absences, and verdicts. Counts, `rowRanges` map identity, groups, and `exact` tuples are therefore unchanged. `ClientStore.setReceipt` reports `false` (no invalidation). Packet candidate3 probes: `parameterShared`/`logicalShared` true on initial/warm/equal/replay/cold; semantic derivative revisions `[0,0,0]`; same frames’ rows/exact/groups/positions. Halo fixture verdict/absence maps are empty on those frames — not a disagreement/count proof. Indexed tests separately exercise nonempty verdict multiplicity and duplicate-absence removal.

Failed incoming validation (wrong `after` width) leaves the installed owner, expected map, and complete-range bit unchanged.

`issuedKeys` remains: `undefined` uses the confirmed pool; `null` withholds the position; a provided tuple is cloned through `prepared.position`. Twin supplies immutable `factImages` keys, and only falls back to the current body when `rowSeq === answer.nextSeq`. That is the “do not rebuild issuing keys from moved mutable rows” rule, inherited from 2ce and kept.

### Carrier sharing and constructor reuse

`CarrierIndex` drops its private `WeakMap<object,{op,meaning}>`. `prepareOwner` reuses a matching wire `RangeReceipt` via `RangeReceipt.get(input,true)` + `matches`. Indexed test: after coverage has prepared, `carrier.rangeKey(raw,'search')` does not call `PreparedRange.finish`. Constructor may re-prepare cold JSON answers and publish replacements through a caller-supplied callback (journal draft during `applySwap`; collected list during `[preparedChanges]`). Default publish writes `state.answers`; `applySwap` overrides it to the draft. Failed swap rolls the journal and restores `referenceIndex`.

`schemaIdentity` is captured at construction. `update()` can replace `this.schema` without recomputing the hash. Index rebuilds when `programs` (or answers/rows/viewed) are replaced at the root, on `resetCoverage`, and when schema is first installed. `offline.ts` passes `schema: this.schema` on swaps; generation change also carries programs. Residual: in-place mutation of a schema object without a programs-root change could reuse a PreparedRange under a stale hash. Same class of risk as the old per-object WeakMap, and stricter because schema identity is now checked at all. Not a demonstrated path.

Eviction no longer mutates frozen `rowIds` in place. After commit, `referenceIndex.update` calls `set(key, newAnswer)` with the index’s previous answer as `held` and the journalled answer as `answer`, so old range objects leave `this.ranges` and new ones enter. If answers are replaced at the root, the index is discarded and rebuilt.

### Metadata root-to-child ownership

**Inherited persistence bug (2ce, admitted packet probe):** `projectMetadata` returned `undefined` (full compare) only when a replaced field was still an object. Object → scalar/null/absent did not return early, produced a header put, and omitted child `remove`s. Probe: in-memory `completeReset` true, SQLite `metadata` still held `["superseded","generation"|schemaHash|authEpoch]`, reopen restored `superseded`. Attribution: synthetic transactional driver + real 26c9 initial frame; not native emitting contradictory rows.

**Current:** `MetadataKeys` indexes encoded keys by root. On `changed '*'`:

- still-object roots: put every current child, then remove owned children not `Object.hasOwn` on the new value (shrink/replace);
- scalar/null/absent/deleted roots: every owned child of that root is removed;
- header `'state'` is rewritten when any `'*'` change exists.

Warm child edits still use `changed.get(field)` only. Unrelated roots are not scanned.

`ProjectionCache.committed()` still runs only after SQLite `transaction` / IndexedDB `transactionDone` success. Abort tests assert the previous meta key set is unchanged. Close walks the cache and asserts no retained string child keys (empty root buckets dropped: `if (!keys?.size) this.roots.delete(name)`). Direct generic `backend.replace` with `('*', {'futureMetadata'})` covers object→scalar→object→null→absent, including populated close/open.

Failed publication cannot advance the baseline. Last-child delete drops the empty root set. Legacy flat keys (`key !== "state" && !key.startsWith("[")`) still force a full metadata compare until the first successful prepare, then `legacyMetadata = false`.

LLP 1013 §3 still describes journaled projection and “key presence” without the root-to-child map. Implementation comments and the new sqlite test state the current contract. That is documentation lag on an existing LLP, not a behavioral defect of this commit. No new LLP/gate was added (session constraint).

### Twin hydrate

`closureFromAnswer` was already removed on the R8 graph; Twin `answer()` is the sole hydrate. 23a0 switches it from `tagReceipt` (plain clone + manual `held_suffix`/`evicted_ids`) to `prepareReceipt` + `RangeReceipt.change` for a halo whose row is not in the live pool. `RangeReceipt.tagged` copies `heldSuffix`/`evictedIds` when present. Halo nulling is a membership change, not a parameter change.

---

## Cumulative e1c6 → 23a0, including 4e927

Do not treat 2ce as a trusted base. The R8 graph (named in the closed coverage-atomicity issue at `4e927c26` / `02a5b980`, then later commits through 2ce to 23a0) is the current execution graph.

### Coverage / ClientStore atomicity (the 4e927 defects)

Closed issue, independently checked in current source:

1. **Duplicate absences:** e1c6 stored every absence key including duplicates, counted owners in a `Set`, and threw on the second `refs.delete` during removal. Current: `[...new Set(…)]` per owner before mutation. Distinct owners still share a Set of owner ids. Verdicts keep multiplicity via `[falseCount,trueCount]`.
2. **rehydrate applied then refused:** e1c6 deleted rows and reset coverage, then rejected a nonboolean verdict, losing the old row/absence. Current: prepare every row, `checkedReceipt` (pool/halo/evicted), and `CoverageIndex.set` on a *new* index before touching tables; journalled put/remove; rollback restores `this.facts` and rows; directory notifications run only after final rows/authority. Eleven malformed replacements are claimed in the issue resolution; the current control flow matches that requirement.

`CoverageIndex` no longer retains full receipt bodies (`ClientStore.receipts` Map is gone). Proof identity is absences + verdicts + isolated range metadata.

Exact page vs exhaustion: `exact` is `[pages, exhausted]`. `covers(exhausted)` requires an exhausted exact page (or drained group). `stop()` rewrites claimed `exhausted` to `limit` when only a Limit page is exact and the group is not drained. Page values do not prove source exhaustion. Runner records `range.stop = this.store.rangeStop(...)`.

### Row images, keys, slots

`RowImage` / `ImageKeys` private brands; shallow freeze cannot forge them. Optional omission is preserved (`#omitted`); Map/JSON keep exact keys. `put` returns false on reference equality; on canonical equality it shares `ImageKeys` without index churn. Physical slot charges: `imageSlots` / `extentSlots` / `proofSlots` from existing owners (accounting-source-equality: those functions are byte-identical on this direct delta). Format 5; predecessor `factGuards` or mixed experimental records force `factFormat=0` and atomic `resetCoverage` on open — no reinterpretation of individual guards. Limit 524288; 524286 numeric absence population is an evidence/reuse number, not re-executed here.

### Extents, movement, delayed FULL, clock

`inFreshExtent` / `CarrierIndex.contains` are replaced by immutable `ExtentCondition` + `extentContains(KeyImage, condition)` + `FactIndex`/`ExtentIndex` matching. Holes enroll only IDs in the bounded candidate set (live match, incoming versions, masked extent-negatives) that are not in `condition.present` and that the key image still satisfies. Scoped nonmembership is not global primary absence. Tombstones still write `state.negative`; extent negatives are separate (`extentNegative.active`) and yield to a newer global tombstone or a newer compatible body.

Ordinary delayed FULL: same-seq fingerprint mismatch compares against `old.nextSeq ?? old.seq` (explicit full seq), not a later conditional seq. Clock-only equal-seq newer `readTime` does not take that conflict path; older clock is stale; identical replay continues. Clock-only frames set `clockOnly` and do not purge globally, advance watermarks as server progress, or retire overlays (`!answer.clockOnly` in overlay retirement). `FullRevalidationRequired` when an ordinary conditional intersects enrolled timed facts without matching immutable proofs; prior answer/seq/fingerprint/data/outbox kept. Durable pooled-row equivocation at a seq still throws atomically.

### Unicode / Words / arguments

Pinned Unicode 17 tables remain generated-not-committed. `Words` on `Null` is `[]`; otherwise `searchWordWork` + `chargeDerived` (certified derived_steps / scratch, 8MiB heap cap). Argument `Text` min/format use `validateTypedValue(..., fanout=true)` (native predicates, pre-execution). Present argument `format: null` fails (`null !== undefined` and is neither handle nor url). Column `format: null` is omitted in runner (`data.format === undefined || data.format === null`). Public Scalar is wire; private Scalar is tagged. `n2_suffix` is ordinary suffix only; `held_suffix` is private provenance.

### ir-contract mismatch (retained)

`ir-contract.json` `valueModelVersion` is `i53-codepoint-bytes-v2`. Runtime JS binds `CURRENT_VALUE_MODEL_VERSION = i53-codepoint-bytes-unicode-search-text-refinements-v5` and `CURRENT_EVALUATOR = bounded-spike-rust-search-text-refinements-4`. JS reads `systemPrincipalId` only from the contract. This is a retained historical mismatch, not a claim that branch native source is integrated. Branch native under `native/source` is unintegrated historical.

### Five-root measurement boundary

`final-entry.ts` still exports twin, `serverArguments`, `reduceQueryState`, `PersistentRangeStore`, `OfflineRuntime`/`offlineView`, plus existing namespace objects `carrierProjection` and `receiptProtocol`. No new public root. Adapters remain inlined.

---

## Findings

No blocking correctness or ownership defect in frozen 23a0 relative to the stated contracts.

| Sev | Introduced? | Item |
|---|---|---|
| — | 2ce, fixed in 23a0 | Metadata object→scalar/null/absent left persisted children. Current `MetadataKeys` + `'*'` reconciliation deletes them; abort does not advance the key baseline. |
| — | candidate2, fixed in 23a0 | Equal FULL/replay left Coverage on obsolete parameters. Semantic-equal rebind adopts current `RangeReceipt`/`logical` without recounting. |
| — | 4e927 graph, fixed before 23a0 | Duplicate absences threw mid-removal; rehydrate mutated then refused. Current source dedups and validates-then-publishes. |
| note | 23a0 | LLP 1013 §3 still says “presence”; code is root-to-child. Tests/comments carry the live contract. Not a runtime bug. |
| note | 23a0 | `CarrierIndex.schemaIdentity` is construction-time. Rebuilds on programs-root / first schema / reset. In-place schema mutation without those is residual, not shown. |
| note | graph | Sharing/semantic probes use empty halo verdict/absence maps. Do not read them as authority-disagreement coverage. |

No issue rises to NEEDS_CHANGES for correctness/ownership.

---

## Actual checks (this review)

- Full packet `context.md` and named AGENTS/RULES/LLP/contract/guide reads.
- Line-by-line owned sources: `range-preparation.ts`, `coverage.ts`, `carrier-index.ts`, `metadata.ts`, `projection.ts`, `swap-journal.ts`, `twin-store.ts`, `offline-protocol.ts` (prepare/tag/decode), `image-runtime.ts`, `build.mjs` image filter, `offline.ts` prepared-range attachment, `range-store.ts` commit/applyCoverage/eviction/`[preparedChanges]`, `sqlite.ts`/`indexeddb.ts` commit-then-`committed()`, `sqlite.test.ts` reset cycles, `test-indexed.ts` new block, `store.ts` setReceipt/rehydrate, `row-image.ts`, `fact-integrity.ts`, `index-store.ts` `prepareScanBounds`/`indexTuple`, `extent-facts.ts` `extentContains`, `runner.ts` Words/stop/format.
- Direct and cumulative patches; 4e927 issue text vs current control flow.
- Evidence JSON: parent metadata fail; candidate2 sharing exit 1; candidate3 sharing all five phases `parameterShared: true`; semantic derivative stable revisions/rows/spans; 75799 gzip FAIL; accounting equality on slot functions; candidate2-to3 reuse (cap/movement not re-run on 23a0; coverage/Twin/sharing/semantic were).
- Line counts vs 1500; public `index.ts` vs private image module.
- No new Node/Bun execution in this directory. No native build, no 524286 cap replay, no movement43 replay, no resident heap.

Historical image probe (`afterShared: false` on equal-body seq/readTime successor) is an earlier observed boundary: current `RowImage.equal` + Coverage rebind are the intended resolution; this review did not re-execute that probe. Historical R3 movement/replacement probes are pre-23a0 observations; extent-index replacement is in the R8 graph and is consistent with “scoped hole ≠ global tombstone,” but those exact scripts were not re-run here.

---

## Remaining uncertainty (does not flip READY)

- Candidate2 cap2 (2.019s / 524286) and movement43 were not re-executed on candidate3/23a0. Reuse file asserts identical condition/admission/index algorithms and that Coverage’s 23a0 delta does not change value/count/extent computation. That is correspondence, not a latest-source full suite.
- No resident run: constructor/reference sharing is not latency or heap.
- No integrated native/compiler/main. 280-corpus 26c9 match is packet provenance (checker SHA `2f3cd93ccbff5902465f2514e61d8cf6fedf76228ad8e7abafe02ed5f1959175`); not repeated.
- No phone/Expo/publication qualification.
- Empty-map halo equality is not disagreement coverage.
- Packet SHA was taken from supervisor prelaunch + prompt; this review did not rehash 85MB / 2261 leaves.

---

## Qualification still pending (explicit)

- **gzip 75799 FAIL** (9799 over 66000). Correctness READY does not waive it.
- Integrated native 26c9 + compiler + main.
- Resident / phone / publication.
- Full movement and 524286 saturation on this exact tree.

---

READY
