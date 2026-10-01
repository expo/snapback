-- @ref LLP 3000.022#2 — the SDK reports delivery; success records the entire run.
use identity
use personas alice, bob, carol

-- The declared worker is ready when you add a provider and emit notifications.
effect notify

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
  unique conversation, principal
  cap 50 by conversation
  immutable conversation, principal, joinedOrdinal
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[.conversation, viewer]
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to members[.conversation]

table messages:
  receipts chat by .conversation, .ordinal from .sender to members:
    counter .lastOrdinal
    floor .joinedOrdinal
    count .recipients
    watermarks .deliveredOrdinal, .seenOrdinal
    runs runs
    operations receipt, delivered, seen, receiptMember, progress, compactReceipts
  conversation: conversations
  sender: principal
  ordinal: int
  recipients: int
  text: text <=2000
  photo: image <=5000000 once ?
  search text
  at: time
  unique byConversationOrdinal: conversation, ordinal
  -- Immutable scope and time keep search keyset positions stable across updates.
  immutable conversation, sender, ordinal, recipients, at
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  retain delivered-history
  sync to members[.conversation] last 500 by byConversationOrdinal

query conversationScreen(conversation: conversations):
  return conversations[conversation]

query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { conversation, chat: conversations[.conversation] }

query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c

query messageReceipts(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c { id, receipt: receipt(.) }

mutation send(conversation: conversations, text: text <=2000, photo: image <=5000000 ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  m = insert messages { conversation, sender: viewer, text, photo, at: now }
  return m.id

mutation add(conversation: conversations, principal: principal):
  require exists members[conversation, viewer] else NOT_MEMBER
  insert members { conversation, principal } if absent
  return null

mutation leave(conversation: conversations):
  me = members[conversation, viewer] ! else NOT_MEMBER
  delete members[me]
  return null

mutation createConversation(title: text 1..50):
  chat = insert conversations { title, creatorId: viewer }
  insert members { conversation: chat.id, principal: viewer }
  return chat.id

-- @ref LLP 3000.028#8 — two private keys, atomically installed; no horizon or online-only resolver.
table directChats:
  owner: principal
  peer: principal
  conversation: conversations
  unique owner, peer
  immutable owner, peer, conversation
  read <- .owner = viewer
  insert <- created conversations[.conversation] and (.owner = viewer or .peer = viewer)
  sync to .owner

query directConversation(other: principal):
  return directChats[owner = viewer, peer = other]

-- One indexed lookup recovers sends on a bare canonical route, even after leave.
query directPeer(conversation: id):
  return first(directChats where .owner = viewer and .conversation = conversation first 1 by .id)

mutation openDirect(id: id, other: principal):
  require other != viewer else SELF_DM
  pair = directChats[owner = viewer, peer = other]
  if pair != null:
    return pair.conversation
  chat = insert conversations { id, title: 'Direct message', creatorId: viewer }
  insert members { conversation: chat.id, principal: viewer }
  insert members { conversation: chat.id, principal: other }
  insert directChats { owner: viewer, peer: other, conversation: chat.id }
  insert directChats { owner: other, peer: viewer, conversation: chat.id }
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
-- @ref LLP 3000.028#3.3 — the SDK combines current server and retained device hits.
query search(q: text <=100, c: cursor ?):
  return messages matching q last 20 by .at after c
