I'll review the PQ round-7 merge against both lanes' rules, read-only, starting with the report, prior rounds, and the diff from `main`.The review stays read-only and in this message. Next I’ll pull the round-7 report, earlier PQ reviews, and the exact diff against `main`.The merge parents are PQ `6b71b7379` and main `78bcc92c8`. I’ll read the conflicted observation and scheduling paths against both rule sets.Auto-compacting conversation (80% full)...
Conversation compacted.
I'll lock the exact lines for the merge fences and the tests that are supposed to catch them, then write the review.**READY WITH CHANGES.** The merge keeps both policies: plain revalidation stays unbounded and keeps the row, and change evidence is bounded only when the attempt actually starts. One recovery hole blanks disjoint local rows after an omitted `/changes` table list. It is inherited from `main`, and this branch’s §10 now promises those watches a later answer.

## Findings

**Medium.** `snapback4/packages/snapback4/src/local.ts:1010` (with `local.ts:767-768` and `local-reads.ts:173-175`). Already the same bare `return` on `main`.

A `/changes` message with **no** `tables` field sets `changeCut` on every watch (`local.ts:840`). A locally complete query for some other table then returns that replica row. `current()` rejects it because it is not `serverOnly` at the cut, and the attempt returns **without** `dirty`, so nothing is queued. Sync then applies the real footprint, `applied()` clears every cut whose watermark has arrived, and `finally` reschedules only watches in that footprint (or with an empty table set). The disjoint watch is still `revalidating` with the right row. About a second later the episode replaces it with `loading`, and nothing reads it again.

Failing case: `profile` reads `profiles`, `item` reads `messages`. The server sends `{ seq: N }` and omits `tables`. Sync’s page touches only `messages`. `item` is replaced. `profile` goes from the retained row to `loading` and stays there. An explicit table list, or `tables: []`, does not do this. A server-executed query can still publish if its `seq` is at the cut.

Smallest fix: on that rejection set `watch.dirty = true` before returning, matching the other fences in `rerun`. The next attempt publishes once `applied()` has cleared the cut. Use the existing paced `readWork.retry` if an immediate retry is too hot while sync is behind.

**Low.** `snapback4/packages/snapback4/src/client.ts:716-721` and `client.ts:740`.

An online body whose `nextExpiry` is already past fails `currentRead`. `fetch` rejects that four times, calls `failed()`, and returns `retryExhausted` (`read-observation.ts:93-95`). `refresh` sets `exhausted` before the due-body guard, and `finally` will not start `retryExpired` while `exhausted` is set. The identity check would not fire anyway: `copyAnswer` keeps identity (`read-observation.ts:13`), and an already revalidating snapshot is the same object (`read-observation.ts:28`). The row stays `revalidating` with the old data, which is what plain retry exhaustion requires, but the observation never tries again unless something else schedules it. No `refresh` interval means it stays there.

Smallest fix: for a past `nextExpiry` only, do not call `failed()` or set `retryExhausted` inside `fetch`. Let `refresh` set `retryExpired` and pace `readWork.retry`. Drop the `answerIdentity !== startedWith` condition.

## Tests

RL’s schedule cases and PQ’s queue cases still cover the guards they were written for. Deleting `if (watch.kept) watch.reload()` at `local.ts:999` fails `per-row-inflight.test.mjs` (deadline stays unset until a slot opens). Deleting either presence `changeVersion` check (`local.ts:959` or `:962`) fails `per-row-boundaries.test.mjs`. Deleting `!answers.current` at `local.ts:1010` fails `answers-stay-round2.test.mjs` (the old replica would settle).

One mutation still passes. Delete `resetVersion !== watch.resetVersion || changeVersion !== watch.changeVersion` from the early return at `local.ts:1004` and leave the same comparisons in the publish callback at `local.ts:1012`. `per-row-inflight.test.mjs` bumps `changeVersion` inside the `expiredRetries` setter, and that assignment is `local.ts:1009`, after the early return and before the callback. The callback still refuses the body, so the test stays green. What changes is reschedule: the callback path sets `retryExpired` (backoff) instead of the early path’s immediate `dirty` retry.

`answers.current` treating a denial as current is deliberate (`answers-stay-round2.test.mjs:24`), not a hole.

I did not re-run tests. `snapback4/packages/snapback4/dist` is not in this worktree, and the tests import it. The report’s 740/740 and 300/300 are the author’s claim, not something this review executed. The one full `scripts/test.sh` they reported is red (exit 1): six `retention-episode` cases loaded the old enqueue-time deadline assertions. The file on this tree expects no deadline until `watch.reload()` (`retention-episode.test.mjs:288-290`), which matches `reload(..., { queued: true })`. They say the corrected file was 65/65 and that no runtime source changed during that run. That is still a red full run, not an all-green tree.

## What is sound

Plain versus change is intact. `reload` records `changePending` even when queued, and `beginEpisode` runs only for `!queued && changePending` (`read-observation.ts:120-129`). An existing deadline does not move (`read-episode.ts:10-12`). Queue wait does not burn the second. `failed()` keeps identity, the original `since`, and `fresh: false` when offline, and a queued failure does not start an episode (`read-observation.ts:136-146`). `keep: false` still goes straight to `loading`. Both retaining policies share the change bound.

The eight-start / eight-active queue, cancel, and the 30s lifetime abort are in `read-work.ts`. A full queue still marks `revalidating` (or `loading` if not retaining) before a slot exists.

Durable and ephemeral notifications and mutation receipts call `scheduleRead(watch, true)` after raising `minimumReadSeq` or the ephemeral floor (`client.ts:818-831`, `:860-868`, `ephemeral-reads.ts:94-98`). Reconnect, refetch, sampling (`invalidate(false, false)`), and credential refresh stay plain. Online presence does not have a change version. It does not need one for those paths: `currentRead` requires `seq >= minimumReadSeq` and `ephemeralReads.accept` (`client.ts:599-604`, `:667-672`), so a second change while the snapshot object is unchanged still cannot publish the older body.

Local `/changes` bumps `changeVersion` and `changeCut` together (`local-reads.ts:160-164`). Presence checks both the captured version and `answers.current` (`local.ts:959-962`). Commits bump authority and mark a queued change; they do not bump the version, and in-flight publication still loses on `answers.revision`. A generation change calls `observeIncarnation` before the table filter, with force (`local.ts:833-834`). That clears answers and sets `partitionCurrent` false, so the follow-up read takes the server path (`local-query.ts:269-271`) and does not answer from the old replica. Explicit `[]` still intersects nothing. Empty versus omitted is preserved on both clients.

Membership removal stays `revalidating` until a server answer at the cut, sync applies it, or the episode withdraws. An old replica row does not settle it, and it does not come back after withdrawal.

No High finding. Nothing here drops either lane’s rule or publishes a pre-change row through an unfenced path. The Medium above is the change to make before landing.
