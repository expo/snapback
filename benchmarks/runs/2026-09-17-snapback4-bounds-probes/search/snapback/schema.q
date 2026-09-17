use personas alice, bob

table members:
  roomId: id
  principal: principal
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  cap 100 by roomId
  cap 1000 by principal
  read <- exists members[.roomId, viewer]
  online only

table messages:
  roomId: id
  body: text <=4000
  at: time
  by byRoomTime: roomId, at, id
  by byRoomWords: roomId, words(body), at, id
  by byWords: words(body), at, id
  read <- exists members[.roomId, viewer]
  online only

-- P1: the query a builder writes first: one cursor, all my chats
query everywhere(q: text <=100, c: cursor ?):
  return merge messages matching q after c last 20 by byRoomWords:
    [m.roomId] for m in members[viewer] first 1000 by byPrincipalRoom

-- P2: plain (non-matching) merge over the same lanes
query inbox(c: cursor ?):
  return merge messages after c last 20 by byRoomTime:
    [m.roomId] for m in members[viewer] first 1000 by byPrincipalRoom

-- P3: unscoped words index on the server, rule per row
query unscoped(q: text <=100, c: cursor ?):
  return messages matching q after c last 20 by byWords

-- P4: the card's two-cursor walk
query searchChats(c: cursor ?):
  return members[viewer] after c first 50 by byPrincipalRoom

query searchChatBatch(q: text <=100, batch: cursor ?, c: cursor ?):
  return merge messages matching q after c last 20 by byRoomWords:
    [m.roomId] for m in members[viewer] after batch first 50 by byPrincipalRoom

-- G: grouped by chat, ONE cursor: chats with a hit (in membership order), each with its newest 3 hits
query grouped(q: text <=100, c: cursor ?):
  return members[viewer] after c first 20 by byPrincipalRoom where count(messages[.roomId] matching q last 1 by byRoomWords) > 0 { roomId, hits: messages[.roomId] matching q last 3 by byRoomWords }
