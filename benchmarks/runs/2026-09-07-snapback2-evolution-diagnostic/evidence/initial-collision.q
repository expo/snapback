query rooms():
  return rooms[viewer] first 100 by byOwner

query messages():
  return messages[viewer] first 100 by byOwner

query reactions():
  return reactions[viewer] first 100 by byOwner

query receipts():
  return receipts[viewer] first 100 by byOwner

mutation send(roomId: rooms, body: text <=200):
  room = rooms[roomId] ! else ROOM_MISSING
  row = insert messages { roomId: room.id, body, at: now, ownerId: viewer }
  return { id: row.id }
