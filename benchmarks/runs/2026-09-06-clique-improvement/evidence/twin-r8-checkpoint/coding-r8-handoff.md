R8 is frozen as a coherent correctness checkpoint. The fixed size gate still FAILS: **221,505 minified / 72,199 gzip bytes**, **6,199 over 66,000** (target 64,000). The movement matrix also still fails its original 10-second deadline. This report grants no landing, release, memory, phone or 100k qualification. Root explicitly directed terminal writer release now, followed by bounded read-only structural analysis; no further product edits were made after the manifest.

Owned branch `s2/clique-search-twin`, starting commit `e1c6e2b79a9e13ceb363f647f52807218aa2b57a`, original lane base `1f9b4b95c54ba7a5a9d0ece41e9463b29078cfa4`. Worktree `/Users/ccheever/projects/snapback-worktrees/clique-search-twin`. Same Astra xhigh session `01a07649-dd08-7990-8d16-16a76e09ffbc`. No commit, push, publication, Rust/compiler edit, benchmark inspection or other-worktree mutation. Supervisor owns integration, consolidated prose and next review disposition.

Exact source custody: [source-checkpoint-r8.json](source-checkpoint-r8.json), SHA256 **7af726f1d813241c2dd701f7924f1d4c1dd8af1d370789a4617a45b2cb35174f**. It records **19 R8 delta files** against e1c6 and **61 total lane source files** against the original base. All 61 actual source bytes are copied under `source-checkpoint-r8.sources/`. Line counts use `split("\n").length`; maximum is client.ts **1500**, range-store.ts and offline-store.test.ts **1420**. Actual `node scripts/caps.mjs` passed. R7/R7a manifests and reports, and the historical R8 format3 snapshot, remain unchanged and are hash-linked in the new manifest.

The defect is repaired by retaining checked nonmembership in an exact extent separately from primary absence/tombstones. A later compatible outside image is accepted in either arrival order, including a separate transaction and cold reopen. A same-sequence inside image contradicts the retained extent even when its ID was never held. A later movement cannot erase an earlier applicable contradiction. Ordinary complete ranges have the same all-ID protection as timed ranges. True primary absence/tombstones remain global, while an outside authoritative image can supersede only the appropriate scoped overlay mask. Queued/sent/committed intent custody, negative FIFO dominance and stale per-answer frontiers remain enforced.

Extent conditions retain the trusted table/index, explicit site/ruleHash, issuing operation, normalized prefix, typed bounds, immutable same-pool Limit endpoints and disclosed IDs/halo. Exact ephemeral range identity is derived from that descriptor; hashes select dictionary references and never substitute for exact normalized meaning. Matching uses maintained scope/token/interval and exact-sequence positive indexes, with a shared live/proof physical posting index. It does not recover keys from mutable final pooled rows or scan all held scopes/history. Unknown schema/program custody remains opaque or requires authenticated revalidation; it cannot invent issuing Q or derived authority.

Private persistence is now **FACT_FORMAT 5**, independent of unchanged public v5 identities. Numeric `rowFacts` values represent primary absence (including zero); tuples represent positive sequence/digest. Verdict assertions and answer proof maps retain their distinct meanings. `factImages` and `factExtents` hold shared immutable key/condition payloads. The actual StoredAnswer/guard records own runtime references; copied owner arrays, positive guard records, liveRows and persisted duplicate extent keys were removed. Live and proof memberships share prepared ordinary tuples and Unicode handles/trie, retaining separate necessary postings and exact sequence namespaces. There is no parallel legacy decoder.

Conditional replies advance their exact immutable row/extent proofs. Answer replacement/GC updates balanced references; guards keep required facts after bodies leave, and the last owner releases dependent index buckets, token paths and payloads. A first missing proof requires one authenticated FULL response; a repeated saturated recovery throws before mutation. That repeated-marker refusal now occurs in the atomic swap, removing the prior whole snapshot read in resetClock. Failed publication, concurrency, cold retry, manual reset, outbox and seal controls remain explicit. Published ordinary no-clock stores with no private marker retain history. Missing-marker experimental custody and explicit formats 0/2/3/4 reset coverage atomically while preserving outbox/seal; they are not guessed into current extent authority. A new regression caught shared projection injecting the current marker when metadata omitted it; projection now preserves absence for common admission to classify.

Accounting remains **524,288 combined logical slots**. Charges include row/verdict guards, proof references and missing markers, extent guards, descriptor records/prefix/bound/endpoint/presence values, immutable image records/index entries/components/word entries, and active/inactive scoped masks. `imageSlots = 1 + sum(index entry 1 + component count + normalized word count)`; `extentSlots = 1 + disclosed IDs + prefix components + all retained ordinary bound/endpoint values`. Runtime memberships have charged owners and bounded multiplicity: index width <=8; derived postings <=4 times summed bounded source widths, enforced at prepared insertion; extent token paths obey independent issuing Q and the shared 4N bound. Actual runtime index/object/string memory is additional resident cost, not a fictitious byte-per-slot claim. The 1M-step/4MiB-closure/8MiB-execution-heap/1MiB-output limits and Exact2 deferral are unchanged.

Other routed R3 repairs are included: same-sequence clock changes no longer suppress genuine higher-sequence revocation; prior halo participates in immutable membership/deletion; unchanged denied/partial public projections omit invalid next and denied data; current-authority resume throws its already-published typed refusal while stale/aborted paths retain their error behavior; Words uses shared Unicode work/scratch accounting while preserving actual native Unicode/null semantics. The Grok stale-native ASCII/null claim was disproved against actual26c9 and was not implemented.

The exact changed files are:

| File | Final responsibility |
| --- | --- |
| `snapback2/packages/evaluator/src/index-store.ts` | Shared live/proof prepared keys and compact postings; bounded insertion. |
| `snapback2/packages/evaluator/src/ordered.ts` | Augmented interval-tree overlap traversal. |
| `snapback2/packages/evaluator/src/runner.ts` | Metered Words execution. |
| `snapback2/packages/evaluator/src/test-indexed.ts` | Extent/positive oracle, shared membership, GC and metering regressions. |
| `snapback2/packages/evaluator/src/test-search-v5-fixtures.json` | Unchanged actual owner26c9 movement/revocation/halo packets for affected controls. |
| `snapback2/packages/evaluator/src/unicode.ts` | Shared Words accounting and corrected foundation scope comment. |
| `snapback2/packages/snapback2/src/client.ts` | Typed current-authority resume refusal. |
| `snapback2/packages/snapback2/src/offline.ts` | Public conditional projection and atomic reset-marker path. |
| `snapback2/packages/snapback2/src/store/carrier-index.ts` | Single immutable owner, exact descriptor preparation and maintained reverse/physical indexes. |
| `snapback2/packages/snapback2/src/store/extent-facts.ts` | Immutable typed key/extent definitions and exact meaning/membership. |
| `snapback2/packages/snapback2/src/store/extent-index.ts` | Indexed retained extent matching and last-owner reclamation. |
| `snapback2/packages/snapback2/src/store/fact-index.ts` | Shared exact-sequence/live posting ownership. |
| `snapback2/packages/snapback2/src/store/fact-integrity.ts` | Global versus extent assertion transactions, private format5 and combined slot accounting. |
| `snapback2/packages/snapback2/src/store/projection.ts` | Preserve absent persisted private format marker. |
| `snapback2/packages/snapback2/src/store/range-store.ts` | Atomic extent admission, scoped masks, conditional/cold lifecycle and migration. |
| `snapback2/packages/snapback2/src/twin-store.ts` | Scoped-negative incremental visibility/FIFO integration. |
| `snapback2/packages/snapback2/tests/offline-store.test.ts` | Public denial/partial/resume and ordinary carrier controls. |
| `snapback2/packages/snapback2/tests/sqlite-state.ts` | Private metadata state shape mirror. |
| `snapback2/packages/snapback2/tests/store-review.test.ts` | Movement/all-ID/GC/conditional/overlay/migration/cap behavior controls. |

Current evidence is listed below. All commands were run from the owned root unless a captured cwd is stated. Entire package build exit0 was awaited before dependent tests. No piped test status is presented as a pass.

| Evidence | Actual result |
| --- | --- |
| `build-r8-projection-marker.log` | Production build/typing EXIT0. Final sourcemap inputs match current source; no redundant rebuild. |
| `evaluator-r8-private5-final.log` | EXIT0: 225 modeled +24 server-only; all foundation/index/cursor/authority/Words/shared-posting regressions. |
| `store-r8-projection-marker-all-formats.log` | 61/61, original10s, 2672.444833ms. Three carriers ×5 marker forms ×timed/ordinary ×sealed/unsealed, plus parent. |
| `r8-cap-direct-setup/stdout.log` | 1/1, original10s, 9009.748417ms (callback8137.598459ms); both exact524286 cycles and all assertions. |
| `store-r8-final-movement.log` | **FAIL**10pass/1cancel, original10s, 10026.4675ms. |
| `store-r8-final-movement-exploration.log` | 43/43, **explicit120s exploration**, 23819.336667ms;432 movement scenarios +6 Limit controls. Not a deadline pass. |
| `store-r8-final-custody.log` | 41/41, original10s, 2919.305292ms. Fixed holes, halo, conditional/GC, first enrollment, zero/global negatives, FIFO, Unicode scope movement, close/reset. |
| `client-r8-final-custody.log` | 15pass/1fail, original10s,1452.407708ms. Sole failure used default predecessor corpus with missing Scalar wrappers. All selected public/atomic/sequence controls passed. |
| `client-r8-final-native-golden.log` | Corrected only the corpus command input to frozen26c9: O1a1/1, original10s,597.239458ms. Original failure retained, no fixture edits. |
| `sqlite-r8-final.log` |15/15, original10s,1389.284416ms. |
| `r8-native-controls/result-r8-private5-final.json` |12/12 unchanged actual native movement/revocation/deleted-halo controls, warm/cold. Build0 awaited, run0. |
| `measure-r8-private5-final.log` | **EXIT1**,221505min/72199gzip against66000. |
| `caps-r8-private5-final.log`, `ref-r8-private5-final.log`, `diff-check-r8-private5-final.log` | All EXIT0. Ref-check411LLPs/7673refs/0errors. |

Every exact command, log SHA256, exit status and TAP deadline/count is recorded under `checks` in the source manifest. The evaluator command uses `SNAPBACK2_CORPUS=/Users/ccheever/clique-improvement/revisions/search-engine/final-snapshot/corpus` and `SNAPBACK2_BIN=/Users/ccheever/clique-improvement/revisions/search-engine/final-snapshot/snapback2-owner`, then `bun snapback2/packages/evaluator/src/test.ts`. No local Rust build or new owner launch occurred. Tests of contradictory authenticated frames are synthetic even when their schema/IR/certificate is native-certified. The native12 replay consumes nine unchanged actual26c9 inputs; it makes no latest Quarry authoring or phone claim.

Final native bundle SHA256 `494109a46379518bce13740cfcd3770e0dedf7b8b13fc3692f971743b87da768`;49 onLoad source snapshots match both current files and their captured copies. Native result SHA256 `9b7836e0153b2d62fccd2f74759d18b63b48b74609d340f51accc19b802c61aa`; input manifest SHA256 `e51455333cc3316991ada546426ca52f53f707a9893ed08da694e7f8ceff7001`. Package/current/native/five-root verification is in `r8-private5-final-source-verification.json`.

The cap pass qualifies **test setup allocation repair only**. Exact full serialized state14569662 bytes, SHA256 `c1855a09efdafc03ac10b721bc2990c798bb518868bf5162360face4fe34c506`, and the entire524286 key sequence, SHA256 `b197a3cbb283a5f704b159f62090acb60a6d04f2da4c80939711783daa419dc9`, were compared for complete equality before replacing only Array.from/Object.fromEntries with direct insertion. Original/new cap-body hashes `7474d8a2...` / `6cf4f757...`; supervisor independently verified every assertion and both cycles unchanged. The sole run used an immutable44-file execution copy, matching live/copy bytes before/after, parent52309/child52312. Capture `6da63dc2d39e21f63a05c32ff305315f2462f9e773d21bbe1b37c3275221074d`; result `556271a60dac55f38b732c078ed0fea75bb8f5e5c9355500e75e08dc09b9afc3`. Earlier capture preparation failed before Node because an extractor omitted a trailing newline; preserved in capture-error.md. No product cold-open improvement or untouched-test qualification follows from this pass.

Full measured roots are verbatim unchanged versus R7: Twin+serverArguments+reduceQueryState; PersistentRangeStore; OfflineRuntime/offlineView; carrierProjection; receiptProtocol. All48 required source inputs—including generated pinned Unicode, metadata, receipt preparation/decoding, clock custody, journal, indexes, cursor and projection—are in the measured graph. Pinned Node22.23.2/esbuild0.25.9/gzip9. Bundle SHA256 `491f80a65b6df24c39e83b074876ae99e67e41d31bd269eb5f5537cff2aeef5b`. Exact artifact, sources and attribution: `r8-private5-final-byte-attribution.json`, `r8-private5-final-metafile.json`, `r8-private5-final-byte-bundle.mjs`.

Actual byte history remains: R7/R7a66904FAIL; format3cleanup71930FAIL; compact stage172130FAIL; atomicmarker72124FAIL; sharedpostings72270FAIL; singleowner72088FAIL; finaldescriptor/projection72199FAIL. The single-owner removal saved182gzip against the shared-posting intermediate, but final central consolidation is **269gzip larger** than format3cleanup. Numeric absence-map payload is demonstrably smaller for the exact saturation state; that is serialized storage, not runtime gzip. No additive minified attribution has been presented as gzip savings.

| Source | R7 minified attribution | Format3 | Final format5 |
| --- | ---: | ---: | ---: |
| `range-store.ts` | 23416 | 25745 | 26056 |
| `carrier-index.ts` | 3985 | 7238 | 6322 |
| `fact-integrity.ts` | 2104 | 6178 | 7098 |
| `extent-index.ts` | 0 | 2381 | 2422 |
| `fact-index.ts` | 0 | 1670 | 1849 |
| `extent-facts.ts` | 0 | 869 | 1055 |
| `index-store.ts` | 5670 | 6290 | 6638 |

These are bytesInOutput, not separable gzip contributions. The exact table is `r8-private5-final-byte-delta.json`. No further safe reduction sufficient to close6199 bytes has been demonstrated. Root has refused a ceiling increase and directed a bounded same-Astra read-only structural proposal after writer release. There is no authorized feature cut, hidden payload, measurement-boundary reduction or new speculative coding loop in this checkpoint.

Material limits and preserved failures:

- Original R7 separate-movement/all-ID contradictory-admission probes remain immutable. R8 fixes are bound to new actual/synthetic inputs; earlier evidence is not relabeled.
- The before-fix physical projection regression remains3ordinarypass/3timedfail (parent=>4fails), original10s1153.73925ms. Exact original new test and old projection are retained in `r8-projection-marker-custody/`. The old projection matches captured single-owner format4 bytes, but the failing run used the completed descriptor-format5 dist, which was not separately archived before rebuild. This is an explicit full-execution custody limitation.
- All original cap failures remain, including compact stage1 and atomicmarker original10s cancellations, and the supervisor format4 phase cancellation. Its first setup4340.929wall/1609.798CPUms and firstopen4116.431wall/1606.628CPUms do not prove a host cause, index hotspot or completed recovery cost. Original fullstore exploration59pass/1cancel at120s also remains failed. The final movement10s cancellation is not closed by exploratory43/43. No final whole-store/whole-Twin10s claim.
- Final format5/shared-posting resident memory and realistic ordinary paginated-history capacity are **unmeasured**. Earlier format2 row-only10k mirror measured193501slots,93276968 heapdelta,42806900 ArrayBuffers and383844352 RSSdelta, JSON11963031bytes. It had no extents, physical carrier or Twin execution indexes and ran on a loaded primary. These distinct measures cannot be added or reused as final-format capacity proof. Root treats this as a material resource concern.
- Historical format3 small200message/10scope extent lifecycle measured3850→3650→3650→3640→0 slots through full/hole/conditional/GC/reset; it does not qualify final shared-index resident memory or normal paginated-history saturation. The ordinary paginated model remains UNRUN; its invalid predecessor named a nonexistent index, while the corrected model explicitly adds a synthetic index and is not a native-certified unchanged-schema comparison. M5 remains supervisor/engine-coordinated; no heavy run was started.
- Root must integrate with moving-main first-authEpoch adoption/tail-cursor fixes and separate e911 drain provenance/refusal propagation. Preserve this lane’s typed current-authority throw and stricter denied/partial projection in the union. Public v5 identities/min/format/null contracts and frozen native/compiler source boundaries are unchanged; full integrated/native/durable qualification belongs to supervisor.

Writer release: this session is terminal for the R8 coding turn. Product source was not changed after `source-checkpoint-r8.json`. Supervisor may inspect/hash/commit this exact owned tree and coordinate the instructed read-only structural analysis; this is not an approval or size waiver.
