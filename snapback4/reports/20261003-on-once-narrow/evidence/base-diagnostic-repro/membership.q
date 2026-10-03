
table members:
  room: id
  principal: principal
  unique room, principal
  read <- exists members[.room, viewer]
  delete <- .principal = viewer
table messages:
  room: id
  body: text <=4000
  payload: text <=20000
  at: time
  tombstone: bool
  until: time ?
  expire at .until
  search body
  by byWords: room, tombstone, words(body), at, id
  read <- exists members[.room, viewer]
query repaired(q: text <=100, c: cursor ?):
  return members[principal = viewer] after c first 2 by .room, .id where exists (messages[room = .room, tombstone = false] matching 'cof' by .at, .id where (.at > 0)) { room, hits: messages[room = .room, tombstone = false] matching 'cof' last 3 by .at, .id where (.at > 0) }
