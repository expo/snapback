use personas p00, p01, p02, p03, p04, p05, p06, p07, p08, p09, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27, p28, p29, p30, p31, p32, p33, p34, p35, p36, p37, p38, p39, p40, p41, p42, p43, p44, p45, p46, p47, p48, p49
effect push

table rooms:
  title: text <=80
  read <- exists members[.id, viewer]
  insert <- allow
  after insert <- exists members[.id, viewer]
  sync to members[.id]

table members:
  roomId: rooms
  principal: principal
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  cap 50 by roomId
  immutable roomId, principal
  read <- exists members[.roomId, viewer]
  insert <- exists members[.roomId, viewer] or created rooms[.roomId]
  sync to members[.roomId]

table messages:
  roomId: rooms
  senderId: principal
  body: text <=4000
  at: time
  by byRoomTime: roomId, at, id
  immutable roomId, senderId, at
  read <- exists members[.roomId, viewer]
  insert <- .senderId = viewer and exists members[.roomId, viewer]
  sync last 500 by byRoomTime

-- today's card form: a send-time presence guard
mutation send(roomId: rooms, body: text <=4000):
  require exists members[roomId, viewer] else NOT_MEMBER
  msg = insert messages { roomId, senderId: viewer, body, at: now }
  for m in members[roomId] first 50 by byRoomPrincipal:
    if m.principal != viewer and not exists connected[m.principal]:
      emit push { targetUserId: m.principal, roomId, preview: body }
  return msg

-- the ruled semantics' worst case for rows: one durable effect per recipient, connected or not
mutation sendAlways(roomId: rooms, body: text <=4000):
  require exists members[roomId, viewer] else NOT_MEMBER
  msg = insert messages { roomId, senderId: viewer, body, at: now }
  for m in members[roomId] first 50 by byRoomPrincipal:
    if m.principal != viewer:
      emit push { targetUserId: m.principal, roomId, preview: body }
  return msg

-- the floor: no effects at all
mutation sendQuiet(roomId: rooms, body: text <=4000):
  require exists members[roomId, viewer] else NOT_MEMBER
  return insert messages { roomId, senderId: viewer, body, at: now }
