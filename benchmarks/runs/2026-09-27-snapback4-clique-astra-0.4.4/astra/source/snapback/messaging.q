effect notify

table conversations:
  title: text 1..50 ?
  description: text <=200 default ''
  color: text default '#4F46E5'
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  kind: enum('dm', 'group')
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
  oncePhoto: image <=10000000 once ?
  expiresAt: time ?
  photo: image <=10000000 ?
  video: video <=50000000 ?
  edited: bool default false
  tombstone: bool default false
  quote: messages ?
  search text
  at: time
  unique byConversationOrdinal: conversation, ordinal
  immutable conversation, sender, ordinal, recipients, at, expiresAt
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  update <- .sender = viewer and exists members[.conversation, viewer]
  expire at .expiresAt
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

query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c { *, type: 'view-once' if .oncePhoto != null else ('image' if .photo != null else ('video' if .video != null else 'text')), mediaRef: .oncePhoto ?? .photo ?? .video, reactions: reactionSummary(.id), receipt: receipt(.), senderProfile: profiles[principal = .sender], quoted: messages[.quote] { id, text, senderProfile: profiles[principal = .sender] } }

query progress(conversation: conversations, c: cursor ?):
  me = members[conversation, viewer] ! else NOT_MEMBER
  delivered = max(me.deliveredOrdinal, me.joinedOrdinal)
  return { member: me, runs: runs where .conversation = conversation and .principal = viewer, ahead: messages where .conversation = conversation and .ordinal > delivered first 100 by .ordinal after c }

mutation send(id: id, conversation: conversations, text: text <=2000, quote: messages ?, photo: image <=10000000 ?, video: video <=50000000 ?, oncePhoto: image <=10000000 ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  if quote != null:
    quoted = messages[quote] ! else NOT_FOUND
    require quoted.conversation = conversation else WRONG_CHAT
  require (photo = null or video = null) and (oncePhoto = null or (photo = null and video = null)) else MIXED_MEDIA
  if photo != null or video != null or oncePhoto != null:
    require count(text) <= 500 else CAPTION_TOO_LONG
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_TOO_LONG
  chat = conversations[conversation] ! else NOT_FOUND
  ttl = config.disappearingTtl(chat.disappearing)
  expiresAt = now + ttl if ttl > 0 else null
  ordinal = chat.lastOrdinal + 1
  recipients = 0
  for member in members where .conversation = conversation:
    if member.principal != viewer:
      recipients = recipients + 1
  update conversations[chat] { lastOrdinal: ordinal }
  m = insert messages { id, quote, photo, video, oncePhoto, expiresAt, conversation, sender: viewer, ordinal, recipients, text, at: now }
  senderName = profiles[principal = viewer].displayName
  for member in members where .conversation = conversation:
    if member.principal != viewer and not exists connected[member.principal]:
      emit notify { targetUserId: member.principal, chatId: conversation, senderDisplayName: senderName, preview: 'Video' if video != null else ('Photo' if photo != null or oncePhoto != null else slice(text, 0, 80)) } once ['message', m.id, member.principal]
  return m.id

mutation leave(conversation: conversations):
  me = members[conversation, viewer] ! else NOT_MEMBER
  for run in runs where .conversation = conversation and .principal = viewer:
    delete runs[run]
  delete members[me]
  return null

mutation delivered(conversation: conversations, from: int, through: int):
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
  for i in range(0, 1024):
    if prefix + 1 >= low:
      break
    if exists messages[conversation, prefix + 1]:
      break
    prefix = prefix + 1
  if low <= prefix + 1:
    update members[me] { deliveredOrdinal: high }
  else if count(runs where .conversation = conversation and .principal = viewer) < 64:
    if prefix > me.deliveredOrdinal:
      update members[me] { deliveredOrdinal: prefix }
    insert runs { conversation, principal: viewer, fromOrdinal: low, throughOrdinal: high }
  return null

mutation seen(conversation: conversations, through: int):
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  if through > me.seenOrdinal:
    update members[me] { seenOrdinal: through }
  return null

table dmPairs:
  low: principal
  high: principal
  conversation: conversations
  unique low, high
  immutable low, high, conversation
  read <- .low = viewer or .high = viewer
  insert <- .low = viewer or .high = viewer
  online only

mutation createDm(other: principal, id: id):
  require other != viewer else SELF_DM
  require exists profiles[principal = other] else USER_NOT_FOUND
  (low, high) = sorted(viewer, other)
  existing = dmPairs[low, high]
  if existing != null:
    return existing.conversation
  chat = insert conversations { id, kind: 'dm', creatorId: viewer }
  insert members { conversation: chat.id, principal: viewer, role: 'admin', joinedOrdinal: 0 }
  insert members { conversation: chat.id, principal: other, role: 'member', joinedOrdinal: 0 }
  insert dmPairs { low, high, conversation: chat.id }
  return chat.id
mutation createGroup(id: id, title: text 1..50, description: text <=200, others: [principal] <=49):
  require count(others) >= 1 else GROUP_NEEDS_MEMBERS
  chat = insert conversations { id, kind: 'group', title, description, creatorId: viewer }
  insert members { conversation: chat.id, principal: viewer, role: 'admin', joinedOrdinal: 0 }
  for p in others:
    require p != viewer else DUPLICATE_MEMBER
    require exists profiles[principal = p] else USER_NOT_FOUND
    insert members { conversation: chat.id, principal: p, role: 'member', joinedOrdinal: 0 } if absent
  return chat.id
mutation addMember(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  chat = conversations[conversation] ! else NOT_FOUND
  require chat.kind = 'group' else NOT_GROUP
  require exists profiles[principal = principal] else USER_NOT_FOUND
  insert members { conversation, principal, role: 'member', joinedOrdinal: chat.lastOrdinal } if absent
mutation removeMember(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  require conversations[conversation].kind = 'group' else NOT_GROUP
  for run in runs where .conversation = conversation and .principal = principal:
    delete runs[run]
  delete members[conversation, principal]
mutation promote(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  require conversations[conversation].kind = 'group' else NOT_GROUP
  update members[conversation, principal] { role: 'admin' }
query chat(id: conversations):
  return conversations[id]
query groupByTitle(title: text 1..50):
  return first(conversations where .title = title and .kind = 'group' first 1 by .id)
query dmFor(other: principal):
  (low, high) = sorted(viewer, other)
  return dmPairs[low, high].conversation
query roster(conversation: conversations):
  return members where .conversation = conversation { *, profile: profiles[principal = .principal] }
query inbox(c: cursor ?):
  return members where .principal = viewer first 100 by .conversation after c { *, chat: conversations[.conversation], peers: members[conversation = .conversation] where .principal != viewer { *, profile: profiles[principal = .principal] } }

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
  return typing where .conversation = conversation and .principal != viewer by .principal { principal, profile: profiles[principal = .principal] }

view unread: count messages by members m
  where .conversation = m.conversation and .ordinal > m.seenOrdinal and .sender != m.principal and not .tombstone
query unreadFor(member: members):
  return unread[member]

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
fn reactionSummary(message: messages):
  own = reactions[message, viewer]
  return group(reactions where .message = message, 'emoji') { emoji: .key, count: count(.items), mine: own != null and own.emoji = .key }
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
mutation edit(message: messages, text: text <=2000):
  m = messages[message] ! else NOT_FOUND
  require m.sender = viewer else NOT_OWNER
  require not m.tombstone else DELETED
  require now - m.at <= config.editWindow() else EDIT_WINDOW_CLOSED
  if m.photo != null or m.video != null or m.oncePhoto != null:
    require count(text) <= 500 else CAPTION_TOO_LONG
  update messages[m] { text, edited: true }
mutation remove(message: messages):
  m = messages[message] ! else NOT_FOUND
  require m.sender = viewer else NOT_OWNER
  require now - m.at <= config.deleteWindow() else DELETE_WINDOW_CLOSED
  update messages[m] { text: '', photo: null, video: null, oncePhoto: null, tombstone: true }
query message(id: messages):
  return messages[id] { *, type: 'view-once' if .oncePhoto != null else ('image' if .photo != null else ('video' if .video != null else 'text')), mediaRef: .oncePhoto ?? .photo ?? .video, reactions: reactionSummary(.id), receipt: receipt(.) }

fn requireSettings(conversation: conversations):
  chat = conversations[conversation] ! else NOT_FOUND
  member = members[conversation, viewer] ! else NOT_MEMBER
  require chat.kind = 'dm' or member.role = 'admin' else NOT_ADMIN
  return chat
mutation rename(conversation: conversations, title: text 1..50, description: text <=200):
  chat = requireSettings(conversation)
  require chat.kind = 'group' else NOT_GROUP
  update conversations[chat] { title, description }
mutation setColor(conversation: conversations, color: text):
  chat = requireSettings(conversation)
  require color in ['#4F46E5', '#0D9488', '#EF6351', '#D97706', '#7C3AED', '#059669', '#E11D48', '#475569'] else INVALID_COLOR
  update conversations[chat] { color }
mutation setBackground(conversation: conversations, background: image <=10000000 ?):
  chat = requireSettings(conversation)
  update conversations[chat] { background }
mutation setDisappearing(conversation: conversations, disappearing: enum('off', '24h', '7d')):
  chat = requireSettings(conversation)
  update conversations[chat] { disappearing }
fn searchPeers(conversation: conversations):
  if conversations[conversation].kind != 'dm':
    return []
  return members where .conversation = conversation and .principal != viewer { profile: profiles[principal = .principal] }
query searchChat(conversation: conversations, q: text <=100, c: cursor ?):
  return messages where .conversation = conversation and not .tombstone matching q last 20 by .ordinal after c { *, senderProfile: profiles[principal = .sender], chat: conversations[.conversation], peers: searchPeers(.conversation) }
query searchMessages(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone and exists members[.conversation, viewer] last 20 by .at after c { *, senderProfile: profiles[principal = .sender], chat: conversations[.conversation], peers: searchPeers(.conversation) }
