NEEDS_CHANGES — correctness of the full R8 delta from `e1c6e2b79a9e13ceb363f647f52807218aa2b57a` through `36feaacc9c5bf2ccede2623653252e67c0152f26`.

Two correctness findings remain. One produces an incorrect public offline page; the other leaves warm coverage attached to superseded issuing keys. Both have small preserved reproductions and exact-base controls. This verdict covers the complete delta, including `4e927c26df5b1cec4f2ce885f9521474586b54a3`; that commit was not treated as trusted. Size, movement, and resource qualification remain independently failed or pending.

**1. [P2] Preserve detected loss of page coverage in the public offline result.**

Source: [offline.ts:883][offline-view], with [range-store.ts:679][held-expansion]. The latest issuing-key correction at [twin-store.ts:188][issuing-keys] exposes this failure on cold public reads.

`offlineView` prefers a stored `complete`/`capped` answer whenever local evaluation returns `partial` with data. That preference assumes the stored answer is still exact. However, `PersistentRangeStore.answer` expands its historical row references using the current shared row bodies, while retaining the historical membership and state. After ordering keys move, this can return neither the original delivered page nor the current covered page.

Reproduction: admit the unchanged final26c9 `nativeR8.halo.first` fixture for `clock.fixed`: ten returned rows `r0` through `r9` at positions 0 through 9, plus the held halo at 10. Admit a synthetic later `clock.read` frame at sequence 2 moving `r8` and `r9` to 100 and 101. Close the runtime, reopen the same persisted state using the actual Client with `startOffline: true`, then query `api.clock.fixed`.

The final-source output is:

| Observation | State | Row positions |
| --- | --- | --- |
| Local Twin after movement | `partial`, sequence 2, `never-held` | 0–7, 10, 100 |
| Stored answer expanded from current rows | `capped`, sequence 1 | 0–7, 100, 101 |
| Actual cold public Client query | `capped`, sequence 1 | 0–7, 100, 101 |

The public result omits the known held halo at 10 even though it precedes both moved rows. It also labels the mixed historical-membership/current-body page `capped` after local evaluation has detected insufficient coverage. The recorded network request count is zero. This fixture has no result-page cursor; the observed `next` is null, so this reproduction does not claim a demonstrated bad continuation token.

Evidence: [harness][movement-harness], [exact inputs][movement-inputs], [persisted state][movement-state], [final output][movement-output], and [exact e1c6 control output][movement-before]. The control uses byte-identical inputs. On e1c6, the warm Twin is already partial and the stored expansion is already wrong; its cold public query instead recomputes positions 0–7, 10, 100 and incorrectly calls that page capped. Thus the unsafe stored-answer fallback and mutable expansion are inherited. The final cold issuing-key repair introduces the demonstrated public omission by making cold local evaluation partial and selecting that inherited fallback. The base is not a correctness oracle.

Fix: when current row movement or membership loss invalidates the held page's coverage, propagate the local partial result or invalidate/recompute the held page's coverage before selecting it. Keep delivered-history retention semantics explicit. Do not treat a historical state label as authority for a page whose referenced bodies have changed. Add a public forced-offline/cold regression using this movement case; exercise retry and subscription paths that share the projection. Preserve the existing prohibition on exposing `next` for a partial result.

**2. [P2] Include immutable issuing-key custody in receipt cache invalidation.**

Source: [twin-store.ts:171][receipt-cache] and [twin-store.ts:188][issuing-keys], consumed by [coverage.ts:98][coverage-keys].

`TwinStore.answer` hashes the closure receipt derived from current rows and returns early when that hash matches the cached value. The new `setReceipt` callback supplies a separate semantic input: immutable issuing keys selected through the replacement answer's `rowProofs` and `factImages`, or the exact FULL sequence fallback. Those inputs do not participate in the cache comparison. A replacement with unchanged visible rows, receipt membership, and last endpoint can therefore leave the previous owner's expected keys installed.

Reproduction: admit the same native initial halo page at sequence 1 and evaluate it. Admit a synthetic `clock.read` frame at sequence 3 confirming the original images of `r0` and `r1`. Then admit a delayed FULL `clock.fixed` replacement at sequence 2 whose issuing positions for those two nonterminal members are -20 and -10. Member ordering, member IDs, halo, and the last returned endpoint remain unchanged. The newer sequence-3 bodies correctly remain current at 0 and 1, but the replacement answer owns the sequence-2 issuing images.

Warm evaluation stays `capped`. Closing and reopening the byte-identical persisted state produces `partial` with `never-held` at `clock.range`. The output confirms `persistedUnchanged: true`. The early return skipped installing the replacement's immutable expected keys; cold hydration installs them and detects the moved members. A durable answer replacement must replace its coverage ownership coherently, irrespective of whether newer shared row bodies happen to be identical to the previous visible closure.

Evidence: [harness][replacement-harness], [exact inputs][replacement-inputs], [persisted state][replacement-state], [final output][replacement-output], and [exact e1c6 control output][replacement-before]. The control inputs are byte-identical. The base reports capped both warm and cold; it predates the issuing-key lookup and is not proof that either classification is correct. The new lookup adds a cache dependency without updating invalidation, introducing this warm/cold disagreement in the reviewed delta. This reproduction establishes stale coverage ownership and inconsistent completeness, not an independently demonstrated missing public row or native-emitted contradictory frame.

Fix: include all preparation-relevant issuing-key identities and missing-key/fallback availability in the per-answer cache decision, or otherwise force coherent replacement when that custody changes. Preserve preparation-before-publication and the existing bounded owner scope. Do not solve this by treating mutable current-row hashes as issuing evidence or scanning all held history. Add delayed FULL replacement controls that change interior issuing keys while preserving the last endpoint, with warm/cold equality and unchanged-replay controls.

**Scope and source review.**

I read `context.md` first, then the applicable AGENTS/rules, LLP1000/1001/1011/1012, and offline/live-query guidance. I applied the current context's ordinary/all-ID immutable extent contract, 524288 combined logical-slot bound, Unicode17 normalization and independent Q requirements, and fixed runtime limits where older prose differs. I reviewed all 24 changed paths in [the full delta][delta], including the new extent/fact indexes, evaluator changes, persistent carrier changes, public projection changes, and tests, and followed relevant unchanged callees.

The review included:

| Area | Inspected behavior and evidence boundary |
| --- | --- |
| Immutable facts and extents | Ordinary and timed typed closed extents; all IDs including previously unknown rows; same-sequence contradiction checks; scoped nonmembership versus global absence; immutable row/key/body separation; interval and Unicode lookup paths; admission order and rollback; body GC and later legitimate movement. |
| Ownership and persistence | Image/frame/reference ownership, variable payload and per-owner multiplicity accounting, reclamation and saturation markers; private-format-5 predecessor recovery, outbox/seal preservation, generic JSON alias isolation, backend failure rollback, retention, auth/view-once invalidation, and FIFO overlay retirement. |
| Clock and conditional recovery | Trusted timed identity, safe-integer readTime, sequence-first ordering, equal-clock replay, stale clocks, clock-only refresh effects, conditional crossing of enrolled facts, one-FULL recovery, and preservation on failure. |
| Standalone evaluator | Constructor, put, rehydrate, and setReceipt; recursive row isolation, typed prefixes/bounds, immutable receipt metadata, preparation before owner mutation, shared owner counts, verdict disagreement, held-directory identities/dependencies, and Limit/halo versus authoritative Exhausted. |
| Search and public paths | Unicode Words accounting and optional-null behavior, certificate budget refusal, indexed search/Q semantics, ordinary/derived suffix validation, current-authority resume refusal, denied/partial data/cursor projection, forced-offline/hydrating/retry/subscription callers, and warm/cold movement. Findings 1 and 2 prevent clearance. |

Native semantics were checked against `packet/native/source` at final `26c9fd5e0d3922ce7680493c0e8f7371f4793d59`, not branch Rust. The v5 identities are `i53-codepoint-bytes-unicode-search-text-refinements-v5` and `bounded-spike-rust-search-text-refinements-4`. The review considered recursive positive Text minima, zero omission, exact handle/url predicates, and the distinction between rejected present Arg `format: null` and accepted/omitted Column `format: null`. Trusted v5 custody does not imply universal rejection by arbitrary historical raw-IR parsers. No native owner executable was run or rebuilt here.

No additional blocker was established by this inspection. That statement is bounded by static review, the frozen checks below, and the two diagnostic scenarios; it is not a fresh full-suite, performance, native emission, or device qualification.

**Custody and actual checks performed in this review.**

[Packet custody verification][custody] checked all 2867 manifest entries, totaling 285999390 bytes, with zero mismatches. [The packet manifest][manifest] binds the complete source, predecessor source, native source, and per-stage evidence. Recorded commits include 4e927, receipt ownership02a5, carrier preparation4fb, doc-only b14eff, coverage47a7, entrypoint repairs cb578, and final36fea. Historical candidate files were not promoted to final-source evidence based on their names.

| Input | SHA256 |
| --- | --- |
| `packet/manifest.json` | `56b018ddd0d1fa562837e4c45a2681ed1f7370698cf253dd32a29023ffae9782` |
| Full `packet/delta.patch` | `5f56c9c159d506d35c16bfdc29a4bdf86f5d7a79525e83b3b396424391d45237` |
| Native owner executable, recorded custody | `4d0f8f0176921b56305e9969da0fcb2dd5ecedae1f65d983f537e613d0c6e46e` |
| Native 261-file source graph, recorded algorithm in `native/inputs.json` | `07d985316ae2d74494980a0c4871a13a877237ca0de15f97e2d12ad337518e70` |
| Final-stage 97-file source checkpoint | `aa7200283cfd4672bb0d7f9a84fcb6a560a9a782bbfbdcf535ab64736d4d3163` |
| Final `offline.ts` | `b6097e78b7fbcc255ad69b55ca83ea5d93f48cbf5605bd3340b34261403f7dea` |
| Final `twin-store.ts` | `0c3f01987acc9b1563610ed74898aea7b3808ff22dad736b0b438d651935e1ec` |
| Final `store/range-store.ts` | `920c489a931713c538b700f02e059ac72e38caf3f2f4ea98b3df618db3f00a56` |
| Final evaluator `coverage.ts` | `f6268bfa6463878e1c9055e4b854347ffb08e51811e64dce10eac8432d665a83` |

The two concrete diagnostic concerns were run once each against final source and once each against exact e1c6 source. The runtime was `/Users/ccheever/.bun/bin/bun` 1.3.12, SHA256 `39e644cea4e6db24a3af36013695655d6f789b4b98f1f13bacb882ac6e5c3c18`, verified against frozen host-tool custody before use. Pinned Node22.23.2 was also hash-verified (`18e387c90ab8a8400183e8bdd396376e1e875b91b4c874b894dcade7b35bf572`) but was not used to execute these probes. The packet preserves the executable artifacts; this review used the authorized matching local Bun.

| Harness | Source | Elapsed seconds | Exit | Diagnostic result |
| --- | --- | ---: | ---: | --- |
| `probe-public-movement.ts` | final | 0.706321208 | 0 | Public capped page omits held halo |
| `probe-public-movement-before.ts` | e1c6 | 0.652389083 | 0 | Public cold page includes halo; inherited overclaim remains |
| `probe-replacement.ts` | final | 0.354653709 | 0 | Warm capped / cold partial |
| `probe-replacement-before.ts` | e1c6 | 0.500811584 | 0 | Warm capped / cold capped |

Each `*-run.json` records argv, cwd, start UTC, elapsed time, return code, and the new 10-second diagnostic wrapper. This wrapper is not an original product-test deadline. Exit 0 means the diagnostic completed and printed observations, not that correctness passed. Inputs, state snapshots, stdout, and empty stderr files are preserved. Both final/base input pairs were confirmed byte-identical.

These probes import exact copied TypeScript through Bun, with no bundle, dependency install, or source edits. The final copy set contains 96 files; the base copy set contains 93. Both sets were checked against the frozen originals with zero mismatches. [Review input custody][review-inputs] records their individual hashes and a conservative static import closure, including type imports, rather than claiming an actual-load trace. The only unresolved source reference is an erased compiler type import. Lazy Expo asset-upload imports are outside the executed query path; no asset upload occurs. Bun supplies `node:fs`. Python was used only for file custody and bounded subprocess capture; its executable identity is recorded in the review inventory. [The review artifact inventory][review-artifacts] hashes the report, harnesses, inputs, outputs, run records, setup failures, and copied sources, excluding itself and the supervisor's live files.

The initial page, program, schema, and certificate are unchanged native26c9 fixtures. The later matching-plan frames are synthetic authenticated-admission controls accepted through the real `OfflineRuntime.accept` decoder and commit path. Finding 1 additionally exercises an actual cold public Client query. Neither probe demonstrates a native-emitted later frame, public mutation grant admission, physical SQLite/IndexedDB behavior, or remote transport. The backend is a small generic JSON-copy backend; Date.now is pinned in the harness to the native fixture time plus 1000.

Two unsuccessful probe setup attempts are retained separately as `setup-failure-probe-replacement.*` and `setup-failure2-probe-replacement.*`: the review copy initially lacked `ir-contract.json`, then the generated Unicode table. Both exited 1 before the diagnostic completed. Only missing frozen input files were added to the review copy. Those setup failures are not admission or product failures. No heavy tests, benchmarks, size/cap/movement/resident populations, installs, builds, dependency changes, remote work, or product edits were performed in this review.

**Frozen test results and separate qualification failures.**

The [final-stage handoff and commit receipt][final-handoff] bind the repaired source. Its scoped Twin 10/10 and store 6/6 results use the original `--test-timeout=10000` with a separate 30-second process wrapper; TAP durations are 8663.71525 ms and 7341.900875 ms. Build/typing, caps, reference, and diff checks have their stated limited scopes. Earlier candidate store 15/15 and direct Bun indexed 24.626674 seconds precede the narrow ordinary fallback and are not a final full indexed qualification. Direct Bun indexed has no original per-file deadline.

The default-corpus `entitlements.byId` missing-index failure reproduced on exact cb578. Selecting the explicit native26c9 corpus changes inputs for those cases. The drained-page failure was introduced and then repaired; its in-file fixtures were byte-identical across attribution controls. Preserved clock/plan, expected-error text/order, and omitted-schema fixture mistakes are distinct from source defects. Prior cb578 public 24/24 and focused Twin 4/4 used original 10-second limits; its Bun indexed duration was 25.887 seconds without a per-file deadline. The new 30-second reference-wrapper timeout and separate 60-second-wrapper retry completing in 14.802 seconds remain separate records. The EEXIST capture-path repair changed external plumbing only.

| Qualification | Status retained by this review |
| --- | --- |
| Complete fixed five-root runtime size | **FAIL:** 73023 gzip / 223602 minified, 7023 over the unchanged 66000 ceiling; target 64000. Final is +314 gzip versus cb578's 72709. Earlier 47a7 72555, 4fb 72367, 02a5 72229, and 4e927 72199 also failed. No measurement was rerun here. |
| Original full movement limit | **FAIL:** original 10000 ms failure remains. The 120-second exploratory 43/43 result at 23.819 seconds does not qualify the original deadline. Carrier-stage 22 pass / 1 cancellation at 10026.907 ms was an earlier candidate before the lazy refusal-order correction, not final-source qualification. |
| Logical slot boundary | The recorded 524286 independent absence-guard control within 524288 slots passed after a separately approved byte-identical test-setup allocation repair. This is not an untouched-test or performance claim, and was not rerun here. |
| Current resident/phone qualification | **PENDING, with historical resource concerns retained.** No latest-source realistic 10k ordinary paginated private-format-5 resident result exists. No phone or overall release clearance follows from correctness review. |

The final measured bundle hash is `8d95d684369a2907dc1c7c67148d255c31ceceec34139fead7c637c717c37906`; its attribution hash is `965368392fa7475aea8ae728fb771594cd8da47ca09556d424352a030c47aa6e`. These are frozen measurements, not new review runs or additive gzip savings estimates.

Historical 10k row-only/private-format-2/empty-range RSS +383.8 MB, heap +93.3 MB, and ArrayBuffers +42.8 MB remain a material concern at a different boundary. The 100k index-only approximately 291 MB observation is separate and must not be added to it. The historical Linux 02a5/4fb/47a7 carrier comparison showed no meaningful retained-heap reduction: approximately 52.0/52.16/52.16 MB, identical 10552 Maps, 20725 Sets, 20540 typed views, 10k rows, 500 answers, 105200 slots, and 8.278766 MB serialized. Generic full-state JSON backend timing is not SQLite latency; ordinary `wordOccurrences=0` says nothing about Unicode posting costs. The baseline Twin h1 assertion failed before subsequent arms, with actual next unlogged; the separate static ordinary-untimed-cursor diagnosis does not repair that observation. Bounded seven-checkpoint/114-slot equality for three images/eight frames proves only that witnessed state/count agreement. None of these observations supplies current-format/Twin/device resident clearance. Other historical publisher/resource failures remain separately bound and unresolved.

**Independence, limitations, and terminal handoff.**

All writes were confined to this review directory. No sibling, prior, or peer review report, or same-session size-design analysis was accessed; no subagents were used. One procedural boundary issue is disclosed: `packet/native/integration-inputs-at-freeze.md` was opened during native custody inspection and contains owner coordination text. It was excluded as evidence for the findings. The findings above derive from frozen product source and the preserved new diagnostics.

Requested Muse1.3/ultra availability was not established. This review makes no global outage, substitute, new availability probe, or third-review claim. Existing main/drain epoch changes were not imported or evaluated as part of this frozen delta; later integration must preserve them. No size waiver or structural-consolidation savings claim is made.

Review work is complete with **NEEDS_CHANGES** for correctness. The supervisor records the actual process/turn terminal status after the final response; this document does not invent a future exit code or PID absence.

[offline-view]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/packet/source/snapback2/packages/snapback2/src/offline.ts:883
[held-expansion]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/packet/source/snapback2/packages/snapback2/src/store/range-store.ts:679
[issuing-keys]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/packet/source/snapback2/packages/snapback2/src/twin-store.ts:188
[receipt-cache]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/packet/source/snapback2/packages/snapback2/src/twin-store.ts:171
[coverage-keys]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/packet/source/snapback2/packages/evaluator/src/coverage.ts:98
[movement-harness]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/astra/probe-public-movement.ts
[movement-inputs]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/astra/probe-public-movement-inputs.json
[movement-state]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/astra/probe-public-movement-state.json
[movement-output]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/astra/probe-public-movement.stdout
[movement-before]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/astra/probe-public-movement-before.stdout
[replacement-harness]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/astra/probe-replacement.ts
[replacement-inputs]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/astra/probe-replacement-inputs.json
[replacement-state]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/astra/probe-replacement-state.json
[replacement-output]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/astra/probe-replacement.stdout
[replacement-before]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/astra/probe-replacement-before.stdout
[delta]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/packet/delta.patch
[custody]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/astra/custody-check.json
[manifest]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/packet/manifest.json
[review-inputs]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/astra/review-input-custody.json
[review-artifacts]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/astra/review-artifacts.json
[final-handoff]: /Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r3/packet/evidence/r8-bound-exhaustion/handoff.md
