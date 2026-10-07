# SN round 1: preserve predicted one-shots

2026-10-07. Base: `6f134f0eb0` (SN round 0), branch
`sb4-intent/sn-one-shot-settlement`. Only the supplied lane-sn checkout and its
own test processes were used. Nothing pushed or published.

## Result

A ready one-shot uses the old custody rule, filtered by static dependencies:
`unobserved && mayIntersect && (!predictable || served || localWakeup)`.
A complete predicted device answer settles online and offline. Server, composed
and remembered answers still require observation of dependent writes. Unknown
dependencies mean possible intersection; they do not forbid complete predictions.
The mock's mutation handlers have already applied their complete predictions,
so its ready answers also settle with pending custody. Online clients retain
their dependent-write barrier; the app facade inherits its raw arm's rule.

Precisely: at successful publication, every admitted write whose operation may
affect the query has been observed or failed, or a predictable write is included
in a complete predicted device answer. Authorization and filtering still decide
which effects appear. Ready does not imply complete coverage or fresh data.
LLP 3000.023 §11, its Revised line, the client card and E_QUERY_RETRY describe this.

Known-offline custody blockers refuse E_OFFLINE promptly. Link notifications
wake an already parked wait. The single 30-second deadline and event-driven
online wait remain. A completed evaluator pending gate can park a loading
candidate; an interrupted candidate gets a publication retry instead. This
matters when discovering a prediction invalidates the first attempt: waiting
on that interrupted candidate would strand an otherwise complete prediction.
The four-round limit still bounds other publication failures.

The five files converted to observations in round 0 are restored byte-for-byte
to the parent of round 0: client-seams, maintained-columns, prediction-routing,
one-shot-model, and helpers/timeline-recovery. Dependency regressions now use
non-predicting edits/removals for observation controls, and separately assert
that predictable edits appear immediately. The count control retains a
predictable write against an unavailable server aggregate. Its initial
prediction-discovery retry is distinct from the later event wait.

## Reproduce first

[Prediction reproduction](reproduction-prediction.log): all eight complete
prediction cases failed against round 0, on wasm/process and both app facades,
online/offline. Their held POST never needed to complete; the one-shot should
have returned its predicted body. All eight remain regressions.

[Store-overlap reproduction](reproduction-store-overlap.log): after correcting
prediction settlement but before adding the adoption guard, a real replacement
while a successful POST reply was held left an outbox receipt stamped with the
replacement's identity. Its sequence was 3 while the new store's head was 2.
The SDK kept waiting for a write that had executed only in the old store; the
fixture's then-silent change stream eventually caused E_OFFLINE. This disproved
round 0's broad claim that the existing fences alone justified every overlap.
The final fixture keeps the link alive and asserts the corrected ordering.

The calibration evidence remains external and is cited in the round-0 report:
`~/sb4-intent/sn-evidence/m6-acceptance.log:181`, `run-log.md:81`,
`m8-acceptance-verified.log:216`, `run-log.md:97`, and `schema.q`.
Nothing from that directory was copied into the repository. Receipt watermarks
are independent of bare history; Trending's maintained likeCount still depends
on likes.

## Sync/POST ordering

Same-store, same-generation acquisition may overlap the POST. Identity/schema
adoption keeps FIFO with its outcome: `syncRound` rejects that acquisition
attempt before `observe_store` if an ordinary POST is still owned and the page
changes/does not establish the same store or generation, or requires adoption.
It retries through ordinary sync after the POST records its result. Terminal
refusals are handled before this guard. Store/schema races can consequently
consume the existing budget; they are not evidence of disjoint custody alone.

The surviving overlap has the following fences and regressions in
`packages/snapback4/test/one-shot-sync-overlap.test.mjs` (all four local arms;
offline wakeups also cover both online arms):

| Hazard | Fence | Regression assertion |
| --- | --- | --- |
| Sync sees a POST before its own response returns | `begin_send_for`, pending capture, `qualify_receipts`, `record_receipt`, transactional publication/replay | Successful and refused POSTs keep their original state/sequence/refusal; one terminal notification; final rows agree. |
| Receipt lookup adopts observation while the POST owns settlement | `receipt_store`/`success_seq`; `settleReceipt` saves history first; `call()` drains unpersisted history; `settling` and emission protection | Qualified success can be recovered while its reply is held; a refusal remains pending until its own reply; no duplicate completion. |
| A later send overtakes a captured sync page | `SEND_REVISION` captured before fetch and compared in `store_identity::observe` and `apply_publication_inner` | The old page is rejected with the overlap diagnostic; retry includes the committed row exactly once. |
| Store replacement or generation deployment arrives mid-overlap | New pre-observation adoption guard; then incarnation callback, `adopt_captured`/`install_checked`, original receipt binding and store-bound POST | Adoption cannot precede the held POST outcome; the first read uses the replacement/new generation; the old POST remains sent once and does not execute in the replacement. |
| Link goes offline while custody is parked | Link notification plus waiter recheck | Prompt E_OFFLINE without releasing the held POST. |

Implementation sources: `src/local.ts`, `src/local-network.ts`,
`src/local-receipts.ts`, `src/query-custody.ts` under the SDK;
`crates/snapback4-device/src/device.rs` (`begin_send_for`, `sync_state`,
`apply_publication_inner`, `adopt_captured`),
`device/store_identity.rs`, and `device/predictions.rs`.
Governing design: LLP 3000.001 implementation follow-up/Repair B;
LLP 3000.007 §18.2/§20.4; LLP 3000.013 §6; LLP 3000.019 §3.3.
These Rust/device sources were inspected, not changed.

The existing sync-after-call cases still require an explicit sync to reserve a
newer round, including after a failed priority observation. Ordinary mutations
retain FIFO dispatch. No new outbox or prediction evaluator was introduced.

## Validation

Commands run from `snapback4/` unless indicated otherwise. Full logs accompany
this report. The one-shot helper now sends idle change-stream heartbeats;
otherwise the transport's real four-second silence watchdog makes an intended
online 30-second custody test offline. Following's existing fixture expects the
single prediction-discovery retry before parking, rather than parking an
interrupted answer. Neither change alters evaluator answers or production timers.

- `bun run --cwd packages/snapback4 build`: pass.
- `bun run --cwd packages/snapback4 typecheck`: pass.
- `node --test --test-concurrency=4 packages/snapback4/test/one-shot*.test.mjs packages/snapback4/test/query-dependencies.test.mjs packages/snapback4/test/query-publication-session.test.mjs packages/snapback4/test/live-margin-settlement.test.mjs packages/snapback4/test/sync-after-call.test.mjs packages/snapback4/test/following-routing.test.mjs`: 330 passed, no skips.
- Affected client selection: 419 passed, one skipped (unavailable historical 0.2.32 binary). Files: client-seams, maintained-columns, prediction-routing, timeline-delivery, local-reads, online-read-order, online-store-order, online-session, app-online-arm, app-local-receipts, app-receipts, sync-generation, ephemeral-mock. Command: `node --test --test-concurrency=4` with those `.test.mjs` paths under `packages/snapback4/test/`.
- `CARGO_BUILD_JOBS=8 cargo test -p snapback4-lang --test guide --test query_settlement`: 118 passed (113 guide, five compiler dependency tests).
- Root `./ref-check --verbose`: pass, 531 LLP documents and 10,547 references, zero errors/unchecked.

The extended overlap file separately passed all 26 cases, including both online
offline-wakeup cases. The final settlement selection above includes them all.

No engine/device/wasm source or budget changed. Round 0's wasm-budget result is
unchanged; this round makes no new wasm-size or macOS qualification claim.
The SDK local file stays under the 1,500-line ceiling (1,499 lines). No contract.ts changes.
Round 0's independent dual review is external to this round; no review verdict
is claimed here.
