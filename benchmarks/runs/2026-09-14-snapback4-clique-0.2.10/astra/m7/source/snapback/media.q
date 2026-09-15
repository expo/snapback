table reactions:
  conversationId: conversations
  messageId: messages
  principal: principal
  emoji: text 1..100
  expiresAt: time ?
  by byExpiry: expiresAt
  unique byMessagePrincipal: conversationId, messageId, principal
  cap 1000 by conversationId, messageId
  immutable conversationId, messageId, principal
  read <- exists members[.conversationId, viewer]
  insert <- .principal = viewer and exists members[.conversationId, viewer]
  update <- .principal = viewer and exists members[.conversationId, viewer]
  delete <- .principal = viewer and exists members[.conversationId, viewer]
  expire at .expiresAt
  retain delivered-history
  sync to members[.conversationId]

fn reactionSummary(messageId: messages):
  m = messages[messageId] ! else MESSAGE_NOT_FOUND
  rows = reactions[m.conversationId, messageId] first 1000 by byMessagePrincipal
  return group(rows, 'emoji') { emoji: .key, count: count(.items), mine: exists reactions[conversationId = m.conversationId, messageId = messageId, principal = viewer, emoji = .key] }

mutation send(messageId: id, conversationId: conversations, caption: text <=500, photo: image <=10485760 ?, video: video <=52428800 ?, viewOnce: bool ?):
  require exists members[conversationId, viewer] else NOT_MEMBER
  require (photo != null and video = null) or (photo = null and video != null) else CHOOSE_ONE_MEDIA
  require viewOnce != true or photo != null else VIEW_ONCE_PHOTO_ONLY
  if video != null:
    duration = video.duration
    require duration != null else DURATION_UNKNOWN
    require duration <= 60000 else VIDEO_TOO_LONG
  if exists messages[messageId]:
    return { id: messageId }
  recipients = []
  for m in members[conversationId] first 50 by byConversationPrincipal:
    if m.principal != viewer:
      recipients = recipients + [m.principal]
  c = conversations[conversationId] ! else NOT_MEMBER
  ttl = disappearingTTL(c.disappearing ?? 'off')
  arrival = nextArrival(conversationId)
  msg = insert messages { arrival, id: messageId, conversationId, senderId: viewer, text: caption, photo: photo if viewOnce != true else null, oncePhoto: photo if viewOnce = true else null, video, kind: 'image' if photo != null else 'video', recipients, at: now, expiresAt: now + ttl if ttl != null else null }
  if not replayMode():
    author = profiles[viewer] ! else PROFILE_REQUIRED
    for member in members[conversationId] first 50 by byConversationPrincipal:
      if member.principal != viewer:
        emit pushCandidate { targetUserId: member.principal, chatId: conversationId, senderDisplayName: author.displayName, preview: 'Photo' if photo != null else 'Video' }
  return { id: msg.id }

mutation react(messageId: messages, emoji: text <=100 ?):
  m = messages[messageId] ! else MESSAGE_NOT_FOUND
  require m.deleted != true else MESSAGE_DELETED
  if emoji != null:
    require count(emoji) > 0 else EMPTY_REACTION
    if exists reactions[m.conversationId, messageId, viewer]:
      update reactions[m.conversationId, messageId, viewer] { emoji }
    else:
      insert reactions { conversationId: m.conversationId, messageId, principal: viewer, emoji, expiresAt: m.expiresAt }
  else:
    if exists reactions[m.conversationId, messageId, viewer]:
      delete reactions[m.conversationId, messageId, viewer]
  return null

mutation edit(messageId: messages, text: text <=2000):
  m = messages[messageId] ! else MESSAGE_NOT_FOUND
  require m.senderId = viewer else NOT_AUTHOR
  require m.kind != 'poll' else POLL_IMMUTABLE
  require m.deleted != true else MESSAGE_DELETED
  require now <= m.at + editWindow() else EDIT_WINDOW_CLOSED
  require m.kind = 'text' or m.kind = null or count(text) <= 500 else CAPTION_TOO_LONG
  update messages[messageId] { text, edited: true }

mutation delete(messageId: messages):
  m = messages[messageId] ! else MESSAGE_NOT_FOUND
  require m.senderId = viewer else NOT_AUTHOR
  require now <= m.at + deleteWindow() else DELETE_WINDOW_CLOSED
  if m.kind = 'poll':
    key0 = at(m.pollOptionKeys ?? [], 0)
    if key0 != null:
      delete pollOptions[m.conversationId, messageId, key0]
    key1 = at(m.pollOptionKeys ?? [], 1)
    if key1 != null:
      delete pollOptions[m.conversationId, messageId, key1]
    key2 = at(m.pollOptionKeys ?? [], 2)
    if key2 != null:
      delete pollOptions[m.conversationId, messageId, key2]
    key3 = at(m.pollOptionKeys ?? [], 3)
    if key3 != null:
      delete pollOptions[m.conversationId, messageId, key3]
  update messages[messageId] { text: '', photo: null, oncePhoto: null, video: null, deleted: true, countWeight: 0, pollOptionKeys: null }

job normalizeMessages():
  chunk m in messages first 100 by byId:
    if m.kind = null or m.edited = null or m.deleted = null:
      update messages[m.id] { kind: m.kind ?? 'text', edited: m.edited ?? false, deleted: m.deleted ?? false }
