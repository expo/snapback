table rooms:
  public

table members:
  room: rooms
  principal: principal
  unique room, principal
  read <- exists members[.room, viewer]
  delete <- .principal = viewer

table messages:
  room: rooms
  ordinal: int
  body: text <=100
  at: time
  tombstone: bool
  until: time ?
  expire at .until
  immutable room, ordinal
  unique room, ordinal
  search body
  by byWords: room, tombstone, words(body), at, id
  read <- exists members[.room, viewer]

mutation delivered(group: rooms, low: int, high: int)
  reports delivery of messages by .room, .ordinal: server
  require low <= high else NOT_A_RUN
  page = messages where .room = group and .ordinal >= low and .ordinal <= high first 3 by .ordinal
  return page

mutation leave(id: id):
  delete members[id]

query newest(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone and exists members[.room, viewer] last 2 by .at after c {alias: .body} {alias}

query plain(room: rooms):
  return messages where .room = room first 2 by .ordinal {alias: .body} {alias}

query expiring(room: rooms):
  return messages where .room = room first 3 by .ordinal
