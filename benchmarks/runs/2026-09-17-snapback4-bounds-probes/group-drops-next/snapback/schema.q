use personas alice

table members:
  roomId: id
  principal: principal
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  read <- exists members[.roomId, viewer]
  online only

table messages:
  roomId: id
  body: text <=200
  at: time
  by byRoomTime: roomId, at, id
  read <- exists members[.roomId, viewer]
  online only

-- control: the merge page returned as itself
query plain(c: cursor ?):
  return merge messages after c last 4 by byRoomTime:
    [m.roomId] for m in members[viewer] first 50 by byPrincipalRoom

-- the page passed through group(): what happens to `next` and `complete`?
query grouped(c: cursor ?):
  page = merge messages after c last 4 by byRoomTime:
    [m.roomId] for m in members[viewer] first 50 by byPrincipalRoom
  return group(page, 'roomId') { roomId: .key, messages: .items { id, at } }

-- the same with a direct (non-merge) page
query groupedDirect(roomId: id, c: cursor ?):
  page = messages[roomId] after c last 4 by byRoomTime
  return group(page, 'roomId') { roomId: .key, messages: .items { id, at } }

-- the page kept beside the grouping
query both(c: cursor ?):
  page = merge messages after c last 4 by byRoomTime:
    [m.roomId] for m in members[viewer] first 50 by byPrincipalRoom
  return { page, groups: group(page, 'roomId') { roomId: .key, n: count(.items) } }
