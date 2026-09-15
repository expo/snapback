table conversations:
  kind: enum('dm', 'group')
  creatorId: principal
  name: text 1..50
  description: text <=200
  color: enum('#4F46E5', '#0D9488', '#EF6351', '#D97706', '#7C3AED', '#059669', '#E11D48', '#475569') ?
  background: image <=10485760 ?
  disappearing: enum('off', '24h', '7d') ?
  at: time
  read <- exists members[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists members[.id, viewer, 'admin']
  after insert <- exists members[.id, .creatorId, 'admin']
  retain delivered-history
  sync to members[.id]

table dmPairs:
  low: principal
  high: principal
  conversationId: conversations
  unique byPair: low, high
  read <- .low = viewer or .high = viewer
  insert <- .low = viewer or .high = viewer
  immutable low, high, conversationId

table members:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  unique byConversationPrincipal: conversationId, principal
  by byConversationPrincipalRole: conversationId, principal, role
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  immutable conversationId, principal, joinedAt
  read <- exists members[.conversationId, viewer]
  insert <- exists members[.conversationId, viewer, 'admin'] or created conversations[.conversationId]
  update <- exists members[.conversationId, viewer, 'admin']
  delete <- .principal = viewer or exists members[.conversationId, viewer, 'admin']
  sync to members[.conversationId]

table readStates:
  conversationId: conversations
  principal: principal
  deliveredAt: time
  readAt: time
  deliveredArrival: int ?
  readArrival: int ?
  unique byConversationPrincipal: conversationId, principal
  immutable conversationId, principal
  read <- exists members[.conversationId, viewer]
  insert <- .principal = viewer and exists members[.conversationId, viewer]
  update <- .principal = viewer and exists members[.conversationId, viewer]
  sync to members[.conversationId]

table messages:
  conversationId: conversations
  senderId: principal
  text: text <=2000
  kind: enum('text', 'image', 'video') default 'text'
  photo: image <=10485760 ?
  oncePhoto: image <=10485760 once ?
  expiresAt: time ?
  video: video <=52428800 ?
  edited: bool default false
  deleted: bool default false
  replyToId: messages ?
  recipients: [principal] <=50
  at: time
  arrival: int ?
  by byConversationTime: conversationId, at, id
  by byConversationArrival: conversationId, arrival, id
  by byChatWords: conversationId, words(text), at, id
  by byWords: words(text), at, id
  by byExpiry: expiresAt
  immutable conversationId, senderId, at, recipients, replyToId
  read <- exists members[.conversationId, viewer]
  insert <- .senderId = viewer and exists members[.conversationId, viewer]
  update <- .senderId = viewer and exists members[.conversationId, viewer]
  retain delivered-history
  expire at .expiresAt
  sync to members[.conversationId]

table typing:
  conversationId: conversations
  principal: principal
  expiresAt: time ?
  unique byConversationPrincipal: conversationId, principal
  by byExpiry: expiresAt
  immutable conversationId, principal
  read <- exists members[.conversationId, viewer]
  insert <- .principal = viewer and exists members[.conversationId, viewer]
  update <- .principal = viewer and exists members[.conversationId, viewer]
  delete <- .principal = viewer
  expire at .expiresAt
  sync to members[.conversationId]

fn receipt(message: messages):
  m = messages[message] ! else MESSAGE_NOT_FOUND
  result = 2
  for p in m.recipients:
    membership = members[m.conversationId, p]
    if membership != null and membership.joinedAt <= m.at:
      r = readStates[m.conversationId, p]
      delivered = r.deliveredArrival >= m.arrival if r != null and r.deliveredArrival != null and m.arrival != null else (r.deliveredAt >= m.at if r != null else false)
      read = r.readArrival >= m.arrival if r != null and r.readArrival != null and m.arrival != null else (r.readAt >= m.at if r != null else false)
      if not delivered:
        result = 0
      else if not read:
        result = min(result, 1)
  return 'read' if result = 2 else ('delivered' if result = 1 else 'sent')

shape messageCard = { *, sender: profiles[.senderId], quote: messages[.replyToId], receipt: receipt(.id) if .senderId = viewer else null, reactions: reactionSummary(.id), viewed: exists opened[viewer, .id] }

query history(conversationId: conversations, c: cursor ?):
  return messages[conversationId] after c last 50 by byConversationArrival messageCard

query conversation(conversationId: conversations):
  return conversations[conversationId]

query roster(conversationId: conversations):
  return members[conversationId] first 50 by byConversationPrincipal { *, profile: profiles[.principal] }

query typing(conversationId: conversations):
  return typing[conversationId] first 50 by byConversationPrincipal where .principal != viewer { *, profile: profiles[.principal] }

query inbox(c: cursor ?):
  return members[viewer] after c first 100 by byPrincipalConversation { *, conversation: conversations[.conversationId], latest: first(messages[.conversationId] last 1 by byConversationArrival), state: readStates[.conversationId, viewer], roster: members[.conversationId] first 50 by byConversationPrincipal { *, profile: profiles[.principal] }, typing: typing[.conversationId] first 50 by byConversationPrincipal }

query dm(other: principal):
  (low, high) = sorted(viewer, other)
  return dmPairs[low, high]

query group(name: text 1..50):
  return members[viewer] first 100 by byPrincipalConversation where conversations[.conversationId].name = name { conversation: conversations[.conversationId] }

mutation createDM(other: principal, conversationId: id):
  require other != viewer else SELF_DM
  require exists profiles[other] else USER_NOT_FOUND
  (low, high) = sorted(viewer, other)
  old = dmPairs[low, high]
  if old != null:
    return { id: old.conversationId }
  c = insert conversations { id: conversationId, creatorId: viewer, kind: 'dm', name: 'Direct message', description: '', at: now }
  insert members { conversationId: c.id, principal: viewer, role: 'admin', joinedAt: now }
  insert members { conversationId: c.id, principal: other, role: 'admin', joinedAt: now }
  insert dmPairs { low, high, conversationId: c.id }
  return { id: c.id }

mutation createGroup(conversationId: id, name: text 1..50, description: text <=200, principals: [principal] <=49):
  require count(principals) > 0 else TOO_FEW_MEMBERS
  if exists conversations[conversationId]:
    return { id: conversationId }
  c = insert conversations { id: conversationId, creatorId: viewer, kind: 'group', name, description, at: now }
  insert members { conversationId: c.id, principal: viewer, role: 'admin', joinedAt: now }
  for p in principals:
    require p != viewer else DUPLICATE_MEMBER
    require exists profiles[p] else USER_NOT_FOUND
    insert members { conversationId: c.id, principal: p, role: 'member', joinedAt: now }
  return { id: c.id }

mutation member(conversationId: conversations, principal: principal, action: enum('add', 'promote', 'remove')):
  c = conversations[conversationId] ! else NOT_MEMBER
  require c.kind = 'group' else NOT_GROUP
  require exists members[conversationId, viewer, 'admin'] else NOT_ADMIN
  if action = 'add':
    require exists profiles[principal] else USER_NOT_FOUND
    insert members { conversationId, principal, role: 'member', joinedAt: now } if absent
  else if action = 'promote':
    update members[conversationId, principal] { role: 'admin' }
  else:
    delete members[conversationId, principal]
  return null

mutation leave(conversationId: conversations):
  c = conversations[conversationId] ! else NOT_MEMBER
  require c.kind = 'group' else NOT_GROUP
  delete members[conversationId, viewer]
  return null

mutation send(messageId: id, conversationId: conversations, text: text <=2000, replyToId: messages ?):
  require exists members[conversationId, viewer] else NOT_MEMBER
  require count(trim(text)) > 0 else EMPTY_MESSAGE
  if replyToId != null:
    quote = messages[replyToId] ! else QUOTE_NOT_FOUND
    require quote.conversationId = conversationId else WRONG_CONVERSATION
  if exists messages[messageId]:
    return { id: messageId }
  recipients = []
  for m in members[conversationId] first 50 by byConversationPrincipal:
    if m.principal != viewer:
      recipients = recipients + [m.principal]
  c = conversations[conversationId] ! else NOT_MEMBER
  ttl = disappearingTTL(c.disappearing ?? 'off')
  arrival = nextArrival(conversationId)
  msg = insert messages { arrival, id: messageId, conversationId, senderId: viewer, text, replyToId, recipients, at: now, expiresAt: now + ttl if ttl != null else null }
  if not replayMode():
    author = profiles[viewer] ! else PROFILE_REQUIRED
    for member in members[conversationId] first 50 by byConversationPrincipal:
      if member.principal != viewer:
        emit pushCandidate { targetUserId: member.principal, chatId: conversationId, senderDisplayName: author.displayName, preview: slice(text, 0, 80) }
  return { id: msg.id }

mutation mark(conversationId: conversations, deliveredAt: time, readAt: time, deliveredArrival: int ?, readArrival: int ?):
  require exists members[conversationId, viewer] else NOT_MEMBER
  previous = readStates[conversationId, viewer]
  d = max(previous.deliveredAt, min(deliveredAt, now)) if previous != null else min(deliveredAt, now)
  r = max(previous.readAt, min(readAt, now)) if previous != null else min(readAt, now)
  ceiling = messageClocks[conversationId].last ?? (now / 1) * 1000
  da = max(previous.deliveredArrival ?? 0, min(deliveredArrival ?? (d / 1) * 1000 + 999, ceiling))
  ra = max(previous.readArrival ?? 0, min(readArrival ?? (r / 1) * 1000 + 999, ceiling))
  upsert readStates[conversationId, viewer] { deliveredAt: max(d, r), readAt: r, deliveredArrival: max(da, ra), readArrival: ra }

mutation type(conversationId: conversations):
  require exists members[conversationId, viewer] else NOT_MEMBER
  upsert typing[conversationId, viewer] { expiresAt: now + 4500 }
