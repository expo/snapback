query listRooms():
  return rooms[viewer] first 100 by byOwner

query listMessages():
  return messages[viewer] first 100 by byOwner

query listReactions():
  return reactions[viewer] first 100 by byOwner

query listReceipts():
  return receipts[viewer] first 100 by byOwner

mutation send(roomId: rooms, body: text <=200):
  room = rooms[roomId] ! else ROOM_MISSING
  row = insert messages { roomId: room.id, body, at: now, ownerId: viewer }
  return { id: row.id }

query countForRoom(roomId: rooms):
  return messageCounts[roomId, viewer]
