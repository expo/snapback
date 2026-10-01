You are lane RY of Snapback 4, round 4, in `~/sb4-intent/lane-ry` (branch `sb4-intent/ry-receipts-allocation`). Rounds 0–3 are your own work: read their prompts and reports, whose rules still bind you.

**Reviews of round 3.** Astra: NOT READY (`~/sb4-intent/reviews/ry-r3.astra.md`). Grok: READY WITH CHANGES (the same High as Astra's first finding) (`~/sb4-intent/reviews/ry-r3.grok.md`). Read both in full. Astra confirmed:
- the 14 earlier witnesses and controls;
- all 120 ordinal-target scenarios and 30 other owned-key scenarios;
- all 382 generated scenarios (disabling the observer fails six tests);
- the full-suite evidence and the wasm reasoning;
- that sends, creates, joins, edits by id and reaction upserts still predict.

Two escapes remain (reproductions at `/tmp/ry-r3-astra-rr3habhe/snapback4/crates/snapback4-lang/tests/declarative_receipts/review.rs`):

1. **(Astra P1) Target selection that tests receipt accounting after the key lookup predicts the wrong row.**
   - A loop `for target in messages where .conversation = conversation first 20 by .id: if target.ordinal = 1: update messages[target] {…}` stays `predictable: true`. The device edits its own new message, while the server edits the competing one.
   - The aliased selection `messages[id = subject, ordinal = 1]` predicts an edit that the server refuses as `MISSING`.

   The dependency is recorded, but a successful prediction bypasses the refusal guard.
2. **(Astra P2) A maintained column derived from receipt accounting drops a valid follow-up.** With `shelves.total` declared as `sum messages of .recipients by .shelf`, requiring `p.total > 0` after a send is refused terminally on both stores, although the server accepts it. The table classifier covers aggregate-view targets but not maintained parent columns.

**The rule for this round, which is the simplest correct one.** Any read of clause-owned state, or of state derived from it, by the mutation's own code during prediction makes the whole mutation unpredictable: queued without a row (`predictable: false`), whether the prediction would succeed or fail. Clause-owned state covers a receipt counter, ordinal, floor, recipient count and receipt state, however it is read. Derived state covers maintained columns and aggregates whose predicate, key or contribution reads clause-owned fields, transitively; taint them at schema time. Only the allocator's own internal reads, which compute a send's or join's provisional values, are exempt, so ordinary sends, creates, joins, edits by id and reaction upserts keep predicting. Delete any per-reader special cases that this rule makes redundant, and extend the generated-case test with loops, filters, aliased selections, maintained columns and `after insert` hooks that read clause-owned or derived state.
3. **(Grok High, the same class) Grok's table (`ry-r3.grok.md`)** reproduces the escape through a non-receipt index (`bySender`) with a residual `if m.ordinal = 1` or `where … .ordinal = 1`, in five ways: update, delete, a filter with delete, a follow-up after a pending send, and `last 20 by bySender` under a horizon on that index. Each has the device acting on its own new row while the server acts on `m1`. Grok also notes that the generated ordinal cases only address `messages[conversation, N]`, and that `generated_reads` compares `m.ordinal = 2`, which is false on the device. Add true comparisons on non-receipt indexes, and loops over any index, to the generated test. Under the rule above, every one of Grok's five cases must queue (`predictable: false`) and match the server after settlement.
`main` has moved: merge `origin/main` first, keeping both sides (set the wasm budget to the measured merged size, with reasons). Run your affected tests, the whole guide, and `scripts/test.sh` once. Report its exact summary line and every failure, marking each as yours, baseline or environmental. Report the wasm size. Write the report under `round4/`, update LLP 3000.022 §14 with the rule, append one journal entry, and commit with the co-author trailer. Push and publish nothing.
