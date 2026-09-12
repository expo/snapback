use identity

table memberships:
  conversationId: text <=80
  principal: principal
  cap 3 by conversationId
  by byConversationPrincipal: conversationId, principal
  read <- .principal = viewer
  insert <- .principal = viewer
  delete <- .principal = viewer

table messages:
  conversationId: text <=80
  authorId: principal
  body: text <=80
  editedAt: time ?
  by bySearch: conversationId, wordPrefixes(body), id
  deliver to memberships[.conversationId] as deliveries with receipts
  retain delivered-history
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer
  update <- .authorId = viewer
  delete <- .authorId = viewer
