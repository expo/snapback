use personas alice, bob
table rooms:
  title: text
  read <- exists members[.id, viewer]
  sync to members[.id]
table members:
  room: rooms
  principal: principal
  unique room, principal
  immutable room, principal
  cap 50 by room
  read <- exists members[.room, viewer]
  sync to members[.room]
table messages:
  room: rooms
  sender: principal
  ordinal: int
  text: text <=2000
  immutable room, sender, ordinal
  by byWords: room, words(text), ordinal
  read <- exists members[.room, viewer]
  insert <- .sender = viewer and exists members[.room, viewer]
  update <- .sender = viewer and exists members[.room, viewer]
  sync to members[.room] last 500 by .ordinal
table reactions:
  message: messages
  principal: principal
  emoji: text
  unique message, principal
  immutable message, principal
  read through .message
  sync
table receipts:
  message: messages
  principal: principal
  unique message, principal
  immutable message, principal
  read through .message
  sync
table profiles:
  principal: principal
  name: text
  unique principal
  read <- allow
  sync public
table posts:
  author: principal
  text: text
  at: time
  read <- allow
  sync public last 100 by .at
query history(room: rooms):
  return messages where .room = room last 100 by .ordinal
query reactionRows(message: messages):
  return reactions where .message = message first 50 by .principal
query receiptRows(message: messages):
  return receipts where .message = message first 50 by .principal
query profile(principal: principal):
  return profiles[principal = principal]
query following():
  return posts where .author = viewer last 20 by .at
query discover():
  return posts last 20 by .at
query search(room: rooms, q: text):
  return messages[room] matching q first 100 by byWords
mutation send(id: id, room: rooms, ordinal: int, text: text <=2000):
  insert messages { id, room, ordinal, text, sender: viewer }
mutation edit(id: messages, text: text <=2000):
  update messages[id] { text }
