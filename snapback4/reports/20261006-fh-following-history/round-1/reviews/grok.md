I'll review the FH Following-history design against LLP 3000.026 §9, the lane report, and the code those documents cite. First I'll locate the draft, the report, and the eb1000 checkout constraints.The draft and the lane report are in this checkout. I'll read §9 and the report next, then check every claim they make against the code.§9 and the report describe a resumable server-side merge over the per-author event index. I'll check those claims against the reader, meters, follow window, and the LLPs they cite.The k-way traversal is the right engine. Section 9 is not sound to implement as written, and option A is the wrong handoff.

**Verdict: APPROVE WITH CHANGES.**

Checked against this checkout (`1b40450b39` on `547c6113bd`): LLP 3000.026 §9, the FH report, `following_history_research.rs`, `research-cpu2.log`, `certificate.txt`, the timeline binder and engine, the meter, and `usePage`. I did not rebuild or re-run the suite. There is no reader to execute, and the lane's own log already records the three counterexamples.

## 1. Is §9 sound?

The diagnosis matches the code. The planned reader is a union scan plus a follow filter, not an author-head merge. `Ceilings::default` is 8,192 examinations, 16,384 index entries, 8,192 probes, 1,000,000 steps, 16 MiB heap, 1 MiB output, and 1,024 rows written. The sparse run dies on heap at 5,789 examinations and 16,777,476 bytes, with `data` null and no `next`. The indexed control's seven meter fields stay identical after 48,900 unrelated posts. `author_cap` and `edge_cap` are serialization defaults, not admission limits. `HISTORY_WINDOW` is 1,000: 50 copied in the follow transaction, up to 950 more pre-admission, newest 1,000 per edge at launch, and a separate 1,000-row device inbox floor. Self-follow is refused. Removal writes a public tombstone and deletes the event in the same transition, and it does not refill the window. `usePage` ANDs `complete` across pages and only continues when `next` is set, so a cut with no `next` sticks as a stopped incomplete list. Its own comment says deduplication cannot recover a row an old boundary skipped. A result cache is on the not-doing list. The guide's limitation paragraph matches this and does not advertise the unbuilt reader.

The publish rule is also right: no ordered page until every eligible lane has a validated head or a proven end, checkpoint the frontier rather than the last emitted row, and do not let the client supply authors, heads, or a meter ledger.

These holes should be closed in the spec before anyone writes the reader.

**Birth is a point probe, not a fence.** Event rows in `@T@Posts` have `(actorId, at, id)` and no admission column. Birth is the delivery `Work.admitted` token (`timeline_admission`: sequence plus write ordinal). Launch writes that row with `viewerId` equal to the author, and `Work` is readable only by that viewer. A follower-level query cannot see it. An engine-internal probe can, but `byActorTime` still returns later births, and each one must be visited. Section 9.4 admits this does not prove finite completion. Section 9.5's certificate sentence drops that caveat. Caller-supplied `at` is legal (`at: time`, immutable, not required to be `now`), and the engine already special-cases clock rewind for queue position. A followed author who inserts older timestamps into the unscanned range can stall a session forever. Skipping those rows is correct. Claiming the scan finishes is not.

**"Edges at opening" and "any membership change restarts" contradict each other.** A new follow gets a new epoch. Restarting discovery on every follow means an active graph never finishes, which is normal use, not an adversary. Unfollow is different: the inbox predicate already hides a copy when `Edges[viewer, actor, epoch]` misses, even if cleanup has not deleted it. Losing an edge that this session already opened must not publish another page. A new edge must not.

**Replay identity, fresh cards, and revalidation disagree.** The same token cannot both be byte-identical and re-read card bodies. Pin the shaped bytes. On replay, recheck authority. If it still holds, return the pinned bytes. If it does not, restart the revision. Do not rewrite the page in place.

**The token's job is ambiguous.** One token cannot both name the session and mean "give me the next page," or a lost response consumes a second page. The page token names one unit. Replaying it returns that unit. The `next` token names the following unit. Advancement and the stored response commit together.

**The meter cannot reserve by charging.** `Meter::charge` adds, then returns false, and the charge stays. The 8,200-follow control ends at 16,385 examinations because head seeks still run after discovery has capped (`word_merge.rs` opens heads before `opened_all`). "Reserve the unit, then take it" needs a preflight that leaves the ledger and the frontier unchanged. Frontier writes have to hit this request's 1,024-row ceiling, not the unbounded maintenance meter. The 16 MiB figure is an accounting charge, not a process RSS cap.

**An oversized card stalls the lane.** One shaped row that cannot fit in 1 MiB can never be emitted. Refusal has to move the cursor past that key with a named omission, or the session retries the same head until expiry.

**Progress counts are a new disclosure channel.** Tombstones and posts are public. Another viewer's edges, and any future block list the viewer cannot read, are not. A count of lanes opened, candidates rejected, or examinations spent differs across worlds that should look the same. Progress should be a phase (`preparing`, `page`, `restart`, `refused`), with no tallies. `Work` probes and unpublished heads stay server-side.

**Blocks are not part of Following.** Naming a `blocks` table does nothing. The inbox filter is "actor is the viewer, or the copy's edge epoch still exists, and the event is not tombstoned." History must use that predicate, extended to older live events born at or before B. A block rule applied only to history will fight the inbox. Add a block to both in one change, or to neither.

**Removal versus birth lifetime.** The delivery `Work` row survives until purge. "Birth record exists" does not mean the event is live. A buffered head has to die on a missing event or a tombstone, and a purged birth must not resurrect it. Original ids are not reused. Repost event ids are minted. Edge source ids are reused, and that already starts a new epoch. The session has to store the edge epoch, not the application edge id.

## 2. Option A, option B, or something simpler?

Neither A nor B. Use the traversal as the only online chronology.

The 101 missing hot events sit between hot-102 and quiet's time 0. They are above the inbox tail and inside the order the user already scrolled. Option A re-reads the whole overlap from the newest event, then inserts into that hole. `usePage` cannot do it. The planned `activity` projection is the wrong key: originals use the post id, reposts use `postId`, while the inbox shape renames `eventId` to `id`. Declaration event ids match. Activity ids do not. Anchor preservation is a list-widget problem, not an engine result. It also cannot be made append-only.

Option B is the right publish rule attached to the wrong object. Refusing an unproven prefix is correct. Holding the copied inbox back until history setup finishes gives up the fast path to avoid a seam you should not build.

A "complete down to" mark on the inbox is not a fix. Per author, the launch window is a prefix of that author's live events only until a later backdated delivery or a new follow. Globally, the quiet event at time 0 is inside the inbox and below the prolific author's floor, which is the bug itself. The mark would be the max of per-author cutoffs, and only after backfill is done. The client would have to hide inbox rows below it. A new follow raises the mark and punches a hole. The device floor is a different 1,000 merged rows, so the device cannot certify the server's mark.

The smaller correct design is the one you sketched, tightened:

- Online, every history page is the exact merge. If this follow set's discovery and one page fit in one request, that response is the page and no frontier row is written.
- If discovery hits a meter, return `preparing` and resume. Still publish no rows until every lane has a head or a proven end.
- Do not pass an inbox cursor in. Do not reconcile the copy window under this list.
- Events born after B are a live prepend owned by the hook, not members of the history domain. A new follow's recent deliveries can prepend the same way. Their older events wait for the next session.
- Offline, keep today's inbox and withhold history. No fabricated heads.

That is B's correctness condition, the one-request fast path when the graph fits, and no client splice. First paint for a large graph waits on preparation instead of showing a false prefix. That wait is the honest cost of an uncapped follow set.

## 3. Who owns the handoff?

The SDK, in a Following-specific hook generated from the view the builder already declares. Not the application. Not `usePage`.

`usePage` keeps an incompleteness bit forever, stops when `next` is absent, and dedupes only compiler-proved source row ids. Preparation must be polled by the hook. `loadMore` will not poll it. Feeding `complete: false` with no `next` into `usePage` makes a spinner that never continues, or, if someone invents a `next`, a list that never becomes complete.

The hook can be invisible online: the builder renders `items` and a loading state, and does not see tokens, lanes, or checkpoints. Empty and preparing have to be different. The existing guide already says not to treat `data.length === 0` as "no posts" while the page is unsettled. Use a distinct preparing status so that rule stays true.

It cannot be invisible offline without lying. The hook should expose one fact, such as history being unavailable on this device, and the stock UI should say that older posts are not on this device. The builder still should not write the merge.

Server history must not replace an unobserved local own-post. That fence stays in front of the server result.

## 4. What has to be proved?

Section 9.5 is the right kind of matrix and the wrong oracle in one place. Do not prove equivalence to the planned `activity` scan. That scan has different repost identity and is the reader that already fails closed. The oracle is an independent scan of `@T@Posts` for the frozen domain: viewer lane plus edges with epoch at or before the session bound, live events, `admitted ≤ B`, order `(at, eventId)` descending, ties included.

Keep these, and make them tests of the real reader:

- Originals, reposts, removal without refill, tombstone still present while `Work` remains, purge, refollow with a reused edge id, no self-follow double lane.
- Cuts during discovery, mid-lane rejection, and shaping. A cut publishes no prefix and no `next` that skips a head. More than 8,192 authors resumes. Unrelated posts do not change the meter. Frontier writes stay within 1,024 rows and the heap charge, with no second wave of failed charges.
- Replay returns the pinned page. A lost response does not advance twice. Expiry, crash, wrong viewer, wrong store incarnation, wrong schema generation, and wrong page size are restarts, never an empty success. Quota exhaustion is a named refusal.
- Births after B never appear. Unfollow drops the lane on the next publish. A new follow does not restart the open domain.
- Pending own-post routing stays in front of the server page.
- The inbox query's bytes and certificates stay as they are. The new certificate is not issued until the tests pass. The guide keeps today's limitation until then.

Add:

- The progress document is phase-only, and worlds that differ only in hidden rows produce the same progress.
- An oversized row is a named continuation past that key, not a stuck head.
- A birth probe is not visible to the client.
- If the certificate says "complete," a continuous backdated insert into the unscanned range must finish. Otherwise the certificate says completion is not finite under that load, and a test shows checkpointed key progress and a distinct stalled refusal rather than a false end.
- The one-active-session rule, whichever limit you pick, including a second device.

Defer, for a server-only landing: device-store parity, wasm execution of the traversal, and option A's seam tests. Replace those with "the inbox is unchanged" and "an inbox cursor is not a history cursor." The 130-byte macOS wasm allowance is a release check if the binary changes, not evidence the reader is exact. A new engine table still needs an old-engine refusal. That is a format test, not a history oracle.

Drop "source-scan equivalence" as stated. It will send the implementer at the wrong identity.

## 5. What can be cut?

Server-only first, with no device traversal, does not lose online completeness. The device withholds and routes online, and it must not invent heads from source floors. Offline stays the inbox and says so.

Do not cut resumable discovery, or large graphs silently lose authors. Do not add a follow cap. Do not cut the birth bound, the epoch check, or idempotent checkpoints. Do cut option A's reconciler, any client-held frontier, and block filtering that the inbox does not also apply.

Finite completion still needs a decision in this spec, not a later patch. Point probes on `byActorTime` are not that mechanism. Pick one and write it down before coding:

- Prefer a fenced engine-owned enumeration, outside the Timeline v2 catalog, that can seek the next `(at, eventId)` among `admitted ≤ B` without visiting later births. Old engines refuse the store.
- Or keep the skip-and-checkpoint scan, and do not say the history is finitely complete while an author can insert older `at` values.

Holding a SQLite snapshot open across requests, or copying every eligible key into the session, fails the custody rules you already cited. Quotas and idle lifetime are part of the same decision: one small number of sessions per viewer, an idle expiry that restarts rather than ending the feed, a byte quota on frontier state, and a named refusal when it is exhausted. Section 9 already says not to code those as improvisation. Approval should keep that gate.

## Changes to make before implementation

1. Adopt the online exact reader above. Reject option A. Do not splice the copy window. Leave option B's publish rule, and drop its requirement to delay the inbox.
2. Put finite birth enumeration, or an explicit non-finite certificate, in the approved spec. Name `Work.admitted` as the birth, read it inside the engine, and do not treat it as liveness.
3. Freeze edges with epoch at or before the session bound. Invalidate on loss of an opened edge, a tombstone, or a visibility revocation. Do not restart on a new follow.
4. Specify the page token, pinned bytes, and restart-on-recheck. Preflight meters so a refused unit writes nothing and does not keep the failed charge.
5. Publish phase-only progress. No rejection or lane counts.
6. Give the SDK hook the session. Keep it out of `usePage` and out of application code.
7. Fix the §9.5 oracle and add the cases above. Land server-only. Qualify the real reader before any certificate or guide sentence says the history is exact.
