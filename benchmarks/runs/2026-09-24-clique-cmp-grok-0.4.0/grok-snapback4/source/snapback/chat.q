-- Clique messaging: DMs, groups, receipts, media, reactions, ephemeral, search.
-- Edit window 60s, delete-for-everyone 120s (config/windows.json shortened).
-- Disappearing 24h=180s, 7d=300s.

table conversations:
  kind: enum('dm', 'group')
  title: text 1..50 ?
  description: text <=200 default ""
  creatorId: principal
  lastOrdinal: int default 0
  accent: text <=16 default "indigo"
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  immutable creatorId, kind
  read <- exists memberships[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists memberships[.id, viewer]
  delete <- deny
  after insert <- exists memberships[conversationId = .id, principal = .creatorId]
  retain delivered-history
  sync to memberships[.id]

table memberships:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  readOrdinal: int default 0
  unique byConversationPrincipal: conversationId, principal
  by byConversationPrincipalRole: conversationId, principal, role
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  immutable conversationId, principal, joinedAt
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin'] or created conversations[.conversationId]
  update <- .principal = viewer or exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin']
  delete <- .principal = viewer or exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin']
  retain delivered-history
  sync to memberships[.conversationId]

table dmPairs:
  userA: principal
  userB: principal
  conversationId: conversations
  unique byPair: userA, userB
  immutable userA, userB, conversationId
  public 'dm pair index'
  insert <- .userA = viewer or .userB = viewer
  online only

table messages:
  conversationId: conversations
  authorId: principal
  ordinal: int
  body: text <=2000 ?
  caption: text <=500 ?
  photo: image <=10000000 ?
  photoOnce: image <=10000000 once ?
  clip: video <=50000000 ?
  quoteId: messages ?
  editedAt: time ?
  tombstone: bool default false
  expiresAt: time ?
  at: time
  unique byConversationOrdinal: conversationId, ordinal
  by byConvTime: conversationId, at, id
  search body, caption
  cap 200000
  immutable conversationId, authorId, ordinal, at
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  update <- .authorId = viewer
  retain delivered-history
  sync last 500 by byConvTime

table deliveries:
  messageId: messages
  conversationId: conversations
  principal: principal
  unique byMessagePrincipal: messageId, principal
  immutable messageId, conversationId, principal
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  sync to memberships[.conversationId]

table reactions:
  messageId: messages
  conversationId: conversations
  principal: principal
  emoji: text <=16
  unique byMessagePrincipal: messageId, principal
  immutable messageId, conversationId
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to memberships[.conversationId]

view reactionCounts: count reactions by .messageId, emoji
  read <- deny
  online only

table typing:
  conversationId: conversations
  principal: principal
  expiresAt: time
  unique byConversationPrincipal: conversationId, principal
  cap 50 by conversationId
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer and exists memberships[.conversationId, viewer]
  expire at .expiresAt
  sync to memberships[.conversationId]

fn disappearingTtl(setting: enum('off', '24h', '7d')):
  return 180000 if setting = '24h' else (300000 if setting = '7d' else 0)

query inbox(c: cursor ?):
  return memberships where .principal = viewer after c first 50 by .conversationId { conversationId, role, readOrdinal, conversation: conversations[.conversationId] }

query conversation(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return conversations[conversationId]

query membership(conversationId: conversations):
  return memberships[conversationId, viewer]

query roster(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return memberships where .conversationId = conversationId { *, profile: profiles[principal = .principal] }

query dmWith(peer: principal):
  pair = dmPairs[viewer, peer]
  return pair

query groupByTitle(title: text 1..50):
  return conversations where .kind = 'group' and .title = title first 5 by .id

query thread(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return messages where .conversationId = conversationId after c last 50 by .ordinal { *, quote: messages[.quoteId] }

query threadHeld(conversationId: conversations, c: cursor ?) held:
  return messages where .conversationId = conversationId after c last 50 by .ordinal { *, quote: messages[.quoteId] }

query typingNow(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return typing where .conversationId = conversationId by .principal { principal, expiresAt }

query messageReactions(messageId: messages, c: cursor ?):
  return reactions where .messageId = messageId first 50 by .emoji after c

query myReaction(messageId: messages):
  return reactions[messageId, viewer]

query chatDeliveries(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return deliveries where .conversationId = conversationId last 200 by .id after c

query messageDeliveries(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require exists memberships[msg.conversationId, viewer] else NOT_MEMBER
  return deliveries where .messageId = messageId first 50 by .principal

query searchPeople(q: text <=100, c: cursor ?):
  return profiles matching q after c first 20 by .id

query searchInChat(conversationId: conversations, q: text <=100, c: cursor ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return messages where .conversationId = conversationId matching q last 50 by .at after c

query searchGrouped(q: text <=100, c: cursor ?):
  return memberships[principal = viewer] after c first 20 by .conversationId where exists (messages[conversationId = .conversationId] by .at matching q) { conversationId, conversation: conversations[.conversationId], hits: messages[conversationId = .conversationId] matching q last 3 by .at }

query searchHeld(q: text <=100, c: cursor ?) held:
  return messages matching q after c last 20 by .at

mutation openDm(conversationId: id, peer: principal):
  require peer != viewer else CANNOT_DM_SELF
  existing = dmPairs[viewer, peer]
  if existing != null:
    return existing.conversationId
  c = insert conversations { id: conversationId, kind: 'dm', creatorId: viewer }
  insert memberships { conversationId: c.id, principal: viewer, role: 'member', joinedAt: now }
  insert memberships { conversationId: c.id, principal: peer, role: 'member', joinedAt: now }
  insert dmPairs { userA: viewer, userB: peer, conversationId: c.id }
  insert dmPairs { userA: peer, userB: viewer, conversationId: c.id }
  return c.id

mutation createGroup(conversationId: id, peer: principal, title: text 1..50, description: text <=200):
  require peer != viewer else GROUP_NEEDS_MEMBER
  c = insert conversations { id: conversationId, kind: 'group', title, description, creatorId: viewer }
  insert memberships { conversationId: c.id, principal: viewer, role: 'admin', joinedAt: now }
  insert memberships { conversationId: c.id, principal: peer, role: 'member', joinedAt: now }
  return c.id

mutation addMember(conversationId: conversations, principal: principal):
  require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  convo = conversations[conversationId] ! else NOT_FOUND
  require convo.kind = 'group' else NOT_GROUP
  insert memberships { conversationId, principal, role: 'member', joinedAt: now } if absent
  return null

mutation removeMember(conversationId: conversations, principal: principal):
  require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  require principal != viewer else USE_LEAVE
  membership = memberships[conversationId, principal] ! else NOT_MEMBER
  delete memberships[membership]
  return null

mutation promoteMember(conversationId: conversations, principal: principal):
  require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  membership = memberships[conversationId, principal] ! else NOT_MEMBER
  update memberships[membership] { role: 'admin' }
  return null

mutation leaveGroup(conversationId: conversations):
  membership = memberships[conversationId, viewer] ! else NOT_MEMBER
  delete memberships[membership]
  return null

mutation updateGroupInfo(conversationId: conversations, title: text 1..50, description: text <=200):
  require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  convo = conversations[conversationId] ! else NOT_FOUND
  require convo.kind = 'group' else NOT_GROUP
  update conversations[convo] { title, description }
  return null

mutation setChatAccent(conversationId: conversations, accent: text <=16):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  convo = conversations[conversationId] ! else NOT_FOUND
  if convo.kind = 'group':
    require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  update conversations[convo] { accent }
  return null

mutation setChatBackground(conversationId: conversations, background: image <=10000000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  convo = conversations[conversationId] ! else NOT_FOUND
  if convo.kind = 'group':
    require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  update conversations[convo] { background }
  return null

mutation setDisappearing(conversationId: conversations, setting: enum('off', '24h', '7d')):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  convo = conversations[conversationId] ! else NOT_FOUND
  if convo.kind = 'group':
    require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  update conversations[convo] { disappearing: setting }
  return null

mutation sendMessage(messageId: id, conversationId: conversations, body: text <=2000, quoteId: messages ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  if quoteId != null:
    quoted = messages[quoteId] ! else QUOTE_NOT_FOUND
    require quoted.conversationId = conversationId else QUOTE_WRONG_CHAT
  convo = conversations[conversationId] ! else NOT_FOUND
  ordinal = convo.lastOrdinal + 1
  upsert conversations[conversationId] { lastOrdinal: ordinal }
  ttl = disappearingTtl(convo.disappearing)
  expiresAt = now + ttl if ttl > 0 else null
  row = insert messages { id: messageId, conversationId, authorId: viewer, ordinal, body, quoteId, at: now, expiresAt }
  me = profiles[principal = viewer]
  name = me.displayName if me != null else 'Someone'
  preview = slice(body, 0, 80)
  for m in memberships where .conversationId = conversationId:
    if m.principal != viewer:
      emit notify { targetUserId: m.principal, chatId: conversationId, senderDisplayName: name, preview }
  return { id: row.id, ordinal }

mutation sendMedia(messageId: id, conversationId: conversations, photo: image <=10000000 ?, clip: video <=50000000 ?, caption: text <=500, viewOnce: bool):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  require not (photo != null and clip != null) else MEDIA_MIXED
  require photo != null or clip != null else MEDIA_REQUIRED
  if viewOnce:
    require photo != null else VIEW_ONCE_PHOTO_ONLY
    require clip = null else VIEW_ONCE_PHOTO_ONLY
  if clip != null:
    require clip.duration != null else DURATION_UNKNOWN
    require clip.duration <= 60000 else VIDEO_TOO_LONG
  convo = conversations[conversationId] ! else NOT_FOUND
  ordinal = convo.lastOrdinal + 1
  upsert conversations[conversationId] { lastOrdinal: ordinal }
  ttl = disappearingTtl(convo.disappearing)
  expiresAt = now + ttl if ttl > 0 else null
  oncePhoto = photo if viewOnce else null
  normalPhoto = photo if not viewOnce else null
  row = insert messages { id: messageId, conversationId, authorId: viewer, ordinal, caption, photo: normalPhoto, photoOnce: oncePhoto, clip, at: now, expiresAt }
  me = profiles[principal = viewer]
  name = me.displayName if me != null else 'Someone'
  preview = 'Photo' if photo != null else 'Video'
  for m in memberships where .conversationId = conversationId:
    if m.principal != viewer:
      emit notify { targetUserId: m.principal, chatId: conversationId, senderDisplayName: name, preview }
  return { id: row.id, ordinal }

mutation editMessage(messageId: messages, body: text <=2000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  require not msg.tombstone else MESSAGE_DELETED
  require now - msg.at <= 60000 else EDIT_WINDOW
  require msg.photo = null and msg.photoOnce = null and msg.clip = null else CAPTION_ONLY
  update messages[msg] { body, editedAt: now }
  return null

mutation editCaption(messageId: messages, caption: text <=500):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  require not msg.tombstone else MESSAGE_DELETED
  require now - msg.at <= 60000 else EDIT_WINDOW
  require msg.photo != null or msg.photoOnce != null or msg.clip != null else NOT_MEDIA
  update messages[msg] { caption, editedAt: now }
  return null

mutation deleteMessage(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  require not msg.tombstone else MESSAGE_DELETED
  require now - msg.at <= 120000 else DELETE_WINDOW
  update messages[msg] { tombstone: true, body: null, caption: null, photo: null, photoOnce: null, clip: null }
  return null

mutation setReaction(messageId: messages, emoji: text <=16):
  msg = messages[messageId] ! else NOT_FOUND
  require exists memberships[msg.conversationId, viewer] else NOT_MEMBER
  require not msg.tombstone else MESSAGE_DELETED
  upsert reactions[messageId, viewer] { messageId, conversationId: msg.conversationId, principal: viewer, emoji }
  return null

mutation clearReaction(messageId: messages):
  if exists reactions[messageId, viewer]:
    delete reactions[messageId, viewer]
  return null

mutation setTyping(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  upsert typing[conversationId, viewer] { conversationId, principal: viewer, expiresAt: now + 4500 }
  return null

mutation markDelivered(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require exists memberships[msg.conversationId, viewer] else NOT_MEMBER
  if msg.authorId != viewer:
    insert deliveries { messageId, conversationId: msg.conversationId, principal: viewer } if absent
  return null

mutation markRead(conversationId: conversations, ordinal: int):
  membership = memberships[conversationId, viewer] ! else NOT_MEMBER
  current = membership.readOrdinal
  next = ordinal if ordinal > current else current
  update memberships[membership] { readOrdinal: next }
  return null
