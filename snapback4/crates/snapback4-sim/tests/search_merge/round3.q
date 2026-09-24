table members:
  roomId: id
  principal: principal
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  read <- exists members[.roomId, viewer]
table messages:
  roomId: id
  authorId: principal
  body: text <=100
  by byRoom: roomId, id
  by byWords: roomId, words(body), id
  read <- exists members[.roomId, viewer] and .authorId = viewer
query matching(c: cursor ?):
  return merge messages matching 'cof' after c first 10 by byWords:
    [m.roomId] for m in members[principal = viewer] first 50 by byPrincipalRoom
