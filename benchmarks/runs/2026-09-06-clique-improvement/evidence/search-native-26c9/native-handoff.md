# Search engine lane 2 — final native handoff

Native implementation is complete and frozen at **26c9fd5e0d3922ce7680493c0e8f7371f4793d59** on `s2/clique-search-engine`, with a clean worktree. Base is `d9ed822aa66ebb5dfd0367a59bc0e454ba1ecd18`. This is a native source/affected-test handoff for parent-owned blind review and matched integration; it is not a search performance, phone, shipped-package, or publication qualification.

## Source and immutable artifacts

Three commits preserve the implementation and explicit feed reconciliation:

- `f8ea577528b7346e5a25d9025aaa86d126c34bc0`: complete native search, active wire migration, independent held/Q certification, pooling/retention/accounting, bounded identities, minimum arguments and registered regressions/corpus.
- `edfe1f36368203775a2fce4f88733f0be4ac8ed7`: separate reconciliation of the full supplied landed feed delta from `72c2a11c56119d9908d1df9a89d4bd9e5f9410fe` plus `2cd0872d2f8a5cad1e0bf6730a3d5e84385cc064`.
- `26c9fd5e0d3922ce7680493c0e8f7371f4793d59`: approved optional query-clock delivery, v5 text formats, actual adjusted chat fixture/runtime regressions, and final corpus identities.

[Final snapshot](final-snapshot/inputs.json) contains the native owner and exporter, complete native source archive/inventory, binary diff from d9, separate feed patch, all corpus bytes, five certified controls, actual clock/chat evidence, and copied validation logs. Native source graph SHA256 is `07d985316ae2d74494980a0c4871a13a877237ca0de15f97e2d12ad337518e70`; owner executable SHA256 is `4d0f8f0176921b56305e9969da0fcb2dd5ecedae1f65d983f537e613d0c6e46e`. The graph algorithm and all 261 native input files are recorded in inputs.json/native-source-inventory.json. The full delta from base has 425 changed source/corpus paths.

Owner: [final-snapshot/snapback2-owner](final-snapshot/snapback2-owner), arm64 macOS debug, Rust/Cargo1.97.0, unchanged package0.0.8. Builds used3jobs and the existing private warm `feed-repair/target/debug` through this lane's `snapback2/target/debug` link. No retained feed binary, frozen app/checkpoint, review snapshot, or private database was modified. No push, npm, version change, stash/reset, main/other-worktree mutation, new repo docs/scripts/checks/config/registry, or compiler/evaluator/client product source changes.

Final active identities are `i53-codepoint-bytes-unicode-search-text-refinements-v5` and `bounded-spike-rust-search-text-refinements-4`. Historical provisional01–07 artifacts remain unchanged and version-bound.

## Implemented behavior

- Active `Index.components`, `Scalar`/`WordPrefix` IR and logical receipt atoms; typed pooled halo references and suffix-only secondary lookahead. Ordinary point/rule/constraint/cursor addresses reject derived indexes. Query source Q is inferred independently from actual lexical binding identity and must exactly equal metadata, independently of indexed column width.
- Independently rederived canonical held membership discovery: actual source principal, authorization predicate pins, scope/disjointness, term/suffix/bounds/take/cursor correspondence. Exact immutable compiler alias-shadow principal, coalesce/object Q, literal-use and erroneous tuple-lowering IR plus rename controls are embedded in registered native tests. Incorrect held metadata and understated or inflated Q are rejected according to actual IR; compiler assertions are never treated as authority, and erroneous source intent is not reconstructed.
- Exact Unicode17 dictionary edges, distinct per-row ancestor postings, compound secondary order and reverse membership; transactional insert/update/delete/upsert/seed/admin/maintained/job paths, reverse deletion without old-text retokenization, deepest-first zero-ref GC, invalidated negative handles. Optional fields normalize independently; empty terms match nothing and multiple occurrences refuse before dedup. `Words` uses the pinned Unicode contract; mentionTokens remains separate.
- Separate old/new `ScopeTouch` propagation through persistence/history/live/OCC/replay/jobs/timers, including content-only edits and scope moves. Ordinary exact touches retain their semantics. Successors rebuild in bounded128-row batches atomically, validate existing identities, and replace engine-owned policy hashes; failed rebuild leaves prior generation/data intact.
- Shared immutable row/map bodies and pooled rule/source images with copy-on-write. `RowMembership` preserves independent trace-first and receipt-first images; only equal images share storage. Rollback, visibility, returned/examined distinctions, auth, halos, opaque cursors and non-search semantics remain covered by existing regressions.
- Separate derived operation and peak scratch ledgers, with normalization/dictionary/reverse/posting/ref/primary/secondary work and live buffers charged. Heap remains32×legacy steps plus derived scratch. Query closure prices actual duplicate wire bytes despite shared memory. Full100-lane/K20/Q2000 and20KiB-message/576-byte-membership stress fit existing ceilings with actual pools; no ceiling was raised.
- Existing144-byte canonical tagged UTF-8 Id/Principal/Ref limits now enforced at input, actual row/seed/admin/cursor/receipt/minted emit and existing-generation boundaries; no identity spelling/order change. Invalid emitted identity rolls back outbox work.
- Recursive argument text minimum and optional handle/url format enforced before query/mutation, job enqueue, and channel admission through shared validation, preserving E_INPUT/E_JOB_ARGS, Optional omission/null, cardinality/scalars/controls/max. Unknown/malformed formats and invalid minimum bounds reject. Column format predicates are reused unchanged, including exact Rust URL whitespace/control semantics. Canonical text order is max, positive min, present format; v4 certificates fence independently by value/evaluator identity. Job suggestions use actual Quarry `text 2..3 format handle` spelling and recursive wrappers.
- Optional full-envelope `readTime` comes from the exact executing Context iff the issuing query declaration requires it, including unvisited timed branches; signed-safe0/negative stamps work, invalid/missing stamps and IR/certificate mismatch refuse. Strong validators include the stamp only when present; seq remains excluded and untimed goldens remain unchanged. Query, initial/continuous SSE and resume use the same projection path, with+32 envelope allowance and actual resume-size accounting. DeliveryUnchanged is unchanged.
- Repaired the every-column offline projection fixture's invalid synthetic image/video IDs to lawful deterministic engine-ID spellings and validated the synthetic row through native admission shape checks; no fabricated asset-ledger authority or relaxed twin decoder.

## Feed overlap preserved

The complete supplied637-line source patch was applied only after the coherent f8 checkpoint. Actual conflicts were in `engine/index.rs` and `engine/merge.rs`; certificate reserve and scan image retention merged automatically. Resolutions retain active components and physical seek binding while traces/receipts keep logical atoms, preserve empty-search exhaustion, and respect already suffix-only `last_examined` during heap/refill ordering.

Shared initial-seek templates, borrowed scans, retained visible-image heap positions, returned/examined ID bookkeeping and strict refill/nonuniform cursor fallback survive. Complete retained-template pricing includes the optional box/inline struct, SQL/parameter/vector/string capacities, typed and encoded scalar/tuple bounds and names, with checked arithmetic and refusal before wide-bound cloning. Reserve stays within the existing32×(L+K+2) legacy heap budget. Supplied capacity/empty-wide/varying-bound/fallback tests were ported without weakening assertions;426 core tests passed after this reconciliation. Original independent first-image regression remains green in the final431. No repeated published-feed client curve or performance claim was made.

## Validation

All build/test attempts and failures remain under this external revision directory; [retained log inventory](final-snapshot/retained-logs-inventory.json) hashes them. Final copied logs are in [final-snapshot/validation](final-snapshot/validation).

| Check | Result | Evidence |
|---|---|---|
| Core nextest, existing local-proof profile |431 passed;1 existing skip|final-core-v5-01.log|
| Native owner unit nextest |151 passed;1 existing skip|final-owner-unit-v5-01.log|
| Whole workspace test compilation |pass|format-build-03.log|
| Native owner/exporter build |pass|owner-export-build-v5-04.log|
| Workspace doctests |pass;0 registered|final-doc-v5-01.log|
| Actual native HTTP/query/initial+continuous SSE/resume clock |1 passed, original30s deadline|clock-native-owner-v5-02.log|
| Exact adjusted real-chat native runtime |1 passed, original30s deadline|guide-native-v5-05.log|
| Exact four emitted search recipes |1 passed|recipes-native-v5-10.log|
| Text format wire/admission and empty-job controls |2+1 passed; also in final core suite|format-native-01.log;format-jobs-01.log|
| Existing corpus exporter |249 cases;30 offline JSON goldens included|export-corpus-v5-04.log|
| Caps/ref-check/diff/scope |7 budget categories pass;411LLPs/7668refs,0 errors/unchecked;clean|final-caps-02.log;final-ref-check-02.log|

Builds used `CARGO_BUILD_JOBS=3 cargo ... --manifest-path snapback2/Cargo.toml -j3 --locked --frozen`. Core nextest used existing `.config/nextest.toml`, profile `local-proof`,8test threads and `--no-fail-fast --locked --frozen`. Focused native test binaries ran under30-second subprocess deadlines with3test threads. Original timeouts were retained. Green final test durations are correctness evidence only.

Owner unit and exporter compiler calls used the verified external **e6c46a2aca7c3fa014ce365dadce667b5e13e509**188-file compiler archive, paired explicitly with active v5 core ir-contract and recorded effects declarations/dependencies, via proven external Bun routing. Node/dist path routing was verified after normalizing actual invocation paths; no owner test was weakened and no ignored package bundle replaced. This is source-consumer validation, not shipped Node package qualification. Toolchain/provenance and invocation logs are retained; this host's general node is25.9.0, not the parent's pinned Node22 metrology graph.

Original owner-unit old-wire failures, unsuccessful initial routing, compilation/corpus/test failures, actual guide admission failures, and missing external journey declaration failure remain retained. The accidental early wrong-root formatting diff was retained externally and only those five clean v1 files restored byte-for-byte from their preexisting HEAD; final delta contains no v1 files. No reset/stash was used. All known affected native product-test failures were resolved before freeze.

## Concrete artifacts for peers

- [Global held certificate](final-snapshot/certificates/search.global.json), [people](final-snapshot/certificates/search.findPeople.json), [conversation](final-snapshot/certificates/search.inConversation.json), [Words](final-snapshot/certificates/search.tokenize.json), [recursive format control](final-snapshot/certificates/format.json). Each includes schema/program/native certificate; read_sites, derived ledger bounds and applicable result_pages/merge_sites are present.
- [Complete corpus](final-snapshot/corpus/manifest.json), plus all30 offline goldens under `final-snapshot/corpus/offline/`, including envelope-uniform-range-halo, envelope-capped-page-next and repaired every-column closure/envelope.
- [Actual native clock evidence](final-snapshot/clock-native-owner-v5-evidence-02.json): authenticated /api/program custody, query, initial/continuous SSE at unchanged durable seq with changed row-bearing window/clock/validator, old-validator full responses, resume log/mounted frames and untimed control.
- [Adjusted real chat evidence](final-snapshot/guide-native-v5-evidence-05.json), [exact full emitted ProjectJson](final-snapshot/guide-emitted-project-e6.json), [emitted declarations](final-snapshot/guide-emitted-api-e6.d.ts). Full original chat was copied externally and changed only by the provided two-index schema patch and search.q; original messages.q/effects/journeys were preserved. All23 programs certify. Registered Rust fixtures contain the exact emitted IR with no external test-file dependency.

Actual chat proof uses100conversations,50members in the fanout scope,200combined legal full-media messages with4000-scalar bodies and finalized assets. A clearly identified native certified put exercises combined fields against the unchanged real schema; original compiled send/media/profile operations also execute. Conversation IDs use lawful minted-form widths because135-byte conversation IDs correctly overran an existing maintained generated identity; other stressed principal/message/membership identities retain maximum admitted widths. No width rule or identity spelling was weakened.

Actual global closure is2,844,510bytes against certified3,557,738; derived scratch3,918,389 against certified bounds, with69,027derived steps. Original4000-scalar canonical-expansion messages.send has481,026actual derived steps and510,412scratch; it writes50deliveries,1message,1maintained count and1outbox item against an818,227total-step certificate. Actual rows fit the unchanged1Mstep/4MiBclosure/8MiBheap/1MiBoutput limits. These are bounded native correctness/accounting witnesses, not latency or scale qualifications.

## Parent-owned integration and risks

The coordination inbox was read at milestones and immediately before final commit. No additional contract delta is pending from this engine lane. Root-approved minimum, format, clock and feed-overlap changes are all included.

Parent owns both fresh blind reviews, final compiler/twin integration, consolidated LLP/guide updates, actual standard package/build/loop and search scale/phone qualification, and any main landing/publication. No reviewer was launched here and no other-family report was read. The exact e6 compiler used for bounded fixtures has known captured-Q source issues being repaired by its owner; exact adversarial native rejection does not clear the compiler. A final format API before/after witness is not claimed from old minimum-only witnesses.

The inherited package compiler/client graph is incompatible with active components/identities. Per explicit final cadence agreement, standard scripts/measure.mjs was not rerun against that graph; external Bun routing must not be relabeled as package/loop proof. The parent must use a matched final owner/compiler/client graph. Optional timed delivery requires the coordinated client custody/order/guard implementation; native proofs do not certify its persistence/no-purge behavior. New v5 constants fence certificates/custody but cannot retroactively repair immutable old raw ProjectJson decoders that silently discard fields. No arbitrary old-decoder or mixed-version timed compatibility is claimed.
