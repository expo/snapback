fn isMember(c: text <=80, p: principal): exists memberships[c, p]

mutation join(conversationId: text <=80):
  insert memberships { conversationId, principal: viewer }

mutation send(conversationId: text <=80, body: text <=80):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  insert messages { conversationId, authorId: viewer, body }

mutation batch(conversationId: text <=80, bodies: [text <=80] <=51):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  for body in bodies:
    insert messages { conversationId, authorId: viewer, body }

mutation edit(messageId: messages, body: text <=80):
  update messages[messageId] { body, editedAt: now }

query allReceipts():
  return deliveriesReceipts[] first 200 by byId

query search(conversationId: text <=80, term: text <=80, c: cursor ?):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  return messages[conversationId, term] after c first 50 by bySearch

query inbox(c: cursor ?):
  return deliveries[viewer] after c first 50 by byRecipient { *, message: messages[.row] }

query thread(conversationId: text <=80, c: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  return deliveries[viewer, conversationId, 'delivered'] after c last 50 by byRecipientGroup { *, message: messages[.row] }

query receipts(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require exists memberships[msg.conversationId, viewer] else MEMBERSHIP_REQUIRED
  return deliveriesReceipts[messageId] first 50 by byRow { recipient, received }
