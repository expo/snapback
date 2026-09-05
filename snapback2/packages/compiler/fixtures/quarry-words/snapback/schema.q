use identity

table conversations:
  title: text <=200
  public

table messages:
  conversationId: conversations
  author: principal
  body: text <=2000
  at: time
  public
  insert <- .author = viewer
  update <- .author = viewer

table searchWords:
  messageId: messages
  conversationId: conversations
  term: text <=2000
  at: time
  unique byMessageTerm: messageId, term
  by byConversationTermTime: conversationId, term, at, id
  public
  insert <- allow
  update <- allow
  delete <- allow
