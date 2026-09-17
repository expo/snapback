table rooms:
  public 'rooms'
  cap 100
  sync public
table members:
  roomId: rooms
  principal: principal
  unread: int
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  cap 100 by roomId
  read <- exists members[.roomId, viewer]
  update <- exists members[.roomId, viewer]
  sync to members[.roomId]
table messages:
  roomId: rooms
  body: text <=100
  at: time
  expiresAt: time ?
  by byRoomTime: roomId, at, id
  by byRoomWords: roomId, words(body), at, id
  by byExpiry: expiresAt
  expire at .expiresAt
  read <- exists members[.roomId, viewer]
  sync to members[.roomId] last 500 by byRoomTime

fn total():
  n = 0
  for m in members[viewer]:
    n = n + m.unread
  return n
query unreadTotal():
  return total()
query everywhere(q: text <=100, c: cursor ?):
  return merge messages matching q after c last 20 by byRoomWords:
    [m.roomId] for m in members[viewer]
query roster(roomId: rooms):
  return members[roomId]
query nested(roomId: rooms):
  return rooms[roomId] { id, members: members[.id] }
mutation bump(roomId: rooms):
  for m in members[roomId]:
    update members[m] { unread: m.unread + 1 }
  return null
query hasMessages(roomId: rooms):
  return exists messages[roomId]
query hasMatches(roomId: rooms, q: text <=100):
  return exists (messages[roomId] matching q)
query grouped(q: text <=100, c: cursor ?):
  return members[viewer] after c first 20 by byPrincipalRoom where exists (messages[.roomId] matching q) { roomId, hits: messages[.roomId] matching q last 3 by byRoomWords }
query exact(roomId: rooms):
  return exists members[roomId, viewer]
