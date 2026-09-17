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
  read <- exists members[.roomId, viewer]
  online only

-- V1: filter with an inner matching top-1, no nested shape
query v1(q: text <=100, c: cursor ?):
  return members[viewer] after c first 20 by byPrincipalRoom where count(messages[.roomId] matching q last 1 by byRoomWords) > 0 { roomId }

-- V2: filter with an inner PLAIN top-1
query v2(c: cursor ?):
  return members[viewer] after c first 20 by byPrincipalRoom where count(messages[.roomId] last 1 by byRoomTime) > 0 { roomId }

-- V3: no filter, nested matching top-3 in the shape
query v3(q: text <=100, c: cursor ?):
  return members[viewer] after c first 20 by byPrincipalRoom { roomId, hits: messages[.roomId] matching q last 3 by byRoomWords }

-- V4: no filter, nested plain top-3 in the shape
query v4(c: cursor ?):
  return members[viewer] after c first 20 by byPrincipalRoom { roomId, recent: messages[.roomId] last 3 by byRoomTime }
