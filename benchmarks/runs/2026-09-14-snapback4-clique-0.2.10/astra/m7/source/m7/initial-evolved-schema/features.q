table opened:
  principal: principal
  messageId: messages
  unique byPrincipalMessage: principal, messageId
  immutable principal, messageId
  read <- .principal = viewer
  insert <- .principal = viewer
  sync to .principal

mutation opened(messageId: messages):
  m = messages[messageId] ! else MESSAGE_NOT_FOUND
  require m.oncePhoto != null else NOT_VIEW_ONCE
  insert opened { principal: viewer, messageId } if absent

mutation customize(conversationId: conversations, name: text 1..50 ?, description: text <=200 ?, color: enum('#4F46E5', '#0D9488', '#EF6351', '#D97706', '#7C3AED', '#059669', '#E11D48', '#475569') ?, background: image <=10485760 ?, disappearing: enum('off', '24h', '7d') ?):
  c = conversations[conversationId] ! else NOT_MEMBER
  require exists members[conversationId, viewer, 'admin'] else NOT_ADMIN
  require c.kind = 'group' or (name = null and description = null) else DM_IDENTITY_FIXED
  update conversations[conversationId] { name: name ?? c.name, description: description ?? c.description, color: color ?? c.color, background: background ?? c.background, disappearing: disappearing ?? c.disappearing }

query inChat(conversationId: conversations, q: text <=100, c: cursor ?):
  return messages[conversationId] matching q after c last 50 by byChatWords where .deleted != true { *, sender: profiles[.senderId], conversation: conversations[.conversationId] }

query allMessages(q: text <=100, c: cursor ?):
  return messages matching q after c last 50 by byWords where .deleted != true { *, sender: profiles[.senderId], conversation: conversations[.conversationId] }
