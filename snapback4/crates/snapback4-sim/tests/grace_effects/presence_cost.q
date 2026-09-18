
use personas alice, bob, carol

effect notify

table conversations:
  title: text <=120
  read <- exists memberships[.id, viewer]
  insert <- allow
  sync to memberships[.id]

table memberships:
  conversationId: conversations
  principal: principal
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer] or created conversations[.conversationId]
  sync to memberships[.conversationId]

table messages:
  conversationId: conversations
  authorId: principal
  body: text <=4000
  at: time
  by byConvTime: conversationId, at, id
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  sync to memberships[.conversationId] last 500 by byConvTime

table rankings:
  postId: id
  score: int
  unique byPost: postId
  read <- allow
  insert <- viewer = 'service:ranker'
  update <- viewer = 'service:ranker'

mutation send(conversationId: conversations, body: text <=4000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  msg = insert messages { conversationId, authorId: viewer, body, at: now }
  for m in memberships[conversationId] first 50 by byConversationPrincipal:
    if m.principal != viewer and not exists connected[m.principal]:
      emit notify { targetUserId: m.principal, chatId: conversationId, messageId: msg.id, preview: slice(body, 0, 80) }
  return { id: msg.id }

query online(p: principal):
  return connected[p]

mutation rank(postId: id, score: int):
  upsert rankings[postId] { postId, score }
