use identity password

table profiles:
  principal: principal
  name: text <=100
  unique principal
  read <- allow
  update <- .principal = viewer
  sync public
table rooms:
  title: text <=100
  read <- exists members[.id, viewer]
  sync to members[.id]
table members:
  room: rooms
  principal: principal
  seen: int default 0
  unique room, principal
  immutable room, principal
  cap 50 by room
  read <- exists members[.room, viewer]
  update <- .principal = viewer
  sync to members[.room]
table messages:
  room: rooms
  sender: principal
  ordinal: int
  text: text <=2000
  quote: messages ?
  photo: image <=10000000 ?
  oncePhoto: image <=10000000 once ?
  immutable room, sender, ordinal
  unique room, ordinal
  read <- exists members[.room, viewer]
  insert <- .sender = viewer and exists members[.room, viewer]
  update <- .sender = viewer and exists members[.room, viewer]
  retain delivered-history
  sync to members[.room] last 500 by .ordinal
table reactions:
  message: messages
  principal: principal
  emoji: text 1..32
  unique message, principal
  immutable message, principal
  read through .message
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync
table posts:
  author: principal
  text: text <=2000
  photo: image <=10000000 ?
  at: time
  read <- allow
  insert <- .author = viewer
  sync public last 100 by .at

query profile(principal: principal):
  return profiles[principal = principal]
query history(room: rooms, c: cursor ?):
  return messages where .room = room last 20 by .ordinal after c
query reactionRows(message: messages, c: cursor ?):
  return reactions where .message = message first 50 by .principal after c
query message(id: messages):
  return messages[id]
fn seenCount(m: messages):
  return count(members where .room = m.room and .seen >= m.ordinal)
query receipts(room: rooms, c: cursor ?):
  return messages where .room = room last 20 by .ordinal after c { id, seen: seenCount(.) }
query feed(c: cursor ?):
  return posts last 20 by .at after c
mutation editProfile(name: text <=100):
  update profiles[principal = viewer] { name }
mutation setReaction(message: messages, emoji: text 1..32 ?):
  m = messages[message] ! else NOT_FOUND
  require exists members[m.room, viewer] else NOT_MEMBER
  if emoji = null:
    if exists reactions[message, viewer]:
      delete reactions[message, viewer]
  else if exists reactions[message, viewer]:
    update reactions[message, viewer] { emoji }
  else:
    insert reactions { message, principal: viewer, emoji }
mutation send(id: id, room: rooms, ordinal: int, text: text <=2000, quote: messages ?, photo: image <=10000000 ?, oncePhoto: image <=10000000 ?):
  insert messages { id, room, ordinal, sender: viewer, text, quote, photo, oncePhoto }
mutation post(id: id, text: text <=2000, photo: image <=10000000 ?):
  insert posts { id, text, photo, author: viewer, at: now }
mutation editMessage(id: messages, text: text <=2000):
  update messages[id] { text }
mutation seen(room: rooms, ordinal: int):
  update members[room, viewer] { seen: ordinal }
