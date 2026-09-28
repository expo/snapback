I'll review the Following-over-a-populated-store proposal read-only, starting with the RFC, the lane brief, and the governing Following design.The RFC's claims are specific about activation, identities, and delivery. I'll check those against the governing LLPs and the code they cite.The activation refusal and the delivery rules are in place. Next I’ll check the prototype, the measurements, and the spots where adoption could leak or claim completeness too early.The empty-source rule is doing the job the RFC describes, and "start this feed now" is the right contract. The design is not ready to build: the writer fence can drop or double a receipted write, and a reader can be told the feed is complete while rows are still missing.

## What is sound

`E_TIMELINE_ACTIVATE` is a non-empty test of the three mapped tables, not a reconstruction. For a first declaration that test is right. Original ids are the post ids (`timeline.rs:94–100`). Repost ids are minted (`slots.rs:16–22`, `timeline.rs:128`). Edge epochs are `(sequence, write ordinal)` (`timeline.rs:156–161`). Backfill and delivery are split by comparing those tokens (`work.rs:74–90`). Cleanup, tombstones, and a device's acquisition floor are not in the source rows. Adding slots already forces a new generation and drops held images (`successor.rs:222–226`, `device.rs:567–572`). A same-name re-add beside a literal default does keep stale images; the fresh-namespace probe is a real counterexample.

No path in this proposal discloses a post the reader is not allowed to see. Sources, events, and tombstones are public; the inbox and work rows are private to `viewerId` (`bind/timeline.q:22–57`). Partial pages during backfill show that reader's own copies.

With the fence actually held, posts, follows, and unfollows after publication match a follow at the adoption boundary. A later follow uses the ordinary backfill. An unfollow or refollow drops the old epoch. A later birth is delivered and does not spend the 1,000. Own copies stay uncapped, as they do today.

The rejected options are real. The 1,001-versus-1,000 pair, the repost-id pair, the removed-original repost that ordinary insert refuses, the sparse planned read (5,764 examinations, heap cut, `next=null`), and the image-preservation pair are in `following_adoption_research.rs` and match `counterexamples.log`. Inferring an epoch from `.at` or from the application edge id is impossible: the admission token is not stored on `follows`, and refollow mints a new one (`online.rs:10`). A source-id-only hash collides with a purged tombstone; LLP 3000.016 already treats that reuse as normal. Copying every retained event, or only the global newest 1,000, breaks the per-actor window in `online.rs:14–18`. A live `byActorTime` walk does not terminate if new rows keep appearing older than its cursor (`work.rs:83–92`); monotone `now` does not hit that, backdated `.at` does. One activation transaction (`store/activation.rs:66`) really does throw away a crash, and it holds the engine lock the whole time (`serve_adoption.rs:181–185`).

## 1. The finding

The finding in §2 is right, with two limits.

The checker does not inspect delivery, cleanup, or devices. It refuses when `posts`, `reposts`, or `follows` is non-empty (`schema/timeline.rs:108`, `activation.rs:49–53`), and separately when an owned name already holds rows (`activation.rs:44–47`). Empty tables after a delete pass, which is correct for a view that never existed. Unchanged declarations skip the check (`activation.rs:43`). Profiles are not consulted.

Device floors are not this error's job. The diagnostic in `codes.rs:65` still says source rows cannot reconstruct original event identities. They can. The RFC's correction is the one to keep: the sentence is true for a new declaration's repost ids and for every edge epoch, and false for original ids.

## 2. Soundness

**High. A receipted write can vanish, or a retry can run twice.** §4, `serve.rs:1037–1196`, `serve_changes.rs:29–34`, `effects.rs:287–294`.

Today the mutation id is checked and executed under one hold of `shared.engine`. The fence tells that request to release the lock and wait with no receipt. `replay_mutation` finds nothing until a commit is logged, so a timeout retry admits a second waiter. Both run after publication: two posts, and two effects. The 33rd writer is not queued; admission aborts it (`serve.rs:420`).

The other direction is the catalog swap. Staging builds a replacement image of `posts` and `reposts`. Any commit that lands on the live table after S is fixed — a mutation that slipped between chunks, a maintain job, a sweep — returns success and is then thrown away by the swap. Presence itself is safe: `presence_reconnected` writes only `_effect_presence`. A job that maintains a column on `posts` is not.

Counterexample: freeze S; between chunks `update posts[p] { removed: true }` commits and the client is told it succeeded; publication installs the staged image where `p` is still live. The removal is gone, and so is the tombstone the feed needed.

Smallest fix: reserve the client mutation id durably before waiting, and execute it at most once after an authority recheck. Give fenced tables a fence epoch and refuse any other commit. Publication must fail if the live high-water of a staged table is not the manifest's.

**High. The feed reports complete while a reader's rows are missing.** §4 step 6, `timeline.rs:279–283`, `engine/mod.rs:924`, `following_adoption_research.rs:698–701`.

`complete` is cleared only when a work row exists for that reader on `byReaderPage` or `byReaderTime`, and only when the meter cut is `Cap`. The engine returns `complete: true` for an empty home with no work row. The probe hides that with a test-only facade (`following_adoption_research.rs:689–695`).

Counterexample: publication commits the edges and the new `home`, and crashes before reader B's task row is in that commit. B's paved page is an empty inbox with `complete: true`. No crash is required for the other form: `followingFeed[viewer] by byReaderActor` never consults work, so during a live roster walk it is a short page marked complete.

Smallest fix: do not publish on the init cursor. In the publication transaction, every retained edge has one task, every qualifying original has its own copy and its `done` birth row, and a reader with no task is complete only when that recount says so. Any read of that reader's feed stays pending until the task is gone, not only the two paved indexes. A missing roster parks the task; it does not exhaust it.

**Medium. Removal during the roster walk is not a new follow at that epoch.** §3 step 7, `work.rs:83–92`.

A live backfill scans current events and therefore pulls an older event into the 1,000 when a newer one is already gone. The frozen roster will not.

Counterexample: at A the actor has E1…E1001, oldest to newest. The roster is E2…E1001. E1001 is removed before it is copied. The adopted reader receives E2…E1000. A follow at the same epoch, scanned after the removal, receives E1…E1000. The adopted reader is missing E1. Posts and unfollows do not have this shape if the epoch is rechecked in the copy transaction, as §3 requires. Reusing today's backfill arm, which checks the edge once per chunk (`work.rs:84`), is safe only because a chunk is one transaction; the next chunk must recheck.

Smallest fix: keep the frozen window. Say in the normative text and on the card that a removal or unrepost during launch deletes that slot and does not refill. Delete the sentence that this is exactly a new follow except with no intervening changes; that sentence is already false as soon as a removal wins the race. Copy the roster newest-first, in `(at, eventId)` order, so a `complete: false` page is a prefix of the final page. Oldest-first shows years-old posts as the home page while the task runs.

**Medium. First adoption does not leave a device on stale slots. A snapshot taken mid-backfill can.** §2 "Device acquisition", §4, `successor.rs:222–226`, `bind/timeline.rs:126–127`.

A first-use slot is a new column, so `keeps_literal_default_images` is false and the device drops images and reacquires. Same-name re-add is the case that returns true; refusing it is correct. After publication the inbox has its own floor of 1,000 merged copies, fixed at acquisition. If the device acquires once the inbox already has 1,000 newer copies, later copies of a quiet author sort below that floor and are never acquired. The paved page is withheld when the scan crosses the floor, so it does not answer "absent". It does answer the newest held page while the server still has `complete: false`. That page is wrong if the worker has not copied newest-first.

Smallest fix: the walk order above, plus a test that a device acquiring halfway through one reader's roster either still has the work row (`complete: false`) or has every roster copy that belongs above its floor.

**Medium. Staging must not be a second replay through `mutate`.** §4, `slots.rs:16–22`, `partition.rs:684–696`.

The probe's construction is ordinary inserts on a second database. On the real store those commits append to the partition log. Replaying a repost mints a new slot for every declaration on that table, including one that already has live event ids. The RFC says not to do this, and the prototype does it anyway, so the measured path is not evidence for the safe path.

Smallest fix: staging writes are unlogged, or logged under names the predecessor schema does not stream. The replacement image copies existing engine columns and other declarations' slots unchanged and fills only the new slot. Two views over one `reposts` table are the test.

**Low. A new work-kind enum forces every device to drop images.** §4, `bind/timeline.q:41`, `successor.rs:246`.

Adding an enum variant changes `followingWork` even for apps that never adopt. `projected != old` makes `keeps_literal_default_images` false.

Smallest fix: store the launch walk as `backfill` with a roster id on the existing cursor, and bump the store version only for the manifest (`store.rs:258`).

The fence does not deadlock if the wait sits outside both `shared.engine` and the SQLite write transaction, which §4 already requires. It does deadlock if the drain waits inside today's adopt lock while `/changes` needs that same lock to record presence. Writes and receipts are stalled for the whole of initialization, not for the foreign-copy phase. That stall is bounded only because S is frozen. It is not short.

## 3. The contract

Accept it for a view that has never existed. Do not accept it as historical equivalence.

An application that already showed these posts will notice. Followers keep at most the newest 1,000 per actor as of A, not the unbounded deliveries a day-one follower would have accumulated. Own posts are all there. Nothing currently live is dropped. Repost ids, tie order, and cutoff membership differ from a feed that had been declared at the start. Nobody has those ids yet, so a first launch does not notice, including at a tie, unless two events share `.at` and the 1,000 boundary falls between them. The probe's fixture is all ties within an actor; real `now` timestamps mostly are not.

1,000 is the right window because it is the follow the product already ships (`schema/timeline.rs:11`, `online.rs:14–18`). Copying everything is unbounded. A global 1,000 hides a quiet author. A shorter window would disagree with a follow made the same day. Apps that need the old hypothetical inbox need a different import, not this switch.

## 4. Cost

The figures match the logs. They are one sample of a different program.

| | 1× | 10× |
|---|---:|---:|
| Construction, s | 127.835 | 1,699.416 |
| of which posts + reposts | 30.53 | 317.68 |
| of which follows (the foreign copies) | 73.32 | 1,111.58 |
| of which redundant delivery | 23.89 | 269.18 |
| Full process, `/usr/bin/time` | 2:15.66 | 30:56.17 |
| RSS, KiB | 17,664 | 21,504 |

Copy totals match the seed: about 48.6 events per follow, under the synchronous preview of 50, plus one own copy per event. 340,697 and 3,407,033 are that arithmetic. RSS stays near 21 MB because the writer never holds the 11 GB file. Candidate read p95 near 2 ms is a detached read against 1 ms chunks on a second database, with the reader sleeping 10 ms. The predecessor read is uncontended. I did not re-run the 1,700 s job.

Untested, and it is the number that matters: the initialization write pause. The post and repost phases are a lower sketch, about 30 s at calibration size and about 5 minutes at 10×, and they still exclude edges, rosters, validation, and the image swap. The follow phase is the part §4 says happens after the fence. 10× multiplies users, so nobody has 1,000 events and there is no hot author. No HTTP, no `/changes`, no device, no concurrent write. The Rust peaks are estimates, as the RFC says; RSS is the real process number. Do not quote 128 s or low read latency as the cost of this design.

## 5. The cheaper path

Ship the card change now. It is not a substitute for adoption, and adoption should wait on the fixes above.

The planned program in §6 runs today over populated sources. The probe read one followed post correctly, and with 9,000 newer unrelated posts it failed closed (`unavailable`, `complete: false`, `next: null`) rather than showing an empty complete page. The card never shows that program. It says declare first (`feeds.md:34`, `feeds.md:222`), mentions a planned view without a query (`feeds.md:230`, `feeds.md:248`), and tells a sparse read to use Following (`feeds.md:255`), which then refuses `E_TIMELINE_ACTIVATE`.

That query is enough for a server page over a moderate corpus. It has no per-follower inbox, no offline floor, and no bound on how many newer non-matching rows it will scan. A large social app will hit that wall. Show the query and those limits beside the refusal. Leave the refusal in place until adoption can publish without losing a write or claiming complete early.

## 6. The five questions

1. **Yes, the frozen newest 1,000 per current follow is the default.** Removals do not refill. Say so on the card. Full history is the planned query, or a later import, not this launch.

2. **Yes, but only a fence around initialization, and not on the evidence in §5.** Presence, identity, and the mutation-id reservation stay live between chunks. Measure the pause on the real init. If it is more than a few seconds, the private image has to be built without holding application writes, and the fence shrinks to the drain plus the publication transaction.

3. **Grandfather every retained repost that still has a card, including a removed card or a reply the originals branch excludes.** That is what the union says. Future repost insert stays strict (`timeline.rs:123–127`). A missing card or a self-follow is a counted refusal with sample ids. Do not skip them silently, and do not block on the first row only.

4. **No implementation past the probe until those process-death tests exist.** The swap sketch is the right shape. It is not shown. The tests in open question 4 are the gate, plus the fence-epoch check and the publication recount.

5. **Yes. Birth records must be inserted directly as `done`.** A missing one parks on `FEED_APP_NOT_FOUND` (`work.rs:87`). The probe's delivery phase is 24 s and 269 s of walks that copy nothing, because every follow is newer than the imported births. Meter those inserts. Do not promise a latency until a skewed run exists.

**NOT READY.** Accept the contract and the card fix. Do not build the publisher until a slipped write cannot erase a receipt, a retry cannot run twice, and no reader can observe `complete: true` with a missing launch row.
