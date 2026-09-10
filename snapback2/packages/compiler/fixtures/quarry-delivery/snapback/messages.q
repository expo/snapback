fn isMember(c: text <=80, p: principal): exists memberships[c, p]

mutation join(conversationId: text <=80):
  insert memberships { conversationId, principal: viewer }

mutation send(conversationId: text <=80, body: text <=100):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  insert messages { conversationId, authorId: viewer, body }

query inbox(c: cursor ?):
  return deliveries[viewer] after c first 50 by byRecipient { *, message: messages[.row] }

query thread(conversationId: text <=80, c: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  return deliveries[viewer, conversationId, 'delivered'] after c last 50 by byRecipientGroup { *, message: messages[.row] }

query receipts(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require exists memberships[msg.conversationId, viewer] else MEMBERSHIP_REQUIRED
  return deliveriesReceipts[messageId] first 50 by byRow { recipient, received }
