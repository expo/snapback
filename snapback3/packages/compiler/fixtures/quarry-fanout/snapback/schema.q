table memberships:
  conversationId: id
  principal: principal
  role: text <=32
  group: text <=32 ?
  unique byConversationPrincipal: conversationId, principal
  by byConversationRole: conversationId, role, id
  by byGroup: group, id
  cap 50 by conversationId
  public
  insert <- allow

table deliveries:
  principal: principal
  public
  insert <- allow
