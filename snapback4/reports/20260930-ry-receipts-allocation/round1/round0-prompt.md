You are lane RY of Snapback 4, round 0, in `~/sb4-intent/lane-ry` (branch `sb4-intent/ry-receipts-allocation`, from `main`). You continue lane RX's receipts clause (merged as dcc785038a; LLP 3000.022 §14, and §14.5 lists this work) in `crates/snapback4-lang` (binder and receipts templates), the engine and the social starter.

## The problem

Calibration #27 scored `data_modeling` 87, noting that "M3 receipts required explicit ordinals, delivered runs, read positions, and membership accounting". RX's clause now generates delivered runs, read positions and member watermarks:

  receipts by .conversation, .ordinal from .sender to members

The application still has to do three things itself, in its own mutations:
1. allocate `.ordinal` per conversation on every send;
2. capture recipient counts;
3. stamp join floors when a member joins, so the member's receipts start at the right position.

The social starter shows all three (`crates/snapback4/src/verbs/init/social/schema.q`), and a builder writing their own messenger must discover and reproduce them.

## What to do

1. **Automatic ordinal allocation.** With the clause, inserting a message without an ordinal allocates the next ordinal in its group atomically, within the insert's transaction, metered. Concurrent inserts must never duplicate or skip. Decide, and document, what prediction does: a device cannot know the server's next ordinal. The usual answer is a provisional local position that settlement replaces, but choose what keeps history ordering and receipts honest offline, and prove it. An explicit ordinal written by the application is refused, or allowed only where it cannot conflict. Choose, and say why.
2. **Join floors.** A member added to a group starts at the group's current high ordinal, so they are never charged for history before they joined. The clause stamps this on member insert. Removal and rejoin work as RX's retirement already does.
3. **Recipient counts.** Whatever the projection needs, such as how many members should receive a message, is captured by the clause at send time, from the membership at that moment.
4. **The social starter** uses only the clause: remove its hand-written allocation, floor and count code. Report the before and after line counts.

Keep RX's guarantees: no invented delivery, the live-blocker rules, metered compaction, authority, fingerprints (bump the semantic version if generated semantics change), and generated names that authored code cannot capture.

## Tests

- A concurrency model over interleaved sends, joins, leaves, rejoins and deliveries, on the server and on both device stores, checking ordinals, floors, counts and projections against a reference.
- Offline sends on two devices that reconnect: ordering and receipts converge exactly once.
- The starter's M3-style receipt scenario end to end.

Run your affected tests, the whole guide, and `scripts/test.sh` once. Report its exact summary line and every failure, marking each as yours, baseline or environmental. Report the wasm size; the budget in `metrics/wasm-budget.json` is a ratchet, so raise it in the same commit, with the reason, only if you must. Write the report under `snapback4/reports/20260930-ry-receipts-allocation/`, append one journal entry, record the decisions in LLP 3000.022 §14, and commit with the trailer `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Push and publish nothing.
