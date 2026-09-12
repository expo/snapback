-- @ref LLP 2000#10-first-implementation-experiment — every useful read has
-- its own membership boundary; an unavailable summary cannot authorize data.
use identity

table conversations:
  title: text <=80
  topic: text <=240
  kind: enum('group', 'direct')
  color: enum('sage', 'clay', 'lavender', 'sky')
  updatedAt: time
  immutable title, topic, kind, color
  read <- exists memberships[.id, viewer] by byConversationPrincipal
  insert <- deny
  update <- exists memberships[.id, viewer] by byConversationPrincipal
  delete <- deny

table memberships:
  conversationId: conversations
  principal: principal
  displayName: text <=60
  role: text <=60
  unique byConversationPrincipal: conversationId, principal
  by byPrincipal: principal, conversationId, id
  by byConversation: conversationId, principal
  cap 50 by conversationId
  immutable conversationId, principal, displayName, role
  read <- exists memberships[.conversationId, viewer] by byConversationPrincipal
  insert <- deny
  update <- deny
  delete <- deny

table messages:
  conversationId: conversations
  author: principal
  body: text 1..2000
  ordinal: int
  at: time
  editedAt: time ?
  by byConversation: conversationId, ordinal, id
  immutable conversationId, author, ordinal, at
  retain delivered-history
  read <- exists memberships[.conversationId, viewer] by byConversationPrincipal
  insert <- .author = viewer and exists memberships[.conversationId, viewer] by byConversationPrincipal
  update <- .author = viewer and exists memberships[.conversationId, viewer] by byConversationPrincipal
  delete <- deny

table readCursors:
  conversationId: conversations
  principal: principal
  seen: int
  unique byConversationPrincipal: conversationId, principal
  immutable conversationId, principal
  read <- .principal = viewer and exists memberships[.conversationId, viewer] by byConversationPrincipal
  insert <- .principal = viewer and exists memberships[.conversationId, viewer] by byConversationPrincipal
  update <- .principal = viewer and exists memberships[.conversationId, viewer] by byConversationPrincipal
  delete <- deny

maintain messageTotals: count messages by conversationId
  read <- exists memberships[.conversationId, viewer] by byConversationPrincipal
