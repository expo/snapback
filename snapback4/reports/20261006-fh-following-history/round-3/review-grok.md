I'll review the Following-history reader against the approved design and the operator's stalled-progress ruling, starting with the LLP, the round-1 report, and the design reviews.The checkout is the round-1 head. Next I’ll read the approved design, the round-1 report, and the two design reviews before looking at the reader itself.The brief matches this session. I’ll read §9, the round-1 report, and the design reviews, and start the reader tests while I check the code.The merge and custody code are in hand. I’ll compile the reader tests now and keep checking cursor order, the oracle, and the follow-churn phase.Auto-compacting conversation (80% full)...
Conversation compacted.
Unit tests finished cleanly. Next I’ll confirm the pass list, then run the ignored scale case and the timeline tests that share this reader.**READY WITH CHANGES.** Commit `8adc7879dd` is a correct internal prefix reader. It does not yet apply the operator's ruling that continuous post-B follow additions which block roster discovery report `stalled`.

Reviewed `547c6113bd` to `8adc7879dd` on this host (`expose-builder-pixel`), the eb1000 checkout. No other machine, no tracked edit, nothing pushed. Design is `1b40450b39` and LLP 3000.026 §9. Evidence: `reviews/fh-r1.grok.evidence/tests.txt`.

## Finding

1. **Required.** A discovery slice that stops while walking follows admitted after B still returns `preparing`. `advance` sets `obstructed` only for `Live::Later` (`session.rs:73`). An edge with `epoch > bound` advances `edge_after` and continues with that flag clear (`session.rs:135-136`). The phase is `page` if the slice is ready, otherwise `stalled` only when `obstructed`, otherwise `preparing` (`session.rs:254-266`). The churn fixture has no posts, so a later birth cannot occur, and `discovery_checkpoints_post_bound_follow_churn_without_a_false_end` accepts `Preparing | Stalled` (`matrix.rs:678`). The green test does not lock the ruling. LLP §9.4 still calls this open.

There is no false end. `discovered` stays false until `next_edge` returns `None`, the actor key moves forward, and after the additions stop the drain is an empty terminal page. The first wave, before any post-B insert, may remain `preparing`. Later waves, whose new work is only those edges, must be `stalled`. A finished page still wins. Do not mark the viewer-self skip as stalled. Tighten the test so those obstructed waves require `Stalled`, and close the §9.4 paragraph.

## What holds

**Prefix.** The viewer lane is installed in `reset_scan` before any selection. A popped lane is written to `pending`, and the next loop refills it before the page-full check and before the next winner, including across a page boundary. The fast path drops the frontier and seeks again from the last staged `(at, id)`. `history_head` on `byActorTime` is descending and exclusive (`i.k < hi`), and every unselected head is older than that cursor because `Position` orders `(at, id)` and selection always pops the greatest. Ties, a reused edge id, original removal with a surviving repost, and a purge whose birth row remains are covered by passing tests: the owned edge check requires the captured epoch, and `birth` rejects `RemovedEvents` before it trusts `Work.admitted`.

**Authority.** Selection, publication, and replay all call `read::live`: captured epoch still present, the post row still equal to the witness, not tombstoned, and `admitted` a 32-hex value at or before B. An unfollow is `LaneGone` and is not refilled. A failed publication check returns `restart` and is not committed; `request` installs only `page`, `preparing`, and `stalled`. Epochs after B never become lanes. The public document is the phase JSON. Meters stay on `Outcome`. Two worlds that differ only in private Work `status`, `error`, and `cursor`, plus another reader's edges, produce the same normalized document and the same meter. `stalled` discloses that an obstruction was hit, not the hidden row.

**Replay and custody.** Replay returns the pinned bytes after a fresh `live` check, or `restart`. It does not substitute another page. The current and previous units are kept; an older token restarts. Sessions are keyed by viewer and opening. A fifth opening is `E_FOLLOWING_QUOTA` and is not inserted. Reclaim walks deadlines one record at a time and does not evict a live peer. Cancel abandons only the named consumer. Expiry is five minutes of idle time. A lost process fails the incarnation check and restarts; it is not an empty end. The four-consumer test passed. The host must serialize `&mut` calls. An `abandoned` bit set on an uncommitted refusal fork is discarded with that fork.

**Meters.** `Budget::work` tests the cost plus the publication and checkpoint reserve before charging, and a failed discovery or refill reserve returns before `next_edge` or `next_event`. A copy-on-write reserve that fails after a seek breaks before `frontier.put`. Refused openings leave the trees and the quota unchanged. The block map is charged as `examined: block_count` and `steps: blocks * 16` at the start of a retained request. Checkpoint writes are the dirty blocks, not every block. On the 8,200-follow corpus the first request wrote 31 rows against the 1,024 ceiling, examined 8,112 against 8,192, and peaked at 17,087,232 accounted bytes against 32 MiB. The 50,000-post sparse corpus published the same 1,101 followed events as the 1,100-post corpus, with the same total meter.

**Oracle.** `Oracle` scans `feedPosts`, `feedWork`, `feedEdges`, and `feedRemovedEvents` through `store.rows` and sorts `(at, id)` descending. It does not call the reader, the index, or the activity scan. Sample 0 checks every published page; all seven samples require the full id list. It freezes edges by later epoch equality rather than re-evaluating `epoch ≤ B` itself, and it compares ids rather than the whole projection. That is enough beside the mutation tests. It is not a route or card test.

**Scope.** No server route, card projection, or SDK hook is in this commit. The new refusal texts say this milestone has no public route and does not change inbox completeness. One `feeds.md` paragraph was rewritten; it still says planned `home` is not a complete-history reader. That is not an exactness claim. Do not add one with this landing. Nothing here is a half-built route that should be reverted.

| Run | Result |
| --- | --- |
| `following_history` unit tests, scale skipped | 21/21, 1.67s |
| ignored scale, 7 samples × 3 corpora | 1/1, 66.31s |
| timeline authority and owned-id schema tests | 6/6, 0.18s |

Timeline engine sources are unchanged in this range. No full suite. Checkout target use was 4.0 GB. Tracked files were left clean.

**Verdict: READY WITH CHANGES.**
