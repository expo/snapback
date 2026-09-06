# Twin-lane independent review — frozen v4 checkpoint

**Verdict: NEEDS_CHANGES**

**Review bound:** commit `0fa68e928e9ff59c3bc5bc2edada49f96ecec6ef` vs base `1f9b4b95c54ba7a5a9d0ece41e9463b29078cfa4`. Independently SHA-256-matched all **54** files in `/Users/ccheever/clique-improvement/lanes/search-twin/source-checkpoint-r4.json` (0 mismatches). Identities `i53-codepoint-bytes-unicode-search-text-min-v4` / `bounded-spike-rust-search-text-min-3`. `FACT_SLOT_LIMIT = 524288`. Read-only; no peer reviews; no broad re-qualification.

The known gzip overage alone forces NEEDS_CHANGES. I did **not** find an additional retained-behavior defect that would independently force that verdict. Missing qualification is recorded plainly below and is not filled in by conjecture.

---

## Blocker 1 — complete-runtime gzip ceiling (known, not waived)

Frozen five-root measurement in `clock-byte-attribution.json` / `source-checkpoint-r4.json`:

| | value |
|---|---|
| minified | **204645** |
| gzip | **66457** |
| ceiling / target | **66000 / 64000** |
| overage | **457** |
| bundle SHA-256 | `f4439dd4af53b77171a30c27fe04e3af70123fbaf10618673d2b04e36d1db425` |

Entry roots match the frozen groups: Twin (`serverArguments`, `reduceQueryState`), `PersistentRangeStore`, `OfflineRuntime`/`offlineView`, `carrierProjection`, `receiptProtocol`. `build.mjs --measure-twin` still requires `unicode-tables`, `index-store`, `twin-store`, `swap-journal`, `carrier-index`, `metadata`, `projection`, `range-store`, `offline.ts`, `offline-protocol`, `local-cursor`, `held-program`. No measurement-only public API. HTTP/SSE/physical adapters stay out.

Largest attributed retained leaves: `runner.ts` 25239, `range-store.ts` 21778, `evaluator/dist/unicode-tables.ts` 17186. Parent authorized this checkpoint despite overage **only**. This is not a landing/release pass. v5 consolidation is pending. Inherited LLP/NOT-DOING 34k text was not treated as a new author prohibition.

---

## Missing / incomplete qualification (not replaced with conjecture)

1. **Native clock witness absent at the cited path.**  
   Brief path `/Users/ccheever/clique-improvement/revisions/inbox-restore/native-clock/row-window/{root-frozen-verification.json,persist-frozen.mjs.inputs.json,persistent-result-1788704878530.json}` and run `run-20260906T141848Z` **do not exist**. That directory contains only the approved design inputs (`astra-design.md`, `root-contract.md`, `root-cross-answer-addendum.md`, `root-capacity-revision.md`, `root-contract.json`). SHA `25784b3a…` was not found. I cannot independently confirm the claimed warm/cold real-row omission (untimed anchor + pool1 / evicted0). Store-review clock cases are explicitly labeled synthetic transport controls.

2. **Original 10s `store-review` file deadline failed, as the frozen manifest says.**  
   `store-clock-candidate.log`: **31 pass / 1 cancelled** by the 10000ms file deadline.  
   `store-clock-checkpoint-120s.log`: 38/38 in **12.070s** — not a 10s pass.  
   Checkpoint status: `not landing/release/full10s store proof`.  
   A later unbound file `store-checkpoint-v4-m5-10s.log` in the same lane dir shows 38/38 in 2644ms; it is **not** listed in `source-checkpoint-r4.json` and is not used as frozen evidence.

3. **Evaluator full-entry was not rerun for this HEAD** (`evaluator-r3-full-entry-tenth.log`, 225 modeled + 24 server-only). Indexed/clock deltas are covered by `test-indexed.ts` (checkpoint: all assertions pass; no Node 10s claim) and twin 28/28.

4. **`owned-clock-checkpoint.log`:** 211 pass / 4 SQLite fixture failures, subsequently repaired; `sqlite-r4-checkpoint.log` **15/15**. The 200 non-SQLite passes are not extra cases.

Bound passes that do count: twin **28/28** original 10s (`twin-clock-candidate.log`, 6734ms); same-swap **4/4** (`same-swap-clock-first.log`).

---

## Retained memory (actual, not 8 MiB fiction)

These are Node 22.23.2 / M5 numbers, **not** phone qualification, **not** summed, **not** execution-heap 8 MiB.

| probe | retained | notes |
|---|---|---|
| 100k index-only (`history-index-summary.json`) | **290,873,924** heap+buffers; RSS Δ 359,776,256 | 400 checked searches, p95 0.039ms; construction 14.5s |
| 10k index-only | 30,114,964 | same probe |
| 100k carrier timed mirror after 524288 cap (`carrier-history-r2-summary.json`) | **213,457,616** heapUsed Δ; JSON **85,736,668** | 300,000 slots; enrollment 25.7s; `refusedConditional: true`; recoveryError null |
| prior 262144 cap failure (`carrier-history-summary.json`) | 206,203,656 heap Δ; JSON 80,950,668 | refuses at 262,000 / offset 3000; **kept as evidence** |
| compact dictionary (`memory-r3-dictionary-m5-summary.json`) | 100-distinct 12,171,880 (was 62.4M, −80.5%); 1000-distinct 115,326,928 (was 618M, −81.3%); 1000-shared 58,930,952 (−21.1%) | ClientStore index only; GC async; no zero-residency claim |

Warm lookup evidence in source: `test-indexed.ts` patches `store.rows` to throw and still seeks. That is logarithmic posting/dictionary work, not a hidden row-history rebuild. Carrier `coverage()` still walks answer history for overlay-retirement cursor chains; that path is disclosed and is not the warm indexed read.

---

## Substantive retained behavior (no extra semantic blocker found)

### Search / Unicode / keys
- Wire remains source descriptors `{"WordPrefix":{"contract":"u17-nfc-scf-nfc-wsp-p","source"}}`; comparison uses prepared meaning (`logicalKey`, `prepareIndexAtom`, `NormalizedWordPrefix.token`). Empty search is null, not the trie root; `foo foo` is one-word `E_INPUT` before dedup (`unicode.ts` `searchQueryToken`).
- Q comes only from the issuing scan’s `source_max` (`coverage.ts` `prepareRange`). Derived receipts without matching trusted IR throw `E_INPUT`. Ordinary historical receipts still admit schema-checked ordinary coverage (`twin-store.ts` skips derived install unless `operation` exists).
- `Index.components` / `Scan.prefix` Scalar vs WordPrefix wrappers; ordinary point keys unchanged (`ordinaryColumns` refuses derived as scan-only). Halo is a same-pool `RowRef`/`haloId`. `n2_suffix` is ordinary suffix only (`cursor.ts` refuses a derived suffix component).
- `held_search` is engine-validated against the merge (`store.ts` `registerHeld`); ineligible narrower discovery does not get the directory plan.
- Readable directory is independent of term postings and downloaded membership; delivered-history remains readable; unknown required authority is `missing-authority` with no continuation; Deny/Public are known. Directory overflow is capped, not “complete.”
- Compact `PrefixDictionary` / `PostingTree` numeric handles, reverse GC, slot reuse, optional-field union, and 3000/4096 adversarial oracles are in `test-indexed.ts`.
- Text-min v4: absent/zero `min` omitted from canonical program JSON; positive minima recursive on args only; column Text stays max-only (`certificate-identity.ts`, `value-runtime.ts`).

### Local `h1`
- Binds partition / op / program / schema / generation / incarnation / `[rows, authority, overlay]` revisions / normalized search meaning. Identity mismatches are `E_INPUT` **before** stale restart (`StaleLocalPage`). Timed pages pin first local `readTime`; continuations do not resample (`twin.ts` + `test-indexed.ts` samples === 1).
- `serverArguments` strips only the declared cursor; `h1.`-prefixed ordinary text is preserved (`client.ts` query/SSE/resume, `client.test.ts`). Overlay retirement and watermark code reject `h1.` (`overlay-retirement.ts`). Server cursor 4096-byte identity unchanged.

### Clock / custody (against Astra + root contract + addendum + 524288 revision)
- Optional `readTime` on `DeliveryEnvelopeV1`: signed safe integer, no `-0`, omitted when untimed (`offline-protocol.ts`). Bound into raw fingerprint only when stamped. `seq` excluded from validator payload as before.
- Ordering: lower seq stale; higher seq wins; equal seq + equal fingerprint idempotent (checked receipt may promote); equal seq + newer clock accepts subject to durable-fact checks; older clock stale; equal clock + different fingerprint conflicts (`range-store.ts` `applyCoverage`).
- Durable facts are sequence-keyed, not `(seq, readTime)`. Immutable `factProofs` / `factGuards`; conditional refresh uses stored proofs, not hashed mutable rows. GC of the body does not drop the guard (tested after `dropAnswers`).
- Whole-swap timed preflight before ordinary conditionals (`guardFacts(..., track=true, enroll)`). Ordinary answer lacking proofs that intersects enrolled guards gets `needsFactProofs` and **one** authenticated full (`FullRevalidationRequired` / `commitMany` loop). Failure retains prior seq/data/outbox; failed preflight rolls back prospective guards (`SwapJournal`). same-swap 4/4.
- Clock-only omission does not infer eviction (`timedChange ? [] : hiddenRefs`), does not advance watermark (`clockMark`), does not count overlay-retirement misses (`onlyClock`). Fresh full row evidence at its durable seq still retires. Different temporal bounds are different `rangeKey`s; they are not unioned into stronger coverage. Local timed coverage with a moved `ReadTime` bound is partial (`test-indexed.ts`).
- Program/clock declaration required when custody exists (`queryClock` IR ≡ certificate; stamp xor untimed refuses). Raw authenticated custody is retained without derived coverage until that admission (`receiptEvidence` vs `receipt`).
- Slot ceiling 524288 counts guards + proof references + missing-proof markers. Exhaustion: one authenticated reset, outbox kept, repeated saturated rebuild refused (`factLimitReset`). Original 262144 failure retained as evidence.

### Other retained fences
- Assets: viewing token / once-column custody / lease-tied eviction unchanged in this delta (`asset-policy.ts`, existing offline-bytes tests in the 200 non-SQLite pass set).
- Trust absence, schema/program/epoch supersession, rollback (`SwapJournal` + carrier `replace` failure), overlay negative dominance over committed-but-unretired FIFO, and successor fences are implemented and tested in the bound twin/store logs.

`scope_touches` is declared on the shared trace type and is **not** populated by this twin runner. That is engine commit-invalidation, not the warm held index. I did not treat it as a twin semantic regression.

---

## What this review did not do

- No `build.mjs --measure-twin` rerun (frozen attribution already hash-bound).
- No 10s/120s store or full evaluator corpus rerun.
- No phone / Expo / process-kill / full-engine latency curve (not claimed by this checkpoint).
- No inspection of other reviewers, coding transcripts, supervisor notes, or benchmark app lanes.

**Bottom line:** do not land or publish this checkpoint. Repair gzip to ≤66000 (v5 consolidation, without weakening author semantics) and supply the missing native row-window witness plus a checkpoint-bound original-10s store proof before any READY claim. The indexed twin, h1 fences, receipt/Q custody, and clock/durable-fact behavior that *are* in this source look consistent with the frozen R2 + clock contracts.
