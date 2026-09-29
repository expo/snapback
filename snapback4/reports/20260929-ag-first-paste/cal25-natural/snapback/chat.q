effect notify

table conversations:
  title: text 1..50
  description: text <=200 default ''
  accent: enum('#4F46E5', '#0D9488', '#EF6351', '#D97706', '#7C3AED', '#059669', '#E11D48', '#475569') default '#4F46E5'
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  kind: enum('dm', 'group')
  peerA: principal ?
  peerB: principal ?
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
  role: enum('member', 'admin')
  joinedOrdinal: int
  deliveredOrdinal: int default 0
  seenOrdinal: int default 0
  unique conversation, principal
  cap 50 by conversation
  immutable conversation, principal, joinedOrdinal
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[conversation = .conversation, principal = viewer, role = 'admin']
  update <- .principal = viewer or exists members[conversation = .conversation, principal = viewer, role = 'admin']
  delete <- .principal = viewer or exists members[conversation = .conversation, principal = viewer, role = 'admin']
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
  delete <- .principal = viewer or exists members[conversation = .conversation, principal = viewer, role = 'admin']
  sync to members[.conversation]

table messages:
  conversation: conversations
  sender: principal
  ordinal: int
  recipients: int
  text: text <=2000
  photo: image <=10000000 ?
  oncePhoto: image <=10000000 once ?
  expiresAt: time ?
  video: video <=50000000 ?
  edited: bool default false
  tombstone: bool default false
  quote: messages ?
  at: time
  unique byConversationOrdinal: conversation, ordinal
  immutable conversation, sender, ordinal, recipients, at, expiresAt
  search text
  expire at .expiresAt
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  update <- .sender = viewer and exists members[.conversation, viewer]
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
  return members where .principal = viewer first 50 by .conversation after c { conversation, chat: conversations[.conversation], other: profiles[principal = conversations[.conversation].peerB if conversations[.conversation].peerA = viewer else conversations[.conversation].peerA] }

query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c

query messageReceipts(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c { id, receipt: receipt(.) }

query receiptMember(conversation: conversations):
  return members[conversation, viewer]

query progress(conversation: conversations, c: cursor ?):
  me = members[conversation, viewer] ! else NOT_MEMBER
  delivered = max(me.deliveredOrdinal, me.joinedOrdinal)
  return { member: me, runs: runs where .conversation = conversation and .principal = viewer, ahead: messages where .conversation = conversation and .ordinal > delivered and .ordinal <= delivered + 100 last 100 by .ordinal after c }

mutation send(messageId: id, conversation: conversations, text: text 1..2000, quote: messages ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  ordinal = chat.lastOrdinal + 1
  recipients = 0
  for member in members where .conversation = conversation:
    if member.principal != viewer:
      recipients = recipients + 1
  update conversations[chat] { lastOrdinal: ordinal }
  if quote != null:
    quoted = messages[quote] ! else QUOTE_NOT_FOUND
    require quoted.conversation = conversation else WRONG_CHAT
  m = insert messages { id: messageId, conversation, sender: viewer, ordinal, recipients, text, quote, expiresAt: expiryFor(chat.disappearing), at: now }
  notifyMembers(conversation, slice(text, 0, 80))
  return m.id

mutation add(conversation: conversations, principal: principal):
  require exists members[conversation = conversation, principal = viewer, role = 'admin'] else NOT_ADMIN
  chat = conversations[conversation] ! else NOT_FOUND
  require chat.kind = 'group' else NOT_GROUP
  require exists profiles[principal = principal] else USER_NOT_FOUND
  insert members { conversation, principal, role: 'member', joinedOrdinal: chat.lastOrdinal } if absent
  return null

mutation leave(conversation: conversations):
  me = members[conversation, viewer] ! else NOT_MEMBER
  for run in runs where .conversation = conversation and .principal = viewer:
    delete runs[run]
  delete members[me]
  return null

mutation delivered(conversation: conversations, from: int, through: int)
  reports delivery of messages by .conversation, .ordinal: server
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  require 0 < from and from <= through else NOT_A_RUN
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  prefix = max(me.deliveredOrdinal, me.joinedOrdinal)
  if through <= prefix:
    return null
  low = from
  high = through
  held = runs where .conversation = conversation and .principal = viewer and .fromOrdinal <= through + 1 and .throughOrdinal + 1 >= from
  for run in held:
    low = min(low, run.fromOrdinal)
    high = max(high, run.throughOrdinal)
  if prefix + 1 < low:
    blocker = first(messages where .conversation = conversation and .ordinal > prefix and .ordinal < low first 1 by .ordinal)
    prefix = blocker.ordinal - 1 if blocker != null else low - 1
  for run in held:
    delete runs[run]
  if low <= prefix + 1:
    prefix = max(prefix, high)
  else:
    require count(runs where .conversation = conversation and .principal = viewer) < 64 else RUNS_FULL
    insert runs { conversation, principal: viewer, fromOrdinal: low, throughOrdinal: high }
  if prefix > me.deliveredOrdinal:
    update members[me] { deliveredOrdinal: prefix }
  return null

mutation seen(conversation: conversations, through: int):
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  if through > me.seenOrdinal:
    update members[me] { seenOrdinal: through }
  return null

table dmKeys:
  low: principal
  high: principal
  conversation: conversations
  unique low, high
  immutable low, high, conversation
  read <- .low = viewer or .high = viewer
  insert <- .low = viewer or .high = viewer
  online only
mutation createDM(conversationId: id, other: principal):
  require other != viewer else CANNOT_DM_SELF
  require exists profiles[principal = other] else USER_NOT_FOUND
  (low, high) = sorted(viewer, other)
  existing = dmKeys[low, high]
  if existing != null:
    return existing.conversation
  chat = insert conversations { id: conversationId, title: 'Direct message', kind: 'dm', creatorId: viewer, peerA: low, peerB: high }
  insert members { conversation: chat.id, principal: viewer, role: 'member', joinedOrdinal: 0 }
  insert members { conversation: chat.id, principal: other, role: 'member', joinedOrdinal: 0 }
  insert dmKeys { low, high, conversation: chat.id }
  return chat.id
mutation createGroup(conversationId: id, title: text 1..50, description: text <=200, other: principal):
  require other != viewer else NEED_TWO_MEMBERS
  require exists profiles[principal = other] else USER_NOT_FOUND
  chat = insert conversations { id: conversationId, title, description, kind: 'group', creatorId: viewer }
  insert members { conversation: chat.id, principal: viewer, role: 'admin', joinedOrdinal: 0 }
  insert members { conversation: chat.id, principal: other, role: 'member', joinedOrdinal: 0 }
  return chat.id
mutation removeMember(conversation: conversations, principal: principal):
  require exists members[conversation = conversation, principal = viewer, role = 'admin'] else NOT_ADMIN
  for run in runs where .conversation = conversation and .principal = principal:
    delete runs[run]
  if exists members[conversation, principal]:
    delete members[conversation, principal]
mutation promote(conversation: conversations, principal: principal):
  require exists members[conversation = conversation, principal = viewer, role = 'admin'] else NOT_ADMIN
  update members[conversation, principal] { role: 'admin' }
query roster(conversation: conversations):
  return members where .conversation = conversation { *, profile: profiles[principal = .principal] }
query groupByTitle(title: text 1..50):
  return conversations where .title = title and .kind = 'group' first 1 by .id
query messageAuthor(message: messages):
  return profiles[principal = messages[message].sender]
query quotedMessage(message: messages):
  return messages[messages[message].quote]
query message(id: messages):
  return messages[id]

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
  if exists typing[conversation, viewer]:
    delete typing[conversation, viewer]
query typingIn(conversation: conversations):
  return typing where .conversation = conversation and .principal != viewer by .principal { principal }
query typingInMyRooms(c: cursor ?):
  return members where .principal = viewer first 100 by .conversation after c { conversation, typing: typing[conversation = .conversation] where .principal != viewer { principal } }

query dmFor(other: principal):
  return first(members where .principal = viewer and conversations[.conversation].kind = 'dm' and (conversations[.conversation].peerA = other or conversations[.conversation].peerB = other) first 1 by .conversation { conversation })

mutation sendMedia(messageId: id, conversation: conversations, text: text <=500, photo: image <=10000000 ?, video: video <=50000000 ?, quote: messages ?, once: bool ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  require (photo != null) != (video != null) else ONE_MEDIA_REQUIRED
  require once != true or photo != null else ONCE_REQUIRES_PHOTO
  if video != null:
    require video.duration != null else DURATION_UNKNOWN
    require video.duration <= 60000 else VIDEO_TOO_LONG
  chat = conversations[conversation] ! else NOT_FOUND
  ordinal = chat.lastOrdinal + 1
  recipients = 0
  for member in members where .conversation = conversation:
    if member.principal != viewer:
      recipients = recipients + 1
  if quote != null:
    quoted = messages[quote] ! else QUOTE_NOT_FOUND
    require quoted.conversation = conversation else WRONG_CHAT
  update conversations[chat] { lastOrdinal: ordinal }
  m = insert messages { id: messageId, conversation, sender: viewer, ordinal, recipients, text, photo: photo if once != true else null, oncePhoto: photo if once = true else null, video, quote, expiresAt: expiryFor(chat.disappearing), at: now }
  notifyMembers(conversation, 'Video' if video != null else 'Photo')
  return m
mutation editMessage(message: messages, text: text <=2000):
  m = messages[message] ! else NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require not m.tombstone else MESSAGE_DELETED
  require now <= m.at + config.editWindow() else EDIT_WINDOW_CLOSED
  if m.photo != null or m.video != null or m.oncePhoto != null:
    require count(text) <= 500 else CAPTION_TOO_LONG
  update messages[m] { text, edited: true }
mutation deleteMessage(message: messages):
  m = messages[message] ! else NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require now <= m.at + config.deleteWindow() else DELETE_WINDOW_CLOSED
  update messages[m] { text: '', photo: null, oncePhoto: null, video: null, tombstone: true }
table reactions:
  message: messages
  principal: principal
  emoji: text 1..32
  unique message, principal
  cap 50 by message
  immutable message, principal
  read through .message
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync
mutation setReaction(message: messages, emoji: text 1..32 ?):
  m = messages[message] ! else NOT_FOUND
  require not m.tombstone else MESSAGE_DELETED
  if emoji != null:
    upsert reactions[message, viewer] { message, principal: viewer, emoji }
  else if exists reactions[message, viewer]:
    delete reactions[message, viewer]
query messageReactions(message: messages):
  return reactions where .message = message by .principal { id, message, principal, emoji }

fn expiryFor(setting: text):
  ttl = config.disappearingTTL(setting)
  return now + ttl if ttl != null else null
mutation rename(conversation: conversations, title: text 1..50, description: text <=200):
  chat = conversations[conversation] ! else NOT_FOUND
  require chat.kind = 'group' else NOT_GROUP
  require exists members[conversation = conversation, principal = viewer, role = 'admin'] else NOT_ADMIN
  update conversations[chat] { title, description }
mutation setAccent(conversation: conversations, accent: enum('#4F46E5', '#0D9488', '#EF6351', '#D97706', '#7C3AED', '#059669', '#E11D48', '#475569')):
  update conversations[conversation] { accent }
mutation setBackground(conversation: conversations, background: image <=10000000 ?):
  update conversations[conversation] { background }
mutation setDisappearing(conversation: conversations, setting: enum('off', '24h', '7d')):
  chat = conversations[conversation] ! else NOT_FOUND
  require chat.kind = 'dm' or exists members[conversation = conversation, principal = viewer, role = 'admin'] else NOT_ADMIN
  update conversations[chat] { disappearing: setting }
query inChat(conversation: conversations, q: text <=100, c: cursor ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  return messages[conversation = conversation] matching q last 20 by .at after c
query searchNewest(q: text <=100, c: cursor ?):
  return messages matching q where exists members[.conversation, viewer] last 20 by .at after c
query searchHeld(q: text <=100, c: cursor ?) held:
  return messages matching q last 20 by .at after c
query displayInfo(conversation: conversations):
  chat = conversations[conversation]
  if chat = null:
    return null
  return { chat, other: profiles[principal = chat.peerB if chat.peerA = viewer else chat.peerA] }
query searchMessages(q: text <=100, conversation: conversations ?, c: cursor ?):
  if conversation != null:
    require exists members[conversation, viewer] else NOT_MEMBER
    return messages[conversation = conversation] matching q last 20 by .at after c
  return messages matching q where exists members[.conversation, viewer] last 20 by .at after c

fn notifyMembers(conversation: conversations, preview: text):
  sender = profiles[principal = viewer]
  for member in members where .conversation = conversation:
    if member.principal != viewer and not exists connected[member.principal]:
      emit notify { targetUserId: member.principal, chatId: conversation, senderDisplayName: sender.displayName if sender != null else 'Member', preview }
  return null
view reactionCounts: count reactions by .message, .emoji
fn firstReaction(r: reactions):
  first = first(reactions where .message = r.message and .emoji = r.emoji first 1 by .principal)
  return first.id = r.id
fn messageObject(m: messages):
  own = reactions[m.id, viewer]
  return { id: m.id, conversationId: m.conversation, senderId: m.sender, serverTimestamp: m.at, type: 'video' if m.video != null else 'photo' if m.photo != null or m.oncePhoto != null else 'text', text: m.text, media: m.oncePhoto if m.oncePhoto != null else m.photo if m.photo != null else m.video, viewOnce: m.oncePhoto != null, edited: m.edited, tombstone: m.tombstone, replyToId: m.quote, expiresAt: m.expiresAt, reactions: reactionCounts where .message = m.id { emoji, count, mine: own != null and own.emoji = .emoji }, receipt: receipt(m) if m.sender = viewer else null }
query apiHistory(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c { message: messageObject(.) }

view unread: count messages by members m
  where .conversation = m.conversation and .ordinal > m.seenOrdinal and .ordinal > m.joinedOrdinal and .sender != m.principal and not .tombstone
query unreadInboxes(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { conversation, unread: unread[.id] }
fn periodUnread(conversation: conversations, reader: principal, seen: int, joined: int, start: time, end: time):
  return count(messages where .conversation = conversation and .at >= start and .at < end and .ordinal > seen and .ordinal > joined and .sender != reader and not .tombstone)
fn digestUnread(reader: principal, start: time, end: time):
  unreadMessages = 0
  unreadChats = 0
  for m in members where .principal = reader:
    n = periodUnread(m.conversation, reader, m.seenOrdinal, m.joinedOrdinal, start, end)
    if n > 0:
      unreadMessages = unreadMessages + n
      unreadChats = unreadChats + 1
  return { unreadMessages, unreadChats }
