# custody-c1 — LLP 1019 D4 + D5

Date: 2026-09-10. Base: `4729319698a18996746b78f9e01f94304bd084aa`.
Worktree: `/Users/ccheever/projects/snapback-s2v`, branch `s2/ri-custody-c1`.
Delivery: uncommitted working tree for the orchestrator. No commits, stashes,
branch changes, or main merges. RFC Status unchanged. D6 templates untouched.

## Implemented claims

- D4: a successful required membership point supplies sender-only prediction
  authority. A binding or inlined `isMember` function preserves that proof;
  unrelated/unused membership, an unproved disjunction, or a membership write
  supplies none. No audience scan. The insert uses the evaluator's direct
  derived-write/maintain route. Receipt-only replay does not derive log events.
- The own-event id hashes row + sender under `own:`. A validated, retained server
  delivered event replaces it by log/row/recipient even when the send response
  was lost and the product intent remains queued. Body arrival alone does not
  retire the provisional log row. No predicted changed/removed events.
- Changed/removed events use the existing ascending drain and shared row store;
  removal tombstones the content body through cold reopen. D1/D2's commit
  ordinals already distinguish repeated edits in one commit; their native test
  and shared corpus replay remain green.
- D5: native delivery creates false receipts, one per original recipient.
  Canonical `_delivery.<log>.ack` is auto-registered as a certified mutation with
  an events list bound of 50. Only the exact generated program can update the
  engine-owned receipts table. Event, content, receipt, and original-event
  reads are ordinary traced reads; live original-group membership is a bounded
  private constraint probe. Receipt seq is the acknowledgement commit seq.
- Receipt reads inherit the content table's rule on every index. Content
  changes update its copied rule fields without resetting received/seq.
  Delivered and changed identities acknowledge the original receipt. Removed
  recipients remain false; repeats preserve the first true value and seq.
- Certification names `delivery acknowledgement: 50 event identities × (N+1)
  membership reserve`, plus ordinary point reads and receipt updates. Private
  membership scratch prices one live page. Native content delivery prices an
  additional receipt upsert and identity probe per reserved recipient.
- SDK candidates require a validated page that disclosed both event and body;
  decoded responses, metadata-only responses, arbitrary request cursors, and
  stale bodies rejected by tombstones do not acknowledge. Pending event marks
  persist in the accepted-page swap. Admission consumes ordinary FIFO outbox
  slices in batches of at most 50; the mark and intent persist atomically.
- Queued acknowledgement bytes retry across crashes/restarts and lost responses.
  Independent clients of one principal each acknowledge. Acknowledgements never
  renew replay trust, bypass the fence, or erase queued product writes. Fully
  held event/body/receipt rows still cannot supply live acknowledgement authority:
  Rust and TS receipt replay are partial and make no acknowledgement write.
- All four custody-b residuals resolved: live job plans specialize each chunk
  for retained A or return the specialization refusal; maintained content
  refuses deliver at admission; the compiler test names its handwritten repair;
  RFC §4 and guide deliver specify owner structural-page pricing plus separate
  native delivery pricing. The plan test compares the complete effective
  certificate, including indexes/write/heap/steps, and preserves portable identity.

## Files changed

All paths below are relative to `snapback2/` unless stated otherwise.

| Area | Files |
| --- | --- |
| Engine declaration/certification | `crates/snapback2-core/src/delivery.rs`, new `delivery/receipts.rs`, `certificate.rs`, `certificate/delivery.rs`, `registry.rs` |
| Engine execution | new `engine/acknowledgements.rs`, `engine/{custody,mod,runner,runner_ops}.rs` |
| Installation/job residual | `successor/delivery.rs`, `registry_jobs.rs` under the core src directory |
| Rust tests/corpus | `crates/snapback2-core/tests/delivery.rs`, new `tests/delivery/receipts.rs`, `tests/spike.rs`; `src/bin/export_corpus/delivery_cases.rs`; `corpus/manifest.json` and five new `corpus/deliver-*.json` cases named below |
| Evaluator | `packages/evaluator/src/{runner,store,test}.ts`; new `delivery-prediction.ts` and `test-delivery.ts` |
| SDK | `packages/snapback2/src/{twin,offline,client,client-outbox}.ts`; new `delivery-acknowledgements.ts`; `src/store/{outbox,range-store,overlay-retirement}.ts` |
| SDK tests | new `packages/snapback2/tests/{delivery-custody,real-owner-delivery}.test.ts`; existing `tests/sqlite-exports.ts` exports the drain for the test bundle |
| Compiler/guide fixture | `packages/compiler/src/delivery-checks.ts`; new `packages/compiler/fixtures/quarry-delivery/snapback/{schema,messages}.q`; `packages/snapback2/build.mjs` includes this fixture in its existing guide-snippet list |
| Guide/measurement | `packages/snapback2/guide/{deliver,offline}.md`; generated `metrics/twin.jsonl` measurement rows |
| Repository-root records | `llp/1019-derived-delivery-custody.rfc.md`; residual ticket resolved and moved from `issues/` to `issues/closed/20260910-snapback2-custody-b-review-residuals.md`; this report |

Scope notes: `client.ts`, `client-outbox.ts`, the compiler fixture and its
`build.mjs` enumeration, successor false-receipt initialization, test-bundle
export, measurement log, and ticket closure are explicit supporting edits beyond
the lane's abbreviated ownership list. No new checks, scripts, registries,
configuration files, or design documents. The chat template was not edited.
`certificate-identity.ts` already implements the exact Rust descriptor field
order and rejects descriptor `audience`; no stripping or modification was needed.
`twin-hydrate.ts` and `snapshot.ts` already consume the shared overlay/store path.

## Before → after evidence

Logs are local session evidence under `/tmp/custody-c1-*.log`.

| Behavior | Before output/evidence | After |
| --- | --- | --- |
| Maintained source admission | `before-maintain.log`: validator errors `[]`; `FAILED. 0 passed; 1 failed` | `maintained_content_refuses_deliver_at_admission` passes with E_SCHEMA_DELIVER |
| False receipt initialization | `before-receipts.log`: `unacknowledged recipients must exist`, `left: 0`, `right: 2` | Two original recipients exist false; acknowledgement changes only its principal |
| Own prediction | `before-twin.log`: `AssertionError: required membership`, `0 !== 1` | Membership-only own prediction checks pass; paired frozen cases also run in prediction mode |
| Durable SDK acknowledgement | `before-sdk.log`: queued acknowledgements `0 !== 1` after accepted body page | Page swap creates a pending mark and then one certified intent; rejection of persistence creates neither |
| Retained-A job plan | `before-job-plan.log`: complete certificate equality fails; cap-3 plan reserves three log writes while effective A=10 needs ten | Complete effective certificate equality; oversized specialization returns E_BOUND naming `A 10` |
| Held receipt acknowledgement authority | `before-ack-authority.log`: `{"error":"E_RULE","message":"E_RULE: deliveriesReceipts update"}` | `after-ack-authority.log`: `{"state":"partial","partialSites":["missing-authority"],"writes":0}` |

Before method: native wart assertions were first run before their implementation;
the receipt-row assertion ran with the new test/program scaffold but before
native receipt creation. Twin/SDK/job reproductions temporarily loaded the
relevant files from the base commit, then restored the lane files in `finally`.
No branch, index, or commit mutation was used. The final authority reproduction
uses base evaluator runner/store against the new fully-held receipt fixture.

## Verification

Node for package builds/tests: real
`/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node` (v24.18.0), not a shim.
Rust/package builds passed. No media helper or Hermes changes require their
additional proof. Per the lane's final instruction, the full `scripts/test.sh`
was **not run**; the orchestrator owns complete remote verification.

| Command/scope | Verbatim result |
| --- | --- |
| `NEXTEST_TEST_THREADS=8 cargo nextest run --config-file ../.config/nextest.toml --profile local-proof -p snapback2-core --test delivery --test cap --test jobs --test timers --no-fail-fast` | `111 tests run: 111 passed, 1 skipped` |
| Added maximum-batch test: `cargo test -p snapback2-core --test delivery full_acknowledgement_batch_fits_its_certificate_and_the_next_identity_refuses -- --nocapture` | `1 passed; 0 failed; 0 ignored; 0 measured; 53 filtered out` |
| `cargo run -p snapback2-core --bin export_corpus` | `wrote 293 frozen corpus cases` |
| `cargo test -p snapback2-core --test spike every_frozen_corpus_case_replays_its_certification_outcome -- --nocapture` | `1 passed; 0 failed; 0 ignored; 0 measured; 12 filtered out` |
| Evaluator `bun src/test.ts` | `Delivery prediction checks: 11 passed, 0 failed`; `{"cases":266,"passed":266,"serverOnly":27,"failed":0,"corruptionPath":"replay-mismatch"}` |
| Compiler `registerDeliveryChecks` by name through `bun -e` | `11 passed, 0 failed` |
| `node --test tests/delivery-custody.test.ts tests/real-owner-delivery.test.ts` | `tests 8`, `pass 8`, `fail 0`, `skipped 0` |
| Neighbor SDK names: `node --test --test-name-pattern='fence\|replays FIFO\|503 after\|rejection and a trace\|settlement lands\|prediction\|tombstone\|overlays' tests/outbox.test.ts tests/twin.test.ts tests/offline-store.test.ts` | `tests 24`, `pass 24`, `fail 0`, `skipped 0` |
| `node build.mjs` | `guide: 32 cards, 85504/98304 bytes (13% headroom)`; successful build |
| `./ref-check --verbose` after report/record append | `ok — 439 LLP docs, 7984 refs in 19145 files, 0 errors, 0 unchecked` |
| `git diff --check` | No output, exit 0 |

New Rust tests in `tests/delivery/receipts.rs`: maintained admission; false
initialization/idempotent batches; inherited reads on every index/departed
recipient/two clients; named reserve/private-index containment/canonical-program
tampering; retained-A owner plans and specialization refusal; enabling receipts
over existing history; changed-event acknowledgement and copied rule fields;
full 50-event batch and refusal of 51. Eight additions; the first seven are in
the 111-test run and the eighth was run by its full name after addition.

Five corpus additions: `deliver-own-membership-contract`,
`deliver-no-membership-contract`, `deliver-receipts-query`,
`deliver-receipts-inbox`, `deliver-ack-missing-authority` (fully held ordinary
rows, missing live private membership authority). Count 288 → 293; executable
count 261 → 266, server-only 27. Pinned count updated. SDK envelope stress tests
use native corpus certificates plus explicitly constructed page variants;
the real-owner test compiles the independent Quarry fixture and exercises actual
drain projection, ordinary acknowledgement replay, `require isMember`, offline
thread prediction, and exactly one server bubble after replay.

Transient validation failures fixed: guide examples initially lacked an exact
enumerated fixture; an early owner test's final replay-field assertion used the
wrong test spelling; the one run concurrent with Rust compilation hit the
owner harness's 30-second Cargo build-lock timeout. Its isolated rerun passed.
No sandbox owner-stop failures occurred; only owned fixture processes were used.

## Size, caps, and RFC corrections

- Complete local runtime: **86,297 gzip bytes**, **263,462 minified bytes**;
  ceiling **90,000**, headroom **3,703**. Node24.18.0/esbuild0.25.9/gzip9.
  Compared with the brief's 84,986 baseline: +1,311 gzip. Final measurement is
  the last `metrics/twin.jsonl` row and `/tmp/custody-c1-size.log`.
  Construction: two small helpers, existing row store/overlay/metadata/outbox
  mechanisms, direct sender derivation, no second evaluator, queue, or carrier.
- No changed source file exceeds 1,500 lines. Largest: `registry.rs` 1,486;
  `range-store.ts` 1,483. Root `caps` remains red solely for inherited Snapback 1
  `crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs` (caps reports
  1,504; base has the same file). No change to that file or baseline.
- Guide deliver: **4,013 bytes**. Offline: **7,867 bytes**, within its actual
  existing 8,192-byte budget. The common brief's 4,352 offline budget is stale
  relative to this base and D2's implementation record. No budgets were raised.
- RFC §6's “written only by that mutation” contradicts its required false rows:
  native delivery must initialize false, and body updates must refresh copied
  rule fields. The RFC now states that only acknowledgement changes false to
  true. Enabling receipts over an existing log uses retained delivered events
  for live bodies in existing installer batches, including departed recipients;
  it never grants custody to newly joined members.
- RFC §7 now spells out provisional metadata: audience/incarnation are zero
  placeholders; seq/at use the prediction clock until actual delivery arrives.
  Only the server identity carries commit seq/ordinal. These values are local
  prediction, not retained server facts.
- RFC §4 now names acknowledgement pricing and resolves residual 4 by stating
  owner structural-page semantics; the native delivery reserve remains separate.
  No attempt was made to impose a user's nonuniform-read rule on owner jobs.
- D1 descriptor canonicalization and D2 repeated-event identities were already
  implemented at the base; retained and verified, not reimplemented.

Open implementation questions: none identified. Remaining program work: D6 and
the orchestrator's full remote verification/commit/landing. The inherited root
caps violation is outside this lane.

## Fix round r1

2026-09-10. Merged base: `c1d96a23d44dabc256296291fd1e99e376851ec4`.
Worktree: `/Users/ccheever/projects/snapback-s2v`, existing branch `s2/ri-custody-c1`.
Uncommitted changes for the orchestrator. No merge, branch change, stash, commit,
full suite, new gate, budget increase, or template change. RFC Status unchanged.

## Disposition by requested item

1. **FIXED — preserve Upsert amplification during retained-A specialization.**
   Native reserves retain their write kind; receipt additions price two maintain
   applications each, including final probes, derivation, timers and aggregate
   write counts. `retained_receipt_upserts_price_twice_the_audience_and_commit_update_and_job`
   independently expects 20 applications after cap 10→3 with retained A=10;
   the update and job chunk commit, count remains 10, and both body edits persist.
   `retained_receipt_specialization_scales_final_probes_search_work_and_timers`
   certifies a valid receipt-sourced search/maintain/timer schema; independently
   checks 40 applications across two maintains, 20 final probes and 20 timer
   writes, and compares all other meters with a separately certified cap-10 plan.
2. **FIXED — initial receipts price their maintains' final probes.**
   Each generated native table contributes its actual maintain dependencies.
   `initial_receipt_maintain_final_exists_is_priced_and_commits`: receipt-sourced
   count's final-existence check is satisfied; reserve 8, actual probes 1, commit
   succeeds and stored count is 1.
3. **FIXED — visible and recoverable acknowledgement admission.**
   Pending batches participate in existing readiness/remaining work; drain
   returns stopped/pending instead of success. Resume and recovery recognize
   unadmitted marks even without a mounted query or product intent. Existing
   FIFO write lock is retained. Terminal rejected/expired marks persist a retry
   flag; only a later accepted page clears the settled intent and admits fresh
   bytes under a fresh grant. Terminal acknowledgement settlement clears only the
   active admission grant when it matches the failed grant; its stored record
   remains available to queued product writes. Redelivery before renewal stays
   visibly pending. Successful compacted marks retain their binding. Product intents survive.
   Tests: `missing acknowledgement grant is visible and retries after resume without losing product writes`,
   its `exhausted` variant, `owner expired acknowledgement is retried only on accepted redelivery under a fresh grant`,
   its `rejected` variant. The existing dropped-response test now supplies
   `effects` and `program` and asserts actual compaction; item 5 also compacts
   actual owner replay responses.
4. **FIXED — containment precedes the receipt read.**
   `receipt_reserve_is_checked_before_the_private_read` removes the reserve and
   poisons stored receipt JSON: TraceSubset fires before decoding, with zero
   examined rows and no constraint trace.
5. **FIXED — both promised real-owner acceptances.**
   `51 messages in one owner commit: only the accepted 50 acknowledge; two clients reopen, retry and compact real replay responses`:
   one batch mutation commits 51 messages at one sequence; accept page one,
   drop the actual second response, assert exactly 50 of 51 true receipts.
   Reopen, add an independent client of the same principal, retry both pages,
   assert 51 true, unchanged first acknowledgement sequences, real compaction,
   and no new acknowledgement after another reopen/redelivery.
   `cold edit outside the live tail refreshes an unmounted thread and offline search without duplicate bubbles`:
   drain 153 messages over several pages without mounting the thread; disconnect,
   edit an early message, reconnect only the drain, reopen offline; thread has
   153 bubbles with one edited row, body and editedAt match owner, new-text search
   finds it, and thread/search make no network reads.
6. **FIXED — failed acknowledgement refuses instead of committing a no-op.**
   Missing original identity and malformed membership authority become traced
   rejections. Authoritative departed membership still leaves received false.
   Tests: `acknowledgement_missing_original_is_a_traced_rejection` and
   `acknowledgement_failed_membership_probe_is_a_traced_rejection`; ordinary
   outbox terminal redelivery recovery is proved by item 3.
7. **FIXED — private constraint declarations match runtime sites.**
   Content receipt Upsert declares DeliveryReceipt; generated acknowledgement
   Update declares DeliveryAcknowledgement on its membership target.
   `receipt_and_acknowledgement_checks_are_declared_only_on_their_runtime_sites`
   asserts declarations and emitted traces on insert, edit, and acknowledgement.
8. **FIXED — frozen corpus exercises D4 prediction.**
   Both membership-contract cases export predictDelivery=true and explicit
   deliveryWrites; the own case freezes the full provisional row and returned
   value, the unproved case freezes an empty prediction. Corpus replay invokes
   prediction and compares those writes. The two identically named checks in
   `test-delivery.ts` also reject corrupted expected writes. Corpus count stays 293.
9. **FIXED — receipt backfill is bounded at installation.**
   All retained log rows scanned, including changed/removed, share the existing
   8,192-event budget with all new bootstrap work. Existing E_SUCCESSOR_BOOTSTRAP
   supplies deliver-line site, work breakdown, and declaration rewrite.
   `receipt_backfill_admits_the_installation_bound_and_refuses_more_log_work`:
   8,192 retained rows admit and initialize 8,192 receipts; 8,224 scanned rows
   refuse before initialization and preserve all existing log rows.
10. **FIXED — prediction test counts are measured and failures exit nonzero.**
    Ten named checks count actual pass/fail and report all failures. Temporarily
    changing the one-event assertion to expect two produced `9 passed, 1 failed`
    and exit 1; the source was restored and the full evaluator run passed.
11. **FIXED in the writable worktree.** RFC §6 says “the receipt query below”;
    the fix-round implementation record is appended, Status unchanged.
    `reports/final-custody-c1.md` copies the prior program report and appends
    `## Fix round r1`. The external canonical report at
    `/Users/ccheever/projects/snapback-ri-20260910/reports/final-custody-c1.md`
    cannot be written under this session's filesystem policy; the orchestrator
    must copy the prepared appendix there. No product item refused.

## Before → after evidence

Logs are `/tmp/custody-c1-r1-<suffix>.log`. The before probes use the base
implementation for the relevant defect with the regression test added; source
restoration was done directly, without Git state changes. Later combined
acceptance failures also exposed the pending-only resume guard.

| Item | Before output / suffix | After assertion |
| --- | --- | --- |
| 1 | `before-pricing`: `left: 13`, `right: 20`; `FAILED. 8 passed; 2 failed` | 20 applications; update and job committed |
| 2 | `before-pricing`: `TraceSubset("rule probes 1 > certificate 0")` | reserve 8, actual 1, count 1, committed |
| 3 | `before-admission`: remaining 1 vs expected 2; `accepted redelivery clears the terminal binding` fails | four missing/exhausted/rejected/expired tests pass; queued product bytes remain |
| 3, fresh grant | `before-fresh-grant`: `redelivery waits for a fresh grant`, `2 !== 1` | redelivery stays pending until a different grant is adopted; original grant records survive |
| 4 | `before-private-read`: `Schema("expected value at line 1 column 1")`; `0 passed; 1 failed` | TraceSubset before private read; examined 0 |
| 5 | New full acceptance coverage; `pages` exposed pending-only recovery during implementation | both real-owner acceptances pass in final `package` log |
| 6 | `before-refused-ack`: `state: Committed { seq: 4 }`; `1 passed; 2 failed` | both failures Rejected with trace and false receipt |
| 7 | `before-check-sites`: insert declares `memberships:DeliveryAcknowledgement`; `0 passed; 1 failed` | receipt and acknowledgement checks only on their firing sites |
| 8 | `before-corpus-prediction`: `{"predictDelivery":false,"deliveryWrites":[]}` | own=true mode with one exact row, unproved=true mode with none |
| 9 | `before-backfill`: `unwrap_err()` received successful `initialized 8192 unacknowledged receipt(s)` after scanning 8,224 rows | 8,224 refuses; 8,192 admits |
| 10 | Old hardcoded `11 passed, 0 failed`; `counter-failure`: `Delivery prediction checks: 9 passed, 1 failed`, exit 1 | `Delivery prediction checks: 10 passed, 0 failed` |

## Verification — verbatim counts

Real Node 24.18.0 was first on PATH for all final commands. Cargo ran from
`snapback2/`; package/evaluator/compiler commands ran from their package roots.
The owner harness and Cargo builds were run separately after an early concurrent
run hit the harness's 30-second build-lock timeout; the isolated run passed.

| Command | Final output | Log suffix |
| --- | --- | --- |
| `cargo build` | successful; owner harness also builds its binary | `build-owner` |
| `NEXTEST_TEST_THREADS=8 cargo nextest run --config-file ../.config/nextest.toml --profile local-proof -p snapback2-core --test delivery --test cap --test jobs --test timers --no-fail-fast` | `117 tests run: 117 passed, 1 skipped` | `nextest` |
| `cargo test -p snapback2-core --lib engine::acknowledgements::tests -- --nocapture` | `3 passed; 0 failed; 0 ignored; 0 measured; 177 filtered out` | `private` |
| `cargo run -p snapback2-core --bin export_corpus` | `wrote 293 frozen corpus cases` | `export` |
| `cargo test -p snapback2-core --test spike every_frozen_corpus_case_replays_its_certification_outcome -- --nocapture` | `1 passed; 0 failed; 0 ignored; 0 measured; 12 filtered out` | `corpus-replay` |
| Evaluator `bun src/test.ts` | `Delivery prediction checks: 10 passed, 0 failed`; `{"cases":266,"passed":266,"serverOnly":27,"failed":0,"corruptionPath":"replay-mismatch"}` | `evaluator` |
| Compiler `bun src/test.ts` | `Compiler checks: 300 passed, 0 failed` | `compiler` |
| `node --test tests/delivery-custody.test.ts tests/real-owner-delivery.test.ts tests/outbox.test.ts` | `tests 44`, `pass 44`, `fail 0`, `skipped 0` | `package` |
| Guide nextest filter `test(command_guides_explain_initialization_and_successor_recovery) \| test(quarry_keywords_print_grammar_and_definitions_beside_symbol_help)` | `2 tests run: 2 passed, 12 skipped` | `guide` |
| `node build.mjs --measure-twin` | `minified: 263232`, `gzip: 86260`, `ceiling: 90000` | `size` |
| `node build.mjs` | `guide: 32 cards, 89879/98304 bytes (8% headroom)`; exit 0 | `build-final` |

`./ref-check --verbose`: `ok — 439 LLP docs, 8014 refs in 19160 files, 0 errors, 0 unchecked`.
`git diff --check`: no output, exit 0.

The one Rust skip is the existing ignored LLP 1016 measurement, not a new
failure. No owner-stop sandbox artifacts remain in the targeted run.
`scripts/test.sh` was **not run**, as the fix-round brief explicitly directs.

## Files and scope

All paths below are under `snapback2/` except the RFC and reports.

- `crates/snapback2-core/src/certificate/delivery.rs`: items 1, 2, 7.
- `crates/snapback2-core/src/engine/acknowledgements.rs`: items 4, 6 and three unit tests.
- `crates/snapback2-core/src/successor/delivery.rs`: item 9.
- `crates/snapback2-core/tests/delivery/receipts.rs`: five regression tests for items 1, 2, 7, 9.
- `crates/snapback2-core/src/bin/export_corpus.rs` and `export_corpus/delivery_cases.rs`: item 8; sibling `assets.rs` and `cap_cases.rs` only initialize the added optional fields.
- `corpus/deliver-{own-membership-contract,no-membership-contract,ack-missing-authority}.json` and `corpus/manifest.json`: regenerated predictions/constraint declarations; no added cases or count change.
- `packages/evaluator/src/{evaluator.ts,types.ts,test-delivery.ts}`: prediction-mode replay, frozen expected writes, counted checks.
- `packages/snapback2/src/delivery-acknowledgements.ts`, `src/store/{range-store.ts,outbox.ts}`: durable retry disposition and visible pending work. Store swap logic lives in the existing delivery helper to keep range-store under the file cap.
- `packages/snapback2/src/{client-outbox.ts,client-recovery.ts,client.ts,offline.ts,types.ts}`: pending batches participate in drain, settled, offline remaining, resume and recovery; existing public readiness shapes.
- `packages/snapback2/tests/{delivery-custody.test.ts,real-owner-delivery.test.ts}`: admission/recovery/compaction and real acceptance coverage.
- `packages/compiler/fixtures/quarry-delivery/snapback/{schema.q,messages.q}`: single-transaction batch, edit timestamp, search and receipt inspection for real-owner tests. Fixture body bound is 80 and member cap 3 so the 51-row indexed batch fits existing ceilings; no production template changed.
- `packages/snapback2/guide/{deliver.md,successor.md}`: every new user rule, compacted within existing budgets.
- `metrics/twin.jsonl`: two measurements appended by the required existing tool.
- `../llp/1019-derived-delivery-custody.rfc.md`, `../REPORT-custody-c1.md`, `../reports/final-custody-c1.md`: corrected rules and requested records.

Scope beyond the original D4/D5 files is explicit above: successor admission was
required by item 9; client recovery guards were necessary for item 3; shared
export constructors require the new optional fields; fixture search/batching
exists only to prove item 5. No changes outside the worktree.

## Corrections and limits

- The actual unused acknowledgement declaration named the membership target
  (`memberships` in these fixtures), not `messages` as the review paraphrased it.
- The evaluator corpus runner did not already honor predictDelivery on this
  merged base; this round adds it. Rust replay validates certification while
  the TS corpus runner freezes the provisional prediction/result.
- The prior assertion harness already threw on a failed assertion; its count
  was fabricated. The new harness reports real counts, collects failures,
  and demonstrably exits 1. The prior report's “11 checks” is corrected to 10.
- Page-one closure can carry a halo body from page two. Acceptance is tied to
  the disclosed accepted event/body pair, not mere body presence: exactly 50
  receipts become true before accepting the dropped page.
- Live authoritative absence is a departed recipient; malformed or unreadable
  membership authority is a refusal. Terminal refusal requires page redelivery
  for a fresh intent, not an automatic retry of settled bytes.
- Existing guide budgets on this merged base are deliver 4,096 and successor
  4,608 bytes; final sizes 4,029 and 4,562. Offline remains 8,188/8,192. The
  common brief's older offline budget does not match the code. No budget raised.
- Final runtime: **86,260/90,000 gzip bytes**, 3,740 headroom; Node24.18.0,
  esbuild0.25.9, gzip9. The measurement records the base SHA because this lane
  is intentionally uncommitted.
- No changed file exceeds 1,500 lines; largest is export_corpus.rs at 1,498;
  range-store.ts is 1,492. Root caps has one inherited Snapback 1 violation:
  `crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs` at 1,504 lines;
  baseline permits 204 oversized files and finds 205. This file and baseline
  are unchanged from HEAD.

Open implementation questions: none identified. External report propagation,
review, commit and landing remain with the orchestrator.

## Fix round r2 (orchestrator)

The host verify of the merged r1 candidate (`custody-c1-m2`) had seven package reds with one cause:
the persisted range state gained `deliveryAcks: {}` and the round-trip/projection fixture
(`tests/sqlite-state.ts`) did not carry it — it does now; and a status read racing a logout/reset
(`supersession.test.ts`, both carriers) failed because `pendingAcknowledgements` read a closed
store — a closed store has nothing pending to admit, so it reports none instead of failing the
status. sqlite, supersession, delivery-custody, outbox, offline-store files 136/136.

## Fix round r3

**REFUSED on item 1 (client bytes).** Items 0, 0b, 1b–1e implemented and verified; no commit or branch operation. The correctness-preserving candidate exceeds all three author-approved maxima. No maximum, scorer, build entry, or runtime allocation was changed.

| Packaged closure, gzip level 9 | r2 base `e389aa8b44` | r3 candidate | Maximum | Excess |
|---|---:|---:|---:|---:|
| client | 140,542 | 140,612 | 139,277 | 1,335 |
| React | 150,252 | 150,322 | 149,089 | 1,233 |
| Expo | 153,856 | 153,926 | 152,832 | 1,094 |

**Why this round refuses bytes.** A negative control removed all SDK acknowledgement admission, marking, lifecycle notification, and readiness accounting, while keeping product outbox behavior. Its successful package build measured **139,789 / 149,499 / 153,103**, still **512 / 410 / 271** above the maxima. All those deletions were reverted before the final build. Removing the entire acknowledgement behavior saved only 823 gzip bytes in each closure; the required client saving is 1,335. Shrinking that path alone did not pay the bill even when its guarantees were completely removed. A larger allocation or authorization to reduce another part of the client/runtime closure is needed; this report does not claim such authorization. The negative control is evidence only, never the delivered implementation.

Toolchain: real Node **v24.18.0**, esbuild **0.25.9**, gzip **9**. Closures were traversed with the exact `packagedEntryBytes` implementation from the unchanged scorer. Baseline and final esbuild metafiles use the actual split client/internal build options through temporary instrumentation in `/tmp`; every changed per-input `bytesInOutput` follows. These are minified byte contributions, not additive gzip attributions. Untouched files with tiny changes reflect esbuild symbol allocation. Moving the existing outbox swap to the delivery module accounts for most of its increase.

| Input | Before | After | Delta |
|---|---:|---:|---:|
| `../evaluator/src/coverage.ts` | 5,726 | 5,728 | +2 |
| `../evaluator/src/runner.ts` | 28,265 | 28,271 | +6 |
| `src/assets.ts` | 6,682 | 6,659 | -23 |
| `src/client-assets.ts` | 2,301 | 2,298 | -3 |
| `src/client-observed.ts` | 8,091 | 8,097 | +6 |
| `src/client-outbox.ts` | 9,469 | 9,459 | -10 |
| `src/delivery-acknowledgements.ts` | 1,053 | 2,139 | +1086 |
| `src/offline.ts` | 23,234 | 23,292 | +58 |
| `src/store/outbox.ts` | 8,457 | 8,342 | -115 |
| `src/store/overlay-retirement.ts` | 6,166 | 6,175 | +9 |
| `src/store/range-store.ts` | 27,159 | 26,428 | -731 |
| `src/twin.ts` | 4,810 | 4,812 | +2 |
| **All client/internal output inputs** | **376,432** | **376,719** | **+287** |

### Implementation and reproduction

- **0 / 1b, lifecycle custody:** `store/outbox.ts` snapshots `generation` before pending marks, rejects stale queued admission, and supplies `enqueueNow`'s `beforeCommit` guard for every batch. `offline.ts` serializes partition open/replacement, wipe/logout, seal, and close with the existing outbox lock. The three grant-read barrier tests use a separately persisted Bob grant and a real accepted Alice event/body. Before: `tests 3`, `pass 0`, `fail 3`; Bob held `intent: "bob-grant:0"`, `grant: "bob-grant"`, `args.events: ["14dcec4356806a2f72e71bf778654d7a2904b08a47b9d6d0e39e2e88c9c784da"]`. Logout failed `json range store is not open`; seal failed `range store is sealed`. After: all three pass; no foreign outbox bytes or consumed grant slice, old partition marks removed, sealed marks unchanged. The unreachable drain return was removed.
- **0b, successor disposition:** adoption removes marks for absent acknowledgement operations, with one log after the durable swap. The real-owner test installs the exact destructive migration plan removing receipts, preserves a queued product intent, reopens the file carrier, replays the product write to the real owner, and verifies no repeated log. Before: `removed operation has no pending work`, `1 !== 0`, `tests 1`, `pass 0`, `fail 1`. After: `tests 1`, `pass 1`, `fail 0` (also part of the final 107).
- **1, construction:** one persisted mark shape, `[seq, intent?, retry?]`, keyed by the existing log-row identity; event/body disclosure derives directly inside the accepted-page transaction, rather than constructing and copying a second swap map in the runtime. One batch builder supplies both readiness and admission; ordinary outbox swaps bind marks to intents. No dedicated allocator, duplicated admission loop, retained row-key array, error-message parsing, or unused extraction export. The changes did **not** produce a net byte reduction: final packaged closures are 70 bytes larger than r2 after the safety and retention fixes. Item 1 is refused, not declared fixed.
- **1c, retirement:** compacted successful marks retire when their event leaves held log coverage. The 120-window test keeps one current log row and exactly one persisted mark, including after reopen; each retained mark prevents another acknowledgement. Before: the second window had two marks for one held event (`2 !== 1`). After: all 120 windows pass. Queued/terminal custody is never discarded to enforce this bound.
- **1d, splits:** range-store **1,469** lines; export_corpus **1,418** lines. The outbox/acknowledgement swap is in existing `delivery-acknowledgements.ts` (**81** lines). The remaining maintained-inbox delivery fixture moved to existing `export_corpus/delivery_cases.rs` (**428** lines). Corpus export: `wrote 293 frozen corpus cases`; no corpus diff or pinned-count change.
- **1e, wire labels:** `maintained_content_deliver_refusal_keeps_every_wire_label` serializes the actual raw-schema admission result and pins `E_SCHEMA_DELIVER`, family `schema`, guide/page `offline`, site `schema.tables.messages.deliver`, and the exact executable removal/source-table rewrite. Its maintain fixture is valid apart from the prohibited deliver declaration. The earlier core test bypassed maintain admission and checked only the delivery issue list.

### Verification

| Command / scope | Verbatim result |
|---|---|
| `cargo build`; `cargo build -p snapback2-media` | exit 0 |
| `node build.mjs` | exit 0; `guide: 32 cards, 89942/98304 bytes (8% headroom)` |
| `node --test --test-concurrency=1 --test-timeout=60000 tests/delivery-custody.test.ts tests/real-owner-delivery.test.ts tests/outbox.test.ts tests/sqlite.test.ts tests/supersession.test.ts` | `tests 107`, `suites 0`, `pass 107`, `fail 0`, `cancelled 0`, `skipped 0`, `todo 0` |
| delivery Rust suite, nextest local-proof, 8 threads | `59 tests run: 59 passed (1 leaky), 0 skipped` |
| maintained-content wire label, nextest local-proof, 8 threads | `1 test run: 1 passed, 435 skipped` |
| `npm_config_cache=/tmp/custody-r3-npm-cache node scripts/measure.mjs --check` | exit 1: only `client_gzip_bytes, react_gzip_bytes, expo_gzip_bytes, runtime_gzip_bytes` failed; bytes **140612 / 150322 / 153926 / 86376**; all timed/consumer checks green |
| corpus export | `wrote 293 frozen corpus cases` |
| `./ref-check --verbose` | `ok — 439 LLP docs, 8014 refs in 19160 files, 0 errors, 0 unchecked` |
| `git diff --check` | exit 0 |
| root `caps` | 1 inherited violation: unchanged `crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs`, 1504 lines; no changed source exceeds 1500 |

The unchanged scorer compares against its earlier accepted byte baseline (client 136547, React 146166, Expo 149836, runtime 84580), so its runtime red is distinct from the author's 90,000 ceiling: **86,376 < 90,000**. The three client closures also exceed the author's one-time maxima, independently of that older scorer baseline. The first measure run hit an unwritable default npm cache; the repeated run used the writable `/tmp` cache and passed the consumer smoke and every timing check. No owner-stop sandbox artifact remained.

The first concurrent package run had one real-owner timeout and one owner-readiness timeout; the final sequential run passed all 107. No persistent owner-stop sandbox failure is hidden in that count. `scripts/test.sh` and the whole suite were not run, as instructed.

### Scope, deviations, and open question

Changed: `snapback2/packages/snapback2/src/{delivery-acknowledgements.ts,offline.ts,client-outbox.ts,store/outbox.ts,store/range-store.ts}`; the two delivery test files; `guide/deliver.md`; `snapback2/crates/snapback2-core/src/bin/{export_corpus.rs,export_corpus/delivery_cases.rs}`; `snapback2/crates/snapback2/src/check.rs`; the existing measurement logs `snapback2/metrics/{loop,twin}.jsonl`; LLP 1019 and the requested reports. The wire admission test in `check.rs` is the explicit extension beyond the originally cited core-only receipt test; it is necessary to pin the wire labels. No engine, compiler, evaluator, template, scorer, or build source was changed. Temporary measurement helpers and logs remain under `/tmp/custody-r3-*`.

Code facts differing from the brief: generated logs have no schema storage cap, and unsent custody has no total-store cap (LLP 1012 §7). Settled marks are therefore bounded by held log rows under the existing fact-slot budget, and only compacted successes may retire; this adds no arbitrary cap or loss of pending work. A later refetch of an evicted event can produce an idempotent acknowledgement. The old never-evicted-success tests all remain green. Native deliver corpus cases were already in `delivery_cases.rs`; this round moved the remaining maintained-inbox case to free the top-level file. Current guide enforcement is the existing 8,192-byte per-card / 98,304-byte aggregate allocation; `deliver.md` was nevertheless trimmed to **4,092 bytes**, within the brief's older 4,096 limit. No budget was raised.

Open question for the orchestrator/author: authorize broader client/runtime reduction or a new allocation. This candidate is **not landable** under the current three maxima. No commit, stash, branch change, publication, or change to RFC Status.
