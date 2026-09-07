# READY

Correctness of the full R8 client/twin delta from `e1c6e2b79a9e13ceb363f647f52807218aa2b57a` through `36feaacc9c5bf2ccede2623653252e67c0152f26` (including `4e927c26`; that commit is not a trusted base). Independent grok review of frozen packet source, `delta.patch`, contracts, native `26c9` owner semantics, and packet evidence only.

This is a correctness verdict only. It is not landing, publication, phone, size, movement-deadline, or resident-memory clearance.

## Separate resource status (not waived)

| Gate | Status | Bound evidence |
|---|---|---|
| Complete five-root gzip ceiling 66,000 (target 64,000) | **FAILED** | Final measurement **223,602 minified / 73,023 gzip**, **7,023 over 66,000** (`packet/evidence/r8-bound-exhaustion/final-measure.log`). +314 gzip vs cb578 72,709. Prior stage failures remain: 4e927 72,199; 02a5 72,229; 4fb 72,367; 47a7 72,555; cb578 72,709. |
| Original movement 10,000 ms | **FAILED / pending** | Original R8 10/1 cancel at 10,026 ms; 43/43 at 23.819 s is 120 s exploration only. Carrier-stage 22 pass / 1 cancel at 10,026.907 ms used a pre-refusal-order candidate, not final source. No latest-source original-deadline movement pass. |
| Resident / phone / 100k | **Pending / failed separately** | No latest-source realistic format-5 paginated resident result. Historical format-2 10k row-only RSS/heap/ArrayBuffer figures are a material resource concern with a different boundary and must not be summed with index-only observations. |

Requested Muse 1.3 / ultra availability was not established. No global outage, substitute, new availability probe, or third review is claimed.

## Scope and provenance

- **Base:** `e1c6e2b79a9e13ceb363f647f52807218aa2b57a` (`packet/before`)
- **Final:** `36feaacc9c5bf2ccede2623653252e67c0152f26` (`packet/source`)
- **Delta:** `packet/delta.patch` — 24 paths, 2,303 insertions / 337 deletions
- **Packet created:** 2026-09-07T03:25:15.421544+00:00 (`packet/manifest.json`)
- **Native owner:** commit `26c9fd5e0d3922ce7680493c0e8f7371f4793d59`, executable SHA256 `4d0f8f0176921b56305e9969da0fcb2dd5ecedae1f65d983f537e613d0c6e46e`
- **Identities:** `i53-codepoint-bytes-unicode-search-text-refinements-v5` / `bounded-spike-rust-search-text-refinements-4`
- **Private persistence:** FACT_FORMAT 5; public v5 identities unchanged
- **Slot ceiling:** 524,288 combined guard / proof / reference / marker slots
- **Runtime ceilings (unchanged):** 1M steps / 4 MiB closure / 8 MiB execution heap / 1 MiB output; Exact 2 deferred

Writable area was this review directory only. Sibling/peer reviews, coding conversations, mutable repository code, and any same-session size-design analysis were not read. No product edits, remote work, heavy tests, size/cap/movement/resident reruns, or subagents. Copied packet binaries were not executed.

### Stage graph (attribution only; each is in the reviewed delta)

| Commit | Role |
|---|---|
| `4e927c26` | Initial R8 format-5 / extent / private-marker checkpoint (not trusted) |
| `02a5b980` | Drop ClientStore full receipt pools; CoverageIndex compact owners |
| `4fb998f2` | Lazy transaction-local image/frame preparation; refusal-order repair |
| `47a7f491` | Per-owner absence dedup; atomic standalone rehydrate |
| `cb578e19` | Frozen-row isolation; shared scan-bound validation; denied/partial projection |
| `36feaacc` | Typed bounds before publication; page vs Exhausted split; issuing-key fallback |

## Findings

No material correctness defect that admits unauthorized completeness, publishes on refusal, drops atomic rollback, unions all-history rowIDs, or weakens native 26c9 / format-5 / 524,288 contracts.

The three latest stated defects are repaired in source, not merely restated in tests.

### Addressed defects (introduced, then repaired in-delta)

These are not open findings. They are the defects the later stages exist to close.

1. **Malformed cursor bounds published, then refused.** `tagReceipt` and `CarrierIndex.prepare` now call existing `prepareScanBounds` before owner mutation or backend replace. Empty and populated carriers, public decoder, and direct schema-supplied paths refuse under-width / over-width / wrong-tag `after`/`before` and scalar-vs-tuple `gt`/`gte`/`lt`/`lte` with prior rows, slots, outbox, and coverage unchanged.
   - Source: `offline-protocol.ts` (tagReceipt loop after range tagging); `carrier-index.ts` `prepare`; `index-store.ts` `prepareScanBounds` / `indexTuple`.
   - Evidence: `store-review.test.ts` `typed full cursor bounds refuse before empty or populated carrier…`; `test-indexed.ts` endpoint variants and ordinary/derived tuple-vs-scalar controls.

2. **Held iterator ending treated as Exhausted.** `CoverageIndex` stores `[pages, exhausted]` per identity. `Runner.recordRange` records Limit/Exhausted then `rangeStop`. A Limit-only exact page with no Exhausted count and no drained prefix is forced to `limit`. Native seq2 Exhausted (`nativeR8.halo.last`) still establishes complete warm and cold.
   - Source: `coverage.ts` `exactCount` / `stop` / `covers`; `runner.ts` `recordRange`.
   - Evidence: `test-indexed.ts` Limit vs Exhausted shared-identity controls; `store-review.test.ts` `Limit replacement values retain a capped stop…`.

3. **Cold coverage used moved current bodies as issued keys.** Twin preparation-only lookup reads `answer.rowProofs` → `factImages[table+digest].keys[index]`. Callback is not retained. Pre-schema ordinary fallback requires `answer.nextSeq === state.rowSeq[key]`, never refreshed `answer.seq`. Missing keys stay `null` (withhold).
   - Source: `twin-store.ts` `answer` issuedKeys; `coverage.ts` expected-key isolation and `member` vs current `position`.
   - Evidence: `store-review.test.ts` `cold coverage keeps the issuing keys after later authenticated movement…` (zero/one/two members and halo; warm and cold partial for two moves).

4. **Drained-page regression on the wider candidate** used `answer.seq` and was repaired to `nextSeq`. Attribution against exact cb578 is in `packet/evidence/r8-bound-exhaustion/` (`parent-ordinary-default` vs repaired; drained inputs byte-equal). Default-corpus `entitlements.byId` failure is a changed input (predecessor index shapes), not a decoder compatibility claim.

5. **Duplicate per-owner absences** broke Set-counted removal. Incoming identities are uniqued with the same `pointKey` before contribute/remove; distinct owners and verdict multiplicities are unchanged. `wireJson` runs during CoverageIndex preparation so malformed absence values cannot fail after publication.
   - Source: `coverage.ts` `set` absences unique + `wireJson`.
   - Inherited at 4e927/02a5; repaired at 47a7.

6. **Standalone rehydrate published then refused.** Rows, pool/halo, issuing Q, verdicts, and absence conversion validate on a staged `CoverageIndex` before row mutation. Journal + deferred directory notification; refusal restores prior facts root, rows, index generations, directory objects, and zero notifications.
   - Source: `store.ts` `rehydrate` / `checkedReceipt` / `prepareRow`.
   - Inherited at 4e927/02a5; repaired at 47a7.

7. **Shallow `Object.isFrozen` treated as internal ownership.** Per-store `WeakMap` marks only that store’s successfully normalized rows. External values are cloned, optionals materialized, recursively frozen (including already-frozen wrappers), then validated. Put/constructor/rehydrate share `prepareRow`.
   - Introduced relative to e1c6 frozen-skip; repaired at cb578.

8. **Denied/partial public projection leaked `next` (and denied data).** `offlineView` and conditional accept omit denied data; `next` only for complete/capped. Private `HeldAnswer` data/next remain for protocol/resume.
   - Source: `offline.ts` `offlineView` and unchanged-conditional result construction.

9. **Current-authority resume swallowed the typed refusal.** `client.ts` now throws the already-published typed refusal when the authority fence is current and the signal is not aborted; aborted/stale paths still throw the original error (AbortError test preserved).

10. **Eager per-swap image preparation inverted refusal order.** `FactTransaction.register` prepares-and-registers each row in order. Invalid index schema on the first image still precedes a later bad source (`E_SCHEMA`). Stale ordinary payloads stay lazy.

## Independent review of required surfaces

### Ordinary / timed closed extents and payload ownership

`extent-facts.ts` keeps immutable `RangeMeaning` / `ExtentCondition` (site, ruleHash, table, index, prepared prefix, order, bounds, Limit first/last, present IDs including halo). Equality is exact prepared meaning; the digest is a dictionary key only (`rangeMeaningKey`).

`FactTransaction.close` refuses same-sequence positives not in `present`, including never-held IDs, via incoming and retained proof indexes. Live current rows at that sequence participate only when `proven` (full-delivery image counts). A later compatible image outside first/last is not a same-seq contradiction; `blocking` plus scoped `extentNegative` handles later exclusion without erasing earlier contradictions. Global `rowFacts` numeric absence/tombstone remains distinct from scoped masks.

Halo is in `present` but not in Limit first/last, so the closed interval is the member span; halo presence still participates when Limit becomes Exhausted.

### Body / key / proof separation

`factImages` store keys only (`PreparedImage` is swap-local). `keyImage` prefers retained keys; it does not recover application rows after GC. `CarrierIndex.receipt` clones one receipt and stamps `heldSuffix` from the frame pool’s last member, not from later moved current rows. Answer `rowProofs` remain the owner of those images through replacement; `integrity.finish` drops unreferenced images/extents and their slot charges.

No new row pool, owner registry, wire field, or private-format field was added in the latest corrections. Coverage expected keys are cloned proof metadata, not the caller pool.

### No all-history warm scan

`ExtentIndex.matching` seeks by prepared (table, index, scalar prefix, token path) buckets. `FactIndex.matching` scans the named physical index at an exact sequence (or live namespace −1). Incoming proof preparation uses touched versions plus maintained seeks. Warm `CoverageIndex.verdict` / `hasAbsence` / `covers` are count lookups. Whole-owner enumeration exists only on explicit standalone `rehydrate` (`authorityOwners`), which is already a whole-store replacement.

### Words metering and native Unicode/null

Native `26c9` `unicode_words` (`search.rs`): Null → `[]`; otherwise `validate_search_source` + NFC/simplefold/NFC tokenize; occurrences counted before dedup. Twin `Runner` `Words` matches that output contract and now charges `searchWordWork` through the shared derived step/scratch ledger, including certified `derived_steps` / `derived_scratch_bytes` when present. Optional null produces no words. Query `searchQueryToken` still refuses a second token (`foo foo`). Independent Q (including Q=2000) remains on `preparePrefix` / issuing-site `source_max`, not on indexed field maxima. 4N posting bound is enforced at `HeldIndex.putPrepared`.

Twin uses UTF-16 `source.length` as the Words `sourceMax`; native uses scalar `chars().count()`. For valid BMP/text this does not change admission or tokens. Scratch formulas differ (native capacities vs twin UTF-16/dedup table model). See Uncertainties.

### Held projection, resume, overlays, GC

Denied public views omit data and `next`. Partial keeps data, omits `next`. Complete/capped keep both. FIFO overlay replay is per-row; scoped holes and global negatives dominate by sequence; clock-only deliveries do not increment overlay misses or treat omitted slots as revocation. `maybeUnused` drops bodies only when no remaining answer refs them; guards/proofs can outlive bodies. Format 0/2/3/4 and missing-marker experimental custody reset coverage atomically and keep outbox/seal; published ordinary no-clock stores without a private marker stay format 5. Projection omits a default `factFormat` so predecessor experimental guards are not relabeled.

`resetClock` no longer snapshots the whole store to compare `factLimitReset`; the repeated exhausted identity is refused inside `applySwap` before mutation.

### Standalone ClientStore and JSON isolation

`checkedReceipt` + `prepareRow` are shared by `setReceipt` and `rehydrate`. Rehydrate during an active prediction journal refuses. Generic JSON isolation remains `jsonState` / journal `raw` / structured clones of incoming deliveries; escaped-object and repeated-pool controls are in `store-review.test.ts`. CarrierIndex is not a second retained receipt-body owner.

Expected keys and Limit endpoints are isolated (`clone` / `structuredClone`). Tests mutate incoming row/range objects after admission and assert retained proof contents unchanged.

### Clock conditionals and enrollment

Seq-first, then strictly newer equal-seq `readTime` under matching plan hash. Equal-clock different payload refuses; older clock is stale. Same-seq pooled canonical row conflicts still throw. Ordinary answers that cross newly enrolled timed guards get `needsFactProofs` and require one authenticated FULL (`FullRevalidationRequired`); prior fingerprint/data/outbox stay; `revalidate` is single-use. Conditionals replay stored proofs at the refresh sequence; hole enrollment after a refresh that still lacks proofs refuses the whole journaled swap.

## Tests versus claims

New controls exercise real decoder/tagger/`ClientStore`/`PersistentRangeStore`/`OfflineRuntime`/`Twin` paths. They do not merely assert implementation field names.

- Duplicate absences use the public envelope decoder.
- Rehydrate refusals cover nonboolean verdict, unsupported tagged absence, missing member/halo, wrong-table halo, missing issuing bound, unknown table, wrapper/body mismatch, non-integer Int, over-limit optional Text, invalid Unicode scalar; valid seed/non-seed replacement, ordinary/derived coverage, optional materialization, and directory reclamation.
- Public denied/partial/forced-offline/hydrating/retry/subscription cases use synthetic frames through the actual Client decoder/runtime, not native emission.
- Movement/halo Exhausted positive control uses unchanged native `26c9` envelopes (`nativeR8.halo.first` Limit, `.last` seq2 Exhausted). Later matching-plan moved-row frames are synthetic.
- Native-certified derived h1 people page uses an actual certificate with synthetic admitted rows.
- Original standalone malformed probes use native-certified schema and do not establish a public/native authorization bypass.

Frozen evidence (not re-run here): bound-exhaustion repaired store 6/6 and Twin 10/10 at original 10 s; direct Bun indexed 24.627 s with no original per-file deadline; cb578 public 24/24 and Twin 4/4 at original 10 s; caps/refs/diff PASS; size FAIL 73,023.

## Uncertainties (not elevated to findings)

1. **Words scratch/step formula vs native.** Output/Null/Unicode tokenization match `26c9`. Twin `source.length` (UTF-16) vs native scalar count, and different scratch addends, are metering-model differences. No evidence they change Words results for valid Text. Not a native rebuild.

2. **Auth-epoch rotation keeps `extentNegative` masks** while clearing guards/images/extents. A later same-row image deactivates the mask. Conservative over-hiding after reauthentication is possible; fabricating authority is not. No counterexample in the frozen controls.

3. **`CoverageIndex.stop` keeps a local `exhausted` stop when there is no exact page count.** Completeness still goes through `covers` / `uncoveredSites` (no Exhausted count and no drained prefix → partial). Twin ordinary evaluation uses that path. Search `held` remains the documented “local enumeration whole, server coverage not” state.

4. **Column `format: null`.** Unchanged `certificate-identity.ts` `pick` lists only `max` for column Text, so a present `format` field (including null) is `E_SCHEMA`. Arg `format: null` throws, matching native `deserialize_text_format`. Native column Option typically omits None. Not in this 24-file delta; v5 certificates in the packet do not carry column `format: null`.

5. **No latest-source resident or original movement qualification.** Ownership witnesses are reachability/count/serialized-state, not RSS. Cap 524,286 pass is the separately approved test-setup allocation repair, not product performance.

6. **Drain/main epoch-adoption changes are not in this frozen lane.** Later integration must keep this lane’s typed current-authority throw and denied/partial projection.

## Structural notes (semantic costs; no size waiver)

Centralizing extent/image/coverage types reduced duplicate receipt clones and full ClientStore receipt maps, at the cost of more modules (`extent-facts`, `extent-index`, `fact-index`) and a larger `range-store` admission function. Removing the ClientStore receipt pool saved retained body reachability; gzip still rose. The latest two-counter exact map and issuing-key lookup add retained metadata, not a measured resident saving.

Further gzip closure of 7,023 bytes is not demonstrated. Relocating required Unicode/index/admission payload is not a saving. No feature cut or ceiling increase is recommended from this review.

## Checks actually performed

| Check | Result |
|---|---|
| Read packet `context.md`, AGENTS, RULES, NOT-DOING, LLP 1000/1001 Unicode foundation, LLP 1012 indexed held search, offline/live-query guides, contracts (current 524,288 / ordinary-all-ID supersede timed-only prose) | Done |
| Read full `delta.patch` (24 files) and final sources for all changed store/evaluator/client/offline/twin/test paths | Done |
| Followed unchanged callees: `swap-journal`, `coverage-spans`, `twin-hydrate`, `certificate-identity`, `search-key`, `unicode` | Done |
| Bound native decode/Words/format semantics from `packet/native/source` at 26c9, not older branch Rust | Done |
| Read stage handoffs and frozen logs/JSON under `packet/evidence/` (custody of failures, not peer reviews) | Done |
| Verified packet source SHA256 of ten critical files against `manifest.json` | Match |
| Verified pinned local Node/Bun SHA256 against `r8-bound-exhaustion/host-tools.json` | Node `18e387c90ab8a8400183e8bdd396376e1e875b91b4c874b894dcade7b35bf572`; Bun `39e644cea4e6db24a3af36013695655d6f789b4b98f1f13bacb882ac6e5c3c18` |
| New execution probes, size/movement/cap/resident/native rebuild | **None** |

Copied packet executables were not run.

## Source hashes (packet/source, manifest-matched)

| Path | SHA256 |
|---|---|
| `evaluator/src/coverage.ts` | `f6268bfa6463878e1c9055e4b854347ffb08e51811e64dce10eac8432d665a83` |
| `evaluator/src/store.ts` | `12c8e5e246386ca36f21f5bb02ddb0639031392219ee142e2a889b7f126f10b8` |
| `evaluator/src/index-store.ts` | `f4ed332ec6c3ed4536818d1a8b38b0f09130468e11151ecabf26170aa6cbeeaa` |
| `snapback2/src/store/range-store.ts` | `920c489a931713c538b700f02e059ac72e38caf3f2f4ea98b3df618db3f00a56` |
| `snapback2/src/store/fact-integrity.ts` | `877f9fe773d3173a5ebab58dd1683187227a706b35b8ccbd77945f09c72be9cc` |
| `snapback2/src/store/carrier-index.ts` | `85ebde3cffc26aacb7b4e859795d047d6ad63cbdef95a97696c5cdec207f6531` |
| `snapback2/src/twin-store.ts` | `0c3f01987acc9b1563610ed74898aea7b3808ff22dad736b0b438d651935e1ec` |
| `snapback2/src/offline.ts` | `b6097e78b7fbcc255ad69b55ca83ea5d93f48cbf5605bd3340b34261403f7dea` |
| `snapback2/src/offline-protocol.ts` | `65e046bbed97a0851e63a1a613c66229a6e3eddd5bcb04f6c497d6c7b41cd11f` |
| `snapback2/src/client.ts` | `731a9969526357d53a18b9e3adec23bb74b0064076d7255c33469f876e995a3f` |

Native owner SHA256 `4d0f8f0176921b56305e9969da0fcb2dd5ecedae1f65d983f537e613d0c6e46e` matches `packet/native/inputs.json` and the `nativeR8` fixture owner stamp.

## Verdict restated

**READY** for correctness of the full e1c6→final R8 delta.

**FAILED** size 73,023 gzip / 66,000 ceiling.

**FAILED / pending** original movement deadline and resident/phone qualification.

Correctness READY does not imply landing, publication, or phone readiness.
