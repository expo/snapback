table rooms:
  creator: principal
  lastOrdinal: int default 0
  read <- exists audience[.id, viewer]
  insert <- .creator = viewer
  update <- exists audience[.id, viewer]
  after insert <- exists audience[room = .id, principal = .creator]
  sync to audience[.id]
table audience:
  room: rooms
  principal: principal
  joinedOrdinal: int
  unique room, principal
  cap 50 by room
  immutable room, principal, joinedOrdinal
  read <- exists audience[.room, viewer]
  insert <- created rooms[.room] or exists audience[.room, viewer]
  update <- .principal = viewer
  sync to audience[.room]
table tracked:
  receipts tracked by .room, .ordinal from .sender to audience:
    counter .lastOrdinal
    floor .joinedOrdinal
    count .recipients
    watermarks .deliveredOrdinal, .seenOrdinal
    runs trackedRuns
  room: rooms
  sender: principal
  ordinal: int
  recipients: int
  text: text <=80
  unique room, ordinal
  immutable room, sender, ordinal, recipients
  read <- exists audience[.room, viewer]
  insert <- .sender = viewer and exists audience[.room, viewer]
  delete <- .sender = viewer
  sync to audience[.room] last 50 by .ordinal
mutation room():
  r = insert rooms {creator:viewer}
  insert audience {room:r.id,principal:viewer}
  insert audience {room:r.id,principal:'member:alice'}
  return r.id
mutation sendTracked(text: text <=80):
  return insert tracked {room:'room1',sender:viewer,text}
mutation gap():
  delete tracked['tracked3']
query trackedHistory(c: cursor ?):
  return tracked where .room = 'room1' first 2 by .ordinal after c
query trackedAll():
  return tracked where .room = 'room1' first 20 by .ordinal
