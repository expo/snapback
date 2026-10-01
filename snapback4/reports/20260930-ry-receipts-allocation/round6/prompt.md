You are lane RY of Snapback 4, round 6, in `~/sb4-intent/lane-ry` (branch `sb4-intent/ry-receipts-allocation`). Rounds 0–5 are your own work: read their prompts and reports, whose rules still bind you except where this prompt changes the design.

**Review of round 5.** Astra: NOT READY (`~/sb4-intent/reviews/ry-r5.astra.md`); read it in full. Taint closed every earlier reproduction family, but its own machinery caused two new problems:
- **P1:** taint bookkeeping can exhaust the heap budget before a decision registers the dependency, so a valid write gets a terminal `E_BOUND` and is dropped. The server accepts it at 8.2 MB of heap.
- **P2:** apps *without* a receipts clause pay unmetered linear traversal. Counting an array 2,000 times went from 0.71 ms to 12–23.5 ms.

The runtime approach has now cost six rounds. Each round closed one path and opened another, and round 5 added about 11 KB of wasm and runtime overhead for every app.

**Design pivot for this round: replace runtime detection with static classification.** Prediction stays where it is safe and simple, and the rest goes to the server.

1. **At compile time**, classify a mutation as server-only (`predicts: never`, queued without a row) if its code, transitively through helpers it calls:
   - reads any clause-owned field (ordinal, floor, recipient count, receipt state, the scope counter), or calls a receipt builtin (`receipt()`, `progress()`, `receiptMember()`);
   - reads a maintained column or aggregate derived from clause-owned fields, tainted transitively at schema time as in round 4;
   - uses a whole record or row of a receipts-clause table in a value context other than reading a non-clause field: passing it to a builtin (`share`, `min`/`max`, `group`, comparisons, collection construction) or returning it;
   - selects a write target by a key that includes a clause-owned field, or filters, loops or branches on one.

   `check` prints one note per such mutation, naming the first reason and its location, and `why <op>` explains it. An explicit `predicts:` assertion on such a mutation is refused with `E_NOT_PREDICTABLE` and the reason.
2. **At runtime, remove the round-5 taint machinery** (the `value.rs` wrapper charges, `receipt_taint.rs` and the count-path traversal), and the round-3/4 runtime observers where the static rule makes them unnecessary. Keep only the allocator: sends, joins and creates still predict their own rows with provisional clause-owned values, displayed as pending and excluded from accounting as in round 1. A predicted mutation is now one that provably never reads those values.
3. **Keep a runtime backstop** in the device admission path for anything the static analysis cannot see, if any such path exists (for example, a dynamic field name). It must preserve queue custody on any resource or refusal error once clause-owned state was touched, with no per-value bookkeeping. Document what it covers.
4. **Measure:** wasm must drop back near round 4's size or below, so report the delta against main. Count-path and ordinary-query timings for apps without receipts must match main.

## Tests

- Port every reproduction family from rounds 1–5 (both reviewers'), including `share()`, compound `min`/`max`/`group`, loops and aliased selections on non-receipt indexes, maintained parent columns, and Astra's heap-exhaustion case, to compile-time assertions (the mutation is `predicts: never` with the right note) plus runtime assertions (it queues, and the server result matches).
- Ordinary flows still predict: sends, creates, joins, edits by id, reaction upserts, and clean inserted-field use.
- An app without a receipts clause has identical classification, wasm-path behaviour and timings to main.

`main` has moved (the wasm budget is now 599,000 B). Merge `origin/main` first, keeping both sides, and set the budget to the measured merged size plus about 500 B of cross-host headroom, with the reason. Run your affected tests, the whole guide, and `scripts/test.sh` once. Report its exact summary line and every failure, marking each as yours, baseline or environmental. Write the report under `round6/`, update LLP 3000.022 §14 with the static rule (and why runtime taint was dropped), append one journal entry, and commit with the co-author trailer. Push and publish nothing.
