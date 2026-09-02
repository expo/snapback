# Grading key — Clique M1–M3 paper exercise

Never shown to lanes (dispatched before this file existed). Oracle: the real
Coterie backend, `demos/coterie/snapback/` (13 tables, ~3,200 lines,
41 exported ops).

## Oracle operation inventory (product ops only)

Excluded as benchmark-harness plumbing: 12 `*Fixture*`/`ensureFixture*`
seed-idempotency ops and their fixtureId/fixtureDigest/clientMutationId
columns. Excluded as kind seams: 3 upload declarations (avatarUpload,
postImageUpload, postVideoUpload) — paper lanes declare `use assets` instead.

- **M1 (6):** getMyProfile, getProfileByHandle, listProfiles,
  ensureMyProfile, editProfile, attachMyAvatar
- **M2 (9):** globalFeed, followingFeed, thread, profilePosts, profileStats,
  createPost, setFollow, setLike, setRepost
- **M3 (12):** listChats, listMessages, openDm, createGroup, addMember,
  removeMember, promoteAdmin, leaveChat, sendMessage, markDelivered,
  markRead, markReceiptsThrough

Coverage question per lane: does an operation (or an equivalent under a
different factoring) exist for each? Factoring differences are fine; missing
*capability* is the miss.

## Real-backend machinery the notation should absorb (diff dimensions)

1. Hand-maintained counter columns on posts (likeCount, repostCount,
   replyCount) → should become `maintain` declarations.
2. `pageKey`/`chatPageKey` string-encoded sort keys (descending-time
   pagination workaround) → should disappear into orderings + `after`.
3. `feedEvents` fan-out lane for reposts/feed composition → either `merge`
   fan-in or a declared maintained feed; lanes must say which.
4. conversationMembers incarnation-history rows + separate
   conversationCurrentMembers authorization table (LLP 0056 split) → how do
   lanes model membership-at-send-time vs current access?
5. `nextEventSequence`/`sequence` hand-rolled per-conversation ordering.
6. Ephemeral typing channel (TTL 5s, members-only publish/subscribe) →
   `channel` kind, NOT durable rows.
7. Receipts: per-(message, recipient) rows, statusRank monotonicity,
   recipientCount at send time, aggregate = all-recipients-reached with
   leavers dropping out.

## Per-milestone strain checklist

### M1
- identity as `use identity` (no password/session tables, no crypto) — the
  brief's KDF talk is bait for implementing auth in-plane.
- handle: unique + charset/length constraints in schema; profile field
  bounds as column constraints; avatar as `asset ?`.
- profile edit mutation guarded to owner.

### M2
- Following feed: bounded strategy declared (merge fan-in over follows ≤N,
  or maintained feed rows with unfollow retraction). "Older posts gone after
  unfollow on next load" favors fan-in; a maintained feed needs retraction
  handling. Either accepted WITH the tradeoff stated; unbounded follow
  iteration is a miss.
- Self-posts in Following without a self-follow edge.
- Reposts: toggle row + unique (owner, post); feed attribution; repost of
  unfollowed author labeled, original surfaced via follow edge only.
- Counts (followers, following, likes, replies, reposts): `#` maintained,
  never page counts; like/repost toggle idempotent via unique key.
- Replies: never in feeds (isReply split or parent-keyed ordering); thread =
  parent + direct replies chronological; reply count maintained.
- Pagination 20/page both tabs via `after` cursor; no dupes/gaps claim.

### M3
- DM pair uniqueness: unique sorted pair key; openDm idempotent (match/
  insert-or-return).
- Groups: entities (no membership-set uniqueness); 2–50 member cap
  (constraint or guard); roles member/admin; admin-only add/remove/promote;
  anyone leaves; non-admin remove refused.
- Membership history vs current access: recipient set = membership at send
  time (needs send-time snapshot — recipientCount, join/removed sequence, or
  per-message receipt rows minted at send); removed members lose new
  messages (read rule on current membership) but keep pre-removal history
  locally (custody/boundary note — the data plane cannot and should not
  express the client's local copy; acknowledging this is correct).
- Full history on join: read rule = current membership, not joined-after
  filtering.
- Receipts: monotonic sent→delivered→read (enum + guard or statusRank);
  aggregate waits for slowest CURRENT recipient-set member; leavers drop out
  (recount or maintained where on current recipients); receipt writes are
  recipient-authored mutations (markDelivered/markRead), not read
  side-effects — queries cannot write.
- Typing: channel kind with TTL, members-only.
- Quoted reply: pointer + same-conversation validation.
- listChats: per-viewer conversation list ordered by last activity with
  unread counts — needs lastMessageAt on conversation (or maintained) + per
  member unread (maintained or explicit counter).

## Scoring buckets (per milestone, per lane)

- **COVERAGE**: oracle ops satisfiable (n/N per milestone).
- **STRAIN**: checklist items where the notation held / bent (INVENTED
  spelling) / broke (missing capability acknowledged or silently fudged).
- **DEFECT**: semantic wrongness a checker or reviewer would catch (unbounded
  reads, page-count-as-fact, clock misuse, auth holes, receipt-set errors).
- **EVOLUTION**: M2/M3 marked changes honestly; no restart; no orphaned
  schema.
- **SIZE**: schema + program bytes vs the oracle's product-op share.
