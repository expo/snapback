table chats:
  read <- exists members[.id, viewer]
  insert <- allow
  sync

table members:
  chat: chats
  principal: principal
  immutable chat, principal
  unique chat, principal
  read <- exists members[.chat, viewer]
  insert <- created chats[.chat] or exists members[.chat, viewer]
  sync

table messages:
  chat: chats
  sender: principal
  body: text <= 2000
  until: time ?
  immutable chat, until
  read <- exists members[.chat, viewer]
  insert <- .sender = viewer and exists members[.chat, viewer]
  expire at .until
  sync

table receipts:
  message: messages
  principal: principal
  state: int
  immutable message, principal
  unique message, principal
  read through .message
  insert <- created messages[.message] or .principal = viewer
  update <- .principal = viewer
  sync

table reactions:
  message: messages
  principal: principal
  emoji: text <= 20
  immutable message, principal
  unique message, principal
  read through .message
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync

view unread: count receipts where .state < 2 by .message.chat, .principal

query unreadFor(chat: chats):
  unread[chat, viewer]
query received(message: messages):
  receipts where .message = message first 50 by .principal { id, principal, state }
query reacted(message: messages):
  reactions where .message = message first 50 by .principal { id, principal, emoji }
