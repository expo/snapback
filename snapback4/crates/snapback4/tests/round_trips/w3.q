query W3():
  return memberships where .principal = viewer and .room != 'r1024' first 32 by .room {
    room, total: .room.total ?? 0, unread: max(0, (.room.total ?? 0) - .last_read) }

mutation seedRoom(key: id, total: int, last_read: int):
  insert rooms { id: key, total }
  return insert memberships { id: key, room: key, principal: viewer, last_read }
