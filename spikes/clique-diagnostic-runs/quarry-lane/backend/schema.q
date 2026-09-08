-- Clique — schema (Quarry v0.2, compiled by quarryc)
-- Counts are ordinary int columns kept correct by mutations: the packaged
-- compiler refuses maintain/# aggregates. Count-bearing tables carry
-- permissive update rules because per-field update grants do not exist in
-- this subset; every write path is a guarded mutation below.

use identity

table users:
  displayName: text <=50
  handle: text <=20
  bio: text <=200 ?
  location: text <=50 ?
  link: text <=200 ?
  followerCount: int
  followingCount: int
  unique byHandle: handle
  public
  insert r <- r.id = viewer
  update r <- allow

table posts:
  author: users
  body: text <=500
  parent: posts ?
  at: time
  likeCount: int
  replyCount: int
  repostCount: int
  by byAuthor: author, at
  by byParent: parent, at
  public
  insert r <- r.author = viewer
  update r <- allow
  delete r <- r.author = viewer

-- One row per feed appearance: originals (kind 'post') and reposts
-- (kind 'repost'). Replies never get a feedItems row, so they are absent
-- from every feed by construction. The Global feed is the byAt ordering;
-- a profile's post list and the client-merged Following feed use byActor.
-- ord is the negated client-intent timestamp (int): the engine's `after`
-- cursor is exclusive-greater in every direction, so newest-first
-- pagination must be an ascending scan over a descending key.
table feedItems:
  actor: users
  post: posts
  kind: enum('post', 'repost')
  origAuthor: users
  at: time
  ord: int
  unique byActorPostKind: actor, post, kind
  by byOrd: ord
  by byActor: actor, at
  by byActorOrd: actor, ord
  public
  insert r <- r.actor = viewer
  delete r <- r.actor = viewer

table follows:
  follower: users
  followee: users
  at: time
  unique byFollowerFollowee: follower, followee
  by byFollower: follower, at
  by byFollowee: followee, at
  public
  insert r <- r.follower = viewer
  delete r <- r.follower = viewer

table likes:
  user: users
  post: posts
  at: time
  unique byUserPost: user, post
  public
  insert r <- r.user = viewer
  delete r <- r.user = viewer

-- conv on members/inbox/dms is a plain id, not a reference: a reference
-- plus the membership read rule forms a table cycle quarryc refuses.
table conversations:
  kind: enum('dm', 'group')
  name: text <=50 ?
  description: text <=200 ?
  creator: users
  createdAt: time
  lastAt: time
  read r <- exists members[r.id, viewer]
  insert r <- r.creator = viewer
  update r <- allow

-- Roster: readable by members of the same conversation (rule is uniform
-- over conv-prefix scans). lastDeliveredAt/lastReadAt are the per-member
-- receipt watermarks; the aggregate tick is derived client-side as the min
-- over current members who were members at send time (joinedAt <= msg.at).
table members:
  conv: id
  user: users
  role: enum('member', 'admin')
  joinedAt: time
  lastDeliveredAt: time ?
  lastReadAt: time ?
  unique byConvUser: conv, user
  read r <- exists members[r.conv, viewer]
  insert r <- allow
  update r <- allow
  delete r <- allow

-- Per-user copy of the membership edge, because the roster rule is not
-- uniform over a user-prefix scan (E_STRUCTURAL_COUNT). Public (ids-only
-- metadata) because a viewer-scoped read rule would hide other users' rows
-- from admin mutations (remove-member) and composite-key writes/upserts
-- are refused, so get-row-then-delete needs the read. Conversation content
-- stays members-only via conversations/messages/members rules.
table inbox:
  user: users
  conv: id
  joinedAt: time
  unique byUserConv: user, conv
  public
  insert r <- allow
  delete r <- allow

table dms:
  lo: id
  hi: id
  conv: id
  unique byLoHi: lo, hi
  read r <- r.lo = viewer or r.hi = viewer
  insert r <- r.lo = viewer or r.hi = viewer

table messages:
  conv: conversations
  author: users
  body: text <=2000
  quoted: messages ?
  at: time
  ord: int
  by byConvOrd: conv, ord
  read r <- exists members[r.conv, viewer]
  insert r <- r.author = viewer and exists members[r.conv, viewer]

channel typing(conv: conversations):
  publish <- exists members[conv, viewer]
  subscribe <- exists members[conv, viewer]
  ttl 5s
