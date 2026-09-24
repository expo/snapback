effect notify
table chats:
  owner: principal
  kind: enum('dm', 'group')
  name: text 1..50
  description: text <=200
  color: text <=20 default '#4f46e5'
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  at: time
  immutable owner, kind, at
  read <- exists members[.id, viewer]
  insert <- .owner = viewer
  update <- exists members[chat = .id, principal = viewer, role = 'admin']
  retain delivered-history
  sync to members[.id]
table members:
  chat: chats
  principal: principal
  role: enum('member', 'admin')
  at: time
  readAt: time default 0
  unique chat, principal
  cap 50 by chat
  immutable chat, principal, at
  read <- exists members[.chat, viewer]
  insert <- exists members[chat = .chat, principal = viewer, role = 'admin'] or created chats[.chat]
  update <- .principal = viewer or exists members[chat = .chat, principal = viewer, role = 'admin']
  delete <- .principal = viewer or exists members[chat = .chat, principal = viewer, role = 'admin']
  retain delivered-history
  sync to members[.chat]
table pairs:
  principal: principal
  other: principal
  chat: chats
  unique principal, other
  immutable principal, other, chat
  read <- .principal = viewer
  insert <- created chats[.chat]
  sync to .principal
table messages:
  chat: chats
  sender: principal
  body: text <=2000
  quote: messages ?
  oncePhoto: image <=10000000 once ?
  expiresAt: time ?
  search body
  photo: image <=10000000 ?
  video: video <=50000000 ?
  edited: bool default false
  tombstone: bool default false
  at: time
  immutable chat, sender, at, quote
  read <- exists members[.chat, viewer]
  insert <- .sender = viewer and exists members[.chat, viewer]
  update <- .sender = viewer and exists members[.chat, viewer]
  expire at .expiresAt
  retain delivered-history
  sync to members[.chat] last 10000 by .at
table receipts:
  message: messages
  chat: chats
  principal: principal
  state: int
  visible: bool default true
  expiresAt: time ?
  unique message, principal
  cap 50 by message
  immutable message, chat, principal
  read <- exists members[.chat, viewer]
  insert <- created messages[.message]
  update (old, next) <- old.principal = viewer or exists messages[id = old.message, sender = viewer]
  retain delivered-history
  sync to members[.chat]
table ephemeralReceipts:
  message: messages
  chat: chats
  principal: principal
  state: int
  visible: bool default true
  expiresAt: time ?
  unique message, principal
  cap 50 by message
  immutable message, chat, principal
  read <- exists members[.chat, viewer]
  insert <- created messages[.message]
  update (old, next) <- old.principal = viewer or exists messages[id = old.message, sender = viewer]
  expire at .expiresAt
  retain delivered-history
  sync to members[.chat]
table typing:
  chat: chats
  principal: principal
  expiresAt: time
  unique chat, principal
  cap 50 by chat
  immutable chat, principal
  read <- exists members[.chat, viewer]
  insert <- .principal = viewer and exists members[.chat, viewer]
  update <- .principal = viewer and exists members[.chat, viewer]
  expire at .expiresAt
  sync to members[.chat]
fn receiptState(m: messages):
  state = 2
  for r in receipts where .message = m.id:
    if exists members[m.chat, r.principal]:
      state = min(state, r.state)
  for r in ephemeralReceipts where .message = m.id:
    if exists members[m.chat, r.principal]:
      state = min(state, r.state)
  return 'read' if state = 2 else 'delivered' if state = 1 else 'sent'
shape messageCard = { *, conversationId: .chat, senderId: .sender, serverTimestamp: .at, type: 'image' if .photo != null or .oncePhoto != null else 'video' if .video != null else 'text', text: .body, mediaReference: .oncePhoto ?? .photo ?? .video, replyToId: .quote, senderProfile: profiles[principal = .sender], quoted: messages[.quote] { body, senderProfile: profiles[principal = .sender] }, receipt: receiptState(.), reactions: reactionList(.) }
fn otherProfile(chat: chats):
  p = first(members where .chat = chat and .principal != viewer first 50 by .principal)
  return profiles[principal = p.principal]
view unreadCounts: count receipts where .state < 2 and .visible by .chat, .principal
view ephemeralUnreadCounts: count ephemeralReceipts where .state < 2 and .visible by .chat, .principal
fn unread(m: members):
  return unreadCounts[m.chat, viewer] + ephemeralUnreadCounts[m.chat, viewer]
query inbox(c: cursor ?):
  return members where .principal = viewer last 50 by .at after c { *, conversation: chats[.chat], other: otherProfile(.chat), unread: unread(.) }
query chat(id: chats):
  return chats[id]
query findGroup(name: text 1..50):
  return first(chats where .kind = 'group' and .name = name first 50 by .at)
query pair(other: principal):
  return pairs[viewer, other]
query roster(chat: chats):
  return members where .chat = chat { *, profile: profiles[principal = .principal] }
query history(chat: chats, c: cursor ?):
  return messages where .chat = chat last 50 by .at after c messageCard
query typingNow(chat: chats):
  return typing where .chat = chat { principal, expiresAt }
mutation startDM(id: id, other: principal):
  require other != viewer else SELF_DM
  existing = pairs[viewer, other]
  if existing != null:
    return existing.chat
  require exists profiles[principal = other] else PROFILE_NOT_FOUND
  row = insert chats { id, owner: viewer, kind: 'dm', name: 'Direct message', description: '', at: now }
  insert members { chat: row.id, principal: viewer, role: 'admin', at: now }
  insert members { chat: row.id, principal: other, role: 'admin', at: now }
  insert pairs { principal: viewer, other, chat: row.id }
  insert pairs { principal: other, other: viewer, chat: row.id }
  return row.id
mutation createGroup(id: id, other: principal, name: text 1..50, description: text <=200):
  require other != viewer else SECOND_MEMBER_REQUIRED
  require exists profiles[principal = other] else PROFILE_NOT_FOUND
  row = insert chats { id, owner: viewer, kind: 'group', name, description, at: now }
  insert members { chat: row.id, principal: viewer, role: 'admin', at: now }
  insert members { chat: row.id, principal: other, role: 'member', at: now }
  return row.id
mutation addMember(chat: chats, principal: principal):
  require exists members[chat = chat, principal = viewer, role = 'admin'] else NOT_ADMIN
  require chats[chat].kind = 'group' else NOT_GROUP
  require exists profiles[principal = principal] else PROFILE_NOT_FOUND
  insert members { chat, principal, role: 'member', at: now } if absent
mutation removeMember(chat: chats, principal: principal):
  require principal = viewer or exists members[chat = chat, principal = viewer, role = 'admin'] else NOT_ADMIN
  require chats[chat].kind = 'group' else NOT_GROUP
  if exists members[chat, principal]:
    delete members[chat, principal]
mutation promote(chat: chats, principal: principal):
  require exists members[chat = chat, principal = viewer, role = 'admin'] else NOT_ADMIN
  update members[chat, principal] { role: 'admin' }
mutation send(id: id, chat: chats, body: text <=2000, quote: messages ?, photo: image <=10000000 ?, video: video <=50000000 ?, oncePhoto: image <=10000000 ?):
  require exists members[chat, viewer] else NOT_MEMBER
  if quote != null:
    require messages[quote].chat = chat else QUOTE_WRONG_CHAT
  require oncePhoto = null or (photo = null and video = null) else MIXED_MEDIA
  require photo = null or video = null else MIXED_MEDIA
  if photo != null or video != null or oncePhoto != null:
    require count(body) <= 500 else CAPTION_TOO_LONG
  if video != null:
    duration = video.duration
    require duration != null else DURATION_UNKNOWN
    require duration <= 60000 else VIDEO_TOO_LONG
  m = insert messages { id, chat, sender: viewer, body, quote, photo, video, oncePhoto, at: now, expiresAt: now + shortTTL() if chats[chat].disappearing = '24h' else now + longTTL() if chats[chat].disappearing = '7d' else null }
  senderDisplayName = profiles[principal = viewer].displayName
  preview = 'Photo' if photo != null or oncePhoto != null else 'Video' if video != null else slice(body, 0, 80)
  for p in members where .chat = chat:
    if p.principal != viewer:
      if m.expiresAt = null:
        insert receipts { message: m.id, chat, principal: p.principal, state: 0 }
      else:
        insert ephemeralReceipts { message: m.id, chat, principal: p.principal, state: 0, expiresAt: m.expiresAt }
      if not exists connected[p.principal]:
        emit notify { targetUserId: p.principal, chatId: chat, senderDisplayName, preview }
  return m
mutation typing(chat: chats):
  upsert typing[chat, viewer] { chat, principal: viewer, expiresAt: now + 4s }
mutation fetched(chat: chats, ids: [messages] <=50, opened: bool):
  require exists members[chat, viewer] else NOT_MEMBER
  for id in ids:
    r = receipts[id, viewer]
    if r != null:
      require r.chat = chat else WRONG_CHAT
      update receipts[id, viewer] { state: max(r.state, 2 if opened else 1) }
    e = ephemeralReceipts[id, viewer]
    if e != null:
      require e.chat = chat else WRONG_CHAT
      update ephemeralReceipts[e.id] { state: max(e.state, 2 if opened else 1) }
  if opened:
    update members[chat, viewer] { readAt: now }

table reactions:
  message: messages
  chat: chats
  principal: principal
  emoji: text 1..32
  unique chat, message, principal
  cap 50 by chat, message
  immutable message, chat, principal
  read <- exists members[.chat, viewer]
  insert <- .principal = viewer and exists members[.chat, viewer]
  update <- .principal = viewer and exists members[.chat, viewer]
  delete <- .principal = viewer and exists members[.chat, viewer]
  sync to members[.chat]
fn reactionList(m: messages):
  rows = reactions where .chat = m.chat and .message = m.id
  return group(rows, 'emoji') { emoji: .key, count: count(.items), mine: reactions[m.chat, m.id, viewer].emoji = .key }
mutation react(message: messages, emoji: text 1..32 ?):
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require not m.tombstone else MESSAGE_DELETED
  if emoji != null:
    upsert reactions[m.chat, message, viewer] { message, chat: m.chat, principal: viewer, emoji }
  else if exists reactions[m.chat, message, viewer]:
    delete reactions[m.chat, message, viewer]
mutation edit(message: messages, body: text <=2000): server
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require not m.tombstone else MESSAGE_DELETED
  require now - m.at <= editWindow() else EDIT_WINDOW_CLOSED
  if m.photo != null or m.video != null or m.oncePhoto != null:
    require count(body) <= 500 else CAPTION_TOO_LONG
  update messages[message] { body, edited: true }
mutation deleteMessage(message: messages): server
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require now - m.at <= deleteWindow() else DELETE_WINDOW_CLOSED
  for p in members where .chat = m.chat:
    r = receipts[message, p.principal]
    if r != null:
      update receipts[r.id] { visible: false }
    e = ephemeralReceipts[message, p.principal]
    if e != null:
      update ephemeralReceipts[e.id] { visible: false }
  update messages[message] { body: '', photo: null, video: null, oncePhoto: null, tombstone: true }

mutation customize(chat: chats, name: text 1..50 ?, description: text <=200 ?, color: text <=20 ?, background: image <=10000000 ?, disappearing: enum('off', '24h', '7d') ?):
  row = chats[chat] ! else NOT_MEMBER
  require exists members[chat, viewer] else NOT_MEMBER
  require row.kind = 'dm' or exists members[chat = chat, principal = viewer, role = 'admin'] else NOT_ADMIN
  if name != null:
    require row.kind = 'group' else GROUP_ONLY
    update chats[chat] { name }
  if description != null:
    require row.kind = 'group' else GROUP_ONLY
    update chats[chat] { description }
  if color != null:
    require color = '#4F46E5' or color = '#0D9488' or color = '#EF6351' or color = '#D97706' or color = '#7C3AED' or color = '#059669' or color = '#E11D48' or color = '#475569' else INVALID_COLOR
    update chats[chat] { color }
  if background != null:
    update chats[chat] { background }
  if disappearing != null:
    update chats[chat] { disappearing }
query searchChat(chat: chats, q: text <=100, c: cursor ?):
  return messages where .chat = chat and not .tombstone matching q last 50 by .at after c messageCard
query searchAll(q: text <=100, c: cursor ?):
  return messages matching q where exists members[.chat, viewer] and not .tombstone last 50 by .at after c { *, conversation: chats[.chat] }

job repairReceiptExpiry():
  for r in receipts:
    m = messages[r.message]
    if m = null:
      update receipts[r.id] { visible: false }
    else:
      if m.expiresAt != null:
        insert ephemeralReceipts { id: r.id, message: r.message, chat: r.chat, principal: r.principal, state: r.state, visible: not m.tombstone, expiresAt: m.expiresAt } if absent
        delete receipts[r.id]
      else:
        update receipts[r.id] { visible: not m.tombstone }
