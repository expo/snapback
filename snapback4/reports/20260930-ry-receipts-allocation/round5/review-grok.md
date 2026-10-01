I'll review round 4 of lane RY against the prior findings and the four claims, starting with the round-3 reviews, the round-4 report, and how those reviews were structured.Round 3 left a residual ordinal comparison and a maintained-column drop. I'll check the round-4 range and the rule that is supposed to close both, then re-run the old reproductions against it.The range is one commit on the merge. I'll read the prediction boundary and the new observation paths, then line them up with the old reproductions.Auto-compacting conversation (81% full)...
Conversation compacted.
The review is still open: no tests have run and there is no verdict. I'll put probes in a scratch worktree so the checkout stays clean, then re-run the round 1–3 cases and the negative control.The scratch worktree is at the round-4 commit. Next I’ll add the gap probes there and start the receipt tests, leaving this checkout untouched.Auto-compacting conversation (80% full)...
Conversation compacted.
The gap probes passed. The remaining required check is the negative control: disable the receipt-observation rule in a scratch copy and show the generated test fails, then write the verdict.**READY.** No product finding remains. A true ordinal comparison on a non-receipt index no longer predicts the wrong row, and a follow-up that reads a maintained column derived from receipt accounting is queued instead of dropped.

## What round 3 left

Round 3 demoted only refusals, and only when the index key itself was clause-owned. A successful `m.ordinal = 1` after a lookup on `bySender` or `.id` stayed `predictable: true` and settled onto a different row. A `require` on a parent total summed from `.recipients` could still end as a terminal device refusal.

## Claim 1 — confirmed

Any authored read of clause-owned or transitively derived state now makes the whole mutation unpredictable, on success and on failure. `predict` installs the observer only when a receipts clause exists, then after the mutation returns `RuntimeError::Prediction` if `receipt_touched()` is set, or if an ordinary `sequence by` read was provisional and the mutation failed (`engine/local.rs`). The host rolls the predicted rows back and keeps the intent. Raw storage and allocator probes do not touch. Authored gets, scans, field reads, index selections, comparisons, and write targets do.

The dependency map is a schema-time fixed point (`schema/receipts.rs`, `prepare_receipt_dependencies`). It seeds the counter, floor, ordinal, recipient count, watermarks, and every column of the runs table, then closes over recorded captures, `through` fields, and maintains. A dependent maintain taints every column of its target plus the private owner column. An untaken arm is not a read: `require true or m.ordinal = 9` still predicts, and the existing `require true or receipt(...)` followed by `require false` stays `Require TERMINAL`.

Re-ran on memory and SQLite, with one server message the device never sees. All of these queued (`predictable: false`, no predicted row). The server outcome is in parentheses.

| Read | Server |
| --- | --- |
| `require m.ordinal = 1` after insert | rejects |
| `require m.ordinal = 2` | accepts |
| `m.ordinal + 0 = 1` | rejects |
| `m.recipients = 0` / `= 1` | rejects / accepts |
| `false or m.ordinal = 1` | rejects |
| `m.ordinal != null` (both sides would succeed) | accepts |
| `receipt(m)` on the fresh insert | rejects |
| `exists` on ordinal 1, hit and miss | accepts / rejects |
| read of `.lastOrdinal` / `.joinedOrdinal` | rejects / accepts |

The five round-3 `bySender` cases all queued on both stores, and the server mutated `m1`, not the device's new row:

| Write | Server texts by ordinal |
| --- | --- |
| `if m.ordinal = 1: update`, `first 20 by bySender` | `edited`, `checked` |
| same loop, `delete` | `checked` |
| `where .ordinal = 1` on `bySender`, then delete | `checked` |
| follow-up after a pending send, `if m.ordinal = 1: delete` | `alice1` |
| `if m.ordinal = 1: update`, `last 20 by bySender` under that horizon | `edited`, `checked` |

A `sum messages of .recipients` parent column is in `receipt_dependencies`. The shelf send still predicts; the follow-up that requires the total queues, and the server accepts it. A sum of ordinary `.score`, which is not in that map, still dies on the device as `NEED_TOTAL` while the server returns `Ok(5)`. That is the pre-existing private-maintain split for a non-receipt column, not a hole in this closure.

Negative control, in a scratch copy only: `observe_receipts` was made a no-op (one caller, `predict`). `generated_loops_memory` failed immediately on `select-byConversationId-first-false-update-if-false`. `deferred` panicked because the admission was `predictable: true` with two predicted message rows. Exit 101. The line was restored; the review checkout was not modified and is still `412a4d23a6`.

## Claim 2 — confirmed

With the same hidden message, these still predict, and after settlement the device matches the server on messages, reactions, conversations, members, and posts: `send`, `createConversation`, `add`, `openDirect`, two reaction upserts on a synced message, edit by id, retitle by id, a text check on the inserted row, `require true or m.ordinal = 9`, and a posts insert. The generated ordinary controls (id edit of the pending message, reaction upsert, inserted-row id reuse, text-only conditional update, and an unrelated `ROLLBACK` that stays terminal) are part of the passing receipt target.

These queue, and the report says so: a whole-row get of a conversation or a message, and `leave` (it gets the member row, which carries the floor and watermarks). A direct `update conversations[id]` still predicts. `saveProfile` also queues; that is the profiles horizon plus a unique key, not the receipts rule. None of them drop the write.

## Claim 3 — confirmed, with a count correction

`require_stable_target` is gone from the product tree. The generated file covers loops, filters, aliased selections, true comparisons on non-receipt indexes, maintained columns, conditional updates, whole-value comparisons, and `after insert` hooks. Alias, column, hook, condition, and whole-value counts match the report (16, 32, 8, 4, 6). The Rust-test count of 25 is right: 10 in `generated_dependencies.rs` and 15 in `generated_read_rule.rs`.

The loop family is not 256. The source runs four indexes × first/last × full/horizon × update/delete × if/where × same-mutation/follow-up, which is 64 per store and 128 with both stores. The report multiplies those factors to 256, so the stated extension of 322 and the total of 704 are each 128 high. The cases that matter are present and passed; the arithmetic in the report is wrong.

## Claim 4 — confirmed as far as it was re-run

The retained `receipts-final.log.gz` is 140 passed, 0 failed, in 80.69 s. Re-running that target on this tree passed those 140; the only failures were two scratch probes, later fixed (`review_gaps` then 2 passed, 0 failed). `lang-composite-final.log.gz` is 140 plus 110 passed. Re-running the guide target here was 110 passed, 0 failed, in 4.00 s. The author log has the same 110 in 4.37 s.

The full suite was not re-run, and wasm was not rebuilt. `full-suite-summary.json` records `bash scripts/test.sh`, exit 0, `== 0 failure(s) in 1305 s`, gzip 605,913, SHA-256 `4751efdc088de8abe01838faa59aacb631fd655566c794029e4e9c82a6af05c0`. `metrics/wasm-budget.json` is exactly 605,913.

An app with no receipts clause does not pay a behavior tax. After the device has a snapshot, an insert predicts and `require false` stays a terminal refusal; the wire schema omits `receipt_dependencies`. The observer installs no schema when `receipts` is empty. The byte cost is the shared wasm increase the report already measures, 1,618 B gzip over the merged baseline, inside that budget.

**Verdict: READY.**
