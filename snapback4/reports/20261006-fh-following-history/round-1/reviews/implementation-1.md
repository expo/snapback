# Internal implementation review 1

Provenance: fresh same-family agent `/root/fh_internal_review`, 2026-10-06.
Read-only review in this lane; no tests, builds, edits, other worktrees or hosts.
The following is its delivered verdict and findings. Line references refer to
source at the time of review, before the subsequent custody fixes.

Verdict: **REQUEST CHANGES** for the internal metadata-reader milestone. No builds or tests were run; findings come from source review.

1. **Opening replay can become a different unit after reclamation.**
   In following_history.rs:364, an absent session with `token: None` is treated as a new opening whenever the controller prefix matches. Reclamation (session.rs:381) deletes the only record distinguishing an accepted opening from a new one. Reproduce: accept an opening, expire or cancel it, reclaim completely, insert an event, replay the original opening request. It opens at a new B instead of returning `restart`. Likewise, the same accepted opening with another viewer and `token: None` opens a second unit. Issued-opening custody must survive logically without unbounded tombstones; unknown or reclaimed openings must restart. Add both regression tests.

2. **Rewind detection only compares against the opening head.**
   following_history.rs:343 checks `head < s.head`, but `s.head` is never advanced after opening. A session that observed later commits accepts a same-incarnation rewind to a sequence between B and its latest observed head. Restored rows can invalidate retained ends and skipped positions. Track the highest observed head separately from frozen B, update it on accepted work/replay, and test a rewind after an observed later commit. Same/higher-sequence store replacement still requires host incarnation invalidation.

3. **New follows can obstruct discovery indefinitely without `stalled`.**
   session.rs:126–136 scans current `Edges.byPair`, advances its actor key, and ignores epochs above B. Continually adding post-B follows into the unscanned range can keep a fixed pre-B domain in `preparing` indefinitely. This is analogous to backdated event insertion, but current obstruction tracking covers only events. Report the obstruction, test strict checkpoint progress and eventual completion after additions stop, and qualify the design’s termination statement accordingly. The author’s stated exception currently names only event backdating.

4. **Terminal empty-token forgery — fixed during review, regression still needed.**
   session.rs:344 stores an empty pending token after terminal output. Originally `Some("")` matched and advanced an unissued unit. The newly added token-format check at following_history.rs:285 closes that path by inspection. Keep a terminal-page regression proving malformed tokens restart without altering valid replay.

The core prefix construction otherwise looks sound for this scope: discovery precedes selection, a lane refill precedes the next winner, and staged/replayed metadata is checked against current epoch, live event, tombstone and admission. The seven-dimensional reservation and copy-on-write structure provide a plausible bounded foundation; no persisted table/catalog changes were found. Deferred shaping, transport and SDK work are clearly identified rather than claimed implemented.

Minor correction: the `SESSION_BASE` comment says nominal event IDs lack principal-width bounds, but `engine/validate.rs:65` invokes `validate_identities` for every column; `value.rs:386–401` bounds all `Value::Id` values to 144 tagged bytes. The reservation may remain conservative, but its rationale should be accurate.
