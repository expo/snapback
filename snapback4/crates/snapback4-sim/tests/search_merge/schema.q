table members:
  roomId: id
  principal: principal
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  cap 100 by roomId
  read <- exists members[.roomId, viewer]
  insert <- exists members[.roomId, viewer]
  sync to members[.roomId]

table messages:
  roomId: id
  body: text <=4000
  at: time
  by byRoomWords: roomId, words(body), at, id
  by byWords: words(body), at, id
  by byRoomTime: roomId, at, id
  read <- exists members[.roomId, viewer]
  insert <- allow
  sync to members[.roomId]

query everywhere(q: text <=100, c: cursor ?):
  return merge messages matching q after c last 2 by byRoomWords:
    [m.roomId] for m in members[viewer] first 50 by byPrincipalRoom

query explicit(q: text <=100, c: cursor ?):
  return merge messages matching q after c last 2 by byRoomWords:
    ['r1']
    ['r2']
    ['r3']
