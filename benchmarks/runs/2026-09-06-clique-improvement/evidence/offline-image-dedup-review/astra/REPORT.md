**Astra independent review — immutable `2ce04895` against `fca223`, with cumulative R8 context from `e1c6`.**

**Correctness verdict: NEEDS_CHANGES.** One reproducible inherited defect remains: successful coverage-reset completion is not durably projected, so reopening can restore `superseded` and make a completed rebuild pending again. I found no additional confirmed regression introduced by the direct image-deduplication delta. This verdict assesses the requested complete candidate, including inherited behavior; it is not an assertion that the direct delta introduced the finding.

**Size verdict, separately: FAIL — 74,399 gzip bytes.** The supplied exact final measurement exceeds the 66,000-byte ceiling by 8,399 bytes and the 64,000-byte target by 10,399 bytes. Fixing the correctness finding would not resolve this failure. Neither verdict provides landing, publication, benchmark, or physical-device clearance.

**Scope and independence.** I read `../packet/context.md` in full before the review. The reviewed identities are:

| Role | Immutable commit |
|---|---|
| Candidate | `2ce04895fa833ef40d8aad4e06b86c4ddae29a8c` |
| Direct base | `fca223284a3a20cc9aa557ff75e87259d9d94337` |
| Cumulative R8 base | `e1c6e2b79a9e13ceb363f647f52807218aa2b57a` |
| Native reference, read only | `26c9fd5e0d3922ce7680493c0e8f7371f4793d59` |

The packet manifest SHA-256 matched the requested `e48a218e6d405db0c91d2eca6603fad30c3362544516060c1051741e0b7effeb`. I independently checked lengths and SHA-256 values of all 2,202 manifest file entries; there were no mismatches. Source reads used the frozen packet, including both bases. I did not consult a moving worktree, separate prior or peer reviews, author review narratives, or benchmark context. Governing source instructions, LLPs, contracts, and the explicitly supplied documentation companion were review inputs. No subagents were used.

Requested model/effort: `gpt-6-astra`, `xhigh`. This review directory's launch and actual-model metadata agree on `gpt-6-astra`, `xhigh`; there is no model substitution to disclose.

I inspected the direct 14-file delta (+355/−168), the cumulative implementation delta including `4e927`, and relevant callers and invariants. Earlier implementation work was not treated as approved. This included the evaluator image/value/index/store/coverage/runner paths; receipt admission and public offline projection; Twin hydration, overlays and issuing-key recovery; carrier facts, extents, postings, journal, projection and adapters; and build entry/module identity. The cumulative closed-issue narrative was not used as evidence. I read the applicable root and Snapback instructions, LLP 1000/1001/1011/1012/1013, offline/live-query guides, and the packet's revised contracts. Explicit packet revisions govern where older documents describe the former timed-only scope, smaller capacity, ASCII search, or obsolete byte allowances.

**Finding F1 — P2: deleting a projected metadata root does not remove its persisted children.**

The relevant candidate code is [metadata.ts:11](/Users/ccheever/clique-improvement/reviews/search-twin-image-dedup-r1/packet/source/snapback2/packages/snapback2/src/store/metadata.ts:11), the journal path in [projection.ts:59](/Users/ccheever/clique-improvement/reviews/search-twin-image-dedup-r1/packet/source/snapback2/packages/snapback2/src/store/projection.ts:59), and [OfflineRuntime.completeReset():759](/Users/ccheever/clique-improvement/reviews/search-twin-image-dedup-r1/packet/source/snapback2/packages/snapback2/src/offline.ts:759).

`completeReset()` commits `{ superseded: null }`. The store deletes `state.superseded`, and the journal records a root deletion. `metadataChanges()` iterates only the fields still present in the new state. Consequently, its fallback for a replaced dictionary never visits the deleted `superseded` field. It emits a new `state` header, but no removals for `["superseded","generation"]`, `["superseded","schemaHash"]`, or `["superseded","authEpoch"]`. `ProjectionCache.prepare()` accepts this incomplete delta. On reopen, `restoreMetadata()` recreates the missing root from those three surviving records.

This is a normal public runtime path, not an invented metadata field or an invalid backend replacement. I reproduced it after a checked full delivery, `resetCoverage()`, and a fresh checked full delivery rebuilding 11 rows. A successful `completeReset(runtime.coverageRevision)` returned `true`; both `resetNeeded` and the in-memory superseded marker cleared. Closing and reopening the same principal restored the old marker and `resetNeeded: true`.

The practical consequence is lost durability of rebuild completion: a cold runtime can treat already rebuilt coverage as superseded again. `coverageCurrent()` then rejects that coverage as current, impairing offline availability and requiring unnecessary reset recovery. I am not claiming this reproduction deletes queued writes or admits stale data as exact.

**Independent reproduction and controls.** [probe-metadata.mjs](/Users/ccheever/clique-improvement/reviews/search-twin-image-dedup-r1/astra/probe-metadata.mjs) contains the full executable reproduction; [probe-metadata-result.json](/Users/ccheever/clique-improvement/reviews/search-twin-image-dedup-r1/astra/probe-metadata-result.json) and [probe-metadata.log](/Users/ccheever/clique-improvement/reviews/search-twin-image-dedup-r1/astra/probe-metadata.log) preserve its final output. Run from this directory:

```sh
/Users/ccheever/.volta/tools/image/node/22.23.2/bin/node probe-metadata.mjs
```

The probe imports the unchanged supplied `dist/sqlite-test.mjs` and its private `image-runtime.mjs`, extracted only under this directory. It exercises shipped `OfflineRuntime`, `PersistentRangeStore`, and `SqliteBackend` JavaScript. Its driver is a small synthetic transactional map implementation of the exact SQL operations issued by that backend. It opens no SQLite database, executes no native checker, and performs no build or network operation. Importing the supplied test bundle imports `node:sqlite` and prints its experimental warning; the native driver and database constructor are never invoked. Thus the observed SQL omission is directly reproduced, while real SQLite/IndexedDB/device transaction behavior was not independently tested.

The input is the packet's unchanged native26c9 `nativeR8.halo` fixture through checked admission, followed by public runtime reset/rebuild/completion calls. The fixture SHA-256 is `e43fbff9ff92e1968a3769b16b0c822700256cdedac9728d0545e45bee05b4a2`. The synthetic part is the storage driver and deliberate transaction-failure injection, not a claim of newly native-emitted receipts.

| Observation | Final probe result |
|---|---|
| Rows after rebuilding | 11 |
| Injected failed completion | Rejected; in-memory pending marker retained |
| Subsequent successful completion | Returned `true`; `resetNeeded: false`; no in-memory `superseded` |
| SQL for successful clear | One state-header upsert; no metadata deletes |
| Persisted stale children | Three `superseded` entries |
| After close/open | `resetNeeded: true`; original generation/schemaHash/authEpoch restored |
| Measured probe body elapsed time | 95.123375 ms |

The failed-completion control verifies that the reproduction is not an accidental consequence of a failed transaction advancing the projection baseline. I first ran the minimal reset/complete case (83.71275 ms), then strengthened it to include the full 11-row rebuild and reran once; the retained files contain the strengthened run. Both were small, bounded JS probes, not performance qualification.

Runtime: Node `v22.23.2`, Darwin arm64, binary SHA-256 `18e387c90ab8a8400183e8bdd396376e1e875b91b4c874b894dcade7b35bf572`, matching the permitted pinned binary. Imported `sqlite-test.mjs` SHA-256: `828f7f62368d63d2c9a4f79c804effa04fb3382b246a0b5d57fa8a632126673c`; `image-runtime.mjs`: `e513ca26560d476218cbfaae4cc67be009b32a810dc71d19edc3fe695872c925`. These come from the supplied candidate4 public-build archive, SHA-256 `019e368b3168738b7b1a85d4d8f982c4665bb0af98f43a48ef24091187b20770`.

**Attribution and repair boundary.** This defect is inherited from before `e1c6`, not introduced by `2ce04895` or the cumulative R8 delta. `metadata.ts` is byte-identical in candidate, direct base, and cumulative base: SHA-256 `a126e078aa672eae5287d42f001b5b15152fb6eb606d4486e274aad8b93bdafd`. Both base projection implementations accept the same incomplete metadata delta. I established base attribution from source, rather than claiming to have executed old builds.

A repair needs to remove the children owned by a deleted metadata root in the same transaction as its header change. Preserve the new presence-only baseline and commit-only advancement. Do not restore serialized row/receipt bodies to solve this. A keyed root-to-metadata-key ownership path can keep normal journaled work bounded; a deliberate full metadata reconciliation during reset completion is another possible tradeoff, but would need explicit workload review. Add a focused reset/rebuild/complete/close/open regression through each database projection, including failed publication and retry. Generic full replacement tests alone do not exercise this journal deletion path.

**Direct change assessment.** The ownership repair is substantially supported by source and supplied evidence, with F1 remaining an independent projection correctness issue.

* Equal authenticated refreshes now rebind the effective store to the current carrier image. `ClientStore.put()` distinguishes image identity from semantic change; equal replacements reuse immutable keys and update index-held row references without calling the semantic row-change/generation path. `HeldIndex.putPrepared()` updates the existing entry and scope membership when the key identity is unchanged. `TwinStore.refreshRow()` therefore stops retaining the obsolete equal effective body. Its asset bookkeeping retains IDs and changes when row meaning changes, rather than becoming another body owner.
* Equality is not digest-only. `RowImage.equal()` compares nominal kind, schema identity, table, omitted optional ordinals, and canonical tagged value. A Row and a Map, an omitted optional and an explicit null, or two schema identities are not silently merged. Carrier wire identity and evaluator tagged identity retain their separate purposes.
* The sparse-image change keeps omission information in private ordinal metadata while materializing optional Null only for execution Rows. `RowImage.tagged()` reconstructs sparse form; `imageWire()` and projection do not publish internal brands or materialized fields that were absent from the authenticated wire row. Optional `__proto__` uses own-property checks and safe field definition, including ordinary and derived index preparation. The synthetic schema-extension probe is evidence for the JS boundary, not native certificate acceptance of the synthetic extension.
* The common validator reduces duplicate wire conversion logic. I checked the complete scalar/shape preflight before reserved/type refusals; input-field and schema traversal order; recursive Optional/List handling; closed asset records and duplicate asset IDs; safe integer/string scalar validation; Bytes; reserved-looking JSON maps; and refusal family/path translation. Receipt fields are converted by declared column type, rather than interpreting arbitrary JSON objects as evaluator tags. I found no concrete direct regression in these paths.
* The projection baseline now stores four sets of committed keys and a legacy-metadata flag, rather than serialized values. Trusted `ChangedRecords` chooses warm writes. Generic backend replacements intentionally serialize/rewrite supplied entries and remove absent keys, ignoring mutable `previous` aliases as an equality authority. Values prepared for writes are recursively JSON-isolated. New JSON-omitted metadata stays absent; an existing entry replaced with an unserializable value still refuses. F1 specifically shows that deletion of an entire split metadata owner needs separate handling.

**Private ownership and retained-state inspection.** I inspected private fields and references in source; enumerable-key probes alone cannot establish body reclamation or physical heap usage.

| Owner | Retained state and review conclusion |
|---|---|
| `RowImage` | One immutable tagged body; private kind/schema/table, omitted ordinals, key image, optional digest. Private fields do not hide a raw-wire body mirror. The cached digest is bounded metadata, not equality authority. |
| `ImageKeys` | Recursively frozen per-index scalar parts and normalized word inventories. No row-body backlink. Scalars may equal portions of a row, as required key values; this is not a second complete row. |
| Carrier current rows and effective Twin | Share the nominal image when effective content equals current base. A changed optimistic row remains a separate effective body. FIFO contributions and asset-ID ownership remain distinct from historical fact custody. |
| Historical facts and extents | Guards, digests, reference counts, key images, closed-extent conditions, presence IDs, issuing proofs and masks. No persistent full row-receipt body map or serialized row mirror was found in these owners. |
| `CoverageIndex` | Cloned receipt metadata and expected issuing keys for every interior row and halo; temporary recovery callbacks are consumed, not retained. Removed body ownership is not kept through a callback closure. |
| Live/proof indexes | Shared key preparation and partitioned postings, with current row references only in the appropriate live/effective owners. Refcounts release last-owner postings and trie entries. Free-slot arrays can retain high-water allocation; logical slot reclamation is not proof that resident heap immediately shrinks. |
| Journals | Swap rollback owns prior records only for the transaction. `StoreChanges` retains bounded key histories, not older row-body deltas. Snapshot consumers may retain their own prior snapshots; that is distinct from a hidden internal current-image mirror. |
| Database projection | Committed key sets only; tentative deltas/JSON strings live for a replace transaction. Close resets the baseline. The F1 stale metadata is a durable key-deletion bug, not retention of row payloads in this cache. |

External `ClientStore.put`, constructor and rehydrate paths prepare/copy arbitrary tagged input, including nested children of shallow-frozen objects. Wire admission builds owned typed children. Custom Twin sources are recursively copied except for internal nominal immutable leaves. Same-object ordinary inputs are not trusted merely because they are frozen. Prediction rollback reinstalls previous row/image ownership. Coverage rehydrate/replacement preflights before changing published authority and journals row restoration on failure.

The actual package build emits one private synchronous `image-runtime.mjs` for `RowImage`, `ImageKeys`, error identity and normalization/capability imports. Client, React, React Native and Expo arms resolve the same module; the nested Expo witness uses its corresponding relative path. The package export map adds no public image-brand subpath. I found no `Symbol.for` image registry or structural brand fallback. The fixed measurement bundles the implementation rather than treating that private runtime as free external code. Cross-arm tests in the packet are supporting evidence; I did not launch React Native or Expo locally.

**Cumulative R8 contract assessment.** The following are source-review conclusions supported by the attributed tests below, not a claim that I reran the full matrix.

| Required area | Assessment |
|---|---|
| Immutable all-ID extents | `FactTransaction.close`, extent conditions/indexes and scoped masking retain closed membership meaning for ordinary and timed answers, including unknown/nonmember IDs. Membership checks use issuing sequences and immutable keys, not whichever current row happens to be resident. |
| Scoped absence versus deletion | An outside-scope full assertion can coexist with an old scoped hole. It does not become a global tombstone. Inside-scope and true tombstone contradictions at the asserted sequence remain distinct refusal cases. Positive preparation precedes extent closure for same-swap arrival-order independence. |
| Historical enrollment | Earlier retained ordinary owners can be enrolled when later integrity checks require them. Row GC does not authorize dropping durable guards. Missing opaque historical evidence requests FULL/reset rather than inventing a key or scanning all historical bodies. |
| Delayed full receipts | `TwinStore.issuing()` uses each retained proof image's index keys, including all interior row IDs and halo. Fallback to current material is explicitly gated by defined `answer.nextSeq` matching `rowSeq`; a conditionally advanced answer `seq` is not substituted. Coverage compares expected/lost keys, extent and endpoint state before accepting a replacement as equivalent. |
| Limit, Exhausted, halo and negative GC | Coverage stop adjustment prevents an apparent drained result from inheriting exhaustion without supporting full extent. Halo loss, missing expected IDs, scoped masks and view-once/global negatives remain inputs to exactness and GC. I reviewed these together with movement and cold-reopen cases. |
| Clock identity | Optional `readTime` is validated as an exact signed safe integer and checked against the issuing query's clock declaration. Sequence orders first, then strictly newer readTime within matching identity at equal sequence. Replays, older clocks, raw full identity and conditional normalization remain distinct. |
| Time-only effects | Clock selection does not itself purge omitted rows, advance a durable watermark, or count an overlay miss. A real fresh full positive still has its explicit durable-sequence meaning. This distinction matters where retirement logic observes actual arrivals. |
| Missing proof recovery | Conditional acceptance checks `needsFactProofs` and requests a FULL result. Store publication remains atomic on missing proof or contradiction. Reset/saturation markers preserve retry state and outbox custody; F1 separately prevents durable completion of an otherwise successful reset. |
| Public offline values | The cumulative `offlineView` change uses current local partial information even when old held data was exact, except explicitly retained history. Denied data and inapplicable continuation fields are omitted; the client propagates the converted offline refusal. |
| Search | Unicode 17 pinned NFC(simpleFold(NFC)), C/S mappings, explicit whitespace/punctuation rules, null-as-no-tokens, token counting before deduplication and the 4N word bound remain in the shared runtime. Query source Q=2000 and 100 scopes are independent bounds. Scalar descriptors are active tagged-vs-wire components, not guessed from JSON shape. |
| Cursor and text boundaries | Ordinary suffixes remain ordinary for halo/n2 and cursor encoding. Local timed continuations retain the first local execution clock. Text predicates and descriptor validation are checked before execution, with native argument-format/null behavior distinguished from column constraint omission. |
| Warm work | Keyed proof/extent/posting owners replace body/history recovery scans. Outbox-only journaled updates do not require reserializing unchanged rows or history. Existing reset/cold reconstruction and explicit owner retirement are separate workloads, not a newly permitted warm all-history fallback. |

**Capacity and execution limits.** Source retains 1,000,000 steps, 4 MiB closure, 8 MiB heap and 1 MiB output as the fixed execution ceilings. Derived normalization/Words work now charges steps and scratch, including the certificate's derived ceilings. The fact format is 5 and `FACT_SLOT_LIMIT` is 524,288. `imageSlots` charges the image, each index/key-part inventory and each normalized word; `extentSlots` charges condition/presence/prefix/bounds. Guards, answer/proof references, missing proofs and negative-mask ownership are separately counted. I found no added combined live-plus-S gate or reduction of the original admissible populations.

The original numeric absence population remains 524,286 in the capacity test. Both saturation/open/recovery cycles and concurrent/retry marker cases remain part of the supplied two-test evidence. I did not rerun or resize them. Physical posting/trie metadata must be understood as derived from the existing live/key/proof owners and schema maxima (including at most eight components and 4N word bounds), not as a second independent policy cap. Reference-counted deletion and format migration are important here, but a logical slot count does not measure bytes.

**Native parity and supplied execution evidence.** The authoritative native source for this review is the packet's exact 26c9 tree, not historical Rust files under the JS candidate. I inspected the relevant native TextFormat/argument validation/IR null treatment. The required identities remain `i53-codepoint-bytes-unicode-search-text-refinements-v5` and `bounded-spike-rust-search-text-refinements-4`. The JS candidate's historical `ir-contract.json` v2/systemPrincipalId discrepancy is an explicitly known provenance limitation, not a new parity claim or a reason to substitute its native tree.

The packet records 280 corpus manifest matches and use of the existing exact checker with SHA-256 `2f3cd93ccbff5902465f2514e61d8cf6fedf76228ad8e7abafe02ed5f1959175`. Its role was `check --ir --json`, not a newly measured owner/server/population. I performed no native execution.

| Supplied run | Observed result and attribution |
|---|---|
| Candidate4 package build | EPYC Linux; exit 0; 3.121177488 s; 120 s outer deadline. |
| Candidate4 SQLite/projection selection | 4/4; 0.264748146 s wrapper; original Node test timeout 10 s, outer 30 s. |
| Candidate4 adapter selection | 67/67 including nested cases; 1.016671930 s wrapper; 10 s test timeout, outer 30 s. |
| Candidate4 equal-image/sparse-optional selection | 2/2; 0.314942134 s wrapper; 10 s test timeout, outer 30 s. |
| Candidate4 movement | 43/43; 5.377933263 s wrapper; original 10 s test timeout, outer 30 s. |
| Candidate4 initial evaluator attempt | Exit 1; 5.578410621 s; missing native checker (`ENOENT`). This attempt is a failure, not a pass. |
| Candidate4 evaluator with exact checker | Exit 0; 6.430314788 s; 120 s outer deadline, no substituted internal test deadline. 225/225 cases, 24 serverOnly classifications, 2/2 visibility checks, plus indexed/Unicode/merge and ownership regressions reported passing. |
| Candidate2 supporting selections | Store 44/44 (1.567541664 s); Twin 12/12 (1.066870389 s); public projection 13/13 (0.966374345 s); delayed FULL 1/1 (0.264788809 s); capacity/recovery 2/2 (2.019420689 s). These are earlier-candidate evidence only for unchanged relevant inputs. |

The supplied before/after equal-image probes support the intended direct ownership repair: final initial/current effective sharing is true, equal refresh changes the current object and rebinds the effective object, canonical equality remains true, and keys are shared. The final synthetic projection driver probe reports 11 typed current rows, 106 fact slots, shared effective images, no serialized wire-body strings in the projection owner, and key-set clearing from 11 to 0 on close. Source inspection of private fields is necessary in addition to those observations. The optional-`__proto__` probe confirms sparse round-trip/admission at the JS boundary under a synthetic schema extension; it is not a new native emission or certification.

Candidate1's type failure and candidate3's undefined-metadata diagnostic remain separate development evidence and are not reported as qualified candidate4 builds. Historical Mac 10 s timeouts remain failures for those runs. Exploratory 120 s reruns do not rewrite those outcomes. I ran none of the supplied suites, cap/movement matrices, builds, size measurements, native checks or remote jobs during this review; the only new execution was the bounded F1 probe described above.

**Exact size accounting.** I inspected the fixed entry, build configuration, final artifact attribution and raw failure output. The entry retains the five required root lines:

```ts
export * from './src/twin.ts'; export { serverArguments } from './src/local-cursor.ts'; export { reduceQueryState } from './src/types.ts';
export { PersistentRangeStore } from './src/store/range-store.ts';
export { OfflineRuntime, offlineView } from './src/offline.ts';
export * as carrierProjection from './src/store/projection.ts';
export * as receiptProtocol from './src/offline-protocol.ts';
```

It includes the full local runtime, Unicode tables, custody, projection, receipt and cursor/admission implementation. The pinned supplied measurement uses Node 22.23.2, esbuild 0.25.9, neutral ESM/es2022, minification and `gzipSync(..., { level: 9 })`.

| Snapshot | Minified bytes | Gzip bytes | Verdict |
|---|---:|---:|---|
| `fca223` | 227,321 | 74,243 | FAIL |
| `2ce04895` | 227,718 | 74,399 | FAIL |
| Direct delta | +397 | +156 | Increased size |

Final bundle SHA-256: `87f699c09dae12e66904da9573162de6f6518d202a73835875c663e60e518a62`. The final measurement exits 1 at the ceiling check. The source attribution shows minified `offline-protocol.ts` −1,629 bytes, `value-runtime.ts` +1,523, `row-image.ts` +284, `index-store.ts` +223 and `projection.ts` −74, among the other changes. These are minified source contributions, not additive gzip deltas. In particular, removing the projection payload mirror does not imply that this patch reduces gzip size.

Historical gzip failures remain failures: 73,023 (`36fea`), 72,709 (`cb578`), 72,555 (`47a7`), 72,367 (`4fb7`), 72,229 (`02a5`) and 72,199 (`4e927`). They do not replace the final 74,399 result. I did not rerun measurement, change its roots, externalize the shared runtime from accounting, relax the ceiling, or infer compressed savings from source-line deletion.

**Memory, documentation, and remaining limits.** Current resident memory is unmeasured. The historical approximately 79.4–79.5 MB carrier-plus-Twin 10k observations and the separate approximately 52 MB carrier/500-answer, 105,200-slot, 8,278,766-serialized-byte observation have different source/workload attribution and zero-word limitations. They are neither current-candidate measurements nor additive components, and must not be extrapolated to 100k, word-heavy histories or a phone.

The exact LLP1013 documentation companion appropriately describes committed key presence, generic replacement rewrite/isolation, sparse wire versus materialized execution form, omitted-versus-existing unserializable metadata, commit-only baseline advancement and close cleanup. It correctly avoids a new physical-memory or device-performance claim. Its warm/reopened-state agreement is the intended contract, but F1 demonstrates that the candidate does not satisfy that statement for root metadata deletion. Other governing LLP integration remains pending as the packet states; this review does not silently promote the companion to completed integration or device qualification.

The concrete architectural recommendation is to keep the projection payload mirror removed and preserve equal-image sharing while repairing metadata-key ownership deletion. I do not have evidence for an additional semantics-preserving deletion that would save the missing 8,399 gzip bytes. A future size proposal must identify actual removable code/state, preserve refusal ordering, proof custody, fixed roots and runtime limits, and be falsified or supported by the same full-entry measurement. There is no defensible numerical saving to assign here.

All new files and extraction outputs are confined to the Astra directory. The packet and source snapshots were not modified. Completion of this review consists of this report and the reproducible finding artifacts; required follow-up is the metadata durability repair and focused regression evidence, with the independent size failure still outstanding.
