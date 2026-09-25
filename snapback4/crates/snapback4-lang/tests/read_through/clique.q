table chats:
  public
table members:
  chat: chats
  principal: principal
  unique chat, principal
  read <- .principal = viewer
  insert <- allow
  delete <- .principal = viewer
table messages:
  chat: chats
  until: time ?
  immutable chat, until
  expire at .until
  read <- exists members[.chat, viewer]
  insert <- allow
table receipts:
  message: messages
  principal: principal
  state: int
  immutable message, principal
  read through .message
  insert <- .principal = viewer
  update <- .principal = viewer
table reactions:
  message: messages
  principal: principal
  emoji: text <=8
  immutable message, principal
  read through .message
  insert <- .principal = viewer
view unread: count receipts where .state < 2 by .message.chat, .principal
view reactionsByMessage: count reactions by .message
mutation join():
  insert members { id: 'member', chat: 'chat', principal: viewer }
mutation setup(until: time ?):
  insert messages { id: 'm', chat: 'chat', until }
  insert receipts { id: 'r', message: 'm', principal: viewer, state: 0 }
  insert reactions { id: 'e', message: 'm', principal: viewer, emoji: 'ok' }
mutation readIt():
  update receipts['r'] { state: 2 }
mutation leave():
  delete members['member']
query unreadFor():
  return unread['chat', 'alice']
query reactionsFor():
  return reactionsByMessage['m']
query receipt():
  return receipts['r']
