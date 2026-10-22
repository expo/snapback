-- @ref LLP 3000.009.001.002#4-controls — the same authorized fixture, served by the shipped engine.
table users:
  principal: principal
  sent: count messages by .sender
  unique principal
  immutable principal
  read <- allow
  online only

table rooms:
  total: count messages by .room
  read <- allow
  online only

table memberships:
  room: rooms
  principal: principal
  last_read: int default 0
  unique room, principal
  immutable room, principal
  read <- .principal = viewer
  online only

table messages:
  room: rooms
  sender: users
  at: time
  body: text <=4000
  immutable room, sender, at
  read <- exists memberships[.room, viewer]
  insert <- .sender.principal = viewer and exists memberships[.room, viewer]
  online only

table counters:
  owner: principal ?
  room: rooms
  n: int default 0
  immutable owner, room
  read <- .owner = viewer or (.owner = null and exists memberships[.room, viewer])
  update <- .owner = viewer or (.owner = null and exists memberships[.room, viewer])
  online only

query W1(message: messages):
  return messages[message] ! else NOT_FOUND

query W2(room: rooms):
  require exists memberships[room, viewer] else NOT_ALLOWED
  return messages where .room = room last 20 by .at, .id

query W3():
  return memberships where .principal = viewer and .room != 'r1024' first 32 by .room {
    room, total: .room.total ?? 0, unread: max(0, (.room.total ?? 0) - .last_read) }

mutation increment(counter: counters):
  c = counters[counter] ! else NOT_FOUND
  return update counters[c.id] { n: c.n + 1 }

mutation post(room: rooms, body: text <=4000):
  u = users[principal = viewer] ! else NOT_FOUND
  return insert messages { room, sender: u.id, at: now, body }
