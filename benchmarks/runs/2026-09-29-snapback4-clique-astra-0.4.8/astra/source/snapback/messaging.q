effect notify

table conversations:
  title: text 1..50
  description: text <=200 default ''
  kind: enum('dm', 'group')
  peerA: principal
  peerB: principal
  creatorId: principal
  lastOrdinal: int default 0
  accent: text <=7 default '#4F46E5'
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  read <- exists members[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists members[.id, viewer]
  after insert <- exists members[conversation = .id, principal = .creatorId]
  retain delivered-history
  sync to members[.id]

table members:
  conversation: conversations
  principal: principal
  role: enum('member', 'admin') default 'member'
  joinedOrdinal: int
  deliveredOrdinal: int default 0
  seenOrdinal: int default 0
  unique conversation, principal
  cap 50 by conversation
  immutable conversation, principal, joinedOrdinal
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[.conversation, viewer, role = 'admin']
  update <- .principal = viewer or exists members[.conversation, viewer, role = 'admin']
  delete <- .principal = viewer or exists members[.conversation, viewer, role = 'admin']
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
  delete <- .principal = viewer or exists members[.conversation, viewer, role = 'admin']
  sync to members[.conversation]

table messages:
  conversation: conversations
  sender: principal
  ordinal: int
  recipients: int
  text: text <=2000
  quote: messages ?
  photo: image <=10000000 ?
  oncePhoto: image <=10000000 once ?
  expiresAt: time ?
  video: video <=50000000 ?
  edited: bool default false
  tombstone: bool default false
  search text
  at: time
  unique byConversationOrdinal: conversation, ordinal
  -- Immutable scope and time keep search keyset positions stable across updates.
  immutable conversation, sender, ordinal, recipients, at, expiresAt
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  update <- .sender = viewer and exists members[.conversation, viewer]
  retain delivered-history
  expire at .expiresAt
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
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c

query messageReceipts(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c { id, receipt: receipt(.) }

query receiptMember(conversation: conversations):
  return members[conversation, viewer]

query progress(conversation: conversations, c: cursor ?):
  me = members[conversation, viewer] ! else NOT_MEMBER
  delivered = max(me.deliveredOrdinal, me.joinedOrdinal)
  return { member: me, runs: runs where .conversation = conversation and .principal = viewer, ahead: messages where .conversation = conversation and .ordinal > delivered and .ordinal <= delivered + 100 last 100 by .ordinal after c }

mutation send(conversation: conversations, id: id, text: text <=2000, quote: messages ?, photo: image <=10000000 ?, video: video <=50000000 ?, oncePhoto: image <=10000000 ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  ordinal = chat.lastOrdinal + 1
  recipients = 0
  for member in members where .conversation = conversation:
    if member.principal != viewer:
      recipients = recipients + 1
  update conversations[chat] { lastOrdinal: ordinal }
  if quote != null:
    source = messages[quote] ! else QUOTE_NOT_FOUND
    require source.conversation = conversation else WRONG_CONVERSATION
  require (photo = null or video = null) and (photo = null or oncePhoto = null) and (video = null or oncePhoto = null) else MIXED_MEDIA
  require count(trim(text)) > 0 or photo != null or video != null or oncePhoto != null else EMPTY_MESSAGE
  if photo != null or video != null or oncePhoto != null:
    require count(text) <= 500 else CAPTION_TOO_LONG
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_TOO_LONG
  m = insert messages { id, conversation, sender: viewer, ordinal, recipients, text, quote, photo, video, oncePhoto, at: now, expiresAt: now + disappearingTTL(chat.disappearing) if chat.disappearing != 'off' else null }
  for member in members where .conversation = conversation:
    if member.principal != viewer and not exists connected[member.principal]:
      emit notify { targetUserId: member.principal, chatId: conversation, senderDisplayName: profiles[principal = viewer].displayName, preview: 'Photo' if photo != null or oncePhoto != null else 'Video' if video != null else slice(text, 0, 80) }
  return m.id

mutation add(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  require exists profiles[principal = principal] else PROFILE_NOT_FOUND
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

query message(id: messages):
  return messages[id]


table dmPairs:
  first: principal
  second: principal
  conversation: conversations
  unique first, second
  immutable first, second, conversation
  read <- .first = viewer or .second = viewer
  insert <- .first = viewer
  online only
mutation createDM(id: id, other: principal):
  require other != viewer else SELF_DM
  require exists profiles[principal = other] else PROFILE_NOT_FOUND
  pair = dmPairs[viewer, other]
  if pair != null:
    return pair.conversation
  reverse = dmPairs[other, viewer]
  if reverse != null:
    return reverse.conversation
  chat = insert conversations { id, title: 'Conversation', kind: 'dm', peerA: viewer, peerB: other, creatorId: viewer }
  insert members { conversation: chat.id, principal: viewer, joinedOrdinal: 0 }
  insert members { conversation: chat.id, principal: other, joinedOrdinal: 0 }
  insert dmPairs { first: viewer, second: other, conversation: chat.id }
  return chat.id
mutation createGroup(id: id, other: principal, title: text 1..50, description: text <=200):
  require other != viewer else SECOND_MEMBER_REQUIRED
  require exists profiles[principal = other] else PROFILE_NOT_FOUND
  chat = insert conversations { id, title, description, kind: 'group', peerA: viewer, peerB: other, creatorId: viewer }
  insert members { conversation: chat.id, principal: viewer, role: 'admin', joinedOrdinal: 0 }
  insert members { conversation: chat.id, principal: other, joinedOrdinal: 0 }
  return chat.id
mutation remove(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  for run in runs where .conversation = conversation and .principal = principal:
    delete runs[run]
  if exists members[conversation, principal]:
    delete members[conversation, principal]
mutation promote(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  update members[conversation, principal] { role: 'admin' }
query roster(conversation: conversations):
  return members where .conversation = conversation { *, profile: profiles[principal = .principal] }
query namedGroup(title: text 1..50):
  return first(conversations where .title = title and .kind = 'group' first 1 by .id)
query dm(other: principal):
  chat = first(conversations where .kind = 'dm' and ((.peerA = viewer and .peerB = other) or (.peerB = viewer and .peerA = other)) first 1 by .id)
  return chat.id
view unread: count messages by members m where .conversation = m.conversation and .ordinal > m.seenOrdinal and .sender != m.principal and not .tombstone
query unreadCount(conversation: conversations):
  me = members[conversation, viewer]
  return unread[me.id] if me != null else 0

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

mutation editMessage(message: messages, text: text <=2000):
  m = messages[message] ! else NOT_FOUND
  require m.sender = viewer else NOT_OWNER
  require not m.tombstone else DELETED
  require now <= m.at + editWindow() else EDIT_WINDOW_CLOSED
  if m.photo != null or m.video != null or m.oncePhoto != null:
    require count(text) <= 500 else CAPTION_TOO_LONG
  else:
    require count(trim(text)) > 0 else EMPTY_MESSAGE
  update messages[m] { text, edited: true }
mutation deleteMessage(message: messages):
  m = messages[message] ! else NOT_FOUND
  require m.sender = viewer else NOT_OWNER
  require now <= m.at + deleteWindow() else DELETE_WINDOW_CLOSED
  update messages[m] { text: '', photo: null, video: null, oncePhoto: null, tombstone: true }
table reactions:
  message: messages
  principal: principal
  emoji: text 1..32
  unique message, principal
  immutable message, principal
  read through .message
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync
mutation setReaction(message: messages, emoji: text 1..32 ?):
  m = messages[message] ! else NOT_FOUND
  require exists members[m.conversation, viewer] else NOT_MEMBER
  require not m.tombstone else DELETED
  if emoji = null:
    if exists reactions[message, viewer]:
      delete reactions[message, viewer]
  else if exists reactions[message, viewer]:
    update reactions[message, viewer] { emoji }
  else:
    insert reactions { message, principal: viewer, emoji }
query reactionState(message: messages):
  return reactions[message, viewer]
query reactionRows(message: messages, c: cursor ?):
  return reactions where .message = message first 50 by .principal after c

mutation setIdentity(conversation: conversations, title: text 1..50 ?, description: text <=200 ?):
  chat = conversations[conversation] ! else NOT_FOUND
  require chat.kind = 'group' else GROUP_ONLY
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  if title != null:
    update conversations[chat] { title }
  if description != null:
    update conversations[chat] { description }
mutation setAccent(conversation: conversations, accent: enum('#4F46E5', '#0D9488', '#EF6351', '#D97706', '#7C3AED', '#059669', '#E11D48', '#475569')):
  require exists members[conversation, viewer] else NOT_MEMBER
  update conversations[conversation] { accent }
mutation setBackground(conversation: conversations, background: image <=10000000 ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  update conversations[conversation] { background }
mutation setDisappearing(conversation: conversations, mode: enum('off', '24h', '7d')):
  chat = conversations[conversation] ! else NOT_FOUND
  require exists members[conversation, viewer] else NOT_MEMBER
  require chat.kind = 'dm' or exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  update conversations[chat] { disappearing: mode }
query searchChat(conversation: conversations, q: text <=100, c: cursor ?):
  return messages[conversation = conversation] matching q where not .tombstone last 20 by .at after c
query search(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone last 20 by .at after c

query searchGrouped(q: text <=100, c: cursor ?):
  return members[principal = viewer] after c first 20 by .conversation where exists (messages[conversation = .conversation, tombstone = false] by .at matching q) { conversation, hits: messages[conversation = .conversation, tombstone = false] matching q last 3 by .at }
