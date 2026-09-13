-- @ref LLP 2000#17-completing-the-full-clique-product — this native witness
-- uses the same authorized, durable-operation surface as an ordinary app.
use identity

table conversations:
  title: text <=80
  updatedAt: time
  immutable title
  read <- exists memberships[.id, viewer] by byConversationPrincipal
  insert <- deny
  update <- exists memberships[.id, viewer] by byConversationPrincipal
  delete <- deny

table memberships:
  conversationId: conversations
  principal: principal
  displayName: text <=60
  unique byConversationPrincipal: conversationId, principal
  by byPrincipal: principal, conversationId, id
  immutable conversationId, principal, displayName
  read <- exists memberships[.conversationId, viewer] by byConversationPrincipal
  insert <- deny
  update <- deny
  delete <- deny

table messages:
  conversationId: conversations
  author: principal
  body: text 1..2000
  clientTag: text 1..120
  ordinal: int
  at: time
  unique byClientTag: conversationId, clientTag
  by byConversation: conversationId, ordinal, id
  immutable conversationId, author, body, clientTag, ordinal, at
  retain delivered-history
  read <- exists memberships[.conversationId, viewer] by byConversationPrincipal
  insert <- .author = viewer and exists memberships[.conversationId, viewer] by byConversationPrincipal
  update <- deny
  delete <- deny

maintain messageTotals: count messages by conversationId
  read <- exists memberships[.conversationId, viewer] by byConversationPrincipal
