use identity
-- @ref LLP 3000.009.001.002#4-controls — the same authorized fixture, served by the shipped engine.
table users:
  insert <- allow
  principal: principal
  unique principal
  immutable principal
  read <- allow
  online only

table rooms:
  insert <- allow
  read <- allow
  online only

table memberships:
  insert <- allow
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
  insert <- allow
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

mutation increment(counter: counters):
  c = counters[counter] ! else NOT_FOUND
  return update counters[c.id] { n: c.n + 1 }

mutation post(room: rooms, body: text <=4000):
  u = users[principal = viewer] ! else NOT_FOUND
  return insert messages { room, sender: u.id, at: now, body }

mutation setup():
  insert users {id: 'u0001', principal: viewer}
  insert rooms {id: 'r0001'}
  insert memberships {id: 'g0001', room: 'r0001', principal: viewer}
  return insert counters {id: 'c0000', room: 'r0001', owner: viewer}
mutation seedMessage(key: id, at: time):
  return insert messages {id: key, room: 'r0001', sender: 'u0001', at, body: 'probe'}
mutation checked(counter: counters, room: rooms):
  require exists memberships[room, viewer] else NOT_ALLOWED
  c = counters[counter] ! else NOT_FOUND
  return update counters[c.id] {n: c.n + 1}
