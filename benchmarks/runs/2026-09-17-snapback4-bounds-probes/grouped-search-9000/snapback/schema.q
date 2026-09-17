use personas alice, bob

table members:
  roomId: id
  principal: principal
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  read <- exists members[.roomId, viewer]
  online only

table messages:
  roomId: id
  body: text <=4000
  at: time
  by byRoomTime: roomId, at, id
  by byRoomWords: roomId, words(body), at, id
  read <- exists members[.roomId, viewer]
  online only

-- grouped by chat, ONE cursor, no merge: chats that hold a hit, each with its newest 3 hits
query grouped(q: text <=100, c: cursor ?):
  return members[viewer] after c first 20 by byPrincipalRoom where count(messages[.roomId] matching q last 1 by byRoomWords) > 0 { roomId, hits: messages[.roomId] matching q last 3 by byRoomWords }
