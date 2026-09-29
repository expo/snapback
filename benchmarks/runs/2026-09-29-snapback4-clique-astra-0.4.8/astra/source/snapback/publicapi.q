-- Stable custom-client facade; authorization remains on the source tables.
fn messageType(m: messages):
  if m.oncePhoto != null:
    return 'view-once'
  if m.photo != null:
    return 'image'
  if m.video != null:
    return 'video'
  return 'text'
view reactionCounts: count reactions by .message, .emoji
query conversations(c: cursor ?):
  return members where .principal = viewer first 20 by .conversation after c { id: .conversation, conversation: conversations[.conversation], role }
query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c { id, conversationId: .conversation, senderId: .sender, serverTimestamp: .at, ordinal, type: messageType(.), text, media: .oncePhoto ?? .photo ?? .video, edited, tombstone, replyToId: .quote, expiresAt, reactions: reactionCounts[message = .id] first 50 by .emoji { emoji, count: .value, mine: reactions[message = .message, principal = viewer].emoji = .emoji }, receipt: receipt(.) if .sender = viewer else null }
query reactionChips(message: messages, c: cursor ?):
  return reactionCounts where .message = message first 50 by .emoji after c { emoji, count: .value, mine: reactions[message, viewer].emoji = .emoji }
query followEdges(principal: principal, c: cursor ?):
  return follows where .followerId = principal first 50 by .followedId after c
