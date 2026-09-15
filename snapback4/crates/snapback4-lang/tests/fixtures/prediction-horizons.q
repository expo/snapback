table members:
  conversationId: id
  principal: principal
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  read <- exists members[.conversationId, viewer]
  sync

table messages:
  conversationId: id
  body: text <=200
  at: time
  by byConversation: conversationId, at, id
  by byWords: conversationId, words(body), at, id
  read <- exists members[.conversationId, viewer]
  insert <- exists members[.conversationId, viewer]
  sync last 500 by byConversation

table posts:
  body: text <=200
  at: time
  by byTime: at, id
  public 'posts'
  insert <- allow
  sync last 500 by byTime

table ranked:
  postId: posts
  by byPost: postId, id
  public 'ranking'
  insert <- exists posts[.postId]
  sync last 500 by byPost

table reactions:
  conversationId: id
  messageId: id
  principal: principal
  emoji: text <=20
  unique byConversationMessagePrincipal: conversationId, messageId, principal
  by byConversation: conversationId, id
  read <- exists members[.conversationId, viewer]
  insert <- .principal = viewer
  update <- .principal = viewer
  sync

table intents:
  principal: principal
  key: id
  unique byPrincipalKey: principal, key
  read <- .principal = viewer
  insert <- .principal = viewer
  sync

table sentMessages:
  principal: principal
  key: id
  unique byPrincipalKey: principal, key
  read <- .principal = viewer
  insert <- .principal = viewer
  sync

table archive:
  at: time
  public 'archive'
  by byTime: at, id
  sync

maintain messageCounts: count messages by conversationId, at
  read <- exists members[.conversationId, viewer]
maintain reactionCounts: count reactions by conversationId, messageId
  read <- exists members[.conversationId, viewer]
maintain postCounts: count posts by body
  read <- allow
maintain postTimes: count posts by at
  read <- allow
maintain rankCounts: count ranked by postId
  read <- allow
maintain rankTotal: count ranked by postId
  read <- allow

mutation send(messageId: messages, conversationId: id, body: text <=200):
  require not exists messages[messageId] else DUPLICATE
  insert messages { id: messageId, conversationId, body, at: now }

mutation createPost(postId: posts, body: text <=200):
  if exists posts[postId]:
    return null
  insert posts { id: postId, body, at: now }
  insert ranked { postId }

mutation react(conversationId: id, messageId: id):
  upsert reactions[conversationId, messageId, viewer] { emoji: 'heart' }

mutation acceptIntent(key: id):
  require not exists intents[viewer, key] else DUPLICATE
  insert intents { principal: viewer, key }

mutation recordSent(key: id):
  if not exists sentMessages[viewer, key]:
    insert sentMessages { principal: viewer, key }

query search(q: text <=100, c: cursor ?):
  return merge messages matching q after c last 20 by byWords:
    [m.conversationId] for m in members[viewer] first 1000 by byPrincipalConversation
