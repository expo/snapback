# Round 1 failure inventory

All unexpected failures below are **ours**, except the unavailable iOS simulator (**environmental**). No failure is claimed as baseline. The staged baseline experiment used the merged round-0 client with the current server and incomplete fixture paths; it is not evidence for a baseline exemption. All known affected failures were resolved and covered by the successor runs in REPORT.md.

## Required full run

Exact summary: `== 2 failure(s) in 1200 s` (`cargo test`, `client tests`). Client aggregate: 4,171 tests, 4,105 passed, 55 failed, 1 cancelled, 10 skipped. All 79 full model tests passed. The cancelled case is the idle-poll fixture with its unchanged fake applied watermark.

| Failure (all ours) |
|---|
| serve::tests::ephemeral_tests::legacy_poll_reply_has_exact_base_shape |
| local observations skip idle polls and rerun after a committed page |
| a failed native replacement falls back without a stale local answer and is retried |
| online watches retain their changes watermark; bare tokens clear on refusal |
| packages/snapback4/test/delivery-fault-matrix.test.mjs |
| online: durable-only change requests and answers retain the base wire bytes |
| wasm: durable-only change requests and answers retain the base wire bytes |
| initial backend installation rejects a query already in flight |
| expiry retry server pagination wasm |
| expiry retry server pagination watch wasm |
| expiry retry server pagination process |
| expiry retry server pagination watch process |
| process: receipt after an unseen commit gap fences old authority |
| online: public rule witnesses do not qualify as harmless profile puts |
| process: public rule witnesses do not qualify as harmless profile puts |
| an already requested sync cannot discharge a later unknown-cut replacement |
| wasm keep=undefined: displayed expiry fences an older body while preserving newer memory (active) |
| process keep=undefined: displayed expiry fences an older body while preserving newer memory (active) |
| wasm keep=true: displayed expiry fences an older body while preserving newer memory (active) |
| wasm keep=true: displayed expiry fences an older body while preserving newer memory (lingering) |
| process keep=true: displayed expiry fences an older body while preserving newer memory (active) |
| process keep=true: displayed expiry fences an older body while preserving newer memory (lingering) |
| wasm keep: an older displayed deadline preserves a newer unexpired remembered answer |
| process keep: an older displayed deadline preserves a newer unexpired remembered answer |
| wasm: keep=undefined never publishes an evaluation captured before a newer commit |
| process: keep=undefined never publishes an evaluation captured before a newer commit |
| wasm: keep=true never publishes an evaluation captured before a newer commit |
| process: keep=true never publishes an evaluation captured before a newer commit |
| wasm: comparative DM before acquisition, HTTP decorations, and unpredicted offline send |
| ready list reads survive account restoration, new chat acquisition and pending unread counts |
| wasm: retained nested rows follow source parents on reordered pages |
| wasm: retained nested rows follow source parents on shifted pages |
| wasm: composed tables sharing an ID keep independent retained rows |
| wasm: projections without id replace a retained copy using its source envelope |
| process: retained nested rows follow source parents on reordered pages |
| process: retained nested rows follow source parents on shifted pages |
| process: composed tables sharing an ID keep independent retained rows |
| process: projections without id replace a retained copy using its source envelope |
| wasm: an identityless object merges its identified child rows |
| wasm: an unidentified sibling preserves paired parents and drops an unpaired current row |
| process: an identityless object merges its identified child rows |
| process: an unidentified sibling preserves paired parents and drops an unpaired current row |
| wasm: an anonymous nested page appends only retained history after a partial rejoin |
| wasm: an in-place edit under an anonymous nested page replaces its retained copy |
| process: an anonymous nested page appends only retained history after a partial rejoin |
| process: an in-place edit under an anonymous nested page replaces its retained copy |
| wasm: an unheld parent falls back without losing retained rows |
| process: an unheld parent falls back without losing retained rows |
| R5 history wasm: retained history and independent held coverage |
| R5 history process: retained history and independent held coverage |
| wasm: resubscription delivers saved row expiry without an accessor, keep=false |
| remembered wakeup retains data until its own server deadline (null, early=false) |
| remembered wakeup retains data until its own server deadline (null, early=true) |
| remembered wakeup retains data until its own server deadline (300, early=false) |
| remembered wakeup retains data until its own server deadline (600, early=false) |
| finding 2: delayed horizon answer cannot escape its incarnation |
| write authority: /m replay keeps only execution identity after hidden writes, dropped replies and revocation |

## Causes and resolutions

- Legacy wire-shape tests: omit empty `nonRevoking` from `/changes`; qualify fresh receipt metadata while preserving early replay identity-only replies. Rust wire test and HTTP suite pass; write-authority tests pass.
- Idle poll/native fallback/server-clock mocks: model the applied watermark and actual server cut. Unknown-cut replies remain deliberately fenced; the new unknown-cut regression verifies that a sync requested before the evidence cannot clear it.
- Query peer/order/expiry assertions: newer one-shots now replace peers and their deadlines; obsolete competing completions can return loading. Tests keep their stale-publication assertions and wait for a winning current completion where needed. Opt-out resubscription withdraws immediately.
- Actual deadline regression: moving deadline installation behind ordering lost the retry timer of an initial loading answer. Restore that timer only when no data is displayed; never replace the displayed body cut or deadline with withheld metadata.
- History/provenance tests: controls must hold the streaming `/changes` body, not just headers or sync. With delivered evidence, the replica is fenced and a checked whole server reply may temporarily replace retained composition. After apply, existing engine retention rules resume. Tests still require original rows/provenance in the no-evidence control and forbid old or removed rows after evidence.
- Builder browser fixtures: use the actual comparative profile schema; complete online dispatch custody in the test harness; ignore intentional aborted requests. The final route/draft/mount assertions pass for wasm and online.
- New tests initially had an ambiguous profile lookup and nullable boolean require; use named `id` lookup and `= true`. The public-rule witness now records streaming evidence after decoding its body, so it cannot miss a poll opened before the fixture hold.
- Delivery instrumentation: the full run mixed an already-built dist tree with a newly extracted source import. The final build contains both helpers. Record the same apply await with its extra synchronous prediction-proof argument and two new zero-await modules; all 313 fault cases pass.
- Guide fact snapshot: update only reads-06 to the revised rendered Details prose. Whole guide passes 98/98.
- Property fixture: oracle evidence must distinguish receipt/acceptance epochs; an older discarded response cannot retroactively become accepted evidence. Authorization history, evidence delivery, replica application and competing completion remain independently scheduled.
- Staged verification: missing fixture/workspace paths and earlier compiled modules produced test-harness failures. Final runs use the complete worktree; no staged failure is labelled environmental or baseline.
- Operational mistakes: scratch scripts were invoked with an extra `snapback4/` prefix from inside that directory, including the first wasm-measurement command; rerun with the correct path. Two Rust filter commands selected zero tests and are not qualification; the named tests and 159-test HTTP target were subsequently run. An initial helper used a void-returning `until` as a value; fixed the helper to return its successful predicate.

## Intermediate runs and expected counterfactuals

Every captured failing name, including repeats in intermediate runs and deliberate mutant failures, is in [failures.json](./failures.json). The following index records every log with a failure. `mutant-*` failures are intentional negative controls, classified ours. Two earlier mutant attempts did not fail by assertion (withheld cut, online builder); strengthened their scheduling/assertions and all ten final mutants are killed.

| Log | Attribution | Unique failing names |
|---|---|---|
| [affected-final.log.gz](./affected-final.log.gz) | ours | 6 |
| [baseline-js.log.gz](./baseline-js.log.gz) | ours | 32 |
| [browser-2.log.gz](./browser-2.log.gz) | ours | 2 |
| [browser-3.log.gz](./browser-3.log.gz) | ours | 1 |
| [browser-initial.log.gz](./browser-initial.log.gz) | ours | 2 |
| [compatibility-rerun.log.gz](./compatibility-rerun.log.gz) | ours | 24 |
| [delivery-rerun.log.gz](./delivery-rerun.log.gz) | ours | 1 |
| [fences-2.log.gz](./fences-2.log.gz) | ours | 2 |
| [fences-initial.log.gz](./fences-initial.log.gz) | ours | 6 |
| [fences-pre-rebuild.log.gz](./fences-pre-rebuild.log.gz) | ours | 1 |
| [guide-final.log.gz](./guide-final.log.gz) | ours | 1 |
| [idle-debug.log.gz](./idle-debug.log.gz) | ours | 1 |
| [isolated-affected.log.gz](./isolated-affected.log.gz) | ours | 2 |
| [model-browser.log.gz](./model-browser.log.gz) | ours | 1 |
| [mutant-asset-next-cut.log.gz](./mutant-asset-next-cut.log.gz) | ours (intentional mutant) | 1 |
| [mutant-asset-refusal.log.gz](./mutant-asset-refusal.log.gz) | ours (intentional mutant) | 1 |
| [mutant-builder-local.log.gz](./mutant-builder-local.log.gz) | ours (intentional mutant) | 1 |
| [mutant-builder-online.log.gz](./mutant-builder-online.log.gz) | ours (intentional mutant) | 1 |
| [mutant-changes-call.log.gz](./mutant-changes-call.log.gz) | ours (intentional mutant) | 2 |
| [mutant-cross-policy.log.gz](./mutant-cross-policy.log.gz) | ours (intentional mutant) | 3 |
| [mutant-replica-fence.log.gz](./mutant-replica-fence.log.gz) | ours (intentional mutant) | 2 |
| [mutant-subset-replacement.log.gz](./mutant-subset-replacement.log.gz) | ours (intentional mutant) | 3 |
| [mutant-unknown-cut-sync.log.gz](./mutant-unknown-cut-sync.log.gz) | ours (intentional mutant) | 1 |
| [mutant-withheld-cut.log.gz](./mutant-withheld-cut.log.gz) | ours (intentional mutant) | 1 |
| [mutations-final.log.gz](./mutations-final.log.gz) | ours | 2 |
| [native-expo.log.gz](./native-expo.log.gz) | environmental | 1 |
| [order-2.log.gz](./order-2.log.gz) | ours | 7 |
| [order-initial.log.gz](./order-initial.log.gz) | ours | 10 |
| [remaining-qualified.log.gz](./remaining-qualified.log.gz) | ours | 6 |
| [retained-debug.log.gz](./retained-debug.log.gz) | ours | 3 |
| [rule-witness-fixture.log.gz](./rule-witness-fixture.log.gz) | ours | 2 |
| [rust-http-final.log.gz](./rust-http-final.log.gz) | ours | 1 |
| [test-sh.log.gz](./test-sh.log.gz) | ours | 57 |
