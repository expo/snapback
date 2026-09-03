-- Clique M1-M3 regression fixture plus the Clique Pay extension from
-- benchmarks/briefs/clique-pay.md, ported from the executed Quarry v0.2 lane.
-- Feed fan-out, hand-kept counters, and client-supplied ord keys are retained
-- deliberately: this pins the app that exercised the old front end.
-- Deliberate port drift: lane feeds refuse USER_NOT_FOUND instead of returning
-- an empty page; group creation refuses USER_NOT_FOUND for an unknown invitee
-- instead of inserting; startDm/toggleFollow resolve the user first, so
-- USER_NOT_FOUND precedes SELF_DM/SELF_FOLLOW for an unknown id.

use identity

table users:
  principal: principal
  displayName: text <=50
  handle: text <=20
  bio: text <=200 ?
  location: text <=50 ?
  link: text <=200 ?
  followerCount: int
  followingCount: int
  unique principal
  unique handle
  by byHandlePage: handle, id
  immutable principal
  public
  insert r <- r.principal = viewer
  update r <- allow

table posts:
  author: principal
  body: text <=500
  parent: posts ?
  at: time
  likeCount: int
  replyCount: int
  repostCount: int
  by byAuthor: author, at, id
  by byParent: parent, at, id
  public
  insert r <- r.author = viewer
  update r <- allow
  delete r <- r.author = viewer

-- One row per feed appearance. Replies deliberately have no feedItems row.
-- ord remains the caller-supplied descending key used by the executed app.
table feedItems:
  actor: principal
  post: posts
  kind: enum('post', 'repost')
  origAuthor: principal
  at: time
  ord: int
  unique actor, post, kind
  by byOrd: ord, id
  by byActor: actor, at, id
  by byActorOrd: actor, ord, id
  public
  insert r <- r.actor = viewer
  delete r <- r.actor = viewer

table follows:
  follower: principal
  followee: users
  at: time
  unique follower, followee
  by byFollower: follower, at, id
  by byFollowee: followee, at, id
  public
  insert r <- r.follower = viewer
  delete r <- r.follower = viewer

table likes:
  user: principal
  post: posts
  at: time
  unique byUserPostUnique: user, post
  by byUserPost: user, post, id
  public
  insert r <- r.user = viewer
  delete r <- r.user = viewer

table conversations:
  kind: enum('dm', 'group')
  name: text <=50 ?
  description: text <=200 ?
  creator: principal
  createdAt: time
  lastAt: time
  read r <- exists members[r.id, viewer]
  insert r <- r.creator = viewer
  update r <- allow

table members:
  conv: conversations
  user: principal
  role: enum('member', 'admin')
  joinedAt: time
  lastDeliveredAt: time ?
  lastReadAt: time ?
  unique byConvUserUnique: conv, user
  by byConvUser: conv, user, id
  read r <- exists members[r.conv, viewer]
  insert r <- allow
  update r <- allow
  delete r <- allow

-- Per-principal membership copy retained from the old app so inbox pages have
-- a uniform public rule while conversation content stays members-only.
table inbox:
  user: principal
  conv: conversations
  joinedAt: time
  unique byUserConvUnique: user, conv
  by byUserConv: user, conv, id
  public
  insert r <- allow
  delete r <- allow

table dms:
  lo: principal
  hi: principal
  conv: conversations
  unique lo, hi
  read r <- r.lo = viewer or r.hi = viewer
  insert r <- r.lo = viewer or r.hi = viewer

table messages:
  conv: conversations
  author: principal
  body: text <=2000
  quoted: messages ?
  at: time
  ord: int
  by byConvOrd: conv, ord, id
  read r <- exists members[r.conv, viewer]
  insert r <- r.author = viewer and exists members[r.conv, viewer]

table ledger:
  owner: principal
  counterparty: principal
  amount: money USD
  kind: enum('deposit', 'send', 'receive', 'settle', 'collect')
  note: text <=140 ?
  expense: expenses ?
  at: time
  by byOwnerAt: owner, at, id
  read r <- r.owner = viewer
  insert r <- r.owner = viewer or r.counterparty = viewer

maintain balances = sum ledger of amount by owner:
  read r <- r.owner = viewer

table expenses:
  conv: conversations
  payer: principal
  description: text <=100
  total: money USD
  tipRate: decimal 4
  tip: money USD
  grand: money USD
  at: time
  by byConv: conv, at, id
  read r <- exists members[r.conv, viewer]
  insert r <- r.payer = viewer and exists members[r.conv, viewer]

table shares:
  expense: expenses
  conv: conversations
  debtor: principal
  amount: money USD
  expenseDescription: text <=100
  expensePayer: principal
  expenseGrand: money USD
  expenseAt: time
  settled: bool
  settledAt: time ?
  unique expense, debtor
  by byConvExpense: conv, expense, debtor
  by byDebtorOpen: debtor, settled, id
  read r <- exists members[r.conv, viewer]
  insert r <- exists members[r.conv, viewer]
  update r <- r.debtor = viewer

maintain convSpend = sum expenses of grand by conv:
  read r <- exists members[r.conv, viewer]

channel typing(conv: conversations):
  publish <- exists members[conv, viewer]
  subscribe <- exists members[conv, viewer]
  ttl 5s
