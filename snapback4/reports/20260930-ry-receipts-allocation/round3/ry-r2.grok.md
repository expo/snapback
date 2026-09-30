I'll review round 2 of lane RY against the two claims and the prior findings, starting with the review instructions and the round-2 report.The round-2 report claims the prior terminal refusals now queue. I'll pin the commit range and the engine paths those refusals used before checking each claim.The round-2 change is one commit on top of the main merge. I'll read the engine diff and the admission path those refusals have to pass through.Auto-compacting conversation (82% full)...
Conversation compacted.
The delete-by-ordinal path still looks like it can refuse a write terminally. I'll reproduce that against the round-2 engine, then check the three claims.The audit says write-target selection observes provisional ordinals, but `delete_target` never calls that check. I'll reproduce that on a scratch worktree and keep the review checkout untouched.The dependency suite finished: 55 passed and 6 failed. I'll read those failures next.**READY WITH CHANGES.** One High finding remains. The named round-2 triggers queue, ordinary sends and joins still predict, and the wasm increase matches the recorded build. A write addressed by the receipt ordinal still does not.

## High — an ordinal key is not provisional accounting

`delete_target` never calls `observe_sequence_selection`. It evaluates the key, looks the row up, and on a proven miss returns `Require NOT_FOUND` (`write_target.rs` 165–189). Update and upsert do observe, before the lookup (`write_target.rs` 207). Point reads do too (`read_point.rs` 30). The dependency bit only changes errors into a queued prediction (`local.rs` 132–134). Any other error is returned before the outbox insert (`device.rs` 1080–1088), so the write is dropped.

That is the same class as round 1, and it is not limited to a missing-row refusal. A successful match on the device’s guessed ordinal stays `predictable: true`, and the server then binds that ordinal to a different row. The stock `send` / `add` / `createConversation` mutations do not address messages by ordinal. An allowed edit or delete by `byConversationOrdinal` does. Both memory and SQLite show it.

Setup for all of these: conversation fully published, then one server send the device never sees (server ordinal 1, device counter still 0), then a device mutation that inserts a message and addresses ordinal 1 or 2. The device predicts the new message as ordinal 1. The server assigns it ordinal 2.

| Write | Sync | Device | Server |
| --- | --- | --- | --- |
| `delete messages[conversation, 2]` | full group, no horizon | `Require { code: "NOT_FOUND" }`, outbox empty | `Sent`. The new message is allocated 2 and deleted. Only ordinal 1 remains. |
| same delete, as a follow-up after a pending send | full group | same `NOT_FOUND` at `deleteOrdinal` | After the send lands at ordinal 2, the delete removes it. |
| `delete messages[conversation, 1]` | full group, and the shipping `last 500` horizon | `predictable: true`, local messages empty (the pending row was deleted) | Only ordinal 2 remains. The earlier message was deleted. The new one was kept. |
| `update messages[conversation, 1] { text: 'edited' }` with `update <- .sender = viewer` | shipping `last 500` horizon | `predictable: true`, one local row | Ordinal 1 is `"edited"`. The new message is ordinal 2 and still `"checked"`. |

Controls on the same build: `messages[conversation, 2] ! else MISSING` queues with `predictable: false` on a full sync. `delete messages[conversation, 2]` also queues under the shipping horizon, because a horizon makes absence unproven and `write_miss` is already a prediction (`rules.rs` 32). A plain send still predicts its row, and `add` still predicts, on both stores.

So the horizon hides only the terminal miss. It does not hide the false success, and that false success is on the default messages sync. The audit line “write-target selection already calls `observe_sequence_selection`” is true for update and upsert and false for `Stmt::DeleteTarget`. Observing inside `delete_target` would fix the `NOT_FOUND` drop. It would not fix the false success: update already observes, and a successful result is not demoted. A key that is a receipt ordinal has to stay unpredictable even when the local write succeeds. Demoting every successful provisional read would also stop ordinary sends from predicting, which this round correctly kept.

## Claims

**1. Confirmed for the triggers it names.** On `171ad5df7d` the whole `allocation::dependencies` module passed except the ordinal-key probes above: the 48 device witnesses, the private-capture compiler test, and the new send/join control. That covers same-transaction `receipt(m) != null`, the receipt follow-up, old/next recipient rules, `receiptMember` and `progress`, ordinal update and delete rules on a row found by id, final-exists, residual equalities, live and stored aggregates, scalar max, group, sort, and both public-capture witnesses.

Reverting the eight round-2 engine files to `bf58d4a003` in a scratch worktree makes `same_transaction_memory` fail again with `Require { code: "NEED_RECEIPT" }` and an empty outbox. `direct_count_memory` and `terminal_control_memory` still pass. That is the round-1 split.

**2. Refuted.** The table’s other rows match the code that the passing witnesses exercise: `SequenceProbe`, `ReceiptSettled` (the pending null sets the bit before returning, `runner.rs` 925–930), final-exists, residuals, row views, extrema, group/sort, and recorded capture (`recorded.rs` 68–72 plus the one-hop recorded lookup in `sequence_field_is_assigned`). Delete-by-ordinal is an engine read of a clause-owned field and is not on that path. The report lists it as already covered.

**3. Confirmed, including the capture correction.** The stored round-1 log is 6 passed and 38 failed, all at the admission assertion. The four later capture witnesses are 0 passed and 4 failed on that engine. 38 + 4 = 42. The round-2 log of those first 44 is clean. I did not repeat the 1,271 s suite. `full-suite-summary.json` and `full-suite.log.gz` both say `== 0 failure(s) in 1271 s`, with rust 4,501 passed / 33 ignored and clients 5,577 passed. The suite wasm log is 2,004,883 B raw / 601,592 B gzip, over the round-1 cap by 1,324 B.

The post-suite capture fix is in this tree. The four file hashes match the `final` column of `post-suite-source-delta.json`. `post-suite-lang.log.gz` is 115 + 11 + 107 + 14 + 5 + 31 = 283, including receipts 115/115 and guide 107/107. Device maintains 29, device recorded 24 + 24, core recorded 4. That is 364, and those witnesses passed again in the dependency run here. `final-wasm.log.gz` ends with `wasm 2005133 B raw, 601629 B gzip (budget 601629: ok)`. The intermediate post-suite wasm log is the same bytes rejected against the 601,592 cap by 37 B, which is the recorded capture delta (250 B raw). `metrics/wasm-budget.json` is exactly 601,629, no slack, and 601,629 − 600,268 = 1,361. I did not relink wasm. The engine diff is about ninety lines of shared observation; 0.23% gzip for threading that bit through the device interpreter is proportionate, and the capture addendum is 37 B.

No other path from pending or provisional accounting to a terminal refusal turned up. Untaken `require false` stays terminal. Sends and joins still predict.

**Verdict: READY WITH CHANGES.**
