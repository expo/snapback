-- Messaging excerpt of the 0.4.3 comparative Grok builder's snapback/schema.q.
-- Profiles, DM/group creation, membership, messages, receipts and reactions keep
-- their original rules and write bodies. Feed/media/typing/digest features are
-- outside this acceptance fixture; the comparative packet is never modified.
-- @ref LLP 3000.021#3.1 — history is bare; decorations have their own queries.
-- @ref LLP 3000.021#3.4 — retain the conversation and pin its own query.
use identity password
use personas alice, bob, carol
effect notify

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200 ?
  location: text <=50 ?
  link: text <=200 format url ?
  avatar: image <=10000000 ?
  unique byPrincipal: principal
  unique byHandle: handle else HANDLE_TAKEN 'That handle is taken.'
  search displayName, handle
  immutable principal
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- deny
  sync last 2000 by byHandle

table conversations:
  kind: enum('dm', 'group')
  title: text 1..50 ?
  description: text <=200 ?
  creatorId: principal
  lastOrdinal: int default 0
  accent: enum('indigo', 'teal', 'coral', 'amber', 'violet', 'emerald', 'rose', 'slate') default 'indigo'
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  read <- exists members[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists members[.id, viewer]
  delete <- deny
  after insert <- exists members[conversation = .id, principal = .creatorId]
  retain delivered-history
  sync to members[.id]

table members:
  conversation: conversations
  principal: principal
  role: enum('member', 'admin')
  handle: text 3..20 format handle
  joinedOrdinal: int
  deliveredOrdinal: int default 0
  seenOrdinal: int default 0
  unique conversation, principal
  cap 64 by conversation
  immutable conversation, principal, joinedOrdinal
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[.conversation, viewer]
  update <- .principal = viewer or exists members[conversation = .conversation, principal = viewer, role = 'admin']
  delete <- .principal = viewer or exists members[conversation = .conversation, principal = viewer, role = 'admin']
  retain delivered-history
  sync to members[.conversation]

table dmEdges:
  me: principal
  other: principal
  conversation: conversations
  unique me, other
  cap 2000 by me
  immutable me, other, conversation
  read <- .me = viewer
  insert <- created conversations[.conversation]
  delete <- deny
  sync to .me

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
  kind: enum('text', 'image', 'video')
  text: text <=2000 ?
  caption: text <=500 ?
  photo: image <=10000000 ?
  photoOnce: image <=10000000 once ?
  clip: video <=50000000 ?
  quote: messages ?
  tombstone: bool default false
  editedAt: time ?
  at: time
  expiresAt: time ?
  search text, caption
  unique byConversationOrdinal: conversation, ordinal
  immutable conversation, sender, ordinal, recipients, at, expiresAt
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  update <- .sender = viewer or exists members[.conversation, viewer]
  delete <- deny
  retain delivered-history
  expire at .expiresAt
  sync to members[.conversation] last 500 by byConversationOrdinal

table reactions:
  message: messages
  principal: principal
  emoji: text <=16
  unique message, principal
  immutable message, principal
  read through .message
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  online only

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

fn ttlMs(setting: enum('off', '24h', '7d')):
  return 180000 if setting = '24h' else (300000 if setting = '7d' else null)

query myProfile():
  return profiles[principal = viewer]

query profileFor(owner: principal):
  return profiles[principal = owner]

query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { *, chat: conversations[.conversation] }

query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c

query messageReceipts(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c { id, receipt: receipt(.) }

query quotedMessage(message: messages):
  return messages[messages[message].quote]

query myReaction(message: messages):
  return reactions[message = message, principal = viewer]

query progress(conversation: conversations, c: cursor ?):
  me = members[conversation, viewer] ! else NOT_MEMBER
  delivered = max(me.deliveredOrdinal, me.joinedOrdinal)
  return { member: me, runs: runs where .conversation = conversation and .principal = viewer, ahead: messages where .conversation = conversation and .ordinal > delivered and .ordinal <= delivered + 100 last 100 by .ordinal after c }

query conversationById(conversation: conversations):
  return conversations[conversation]

query reactionsOn(message: messages, c: cursor ?):
  return reactions where .message = message first 32 by .principal after c

query searchHeld(q: text <=100, c: cursor ?) held:
  return messages matching q after c last 20 by .at

mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200 ?, location: text <=50 ?, link: text <=200 format url ?):
  upsert profiles[principal = viewer] { principal: viewer, displayName, handle, bio, location, link }
  return null

mutation createDm(id: id, other: principal):
  require other != viewer else SELF_DM
  existing = dmEdges[me = viewer, other = other]
  if existing != null:
    return existing.conversation
  otherProfile = profiles[principal = other] ! else NOT_FOUND
  meProfile = profiles[principal = viewer] ! else NOT_FOUND
  c = insert conversations { id, kind: 'dm', creatorId: viewer, title: otherProfile.displayName }
  insert members { conversation: c.id, principal: viewer, role: 'member', handle: meProfile.handle, joinedOrdinal: 0 }
  insert members { conversation: c.id, principal: other, role: 'member', handle: otherProfile.handle, joinedOrdinal: 0 }
  insert dmEdges { me: viewer, other, conversation: c.id }
  insert dmEdges { me: other, other: viewer, conversation: c.id }
  return c.id

mutation createGroup(id: id, second: principal, name: text 1..50, description: text <=200 ?):
  require second != viewer else NEED_OTHER_MEMBER
  secondProfile = profiles[principal = second] ! else NOT_FOUND
  meProfile = profiles[principal = viewer] ! else NOT_FOUND
  c = insert conversations { id, kind: 'group', creatorId: viewer, title: name, description }
  insert members { conversation: c.id, principal: viewer, role: 'admin', handle: meProfile.handle, joinedOrdinal: 0 }
  insert members { conversation: c.id, principal: second, role: 'member', handle: secondProfile.handle, joinedOrdinal: 0 }
  return c.id

mutation addMember(conversation: conversations, principal: principal):
  require exists members[conversation = conversation, principal = viewer, role = 'admin'] else NOT_ADMIN
  chat = conversations[conversation] ! else NOT_FOUND
  require chat.kind = 'group' else NOT_GROUP
  other = profiles[principal = principal] ! else NOT_FOUND
  insert members { conversation, principal, role: 'member', handle: other.handle, joinedOrdinal: chat.lastOrdinal } if absent
  return null

mutation removeMember(conversation: conversations, principal: principal):
  require exists members[conversation = conversation, principal = viewer, role = 'admin'] else NOT_ADMIN
  require principal != viewer else USE_LEAVE
  row = members[conversation, principal] ! else NOT_FOUND
  for run in runs where .conversation = conversation and .principal = principal:
    delete runs[run]
  delete members[row]
  return null

mutation leaveConversation(conversation: conversations):
  me = members[conversation, viewer] ! else NOT_MEMBER
  for run in runs where .conversation = conversation and .principal = viewer:
    delete runs[run]
  delete members[me]
  return null

mutation sendText(id: id, conversation: conversations, text: text <=2000, quote: messages ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  me = profiles[principal = viewer]
  ordinal = chat.lastOrdinal + 1
  recipients = 0
  for member in members where .conversation = conversation:
    if member.principal != viewer:
      recipients = recipients + 1
  update conversations[chat] { lastOrdinal: ordinal }
  ttl = ttlMs(chat.disappearing)
  m = insert messages { id, conversation, sender: viewer, ordinal, recipients, kind: 'text', text, quote, at: now, expiresAt: now + ttl if ttl != null else null }
  for member in members where .conversation = conversation:
    if member.principal != viewer and not exists connected[member.principal]:
      emit notify { targetUserId: member.principal, chatId: conversation, senderDisplayName: me.displayName, preview: slice(text, 0, 80) }
  return m.id

mutation setReaction(messageId: messages, emoji: text <=16):
  msg = messages[messageId] ! else NOT_FOUND
  require exists members[msg.conversation, viewer] else NOT_MEMBER
  require not msg.tombstone else DELETED
  if emoji = 'none':
    delete reactions[messageId, viewer]
  else:
    upsert reactions[messageId, viewer] { emoji }
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
  if low <= prefix + 1:
    update members[me] { deliveredOrdinal: high }
  else if count(runs where .conversation = conversation and .principal = viewer) < 64:
    insert runs { conversation, principal: viewer, fromOrdinal: low, throughOrdinal: high }
  return null

mutation seen(conversation: conversations, through: int):
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  if through > me.seenOrdinal:
    update members[me] { seenOrdinal: through }
  return null

