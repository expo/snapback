effect notify from push

proc queuePeriodUnread from custody
proc clearMessagePeriodUnread from custody

fn settings(): appSettings['windows']

proc storeAtExpiry(conversationId: conversations, messageId: id, author: principal, target: principal, body: text <=2000 ?, photo: image <=10485760 ?, clip: video <=52428800 ?, oncePhoto: image <=10485760 ?, expiry: time ?, preview: text <=2000):
  insert messages { id: messageId, conversationId, author, body, photo, clip, oncePhoto, expiresAt: expiry }
  cfg = settings() ! else CONFIG
  if cfg.replayMode = false:
    (_period, rem) = divmod(now, cfg.digestPeriodMs)
    for member in memberships[conversationId] first 50 by byConversationPrincipal:
      if member.principal != author:
        queuePeriodUnread(messageId, member.principal, conversationId, member.id, now - rem)
  boundedPreview = slice(preview, 0, 80)
  insert pushLog { target, kind: 'message', chatId: conversationId, sender: author, preview: boundedPreview, messageId }
  emit notify { to: target, body: boundedPreview }

proc storeWithExpiryPolicy(conversationId: conversations, messageId: id, author: principal, target: principal, body: text <=2000 ?, photo: image <=10485760 ?, clip: video <=52428800 ?, oncePhoto: image <=10485760 ?, explicitExpiry: time ?, disappearing: enum('off', '24h', '7d'), disappear24hMs: int, disappear7dMs: int, preview: text <=2000):
  if explicitExpiry != null:
    storeAtExpiry(conversationId, messageId, author, target, body, photo, clip, oncePhoto, explicitExpiry, preview)
  else:
    if disappearing = '24h':
      storeAtExpiry(conversationId, messageId, author, target, body, photo, clip, oncePhoto, now + disappear24hMs, preview)
    else:
      if disappearing = '7d':
        storeAtExpiry(conversationId, messageId, author, target, body, photo, clip, oncePhoto, now + disappear7dMs, preview)
      else:
        storeAtExpiry(conversationId, messageId, author, target, body, photo, clip, oncePhoto, null, preview)

mutation send(conversationId: conversations, target: principal, body: text <=2000, expiresAt: time ?, messageId: id ?):
  conversation = conversations[conversationId] ! else NOT_FOUND
  cfg = settings() ! else CONFIG
  chosenId = messageId ?? new
  storeWithExpiryPolicy(conversationId, chosenId, viewer, target, body, null, null, null, expiresAt, conversation.disappearing, cfg.disappear24hMs, cfg.disappear7dMs, body)
  return { id: chosenId }

mutation sendPhoto(conversationId: conversations, target: principal, photo: image <=10485760, body: text <=500 ?, messageId: id ?):
  conversation = conversations[conversationId] ! else NOT_FOUND
  cfg = settings() ! else CONFIG
  chosenId = messageId ?? new
  storeWithExpiryPolicy(conversationId, chosenId, viewer, target, body, photo, null, null, null, conversation.disappearing, cfg.disappear24hMs, cfg.disappear7dMs, body ?? 'Photo')
  return { id: chosenId, photo }

mutation sendClip(conversationId: conversations, target: principal, clip: video <=52428800, body: text <=500 ?, messageId: id ?):
  require clip.duration <= 60000 else VIDEO_TOO_LONG
  conversation = conversations[conversationId] ! else NOT_FOUND
  cfg = settings() ! else CONFIG
  chosenId = messageId ?? new
  storeWithExpiryPolicy(conversationId, chosenId, viewer, target, body, null, clip, null, null, conversation.disappearing, cfg.disappear24hMs, cfg.disappear7dMs, body ?? 'Video')
  return { id: chosenId, clip, duration: clip.duration }

mutation sendOncePhoto(conversationId: conversations, target: principal, photo: image <=10485760, body: text <=500 ?, messageId: id ?):
  conversation = conversations[conversationId] ! else NOT_FOUND
  cfg = settings() ! else CONFIG
  chosenId = messageId ?? new
  storeWithExpiryPolicy(conversationId, chosenId, viewer, target, body, null, null, photo, null, conversation.disappearing, cfg.disappear24hMs, cfg.disappear7dMs, 'Photo')
  return { id: chosenId, photo }

mutation unsend(messageId: messages):
  message = messages[messageId] ! else NOT_FOUND
  require message.author = viewer else AUTHOR_REQUIRED
  require exists memberships[message.conversationId, viewer] else MEMBERSHIP_REQUIRED
  clearMessagePeriodUnread(messageId)
  delete messages[message]
  return null
