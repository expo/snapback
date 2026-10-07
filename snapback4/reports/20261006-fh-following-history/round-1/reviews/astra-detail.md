# FH design review

Verdict: **APPROVE WITH CHANGES**.

Reviewed head `1b40450b39a3cf5479bbe6c1f7bff3fc878eb0a6` on base
`547c6113bdab6a68c3b8628d79fa6c0b6eb0ce53`. This reviews LLP 3000.026 §9 and
the FH report as a design, not a production implementation. Work stayed on
eb1000 (`expose-builder-pixel`), in the supplied detached checkout. No lane
files changed and nothing was pushed. No other machine or agent was used.

The bounded per-author merge is a sound direction. I recommend making it the
reader from the first online Following page, with resumable setup when the
request budget runs out. Do not make the ordinary builder compose an inbox and
a historical query. Before coding, resolve the publication, authorization,
replay and lifecycle contracts below. Approval of the direction is conditional
on those changes; the current draft is not a complete protocol specification.

## 1. Findings against the code

The diagnosis is accurate. `engine/view_merge.rs:86` requests page-size-plus-one
survivors from each source branch, then sorts projections and adds branch
identity to the position. It does not discover followed actors. The research
control exercises the different `word_merge.rs` path; that path opens all lanes
before it has an ordered prefix and does not persist unfinished discovery.

`bind/timeline.q:1` defines the existing public `(actorId, at, id)` event index.
`timeline/online.rs:6` copies 50 immediately and schedules the rest of the
1,000-event window. `store/timeline_launch.rs:202` copies at most 1,000 per
current edge on launch. Nothing in these mechanisms proves the inbox is one
complete global time prefix. The reproduced quiet-at-0 / hot-at-1-through-1101
case is a decisive counterexample to handing off below the inbox tail.

`bind/timeline.rs:165` checks current edge epoch and removal tombstone for
ordinary inbox reads; its projection deliberately maps `id` to `eventId`.
The new reader must use that declaration-specific event identity, not the
source repost ID, underlying inbox row ID, post/card ID, or plain activity
union branch cursor. Two repost events of the same card are different events.

Existing birth witnesses really do exist, but are not ordinary public event
columns: delivery Work rows retain `admitted` after becoming done
(`timeline/work.rs:148`). Their IDs are derived from declaration/actor/event;
launch constructs equivalent witnesses (`store/timeline_launch.rs:183`).
`bind/timeline.q:41` makes Work readable only to its `viewerId`, which is the
event actor for delivery work. Reading another actor's birth witness therefore
needs a narrowly scoped internal mechanism and lawful accounting, not an
ordinary caller read or blanket system execution of the query.

`react-pages.ts:38` owns a chain of independently observed ordinary cursors,
discards a suffix when its predecessor cursor changes, preserves first display
positions when deduplicating, and ANDs all page completeness bits at line 123.
That validates the report's warning about reusing `usePage` unchanged. A
stateful consuming traversal with acknowledged/expired retry responses also
needs an explicit answer for how already-mounted earlier pages revalidate.

## 2. Required contract changes

### Authorization and revision custody

Capture the roster revision and engine-birth fence atomically at opening.
Check the revision again in the transaction that authorizes and publishes a
page. Persisted progress never grants read authority. Declare exactly which
follow, block and visibility dependencies invalidate a session, including
negative probes, unblock, delete/refollow within one transaction, source ID
reuse, and visibility changes involving an original author not followed by
the reader. Specify block direction and semantics explicitly. A table called
`blocks` still has no effect by itself.

Use scoped dependency revisions, or an equally strong bounded change proof.
A global store commit counter is suitable for the birth fence but is a poor
graph-invalidation revision: unrelated writes would continually restart
traversals and could introduce additional observable changes. Register the
dependencies before preparing rows, including authorization dependencies of
empty/exhausted lanes. A block during discovery must not escape merely because
that actor has not been reached yet.

Apply actor exclusion before lane opening and original-author/card authority
to repost output. Private fields on otherwise public cards still need normal
projection authorization. Keep non-uniform private source admission refused
in the first version. Give birth-witness access and frontier storage only the
internal authority they require. They must not acquire ordinary query/SQL/sync
visibility accidentally.

### Publication, deletion and replay

Define the linearization point for publication and the distinction between
preparation, a delivered logical page, reset/expiry, refusal and exhaustion.
All current event-incarnation and authorization checks for a response must
hold in one publication transaction. Shape card bodies from that transaction;
earlier staged bodies are not automatically fresh. Reserve the final
validation/serialization/checkpoint work as well as candidate preparation.

Removal of an original removes that event, while the retained card and
independent repost events may remain. Deleting a repost removes its own event.
Deleted buffered heads and deleted staged rows need explicit discard/refill
rules. Define the continuation when the staged final row, every staged row, or
an entire lane disappears. Preserve a proven prefix; never accidentally
advance by a prefetch position or interpret a missing birth record as an
eligible event. State how a page too large for final publication is shortened
lawfully or refused, rather than preparing forever.

Choose a replay policy that does not conflict with fresh bodies and current
authorization. Recommended: persist a page identity, selected event
incarnations and successor; retry does not advance again. Revalidate before
each disclosure. If the selected page can no longer be replayed under that
identity, return a typed reset/superseded outcome; do not silently refill the
old token with a different page or replay revoked bytes. A changed card body
requires either a newly identified authorized image of the same page or a
reset, specified explicitly. Byte-identical response replay is not compatible
with unconditional fresh-body reads.

Specify acknowledgement semantics and the bounded replay window. A token older
than retained replay state must fail/reset without consuming progress. Cover
duplicate/concurrent advances, lost responses, reordered responses and a lost
acknowledgement. The SDK must discard obsolete page/epoch responses after a
reset. Mounted old pages cannot simply retain authorization forever because
their retry payloads were reclaimed; they need invalidation and a defined
refresh/restart path.

### Disclosure

“Progress counts obey disclosure rules” needs an executable contract. Prefer
an opaque preparing state; keep candidate/rejection counts, skipped keys and
private revisions out of ordinary responses. Opaqueness alone is insufficient:
the number of preparation rounds, the decision to return ready versus
preparing, quota refusal details and token structure can also reveal private
work.

Use the existing separation between public reservations and internal physical
accounting for hidden authorization and birth-witness work. Specify the
admitted block/visibility class and prove paired worlds for new observables.
LLP 3000.015 §1 explicitly retains a paging-count residual; this review does
not demand retroactive removal of that residual or constant-time HTTP. It does
require stating which existing residual applies and avoiding an unreviewed
new rejection/progress oracle. Owner-readable follow counts are a different
case from hidden authorization witnesses; do not conflate them.

### Finite domain and live refresh

The engine-birth fence, immutable ordering fields, incarnation validation and
revision restart make the merge's prefix argument sound. Removing events only
shrinks that domain. A caller's event timestamp is not a birth witness. Keep
the draft's honest limitation: post-fence backdated arrivals can make physical
rejection work unbounded even when the eligible event set is finite. A retained
index snapshot or equivalent enumeration mechanism is needed only if finite
completion under that continuing workload is promised.

Also specify the live-feed contract. A session exact for birth fence B is not
automatically exact for later births. A newly born backdated event may belong
inside an already displayed range, not just above its newest row. Define an
SDK-owned epoch refresh/reconciliation rule (or an explicitly stale snapshot
until refresh) and do not silently extend B or claim current completeness for
an old epoch. Graph changes withdraw/reset affected accumulated results, not
only the currently requested page. State eventual-completion conditions in the
user-facing capability: relevant graph and scan workload settle, resources
remain admitted, and the session remains alive or can resume successfully.

### Frontier custody and actual bounds

Specify quotas, idle lifetime, cancellation, admission and reclaim behavior
before implementation. Account for indexes, staged pages, retry images,
revision bookkeeping, tombstones awaiting cleanup and WAL/storage overhead;
the O(F+N) row count is not itself a byte or whole-system memory bound. Atomic
units must reserve their commit/checkpoint work before proceeding. Cleanup is
bounded and storage quota is not released before the corresponding physical
custody is reclaimed. Cancellation/admission storms must not accumulate
unbounded abandoned frontiers. Scheduling should preserve foreground and
background progress under contention.

Resolve the multi-tab/device policy. “One active traversal per
reader/declaration” must not let a second tab repeatedly evict the first, or
let two consumers consume one another's next page. Use explicit ownership and
bounded independent leases, or a shareable protocol with a proved consumer
model; an honest busy/refusal outcome is also possible. Include query argument
values, filters, projection, page size and declaration in the binding, not just
an informal query shape. Other viewers, store restore, unsupported formats,
retired declarations and expired tokens never inherit frontier authority.

## 3. Recommended read path; A versus B

Use one exact online reader from the first page. It discovers the viewer's lane
and every eligible followed-author lane, establishes one head or end per lane,
then emits the requested prefix. When the complete setup plus page and
checkpoint fit the request's actual meters, return in that request. Otherwise
save progress and continue through the same state machine. This is not an
arbitrary follow-count threshold, and a small roster can still need preparation
because of rejection or shaping work. Preserve the frontier for later pages.

This has B's essential safety property: prove coverage of the prefix before
claiming it. It does not require traversing or materializing all history before
showing the first page. One head/end per lane suffices. It avoids needing to
prove that an independently maintained inbox happens to equal the exact prefix.

Option A is logically valid as a separately labeled exact-history recovery
mode. It eventually reconstructs missing rows if fully traversed, but a user
who has already scrolled to the ancient row can have 101 unseen rows inserted
above their anchor. That is a significant product behavior, not a transparent
pagination optimization. I would not choose it for the requested ordinary,
complete Following feed.

An exact “complete down to” boundary is a possible later optimization, but
requires positive coverage evidence for every current lane, tied to the graph
and birth/delivery revision. If lane a is proven complete at or above key C_a,
the safe global lower boundary is the greatest of the C_a keys (with proper
inclusive/exclusive semantics), treating a proven exhausted lane appropriately.
Do not publish inbox rows below that boundary before history reaches them.
Pending deliveries, backfill, new follows, backdating and tied event IDs must
all preserve the certificate. The oldest current inbox row alone proves none
of this. Building and maintaining that certificate is more complex than the
exact merge initially, so defer it until measurement justifies the fast path.

## 4. SDK and application responsibilities

The engine owns ordered-prefix proof, authorization, continuation and replay.
The SDK owns preparation requests, page/revision custody, cancellation, retry,
resets, event-key deduplication, live refresh and accumulated-result withdrawal.
Prefer a typed traversal capability behind one Following read. A
Following-specific SDK controller/hook is a reasonable first implementation;
extend `usePage` only with explicit compiled traversal metadata and a new
well-defined state model. Do not globally reinterpret ordinary `complete` or
`next` to accomplish it.

The builder should author the Following selection and card projection and
render items plus ordinary loading/offline/refusal states. They should not
author a second history query, translate cursors, reconcile event namespaces,
or decide whether a gap has been filled. This machinery can be invisible.
Network preparation, expiry, offline withholding and live refresh remain real
observable states. Stable scroll anchoring also needs cooperation with the UI
list/virtualizer; a data-only hook cannot universally preserve pixel position.

## 5. Implementation acceptance

Keep §9.5's generated independent source oracle, tied ordering, mutations,
meter cuts in all phases, more than 8,192 authors, replay/restart, seam and
pending-intent cases. Add or make explicit:

1. A model of the specified birth-bounded/current-authorization semantics,
   with cuts and interleavings before every discovery, refill, staging and
   publication step. Assert every delivered page is a prefix, not merely that
   the final drained set matches. Include empty rosters, empty lanes, all
   rejected lanes, original removal with surviving reposts, and declaration
   identity across multiple views.
2. Block in both declared directions, original-author block through someone
   else's repost, invisible negative probes, same-transaction unfollow/refollow,
   source ID reuse and deletion/recreation of buffered events. Test revalidation
   of mounted old pages after retry storage has been acknowledged/reclaimed.
3. Forged/cross-viewer/cross-store/cross-declaration/cross-argument tokens;
   duplicate advances, lost reply/ack, stale token after ack, reordered SDK
   replies, concurrent tabs and crash cuts around atomic checkpoint commits.
   Test authorization loss between preparation and output and before a retry.
4. Paired-world assertions for result, progress phase, cursor, error envelope,
   public meter and observable revisions, with any permitted residual stated.
   Check no event heads, hidden counts or private birth/work data reach wire,
   ordinary SQL/catalog access or sync.
5. Budget boundaries for all seven dimensions, including final validation,
   authorization reservations, frontier mutations, retry response retention,
   cleanup and admission. Exercise output/heap-indivisible cards, huge rosters,
   repeated cancellation, quota pressure, process restart and session expiry.
   Show continued forward progress under a settled workload and foreground
   fairness under concurrent traversal load.
6. An SDK journey that requires one authored feed: hot/quiet counterexample,
   first page through exhaustion, refresh with a later backdated birth,
   block/unfollow while older pages are mounted, expiry, reconnect, duplicate
   responses, own predicted posts and unobserved own-edge mutations. Verify
   exact identity, monotonic ordering within an epoch, no missing prefix, no
   false exhausted/loading-to-empty transition and automatic recovery.
7. Measure time to first displayed page, preparation request count, later-page
   latency, total work to exhaustion, storage high-water mark and reclaim
   behavior at realistic follow counts, including all-empty lanes and >8,192
   follows. The existing microbenchmark returns event metadata, not shaped
   cards or HTTP/SDK behavior, so it cannot set an end-to-end latency claim.

Require logical independence from unrelated authors' posts; do not demand
identical physical B-tree I/O, RSS or latency when the whole index grows.
The draft already acknowledges O(log E) seek costs. Do not require universal
termination under endless adversarial backdating unless the scope adds the
storage mechanism that makes that promise possible.

Keep existing compatibility/release gates. Old engines must reject the opt-in
capability safely while untouched Timeline v2 applications remain valid.
Published Darwin qualification is a separate authorized platform step, not
work for this eb1000-only review. No full recalibration or device-local reader
is needed to establish the initial server reader's correctness.

## 6. Scope cut

Ship server-only traversal first, with SDK routing on all client tiers,
explicit offline withholding and the existing pending-intent/own-edge fences.
Device-local frontier execution and its Memory/SQLite parity, retained index
snapshots, inbox coverage certificates, general private-source support and a
general resumable-query framework can all wait. This preserves online
completeness. A backend reader alone can be an internal milestone, but the
product goal is unfinished until the SDK and paved guide remove builder-owned
handoff work.

## Verification and retained evidence

Reran the existing research executable with all ignored cases included:
**3 passed, 0 failed**, exit 0. Sparse history again stopped at 5,789 examined
and 16,777,476 heap bytes; the indexed control returned 20 rows in 23 examined.
The 8,200-follow control again had no continuation, and the hot/quiet seam case
passed. The reproduced medians (22,712 µs and 106 µs) are diagnostic shared-host
test-profile samples, not product qualification. The test took 9.96 seconds
after compilation. One Cargo target, 362 MB; no other checkout or test target.

The report's three source-artifact hashes match. Full suite, wasm and Darwin
tests were not rerun for this design review. The research tests validate the
reported existing limitations; they do not validate the unimplemented reader.

See `research-recheck.log`, `verification.json` and the numbered pinned excerpts
in `source-evidence.txt` alongside this file. All are retained outside the
disposable checkout.
