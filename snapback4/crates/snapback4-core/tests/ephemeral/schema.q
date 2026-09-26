table rooms:
  title: text <=80
  public 'rooms'
  insert <- allow
  sync public
table members:
  roomId: rooms
  principal: principal
  unique byRoomPrincipal: roomId, principal
  by byPrincipal: principal, roomId
  read <- allow
  insert <- allow
  delete <- allow
  sync public
table typing:
  roomId: rooms
  principal: principal
  payload: text <=100 default ''
  unique byRoomPrincipal: roomId, principal
  cap 50 by roomId
  read <- exists members[.roomId, viewer]
  insert <- .principal = viewer and exists members[.roomId, viewer]
  update <- .principal = viewer
  delete <- .principal = viewer
  ephemeral 4s
mutation setTyping(roomId: rooms, payload: text <=100):
  upsert typing[roomId, viewer] { payload }
  return typing[roomId, viewer]
mutation stopTyping(roomId: rooms):
  delete typing[roomId, viewer]
mutation removeMember(roomId: rooms, who: principal):
  delete members[roomId, who]
query typingIn(roomId: rooms):
  return typing where .roomId = roomId by .principal
query typingOne(roomId: rooms, who: principal):
  return typing[roomId, who]
query names(roomId: rooms):
  return typing where .roomId = roomId by .principal { principal, title: rooms[.roomId].title }
query durable():
  return rooms['r']
