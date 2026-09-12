mutation direct(conversationId: id):
  for m in memberships[conversationId] first 50 by byConversationPrincipal:
    insert deliveries { principal: m.principal }

mutation bound(conversationId: id):
  page = memberships[conversationId] first 50 by byConversationPrincipal
  for m in page:
    insert deliveries { principal: m.principal }

mutation longer(conversationId: id):
  for m in memberships[conversationId, 'member'] first 50 by byConversationRole:
    insert deliveries { principal: m.principal }

query page(conversationId: id):
  for m in memberships[conversationId] first 50 by byConversationPrincipal:
    require m.principal = viewer else NOT_ME
