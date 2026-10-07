# FH D0 review dispositions

The commissioning user, acting under delegated architectural authority, accepted
the direction with eleven binding decisions in the FH round-1 commission.
Those decisions supersede differing recommendations in the two reviews.
The supplied reviews are retained verbatim in `reviews/`; neither is a review
of round-1 implementation. Astra's detailed acceptance matrix is §5 (its summary
calls it §4); Grok's is §4. Both are included below.

| Finding | Disposition in approved LLP 3000.026 §9 |
|---|---|
| Both: exact-first; reject A's inbox splice | Accepted. One exact online chronology from its first page; no inbox seam. |
| Both: all author heads before output | Accepted. Discovery/refill is resumable; no ordered output without the prefix invariant. |
| Both: small reads should complete immediately | Accepted. No retained frontier for a request that finishes setup and its page with checkpoint reservations. Replay state remains necessary. |
| Both: birth is private `Work.admitted`, not `at` | Accepted. Narrow internal point probes, fixed reservations, no birth or head data on the wire. |
| Both: birth does not prove liveness | Accepted. Current event, tombstone and captured edge epoch are checked at selection/publication/replay. |
| Grok: freeze edges; do not restart on a new follow | Accepted. Edge epoch and event admission must be ≤ B. New follows affect live prepend, not the session roster. |
| Astra: scope revisions; register negative dependencies | Narrowed by author. No block/private-source extension; the inbox predicate governs. Current epoch and tombstone point checks enforce withdrawal; unrelated commits never restart. |
| Astra: block direction, original-author blocking, unblocks | Rejected for this feature by decision 4. No history-only block filter; block test cases become predicate-parity tests. |
| Both: deletion of buffered/final/all staged rows | Accepted. Invalid staged output restarts explicitly; stale unpublished heads are removed/refilled before further selection. |
| Both: preserve independent repost identity and lifetime | Accepted. Declaration event ID is the ordering/dedup identity; removal of its original does not remove a surviving repost. |
| Both: edge/source reincarnation | Accepted. Captured epoch, not application edge ID; same-transaction refollow is a new epoch. |
| Both: pinned replay versus fresh cards | Author chooses pinned shaped bytes. Reauthorize; restart on authority loss, never substitute another page under an old token. |
| Both: token names unit; lost response must not advance twice | Accepted. Unit and successor are distinct opaque tokens; advancement and retained response are atomic. |
| Astra: acknowledgements, stale tokens, concurrent/reordered replies | Accepted. A bounded replay window, implicit acknowledgement on successor advancement, explicit stale-unit restart, SDK revision custody. |
| Both: fixed request meters; reserve before charging | Accepted. Failed reservations mutate neither meter nor frontier. Stop discovery immediately on cut. |
| Both: checkpoint/final validation costs | Accepted. Charge scratch, retained allocations, final validation, output, frontier records, replay and cleanup. No raised ceiling. |
| Grok: oversized row must not pin a head forever | Accepted. Ordered named omission advances past that event; inability to fit even the omission is a named request refusal. |
| Both: opaque progress is not by itself non-disclosure | Accepted. Phase-only public progress; fixed private-probe reservations; paired-world phase/token-shape/error tests. No public meters or revisions derived from private work. |
| Both: finite B does not stop physical backdating work | Author chooses skip/checkpoint, not fenced enumeration. A slice obstructed by post-B backdated rows reports `stalled`, retains its key, never reports false exhaustion. |
| Astra: new backdated births need an explicit live policy | Author chooses a separate live prepend. Such births never enter the frozen history epoch; SDK owns identity and withdrawal. |
| Both: actual quotas, TTL, abandoned state, bounded reclaim | Accepted. Four independent sessions per viewer/declaration; five-minute idle expiry; 32 MiB per session and 128 MiB per controller accounted allocation quotas. Abandoned state remains charged until reclaimed. |
| Both: a second tab/device must not evict or consume the first | Accepted. Independent opening/unit tokens, no eviction, named quota refusal. |
| Both: crash/restore/expiry/store/schema/arguments custody | Accepted. Explicit restart. Initial implementation uses process-owned volatile state; losing the controller is a crash boundary, not exhaustion. |
| Both: SDK owns the protocol, not `usePage` or application code | Accepted. Following-specific generated binding/hook; publication remains gated until its journeys pass. |
| Both: offline and pending own-post/own-edge fences | Accepted. Existing inbox offline plus “older posts are not on this device”; no server result bypasses pending intent. |
| Both: oracle must prove each prefix, not just final set | Accepted. Independent scan of owned events and engine admissions over frozen roster, descending `(at,eventId)`. |
| Grok: replace planned activity/source oracle | Accepted. It has the wrong repost identity; it is not the oracle. |
| Both: paired worlds, empty/rejected lanes, resource boundaries | Accepted into the qualification matrix, including private probes, output, heap, replay and quota/reclaim. |
| Both: interleavings, forged tokens, lost replies, expiry, two consumers | Accepted into the qualification matrix; no claim from a metadata-only or fixed-corpus control. |
| Astra: mounted old pages after replay reclamation | Accepted; requires SDK withdrawal/revision handling, separate from bounded server replay retention. |
| Astra: fairness, cancellation storms, storage high-water | Accepted into the matrix and measurements; session admission does not evict existing readers. |
| Both: measure displayed first page and whole preparation/storage | Accepted. Internal milestone measurements are labelled engine-only; HTTP/display claims wait for route/SDK tests. |
| Both: defer device execution/parity and coverage certificates | Accepted. Keep inbox bytes/certificates; no device frontier or general resumable-query framework. |
| Both: old-engine compatibility and Darwin fence | Accepted. Any future persistent format needs a fence; this milestone introduces no persistent table. Darwin remains the user's separate run. |

The internal-reader milestone is not the complete product. Its report maps the
matrix to executed tests and names every deferred route, shaping and SDK case;
neither design approval nor the D0 research tests qualify the new capability.

## Implementation-review dispositions

These follow the supplied design reviews and do not replace their provenance.
See `reviews/implementation-1.md` and `reviews/implementation-2.md`.

| Finding | Disposition |
|---|---|
| Empty token advances a terminal session | Fixed: issued-unit syntax checked before lookup; terminal forgery regression preserves replay. |
| Reclaimed or cross-viewer opening can become another unit | Fixed: bounded viewer/declaration/page-size registration, charged quota/expiry/reclaim custody, unknown openings restart; regressions cover accepted and unused openings. |
| Rewind checked only against B | Fixed: latest observed accepted/replayed head advances independently of B; rewind regression. Equal/higher-sequence replacement remains the host's invalidation responsibility. |
| Registered opening with changed page size returns refusal | Fixed: both live sessions and registrations return restart on mismatched page-size binding; 0/101 regression. |
| ID-width rationale | Corrected: engine validates all IDs; base reservation returns to 16 KiB. |
| Post-B follow churn can obstruct discovery | **Open author clarification.** Strict key progress and eventual completion after churn stops are tested; current phase is preparing. The author must choose whether to extend stalled or require stronger roster enumeration. No guarantee is silently broadened. |

Resumed fresh review (2026-10-07) found undersized lifecycle heap reservations
and pre-admission key clones. Fixed with a separate 64 KiB scratch reservation
for opening, cancellation and each reclamation record; retained session prices
stay 16 KiB. The 96-registration regression verifies refusal leaves expiry,
abandonment and quota unchanged. Actual reviews are in
`reviews/implementation-3.md` and `reviews/implementation-4.md`; final scoped
verdict is APPROVE, with the follow-churn author decision still open.
