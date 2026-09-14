table memberships:
  chatKey: text 1..40
  principal: principal
  role: enum('admin', 'member')
  unique byChatPrincipal: chatKey, principal
  by byPrincipalChat: principal, chatKey, id
  cap 16 by chatKey
  cap 16 by principal
  read <- .principal = viewer or exists memberships[.chatKey, viewer]

table messages:
  chatKey: text 1..40
  sender: principal
  read <- exists memberships[.chatKey, viewer]

table acknowledgments:
  messageId: messages
  chatKey: text 1..40
  principal: principal
  state: enum('delivered', 'read')
  unique byMessagePrincipal: messageId, principal
  by byMessagePrincipalState: messageId, principal, state
  read <- exists memberships[.chatKey, viewer]

query roster(chatKey: text 1..40):
  return memberships[chatKey] first 16 by byChatPrincipal

query directory():
  return memberships[viewer] first 16 by byPrincipalChat

query receipt(messageId: messages):
  msg = messages[messageId]
  if msg = null:
    return null
  recipients = memberships[msg.chatKey] first 16 by byChatPrincipal where .principal != msg.sender {
    read: 1 if exists acknowledgments[msg.id, .principal, 'read'] else 0,
    delivered: 1 if exists acknowledgments[msg.id, .principal, 'delivered'] or exists acknowledgments[msg.id, .principal, 'read'] else 0
  }
  if sum(recipients, .read) = count(recipients):
    return { state: 'read' }
  if sum(recipients, .delivered) = count(recipients):
    return { state: 'delivered' }
  return { state: 'sent' }
