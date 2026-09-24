effect push

table conversations:
  kind: enum('dm', 'group')
  name: text 1..50
  description: text <=200
  creatorId: principal
  color: text <=7 default '#4F46E5'
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  lastOrdinal: int default 0
  lastAt: time default now
  by byName: name, id
  immutable kind, creatorId
  read <- exists members[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists members[.id, viewer]
  after insert <- exists members[.id, .creatorId, 'admin']
  retain delivered-history
  sync to members[.id]

table dmPairs:
  first: principal
  second: principal
  conversationId: conversations
  unique byPair: first, second
  immutable first, second, conversationId
  read <- .first = viewer or .second = viewer
  insert <- .first = viewer
  online only

table members:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedOrdinal: int
  delivered: int default 0
  readOrdinal: int default 0
  unique byPair: conversationId, principal
  by byRole: conversationId, principal, role
  by byPrincipal: principal, conversationId, id
  cap 50 by conversationId
  immutable conversationId, principal, joinedOrdinal
  read <- exists members[.conversationId, viewer]
  insert <- exists members[.conversationId, viewer, 'admin'] or created conversations[.conversationId]
  update <- .principal = viewer or exists members[.conversationId, viewer, 'admin']
  delete <- .principal = viewer or exists members[.conversationId, viewer, 'admin']
  sync to members[.conversationId]

table messages:
  conversationId: conversations
  senderId: principal
  body: text <=2000
  kind: enum('text', 'image', 'video') default 'text'
  photo: image <=10000000 ?
  oncePhoto: image <=10000000 once ?
  expiresAt: time ?
  video: video <=50000000 ?
  edited: bool default false
  tombstone: bool default false
  replyToId: messages ?
  recipients: [principal] <=50
  ordinal: int
  at: time
  by byConversationOrdinal: conversationId, ordinal, id
  by byConversationTime: conversationId, at, id
  by byRoomWords: conversationId, words(body), at, id
  by byWords: words(body), at, id
  by byExpiry: expiresAt
  immutable conversationId, senderId, ordinal, at, recipients
  read <- exists members[.conversationId, viewer]
  insert <- .senderId = viewer and exists members[.conversationId, viewer]
  update <- .senderId = viewer and exists members[.conversationId, viewer]
  retain delivered-history
  expire at .expiresAt
  sync to members[.conversationId] last 10000 by byConversationOrdinal

table typing:
  conversationId: conversations
  principal: principal
  expiresAt: time
  unique byPair: conversationId, principal
  by byExpires: expiresAt
  cap 50 by conversationId
  read <- exists members[.conversationId, viewer]
  insert <- .principal = viewer and exists members[.conversationId, viewer]
  update <- .principal = viewer and exists members[.conversationId, viewer]
  delete <- .principal = viewer
  expire at .expiresAt
  sync to members[.conversationId]

fn receipt(m: messages):
  delivered = true
  read = true
  for p in m.recipients:
    member = members[m.conversationId, p]
    if member != null and member.joinedOrdinal < m.ordinal:
      if member.delivered < m.ordinal:
        delivered = false
      if member.readOrdinal < m.ordinal:
        read = false
  return 'read' if read else ('delivered' if delivered else 'sent')
shape messageCard = { *, opened: exists views[.id, viewer], reactions: reactionCounts[.conversationId, .id] by byGroup { emoji, count: .value, mine: reactions[messageId = .messageId, principal = viewer].emoji = .emoji }, sender: profiles[principal = .senderId], quote: messages[.replyToId] { id, body, sender: profiles[principal = .senderId] }, receipt: receipt(.) }
shape roomCard = { *, roster: members[.id] by byPair { *, profile: profiles[principal = .principal] }, typing: typing[.id] by byPair { principal, expiresAt }, unread: .lastOrdinal > (members[.id, viewer].readOrdinal ?? 0) }
query inbox(c: cursor ?):
  return members[viewer] after c first 100 by byPrincipal { *, conversation: conversations[.conversationId] roomCard }
query room(conversationId: conversations):
  return conversations[conversationId] roomCard
query group(name: text 1..50, c: cursor ?):
  return conversations[name] after c first 20 by byName roomCard
query dm(other: principal):
  pair = dmPairs[viewer, other] ?? dmPairs[other, viewer]
  return conversations[pair.conversationId] roomCard
query history(conversationId: conversations, c: cursor ?):
  return messages[conversationId] after c last 50 by byConversationOrdinal messageCard
query message(messageId: messages):
  return messages[messageId] messageCard
query typingNow(conversationId: conversations):
  return typing[conversationId] by byPair { principal, expiresAt }
mutation createDM(conversationId: id, other: principal):
  require other != viewer else SELF_DM
  require exists profiles[principal = other] else PERSON_NOT_FOUND
  pair = dmPairs[viewer, other] ?? dmPairs[other, viewer]
  if pair != null:
    return conversations[pair.conversationId]
  r = insert conversations { id: conversationId, kind: 'dm', name: 'Direct message', description: '', creatorId: viewer }
  insert members { conversationId: r.id, principal: viewer, role: 'admin', joinedOrdinal: 0 }
  insert members { conversationId: r.id, principal: other, role: 'member', joinedOrdinal: 0 }
  insert dmPairs { first: viewer, second: other, conversationId: r.id }
  return r
mutation createGroup(conversationId: id, other: principal, name: text 1..50, description: text <=200):
  require other != viewer else SECOND_MEMBER_REQUIRED
  require exists profiles[principal = other] else PERSON_NOT_FOUND
  if exists conversations[conversationId]:
    return conversations[conversationId]
  r = insert conversations { id: conversationId, kind: 'group', name, description, creatorId: viewer }
  insert members { conversationId: r.id, principal: viewer, role: 'admin', joinedOrdinal: 0 }
  insert members { conversationId: r.id, principal: other, role: 'member', joinedOrdinal: 0 }
  return r
mutation addMember(conversationId: conversations, principal: principal):
  require exists members[conversationId, viewer, 'admin'] else NOT_ADMIN
  room = conversations[conversationId] ! else NOT_FOUND
  require room.kind = 'group' else NOT_GROUP
  require exists profiles[principal = principal] else PERSON_NOT_FOUND
  insert members { conversationId, principal, role: 'member', joinedOrdinal: room.lastOrdinal } if absent
mutation promote(conversationId: conversations, principal: principal):
  require exists members[conversationId, viewer, 'admin'] else NOT_ADMIN
  update members[conversationId, principal] { role: 'admin' }
mutation removeMember(conversationId: conversations, principal: principal):
  require exists members[conversationId, viewer, 'admin'] else NOT_ADMIN
  require conversations[conversationId].kind = 'group' else NOT_GROUP
  if exists members[conversationId, principal]:
    delete members[conversationId, principal]
mutation leave(conversationId: conversations):
  require conversations[conversationId].kind = 'group' else NOT_GROUP
  delete members[conversationId, viewer]
mutation send(messageId: id, conversationId: conversations, body: text <=2000, replyToId: messages ?, photo: image <=10000000 ?, video: video <=50000000 ?, once: bool ?):
  require exists members[conversationId, viewer] else NOT_MEMBER
  require count(body) > 0 or photo != null or video != null else EMPTY_MESSAGE
  require not (photo != null and video != null) else MIXED_MEDIA
  require once != true or (photo != null and video = null) else PHOTO_REQUIRED
  if photo != null or video != null:
    require count(body) <= 500 else CAPTION_TOO_LONG
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_TOO_LONG
  room = conversations[conversationId] ! else NOT_FOUND
  if replyToId != null:
    require messages[replyToId].conversationId = conversationId else INVALID_QUOTE
  recipients = []
  for member in members[conversationId] by byPair:
    if member.principal != viewer:
      recipients = recipients + [member.principal]
  ordinal = room.lastOrdinal + 1
  update conversations[conversationId] { lastOrdinal: ordinal, lastAt: now }
  update members[conversationId, viewer] { delivered: ordinal, readOrdinal: ordinal }
  msg = insert messages { id: messageId, conversationId, senderId: viewer, body, photo: photo if once != true else null, oncePhoto: photo if once = true else null, expiresAt: now + disappearanceMs(room.disappearing) if room.disappearing != 'off' else null, video, kind: 'video' if video != null else ('image' if photo != null else 'text'), replyToId, recipients, ordinal, at: now }
  senderDisplayName = profiles[principal = viewer].displayName
  preview = 'Video' if video != null else ('Photo' if photo != null else slice(body, 0, 80))
  for p in recipients:
    if not exists connected[p]:
      emit push { targetUserId: p, chatId: conversationId, senderDisplayName, preview }
  return msg
mutation acknowledge(conversationId: conversations, through: messages, viewed: bool):
  m = messages[through] ! else MESSAGE_NOT_FOUND
  require m.conversationId = conversationId else INVALID_MESSAGE
  member = members[conversationId, viewer] ! else NOT_MEMBER
  update members[conversationId, viewer] { delivered: max(member.delivered, m.ordinal), readOrdinal: max(member.readOrdinal, m.ordinal) if viewed else member.readOrdinal }
mutation setTyping(conversationId: conversations):
  upsert typing[conversationId, viewer] { conversationId, principal: viewer, expiresAt: now + 4500 }

table reactions:
  conversationId: conversations
  messageId: messages
  principal: principal
  emoji: text 1..64
  expiresAt: time ?
  by byExpiry: expiresAt
  unique byMessagePrincipal: messageId, principal
  unique byConversationMessage: conversationId, messageId, principal
  cap 50 by messageId
  immutable conversationId, messageId, principal
  read <- exists members[.conversationId, viewer]
  insert <- .principal = viewer and exists members[.conversationId, viewer]
  update <- .principal = viewer and exists members[.conversationId, viewer]
  delete <- .principal = viewer and exists members[.conversationId, viewer]
  expire at .expiresAt
  sync to members[.conversationId]
maintain reactionCounts: count reactions by conversationId, messageId, emoji
  read <- exists members[.conversationId, viewer]
mutation react(messageId: messages, emoji: text <=64 ?):
  m = messages[messageId] ! else MESSAGE_NOT_FOUND
  require exists members[m.conversationId, viewer] else NOT_MEMBER
  require not m.tombstone else MESSAGE_DELETED
  if emoji != null and count(emoji) > 0:
    upsert reactions[m.conversationId, messageId, viewer] { conversationId: m.conversationId, messageId, principal: viewer, emoji, expiresAt: m.expiresAt }
  else if exists reactions[messageId, viewer]:
    delete reactions[m.conversationId, messageId, viewer]
mutation edit(messageId: messages, body: text <=2000):
  m = messages[messageId] ! else MESSAGE_NOT_FOUND
  require m.senderId = viewer else NOT_SENDER
  require not m.tombstone else MESSAGE_DELETED
  require now - m.at <= editWindowMs() else EDIT_WINDOW_CLOSED
  if m.kind != 'text':
    require count(body) <= 500 else CAPTION_TOO_LONG
  update messages[messageId] { body, edited: true }
mutation deleteMessage(messageId: messages):
  m = messages[messageId] ! else MESSAGE_NOT_FOUND
  require m.senderId = viewer else NOT_SENDER
  require now - m.at <= deleteWindowMs() else DELETE_WINDOW_CLOSED
  update messages[messageId] { body: '', photo: null, oncePhoto: null, video: null, tombstone: true }

table views:
  messageId: messages
  principal: principal
  by byPrincipal: principal, id
  unique byPair: messageId, principal
  read <- .principal = viewer
  insert <- .principal = viewer
  sync to .principal
mutation markViewed(messageId: messages):
  require exists messages[messageId] else MESSAGE_NOT_FOUND
  insert views { messageId, principal: viewer } if absent
mutation setAppearance(conversationId: conversations, color: text <=7):
  require exists members[conversationId, viewer] else NOT_MEMBER
  require color = '#4F46E5' or color = '#0D9488' or color = '#EF6351' or color = '#D97706' or color = '#7C3AED' or color = '#059669' or color = '#E11D48' or color = '#475569' else INVALID_COLOR
  update conversations[conversationId] { color }
mutation setBackground(conversationId: conversations, background: image <=10000000):
  require exists members[conversationId, viewer] else NOT_MEMBER
  update conversations[conversationId] { background }
mutation rename(conversationId: conversations, name: text 1..50, description: text <=200):
  require exists members[conversationId, viewer, 'admin'] else NOT_ADMIN
  require conversations[conversationId].kind = 'group' else NOT_GROUP
  update conversations[conversationId] { name, description }
mutation setDisappearing(conversationId: conversations, setting: enum('off', '24h', '7d')):
  require exists members[conversationId, viewer] else NOT_MEMBER
  require conversations[conversationId].kind = 'dm' or exists members[conversationId, viewer, 'admin'] else NOT_ADMIN
  update conversations[conversationId] { disappearing: setting }
query searchChat(conversationId: conversations, q: text <=100, c: cursor ?):
  return messages[conversationId] matching q after c last 20 by byRoomWords where not .tombstone messageCard
query searchAll(q: text <=100, c: cursor ?):
  return merge messages matching q after c last 20 by byRoomWords where not .tombstone:
    [m.conversationId] for m in members[viewer]
query searchHeld(q: text <=100, c: cursor ?) held:
  return messages matching q after c last 20 by byWords where not .tombstone
