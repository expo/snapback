I'll review the Following adoption change read-only, starting with the contract and the branch diff before checking atomicity, concurrency, and the tests.The contract is atomic launch under one writer lock. Next I’ll read the launch path and the admission checks that are supposed to enforce it.**READY.** Atomic launch matches the "start this feed now" contract. One SQLite transaction fills slots, writes births and copies, and publishes the generation. A crash before that commit leaves the predecessor, and the next start launches again from scratch.

## Atomicity and crash safety

Sound. `Store::activate_at_with_launch` (`snapback4/crates/snapback4-core/src/store/activation.rs:74`) opens one `IMMEDIATE` transaction. Inside it, in order: the writer-lock preflight (`activation.rs:111`), read-through retirement (`activation.rs:142`), `timeline_launch::build` (`activation.rs:147`), `event_slots::fill` (`activation.rs:148`), index and invariant checks, then generation metadata and `tx.commit()` (`activation.rs:288`).

`build` (`snapback4/crates/snapback4-core/src/store/timeline_launch.rs:158`) inserts events, `done` birth rows, own copies, edges, and follow copies with `INSERT`, then `record_commit` (`timeline_launch.rs:230`). Slot bytes are a raw `UPDATE` in that same transaction (`snapback4/crates/snapback4-core/src/store/event_slots.rs:48`), not a separate commit and not a partition-log row. Catalog inserts for the new tables are in the same transaction (`activation.rs:119`). Drop or error rolls the transaction back, so a crash cannot leave filled slots unpublished, copies without births, or a generation without its copies.

The process-death test exits from the commit hook before the commit returns. Reopen checks generation, sequence, post images, an empty feed, and no `following%` catalog names, then adopts successfully (`snapback4/crates/snapback4-lang/tests/following_atomic_launch.rs:177`). A retry calls `ids::mint` again (`timeline_launch.rs:160`). Nothing from the failed attempt is visible, so a repeated incarnation in the same millisecond cannot collide with a published id.

Launch-owned indexes are built by `put` and then skipped rather than deleted and rebuilt (`activation.rs:177`). The later validation pass still walks those tables because a new table's plan has `project == true` (`activation.rs:235`). `put` itself refuses an oversized index key (`snapback4/crates/snapback4-core/src/rows.rs:47`).

## The contract

Sound. For each new declaration, `build` keeps live originals (removal flag and the declaration filter) and every retained repost that still has a card (`timeline_launch.rs:167`). Original event ids are the post ids. Repost ids are `owned_id(name, "LaunchEvent", [incarnation, source role, source id])` (`timeline_launch.rs:179`), so they are not a hash of the source id alone. Same-name reuse is refused while the owned name or slot is still present (`timeline_launch.rs:87`), including after retirement, because catalog numbers are kept (`activation.rs:162`).

Every retained event gets a `delivery` work row with `status=done`, `remaining=0`, and `admitted` at `(seq, 0)`, plus an own feed copy at epoch null (`timeline_launch.rs:183`). Each follow becomes an edge at `(seq, 1)` and receives that actor's newest events from `byActorTime` descending, at most `HISTORY_WINDOW` (1000), in pages of 32 (`timeline_launch.rs:195`). The cursor keeps the key suffix after the actor and passes it as an exclusive `after` bound (`timeline_launch.rs:222`, `snapback4/crates/snapback4-core/src/rows.rs:123`). There is no backfill task, so removal purges copies and does not pull the next older event. A later follow uses an ordinary newer admission and reads those `done` births (`snapback4/crates/snapback4-core/src/engine/timeline/work.rs:87`).

`following_atomic_launch.rs:54` pins the set: all of the author's live posts, the follower's own post and repost, the other follower's newest 1000, no `p00001` after removing a copied post, a later follow of 1000, and a refollow that opens a new window. Tied times omit the lowest event id (`following_atomic_launch.rs:111`). A repost of a reply is kept and the reply's post slot is false (`following_atomic_launch.rs:123`).

## Concurrency

Sound. Adoption holds the serving-engine lock across the whole transaction (`snapback4/crates/snapback4/src/serve_adoption.rs:181`). Mutations, receipts, and `mutate` run under that same lock (`snapback4/crates/snapback4/src/serve.rs:1191`). Jobs, delivery, and sweeps take it via `engine.background()` (`snapback4/crates/snapback4/src/serve_maintenance.rs:15`). `/changes` records presence on the way in under the same lock (`snapback4/crates/snapback4/src/serve_changes.rs:29`). Lock order is engine, then readers. The sync path reads `launching_feed` and drops that guard before it waits on the engine (`snapback4/crates/snapback4/src/serve_sync.rs:36`), so it does not deadlock with maintenance.

Detached queries do not take the engine lock. They cannot see uncommitted slot bytes. After commit, a stale reader fails the generation identity check in `read_transaction` (`snapback4/crates/snapback4-core/src/store.rs:295`) instead of projecting new slot bytes with the old schema. The HTTP test holds the commit hook and checks that `/q/home` still returns the predecessor, while `/sync` and a mutation block, then the sync gets `E_SYNC_GENERATION` and the same mutation id commits once (`snapback4/crates/snapback4/tests/serve_adoption/mod.rs:4`).

`serve` does not adopt edited source. `attach_release` only opens the stored generation (`snapback4/crates/snapback4-core/src/engine/mod.rs:418`). The `allow: true` repair in `open_at` (`engine/mod.rs:407`) reactivates that stored schema when a contribution-index or cap proof is stale. It does not add a timeline, and an already-declared timeline is not launched again.

## Devices

Sound. Any new `$timeline:` slot makes `keeps_literal_default_images` false (`snapback4/crates/snapback4-core/src/successor.rs:224`), so device `adopt` clears images and the acquisition watermark (`snapback4/crates/snapback4-device/src/device.rs:567`). The native and memory-store test drops `posts` and `feedFeed`, reacquires, and only then sees the filled post slot (`snapback4/crates/snapback4-device/tests/event_slots.rs:159`). An old generation has no Following view to serve. A sync that still names it gets `E_SYNC_GENERATION`. Reintroducing the same owned name is refused, which is what blocks the stale same-name image case.

## Preflight

Sound, with the intended dev/deploy split. `check`, the unlocked admission, and the in-transaction admission all call `timeline_launch::preflight` (`timeline_launch.rs:58`). `check` and dev pass `allow=true` (`snapback4/crates/snapback4-core/src/store.rs:120`, `engine/mod.rs:338`). Deploy and rollback pass the flag (`snapback4/crates/snapback4/src/verbs/releases.rs:117` and `:131`).

| Mode | Result |
|---|---|
| dev, under the ceiling, valid sources | `check` exits 0 with `N_TIMELINE_ADOPT`; dev adopts |
| deploy without `--allow-feed-adoption` | runtime `E_TIMELINE_ACTIVATE` names the flag, the estimate, and planned `home` (`timeline_launch.rs:51`) |
| deploy with the flag, under the ceiling | adopts, and prints the estimate before the transaction (`activation.rs:69`) |
| over 5,000,000 copies | both refuse before the write transaction (`timeline_launch.rs:47`, `activation.rs:68`) |
| orphan repost, self-follow, reused owned name | both `E_TIMELINE_ACTIVATE`; dev does not adopt |

`check` does not exit 1 for a missing deploy flag. The note's rewrite says deploy needs `--allow-feed-adoption` (`snapback4/crates/snapback4/src/verbs/adoption.rs:53`). That is the round-3 split, not two different copy counts. The ceiling does not consult the flag. The estimate `(sources + 2×events + copies) / 7000` equals the reported logical row writes (493,697 at 1×). It is a hardware estimate, not a latency promise. `check` is read-only: the adoption tests compare database and WAL bytes.

Retirement uses the same pinned-time predicate as activation (`timeline_launch.rs:81`, `through_activation.rs:124`). Rows that activation will delete are not counted. The in-lock preflight runs again before catalog inserts or copies (`activation.rs:111`).

## Authorization and disclosure

Sound. Timeline sources must be public and non-expiring (`snapback4/crates/snapback4-lang/src/bind/timeline.rs:58`). Feed and edge rows are readable only by `readerId`. Birth rows are readable only by `viewerId`, which is the actor, and they do not list followers. The operator diagnostic is counts plus, on refusal, the offending repost or follow id. It does not include post bodies. It is printed on the deployer's stderr and in `check`, not returned to a viewer. Slot fills are not written to the change log.

## Test strength

**Low.** `snapback4/crates/snapback4-lang/tests/following_atomic_launch.rs:136` and `snapback4/crates/snapback4/tests/timeline_adoption.rs:420` only cross the ceiling on a quiescent store.

A mutation that deletes the in-lock preflight at `activation.rs:111` and trusts the earlier read-only call at `activation.rs:68` survives every current test. Those tests never insert a follow between the unlocked estimate and `transaction_with_behavior(Immediate)`.

Failing scenario: connection A passes the unlocked estimate at 4,999,999 copies and has not yet started the write transaction. Connection B commits one more follow of an actor who has 1,000 live events. Activation then copies 5,000,000+ rows. The ceiling promise is "known over-ceiling refuses before any candidate write."

Smallest fix: keep the second `preflight` under the writer lock, and add a test that publishes the extra follow after the unlocked estimate and asserts `E_TIMELINE_ACTIVATE`, an unchanged generation, and no committed feed rows.

A second, weaker hole: swapping the birth ordinal and the edge ordinal at `timeline_launch.rs:162` still passes. Later follows only require the launch sequence to be less than the next transaction's sequence. Nothing posts a new event afterward and asserts that an existing launch follower receives it. That swap does not break today's launch, because those `done` rows are not replayed.

## Verdict

**READY.** Ship the atomic launch. The online publisher in LLP 3000.026 §8 is still unbuilt, as required. I did not recompile or re-run the suite in this worktree; the conclusion is from the transaction boundary, the launch loop, and the tests as written.
