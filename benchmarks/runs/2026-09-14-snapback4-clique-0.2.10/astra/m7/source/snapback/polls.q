-- A poll is a message; options are immutable after creation.
table pollOptions:
  conversationId: conversations
  messageId: messages
  key: text 1..128
  label: text 1..50
  position: int
  expiresAt: time ?
  unique byMessageKey: conversationId, messageId, key
  by byMessagePosition: conversationId, messageId, position, id
  by byExpiry: expiresAt
  cap 4 by conversationId, messageId
  immutable conversationId, messageId, key, label, position
  read <- exists members[.conversationId, viewer]
  insert <- exists members[.conversationId, viewer] and created messages[.messageId]
  delete <- exists members[.conversationId, viewer]
  expire at .expiresAt
  sync to members[.conversationId]

table pollVotes:
  conversationId: conversations
  messageId: messages
  principal: principal
  optionKey: text 1..128
  expiresAt: time ?
  unique byMessagePrincipal: conversationId, messageId, principal
  by byOption: conversationId, messageId, optionKey, id
  by byExpiry: expiresAt
  cap 1000 by conversationId, messageId
  immutable conversationId, messageId, principal
  read <- exists members[.conversationId, viewer]
  insert <- .principal = viewer and exists members[.conversationId, viewer]
  update <- .principal = viewer and exists members[.conversationId, viewer]
  delete <- exists members[.conversationId, viewer]
  expire at .expiresAt
  sync to members[.conversationId]

query view(messageId: messages):
  m = messages[messageId] ! else MESSAGE_NOT_FOUND
  require m.kind = 'poll' and m.deleted != true else NOT_POLL
  return { question: m.text, vote: pollVotes[m.conversationId, messageId, viewer], options: pollOptions[m.conversationId, messageId] first 4 by byMessagePosition { *, count: count(pollVotes[.conversationId, .messageId, .key] first 1000 by byOption) } }

mutation create(messageId: id, conversationId: conversations, question: text 1..200, options: [text 1..50] <=4, optionKeys: [text 1..128] <=4):
  c = conversations[conversationId] ! else NOT_MEMBER
  require c.kind = 'group' else NOT_GROUP
  require count(trim(question)) > 0 else EMPTY_QUESTION
  require count(options) >= 2 and count(options) = count(optionKeys) else INVALID_OPTIONS
  if exists messages[messageId]:
    return { id: messageId }
  for option in options:
    require count(trim(option)) > 0 else EMPTY_OPTION
  recipients = []
  for m in members[conversationId] first 50 by byConversationPrincipal:
    if m.principal != viewer:
      recipients = recipients + [m.principal]
  ttl = disappearingTTL(c.disappearing ?? 'off')
  arrival = nextArrival(conversationId)
  msg = insert messages { arrival, id: messageId, conversationId, senderId: viewer, text: question, kind: 'poll', pollOptionKeys: optionKeys, recipients, at: now, expiresAt: now + ttl if ttl != null else null }
  for position in range(0, count(options)):
    insert pollOptions { conversationId, messageId, key: at(optionKeys, position) ! else INVALID_OPTIONS, label: at(options, position) ! else INVALID_OPTIONS, position, expiresAt: msg.expiresAt }
  if not replayMode():
    author = profiles[viewer] ! else PROFILE_REQUIRED
    for member in members[conversationId] first 50 by byConversationPrincipal:
      if member.principal != viewer:
        emit pushCandidate { targetUserId: member.principal, chatId: conversationId, senderDisplayName: author.displayName, preview: slice(question, 0, 80) }
  return { id: messageId }

-- Set-state, never toggle. The mutation envelope's client ID deduplicates retries.
mutation vote(messageId: messages, optionKey: text 1..128):
  m = messages[messageId] ! else MESSAGE_NOT_FOUND
  require m.kind = 'poll' and m.deleted != true else NOT_POLL
  require exists members[m.conversationId, viewer] else NOT_MEMBER
  require exists pollOptions[m.conversationId, messageId, optionKey] else INVALID_OPTION
  if exists pollVotes[m.conversationId, messageId, viewer]:
    update pollVotes[m.conversationId, messageId, viewer] { optionKey }
  else:
    insert pollVotes { conversationId: m.conversationId, messageId, principal: viewer, optionKey, expiresAt: m.expiresAt }
  return null
