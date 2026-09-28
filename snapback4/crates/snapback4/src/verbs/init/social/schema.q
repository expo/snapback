-- @ref LLP 3000.022#2 — the SDK reports delivery; success records the entire run.
use identity
use personas alice, bob, carol

table conversations:
  title: text 1..50 ?
  creatorId: principal
  lastOrdinal: int default 0
  read <- exists members[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists members[.id, viewer]
  after insert <- exists members[conversation = .id, principal = .creatorId]
  retain delivered-history
  sync to members[.id]

table members:
  conversation: conversations
  principal: principal
  joinedOrdinal: int
  deliveredOrdinal: int default 0
  seenOrdinal: int default 0
  unique conversation, principal
  cap 50 by conversation
  immutable conversation, principal, joinedOrdinal
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[.conversation, viewer]
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to members[.conversation]

table runs:
  conversation: conversations
  principal: principal
  fromOrdinal: int
  throughOrdinal: int
  unique conversation, principal, fromOrdinal
  cap 64 by conversation, principal
  cap 3200 by conversation
  read <- exists members[.conversation, viewer]
  insert <- .principal = viewer and exists members[.conversation, viewer]
  delete <- .principal = viewer
  sync to members[.conversation]

table messages:
  conversation: conversations
  sender: principal
  ordinal: int
  recipients: int
  text: text <=2000
  photo: image <=5000000 once ?
  search text
  at: time
  unique byConversationOrdinal: conversation, ordinal
  immutable conversation, sender, ordinal, recipients, at
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  retain delivered-history
  sync to members[.conversation] last 500 by byConversationOrdinal

fn receipt(m: messages):
  state = 'read'
  remaining = 0
  for member in members where .conversation = m.conversation:
    if member.principal != m.sender and member.joinedOrdinal < m.ordinal:
      remaining = remaining + 1
      if m.ordinal > member.deliveredOrdinal:
        run = first(runs[conversation = m.conversation, principal = member.principal, fromOrdinal <= m.ordinal] last 1 by .fromOrdinal)
        if run = null or run.throughOrdinal < m.ordinal:
          return 'sent'
      if member.seenOrdinal < m.ordinal:
        state = 'delivered'
  return state if remaining > 0 or m.recipients > 0 else 'sent'

query conversationScreen(conversation: conversations):
  return conversations[conversation]

query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { conversation, chat: conversations[.conversation] }

query history(conversation: conversations, c: cursor ?):
  return messages[conversation = conversation] last 20 by byConversationOrdinal after c

query messageReceipts(conversation: conversations, c: cursor ?):
  return messages[conversation = conversation] last 20 by byConversationOrdinal after c { id, receipt: receipt(.) }

query receiptMember(conversation: conversations):
  return members[conversation, viewer]

query progress(conversation: conversations, c: cursor ?):
  me = members[conversation, viewer] ! else NOT_MEMBER
  delivered = max(me.deliveredOrdinal, me.joinedOrdinal)
  return { member: me, runs: runs where .conversation = conversation and .principal = viewer, ahead: messages where .conversation = conversation and .ordinal > delivered and .ordinal <= delivered + 100 last 100 by .ordinal after c }

mutation send(conversation: conversations, text: text <=2000, photo: image <=5000000 ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  ordinal = chat.lastOrdinal + 1
  recipients = 0
  for member in members where .conversation = conversation:
    if member.principal != viewer:
      recipients = recipients + 1
  update conversations[chat] { lastOrdinal: ordinal }
  m = insert messages { conversation, sender: viewer, ordinal, recipients, text, photo, at: now }
  return m.id

mutation add(conversation: conversations, principal: principal):
  require exists members[conversation, viewer] else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  insert members { conversation, principal, joinedOrdinal: chat.lastOrdinal } if absent
  return null

mutation leave(conversation: conversations):
  me = members[conversation, viewer] ! else NOT_MEMBER
  for run in runs where .conversation = conversation and .principal = viewer:
    delete runs[run]
  delete members[me]
  return null

mutation delivered(conversation: conversations, from: int, through: int)
  reports delivery of messages by .conversation, .ordinal:
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  require 0 < from and from <= through else NOT_A_RUN
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  prefix = max(me.deliveredOrdinal, me.joinedOrdinal)
  held = first(runs where .conversation = conversation and .principal = viewer and .fromOrdinal <= from last 1 by .fromOrdinal)
  if through <= prefix or (held != null and held.throughOrdinal >= through):
    return null
  low = from
  high = through
  for run in runs where .conversation = conversation and .principal = viewer and .fromOrdinal <= through + 1 and .throughOrdinal + 1 >= from:
    low = min(low, run.fromOrdinal)
    high = max(high, run.throughOrdinal)
    delete runs[run]
  if low <= prefix + 1:
    update members[me] { deliveredOrdinal: high }
  else:
    require count(runs where .conversation = conversation and .principal = viewer) < 64 else RUNS_FULL
    insert runs { conversation, principal: viewer, fromOrdinal: low, throughOrdinal: high }
  return null

mutation seen(conversation: conversations, through: int):
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  if through > me.seenOrdinal:
    update members[me] { seenOrdinal: through }
  return null

mutation createConversation(title: text 1..50):
  chat = insert conversations { title, creatorId: viewer }
  insert members { conversation: chat.id, principal: viewer, joinedOrdinal: 0 }
  return chat.id

query messagePhoto(id: messages):
  return messages[id]

table profiles:
  principal: principal
  name: text 1..80
  avatar: image <=5000000 ?
  unique principal
  immutable principal
  public 'display names and avatars are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public last 500 by .id
query profile(principal: principal):
  return profiles[principal = principal]
mutation saveProfile(name: text 1..80):
  upsert profiles[principal = viewer] { principal: viewer, name }
mutation placeAvatar(avatar: image <=5000000):
  update profiles[principal = viewer] { avatar }

table posts:
  authorId: principal
  body: text 1..500
  at: time
  removed: bool default false
  immutable authorId, at
  public 'public posts'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public last 1000 by .at

table follows:
  followerId: principal
  followedId: principal
  unique followerId, followedId
  immutable followerId, followedId
  public 'public follows'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  online only

-- Reposts supplies the second source required by view following; no repost action yet.
table reposts:
  actorId: principal
  postId: posts
  at: time
  unique actorId, postId
  immutable actorId, postId, at
  public 'public reposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public last 1000 by .at
view activity:
  posts where not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]
query feed(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] }
mutation post(body: text 1..500):
  return insert posts { authorId: viewer, body, at: now }
mutation follow(principal: principal):
  insert follows { followerId: viewer, followedId: principal } if absent
mutation unfollow(principal: principal):
  delete follows[viewer, principal]

table likes:
  post: posts
  principal: principal
  at: time
  unique post, principal
  immutable post, principal, at
  public 'public likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by .at with own keys .principal
query postState(post: posts):
  return { liked: exists likes[post, viewer] }
mutation setLike(post: posts, liked: bool):
  if liked:
    insert likes { post, principal: viewer, at: now } if absent
  else:
    delete likes[post, viewer]

table typing:
  conversation: conversations
  principal: principal
  unique conversation, principal
  cap 50 by conversation
  read <- exists members[.conversation, viewer]
  insert <- .principal = viewer and exists members[.conversation, viewer]
  update <- .principal = viewer and exists members[.conversation, viewer]
  delete <- .principal = viewer
  ephemeral 4s
mutation setTyping(conversation: conversations):
  upsert typing[conversation, viewer] {}
mutation stopTyping(conversation: conversations):
  delete typing[conversation, viewer]
query typingIn(conversation: conversations):
  return typing[conversation = conversation] where .principal != viewer by .principal { principal }

-- One ordinary pinned body keeps certified retained hits in both link states.
query searchChat(conversation: conversations, q: text <=100, c: cursor ?):
  return messages[conversation = conversation] matching q last 20 by .at after c
-- Current documented all-chat forms, until ordinary mixed search ships.
-- Current memberships online; device holdings (including retained) offline.
query searchNewest(q: text <=100, c: cursor ?):
  return messages matching q where exists members[.conversation, viewer] last 20 by .at after c
-- Keep this held query unguarded: check's membership rewrite would discard
-- lawful retained hits after leave. The current online/held split is deliberate.
query searchHeld(q: text <=100, c: cursor ?) held:
  return messages matching q last 20 by .at after c
