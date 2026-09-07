# Independent review — frozen `2ce04895` vs `fca223` (cumulative R8 from `e1c6`)

Reviewer: grok (this directory). No prior/peer review, author narrative, moving worktree, or benchmark builder/app lanes were read. No subagents. No native build, remote/heavy suite, resident run, or repeated size test.

## Identity

| Item | Value |
|---|---|
| Packet manifest SHA-256 | `e48a218e6d405db0c91d2eca6603fad30c3362544516060c1051741e0b7effeb` (verified against `packet/manifest.json`) |
| Frozen source | `2ce04895fa833ef40d8aad4e06b86c4ddae29a8c` |
| Direct base | `fca223284a3a20cc9aa557ff75e87259d9d94337` |
| Cumulative R8 base | `e1c6e2b79a9e13ceb363f647f52807218aa2b57a` |
| Native reference (not executed) | `26c9fd5e0d3922ce7680493c0e8f7371f4793d59` |
| Requested model/effort | grok-4.6 / xhigh (`launch.json`) |
| Actual model/effort | grok-4.6 / xhigh as launched; Muse 1.3/ultra not used; no third-review substitution |
| Pinned Node | v22.23.2 `/Users/ccheever/.volta/tools/image/node/22.23.2/bin/node` SHA-256 `18e387c90ab8a8400183e8bdd396376e1e875b91b4c874b894dcade7b35bf572` |
| Pinned Bun | 1.3.12 `/Users/ccheever/.bun/bin/bun` SHA-256 `39e644cea4e6db24a3af36013695655d6f789b4b98f1f13bacb882ac6e5c3c18` |

Packet policy matches: independent Git exports (`source/`, `before/`, `r8-before/`), generated Unicode separate, `priorReviewsProvided: false`, `authorReportProvided: false`. Session-delegated contracts in `packet/contracts/` (clock owner, 524288 integrity slots, ordinary-conditional-before-timed FULL) were treated as binding over stale timed-only custody prose.

## Verdicts (keep these separate)

### Correctness / ownership — READY

The direct stage repairs the three raw before-probe defects (equal-body current/effective split, serialized projection payload mirrors, optional indexed `__proto__` own-property refusal) and the shared construction/validation consolidation they required. I did not find a remaining correctness, isolation, journal, or ownership defect that should block this frozen checkpoint on product semantics.

READY means: the frozen JS local-runtime graph is internally consistent with the stated image/projection/validation contracts, on the evidence in this packet plus small synthetic probes in this directory. It is not landing, publication, phone, or native clearance.

### Size — FAIL (not waived)

Original Node 22.23.2 `gzipSync({level:9})`, esbuild 0.25.9, complete local runtime (the five exported roots in `evidence/candidate4/measurement/final-entry.ts`):

- After: minified **227718**, gzip **74399**, bundle SHA `87f699c09dae12e66904da9573162de6f6518d202a73835875c663e60e518a62`
- Parent `fca223`: minified 227321, gzip 74243
- Delta: **+397 min / +156 gzip**
- Ceiling 66000 / target 64000: **FAIL 8399 over 66000**
- Individual `bytesInOutput` are not additive gzip
- Physical resident memory was not measured on this candidate

A correctness READY cannot waive this, grant landing/publication/phone clearance, or treat the gzip number as improved by relocating required bytes.

### Pending qualification (not this review)

Integrated native/compiler/main/phone/resident qualification remains open. Branch native source is unintegrated historical. Exact 2 remains deferred until search qualifies. Historical Mac original-10s movement failures remain failures. Candidate2 focused matrix was not fully rerun on final source. No size/cap/movement/full-suite rerun was performed for this review.

---

## What this stage changes

Direct delta (14 files; claimed 355 insertions / 168 deletions): current-image ownership, shared typed/wire validation, adapter projection.

Cumulative R8 (`e1c6` → `2ce04895`, including `4e927` and later) is the complete current execution graph: Unicode17 pinned tables, held indexes, fact/extent custody, clock identity, delayed FULL, overlay retirement, carriers, twin. Older R8 work was not trusted a priori; it was re-read against the contracts below.

No new public API (package `exports` unchanged; `dist/image-runtime.mjs` is a private shared chunk, not an export). No new gate, runtime generator, or registry. No source file over 1500 lines (nearest: `client.ts` 1499, `range-store.ts` 1476, `store-review.test.ts` 1485, `twin.test.ts` 1469, `test-indexed.ts` 1391). Exact 2 still deferred.

---

## Direct-stage correctness (introduced at `2ce04895`)

### 1. Equal-body refresh rebinds ownership without semantic churn — pass

`ClientStore.put` now returns whether the body changed. Identity-equal reuse returns false immediately. Canonical `RowImage.equal` (kind, schema, table, omitted ordinals, `canonicalValue`) — **not** digest-only — decides `changed`. On `!changed`, issuing `ImageKeys` rebind onto the surviving object, indexes `putPrepared` with the same `parts` array identity (HeldIndex swaps the row pointer, does **not** bump `generation`), and `rows.set` publishes the new current.

`TwinStore.row` borrows `base.row` when the overlay/effective body equals the authenticated current (`RowImage.equal`). Changed overlay bodies stay distinct new images. `rowsRevision` / `authorityRevision` advance only when `put`/`remove` reports a semantic change.

Before raw probe (`evidence/before-raw-probes/equal-image-result.json`): `afterShared: false`, `effectiveUnchanged: true` (distinct current vs effective after equal-body seq/readTime successor). Candidate4: `afterShared: true`, `currentChanged: true`, `keysShared: true`, `canonicalEqual: true`. Store-review test covers warm and cold, no-op overlay borrow, identical replay, journal rollback preserving outbox/`keep`, and a later body change bumping `rowsRevision`.

Digest remains `sha256(imageCanonical)` (sparse wire). Nested Row versus Map can share wire JSON and still `put` as changed (`test-indexed.ts`). That is the required “canonical equality is not digest-only authority.”

### 2. Isolation, brands, shared module identity — pass

- `#schema` / `#owned` private brands; `Object.freeze` on the image; `ImageKeys.is` / `RowImage.is` reject spread/frozen wrappers (`twin.test.ts` `fake = Object.freeze({ ...current.row })`).
- External tagged inputs clone through `JSON.parse(JSON.stringify)` before branding. Shallow-frozen nested mutation of the caller’s object does not alias into the image (synthetic probe: input became `"mut"`, prepared wire stayed `"x"`).
- `fromWire` / `rowFromWire` build a new `Object.create(null)` tagged row; they do not retain the caller object.
- Historical fact images store `{refs, keys}` only (`fact-integrity.ts`: “only keys enter the retained fact image pool”). Proof GC drops unreferenced key records. No full row-receipt map or serialized payload mirror.
- `preparedChanges` / `preparedProjection` / `preparedDeliveryRows` are per-module `Symbol()`, not `Symbol.for`.
- `build.mjs` emits one `image-runtime.mjs` and externalizes `row-image` / `errors` / `unicode` from every public arm. EvalError/RowImage/ImageKeys/SearchNormalizer identity is one synchronous ESM module across client/react/expo/sqlite-test. Measurement entry inlines the same sources; it does not introduce a second brand.

### 3. ProjectionCache key presence, journals, isolation — pass

`ProjectionCache` retains `Set`s of committed keys, not serialized row/answer/outbox/metadata bodies. `committed()` runs only after SQLite `transaction` returns or IndexedDB `transactionDone`; throw/abort leaves the old baseline. `close()` `reset()`s empty sets (candidate4 probe: 11 row keys before close, 0 after; no retained wire string for 11 rows / 106 fact slots).

Trusted `ChangedRecords` bound warm puts/removes. Direct generic `replace` without a journal **rewrites all supplied entries** and deletes keys absent from the new state (`_previous` is accepted and ignored). Mutable previous aliases cannot suppress publication (sqlite test: `replace(replacement, noBytes, replacement)` after in-place mutation still persists). Puts always `JSON.parse(JSON.stringify(...))` (via `imageRecord` for rows), so caller objects are not stored.

Failed transaction: sqlite `beforeCommit` throw / IndexedDB abort → no `committed()`. Test: abort leaves persisted rows and key baseline unchanged.

Metadata: new JSON-omitted values stay absent (`if (text === undefined && !this.keys[name].has(key)) return`). Replacing a **present** entry with `undefined` still throws `JSON.parse(undefined)` (SyntaxError) — the existing unserializable refusal, confirmed in the synthetic probe. Legacy metadata (non-`state`, non-`[` keys) forces a full meta compare until the first successful commit.

Bytes/outbox still share the same carrier transaction. File carrier still projects wholesale; it never held a payload mirror.

### 4. Own-property indexed `__proto__` — pass for the required case

`imageField` uses `Object.hasOwn` for raw rows; `field` / `fieldOrNull` already used `hasOwn` on tagged objects. Carrier index construction no longer reads `row.row[column]` (which returned `Object.prototype` for omitted `__proto__`).

Before raw probe: raw commit `DeliveryEnvelopeDecodeError: events.__proto__: expected text string`, refused before persistence; cold `answer()` same error. Candidate4: no `rawError`, sparse persist (`!Object.hasOwn(saved.row, '__proto__')`), cold own-property admission for ordinary and `WordPrefixes` keys. `test-indexed.ts` covers raw, prepared (`preparedDeliveryRows`), and cold JSON reopen.

Legal `__proto__` columns are not banned: schema own enumerable `__proto__` via `defineProperty` is indexed as optional Null when omitted.

Residual (not admission): `rowFromWire` still uses `name in columns` for undeclared-field rejection. An extra own `__proto__` or `constructor` field on a row whose schema has no such column fail-closes as `has an unsupported schema descriptor` instead of `is not a declared column` (synthetic probe). Inherited `in` check, relocated into the shared decoder, not a new fast path. Fail-closed; does not admit pollution; does not refuse a declared `__proto__` column.

### 5. Shared construction / validation — pass

Duplicate `tagRow` / `tagTyped` / `tagJson` / `validateAssetTypedValue` / `valueContainsReservedPrincipal` were deleted from `offline-protocol.ts` and folded into `value-runtime.ts`. `tagWireRow` / `prepareWireRow` / `tagWireValue` call the same functions. Tests assert owned construction and the mutable adapter preserve exact input refusal ordering.

Order now:

1. `inspectValue` — complete tagged-shape / scalar preflight (invalid Unicode scalar, non-tagged, unsafe int) while collecting reserved Ids
2. reserved system principal (`internalKey` still allows trusted viewer/index components)
3. `validateType` — descriptor refusals, including assets on the same walk

Matches the added `test-indexed` cases: surrogate wins over reserved; reserved wins over later type; list overflow is `E_FANOUT` for ordinary fanout lists and `E_ASSET_TYPE` for asset lists; nested Optional/List assets; duplicate asset ids; Optional Null in a list. Wire path: input-field order for undeclared columns, schema-order for `validateWriteRow`. Canonical Bytes still require lowercase hex. Json columns still `tagJson` application data (a map shaped `{Bytes:…}` stays a Map, not the byte variant).

Argument `Text.format: null` refuses (`E_INPUT: … invalid null format`) when `fanout` is true; column validation (`fanout` false) omits format. Synthetic probe confirmed.

Safe integers: wire Int/Time/Decimal/Money use `Number.isSafeInteger` (same predicate as the old `uintOrSigned`).

### 6. Overlay / journal / issuing keys — pass

Equal no-op overlay borrows current base; hydration identity stays the current RowImage; `rowsRevision` unchanged. Removing the overlay keeps that body. Failed higher-seq commit rolls back (`SwapJournal` + projection `committed` not called); outbox `keep` and factSlots preserved. Issuing keys share the ImageKeys object across equal refresh (`RowImage.keys(current) === RowImage.keys(initial)`).

`RowAssets.set` is skipped on `!changed`. It stores asset-id sets, not row bodies, so equal refresh does not pin an obsolete image through the asset table.

Partitioned HeldIndex: shared key identity does not erase sequence partition (`test-indexed` temporal index with `r => r.seq`).

---

## Cumulative R8 (from `e1c6`, including `4e927`) — not assumed trusted

Re-read against session contracts and LLP 1001/1012/1013. No additional correctness blocker found in the current graph for the local JS runtime. High-signal points:

**Integrity capacity.** `FACT_SLOT_LIMIT = 524288`, `FACT_FORMAT = 5`. Guards, immutable proof refs, and missing-proof answer markers (`needsFactProofs`) participate. StoreChanges 262144 remains a discardable **byte** journal, not an integrity cap. Exhaustion throws `ClockCoverageReset(true)` with outbox preserved by the existing reset path.

**Complete-extent custody.** `FactIndex.opaque(table, seq)` surfaces a fact lacking keys; `FactTransaction.close` calls `missing()` → `FullRevalidationRequired` or coverage reset rather than inventing membership. Unknown/nonmember IDs in a typed extent are not global primary absence. Extent nonmembership is scoped (`extentNegative` with cause), distinct from `negative` tombstones. Same-seq move-out is not deletion (`applyCoverage` comment and eviction guards vs `rowSeq`). Halo Limit-to-Exhausted: page-value exactness does not imply exhaustion (`CoverageIndex.stop` / `covers`). `heldSuffix` is carrier metadata; `n2_suffix` stays ordinary suffix; private keys preserve provenance.

**Delayed FULL / ordinary fallback.** Conditional refresh sets `nextSeq ??= answer.seq` **before** bumping `seq`, so `nextSeq` stays the last full sequence. Full reinstall compares `old.nextSeq ?? old.seq`, not a later conditional seq. Twin coverage callback: `if (answer.nextSeq === undefined || this.state.rowSeq[key] !== answer.nextSeq) return null` — no mutable-row hashing fallback, no later conditional sequence. Ordinary intersecting timed guards without proofs set `needsFactProofs` and throw `FullRevalidationRequired` for one authenticated FULL; fingerprint/data/outbox preserved until that FULL. No repeated reset loop in this path.

**Clock.** Optional signed safe `readTime` plus `clockPlanHash` (plan hash) on certified timed full envelopes. Seq first; equal-seq older clock stale (`frame.preflight` / `timedChange` continue); equal-seq newer clock is clock-only. Identical fingerprint replay may install a checked receipt. Equal-clock differing payload refuses. Clock-only answers are tagged `clockOnly: true`; overlay retirement ignores them as arrival (`!answer.clockOnly`) and `onlyClock` swaps do not increment overlay misses. Clock-only execution does not write watermarks (`clockMark` skip), does not purge globally, and does not imply server progress.

**Durable equivocation.** Same-seq different digest throws `conflicting durable fact` / `conflicting row` atomically inside the journaled swap.

**Unicode 17.** Pinned ahead-of-time tables (generated, not a new runtime generator). Contract `u17-nfc-scf-nfc-wsp-p`. Optional null contributes no tokens. Query token validation before dedup. 4N source bound. Public Scalar wraps wire; private Scalar wraps tagged. Argument Text min/format use `validateTypedValue(..., fanout true)` at preexecution, not body guards.

**Movement / halo.** `imageField` + immutable keys mean prefix/bounds/issuing keys are not rebuilt from moved mutable rows. Coverage `issuedKeys` prefers fact-image keys; missing fallback is explicit `nextSeq` vs `rowSeq`. Local partial movement: lost members go to `r.lost`; exact page quality accounts for halo; evictedIds break drained-prefix completeness. ForcedOffline/hydrating/retry/subscription paths were not re-executed here; candidate4 movement 43/43 under original 10s wrapper passed (`5.3779s`). Historical Mac original-10s failures remain failures.

**Sharing.** Sharing RowImage / ImageKeys references does not subtract logical fact slots. Physical current/effective bounds still derive from owners/schema; max 8 index components and 4N word bound unchanged.

**IR contract mismatch (retained, not a native-integration claim).** `ir-contract.json` `valueModelVersion` is `i53-codepoint-bytes-v2`. JS runtime reads only `systemPrincipalId`. Evaluator/custody bind explicit Runner v5 constants (`i53-codepoint-bytes-unicode-search-text-refinements-v5`). Documented as retained mismatch.

**4e927 and later size history.** Historical gzip snapshots `36fea73023`, `cb57872709`, `47a772555`, `4fb72367`, `02a572229`, `4e92772199` all failed. This review does not treat any of them as a size success or as a memory proof. Ordinary 02a5/4fb/47a7 resident figures (~79.4–79.5MB / 10k) are different snapshots, not current, not additive, not a 100k/phone extrapolation.

---

## Documentation companion (LLP 1013)

Frozen Git `llp/1013-expo-arm.spec.md` is **unchanged** (preimage SHA `6ea0b7cc5a13336cf86fce2269520c9b2c151d7d96bf54e78af5b191de01e57f`). `documentation-companion/` is an external exact prose companion (proposed SHA `bdabc6316719069cf50f5e362835f90249fdabf246f283018ab0716b6b0f6444`) for review and eventual product landing. Other LLP updates remain integration work; this review does not invent prior author approval.

Proposed §2 decision 1, §3 projection, and the `replace` contract match the code: journaled writes use committed key presence; generic replacements rewrite supplied entries with JSON isolation; `previous` does not authorize skipping writes; omit vs explicit null preserved; close clears the key baseline; this is an ownership contract, not a resident-memory claim. Assessed as accurate relative to `projection.ts` / `sqlite.ts` / `indexeddb.ts`. It must not be treated as already landed in frozen source.

---

## Findings

### Blocking correctness

None.

### Residual (non-blocking)

**R1 — Severity: suggestion — inherited `in` check, relocated into the shared decoder (not a new parallel path)**

- File: `snapback2/packages/evaluator/src/value-runtime.ts` (`rowFromWire`, `name in columns`)
- Repro (synthetic, this directory, Bun 1.3.12, packet source): extra own enumerable `__proto__` or `constructor` on a row whose schema has no such column → `rows.t.__proto__: has an unsupported schema descriptor` / `rows.t.constructor: has an unsupported schema descriptor`, not `is not a declared column`.
- Impact: fail-closed; wrong error family/path for prototype-inherited names. Does not admit the field, does not refuse a declared `__proto__` column, does not affect the sparse omitted-optional case the stage repaired.
- Attribution: same `in` test existed in deleted `tagRow`; consolidation copied it. `validateWriteRow` already uses `hasOwn(columns, name)` for unknown fields.

**R2 — Severity: nit — unserializable present-entry refusal is `JSON.parse(undefined)` SyntaxError**

- File: `snapback2/packages/snapback2/src/store/projection.ts` (`put`)
- Same throw existed when the cache stored serialized strings. Spec asks to retain the existing refusal; it is retained, not typed.

No other open correctness issues from this review.

---

## Coverage vs required checklist

| Requirement | Result |
|---|---|
| Equal-body refresh shares current/effective; keys rebound; no generation/revision churn | Pass (code + candidate4 probe + store-review) |
| Canonical equality not digest-only; Row vs Map distinct | Pass |
| Equal no-op overlay borrows current; changed overlay distinct | Pass |
| Journal rollback; issuing keys preserved | Pass |
| One private ESM module; no Symbol.for / global registry / forged brands | Pass |
| External put/constructor/rehydrate isolate shallow-frozen inputs | Pass (code + synthetic probe) |
| Historical keys have no body backlink | Pass |
| ProjectionCache key presence only; close reclaims | Pass |
| Journals bound warm writes; generic replace rewrites; JSON isolation | Pass |
| Cold deletion; metadata migration; absent vs undefined metadata | Pass (absent skip / present throw) |
| Mutation aliases cannot suppress publication | Pass |
| Failed transaction keeps baseline; commit-only publication | Pass |
| Own-property `__proto__` omission; legal columns not banned | Pass (required case); R1 residual on extra undeclared names |
| Shape preflight before reserved/type; input-field vs schema-order | Pass |
| Nested List/Optional assets; duplicate asset ids; Bytes; reserved-looking JSON maps | Pass |
| Delete duplicate work, not a parallel untrusted fast path | Pass (`tagTyped`/`tagRow`/`validateAssetTypedValue` removed) |
| 1M steps / 4MiB closure / 8MiB heap / 1MiB output / 524288 slots / format 5 | Unchanged in this graph |
| All-ID complete-extent custody; scoped nonmembership; move-out vs tombstone | Pass on read of current graph; movement 43/43 on candidate4 |
| nextSeq vs rowSeq ordinary fallback; no warm all-history scan | Pass |
| Clock seq-then-readTime; clock-only no purge/progress/overlay retirement | Pass |
| Ordinary conditional × timed guards → one FULL | Pass |
| Unicode 17 pinned tables, NFC/simple-fold, optional null, 4N | Unchanged foundation; not re-certified here |
| No file >1500; no new public API/gate/generator | Pass |
| LLP 1013 companion matches code; frozen LLP not modified | Pass as companion-only |
| 74399 gzip | FAIL, separate |
| Resident / phone / native / compiler / main | Unqualified |

---

## Actual checks performed in this review

**Read (frozen packet only):** `context.md`; contracts; AGENTS / Snapback2 AGENTS / RULES / NOT-DOING; LLP 1000, 1001 Unicode foundation, 1011 search-cursor note, 1012 indexed-held-search and clock/offline sections, frozen vs proposed LLP 1013; source `@ref`s on changed files; `guide/offline.md`, `guide/live-query.md`; direct 14-file patch; cumulative path list; row-image, value-runtime, store, index-store, twin-store, projection, sqlite, indexeddb, carrier-index, fact-integrity, fact-index, coverage, swap-journal, range-store (applyCoverage / overlay / nextSeq / clock), offline (prepare + `offlineView`), build.mjs, package.json exports, image-runtime.ts, final-entry.ts, evidence probes and candidate4 results, companion proposed/preimage.

**Not read:** other reviewer directory, author report, moving worktree, benchmark builder/app lanes, prior review files.

**Candidate4 evidence (not re-run):** package build 3.121s / 120s wrapper; SQLite/adapter/image/movement original 10000ms (movement 43/43, 5.3779s); Bun evaluator with exact 26c9 checker 225 + 24 serverOnly + 2 visibility + indexed/Unicode/merge, 6.4303s / 120s; equal-image / optional-proto / projection-retention probes as cited. Candidate2 focused matrix (store44, Twin12, public13, delayedFULL1, cap2, movement43) is earlier, before projection/proto repairs.

**Synthetic probes (this directory, not native, not SQLite/phone):** `grok/probes/edges.mjs` via Bun 1.3.12 on packet TypeScript source. Attribution: synthetic schema `t` with `id`/`body`/`note`; no native frame. Results: extra `__proto__`/`constructor` fail-closed with unsupported-descriptor; omitted vs explicit null neither equal nor same digest/canonical; shallow-frozen tagged input cloned (prepared body stayed `"x"` after caller nested mutation to `"mut"`); argument `format: null` refuses, column path with `fanout=false` accepts; `JSON.parse(undefined)` SyntaxError.

**Not done (forbidden or out of scope):** native checker, full suite, installs, builds of the frozen tree, resident measurement, remote hosts, size re-measure, subagents.

---

## Uncertainties

- Private-field omission / key / digest lifecycle cannot be proved by enumerable object walks. Code paths that could retain bodies (ProjectionCache values, factImages.row, RowAssets.rows, ImageKeys) were read: they retain keys, id sets, or key parts only. Candidate4 projection probe found no serialized row JSON. That is not a heap dump.
- `jsonState = JSON.parse(JSON.stringify)` would encode a RowImage as `{Row: {…materialized}}` if a delivery’s public `rows` array held branded images. The production path keeps wire rows on `rows` and branded images on `preparedDeliveryRows` (a Symbol, dropped by JSON). Tests that commit use `RowImage.wire`. No public path found that JSON-clones a brand as a nested Row tag into persistence.
- Candidate4 did not rerun every earlier focused matrix on the final projection/proto source. Reuse is limited to unchanged semantic inputs, as the packet states.
- Physical SQLite/FakeIndexedDB tests in evidence are separate from the synthetic no-storage projection driver. This review did not re-open a database.
- Native 26c9 correspondence is supervisor-recorded (`280` corpus inputs, commit `26c9fd5e…`). This review did not execute native.

---

## Architectural consolidation (only if naming real code)

This stage already deleted the duplicate wire decoder (`tagTyped`/`tagRow`/`tagJson` in `offline-protocol.ts`) and the duplicate asset/reserved walk (`validateAssetTypedValue`, `valueContainsReservedPrincipal`). Measured minified attribution (not additive gzip): `offline-protocol.ts` **−1629**, `value-runtime.ts` **+1523**, `row-image.ts` **+284**, `index-store.ts` **+223**, `projection.ts` **−74**. Net **+397 min / +156 gzip**.

No further duplicate untrusted fast path remains in the changed files. The gzip gap to 66000 is **8399**. Dominant measured bodies are `range-store.ts` (27140), `runner.ts` (25444), `unicode-tables.ts` (17186), `offline.ts` (16370) — not removable without cutting search, custody, or Unicode, which this session’s doing-list forbids. Falsifiable hypothesis: another delete-duplicate in the image/projection/validation set will not close 8399 gzip, because that set already netted +156 gzip after the consolidation. I do not invent a saving or a scope cut.

---

## Final response

**Correctness/ownership: READY.** Frozen `2ce04895` vs `fca223`, with cumulative R8 from `e1c6` re-read and not trusted a priori, repairs equal-body current-image sharing, projection payload-mirror removal, and optional indexed `__proto__` own-property admission, and consolidates wire/typed validation onto one owned path. Residual R1 is fail-closed error-family noise for extra undeclared prototype names.

**Size: FAIL 74399 gzip (8399 over 66000), parent 74243 also failed, this stage +156 gzip. Not waived. Not landing/publication/phone clearance.**

**Still unqualified:** integrated native/compiler/main/phone/resident; Exact 2; historical Mac 10s movement; complete-suite rerun on final source.
