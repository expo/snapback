effect changed

table memberships:
  room: id
  principal: principal
  role: enum('member', 'admin')
  unique byRoomPrincipal: room, principal
  by byRoomPrincipalRole: room, principal, role
  by byPrincipalRoom: principal, room, id
  cap 64 by room
  immutable room, principal
  read <- exists memberships[.room, viewer]
  insert <- exists memberships[room = .room, principal = viewer, role = 'admin']
  delete <- .principal = viewer or exists memberships[room = .room, principal = viewer, role = 'admin']
  sync

table items:
  room: id
  owner: principal default viewer
  title: text <=120
  amount: int default 0
  at: time default now
  unique byRoomTitle: room, title
  by byRoomTime: room, at, id
  immutable room, owner
  read <- exists memberships[.room, viewer]
  insert <- .owner = viewer and exists memberships[.room, viewer]
  update <- .owner = viewer
  delete <- .owner = viewer
  sync last 500 by byRoomTime

maintain totals: sum items of amount by room
  read <- exists memberships[.room, viewer]

table counters:
  value: int
  public 'evaluation counters'
  insert <- allow
  update <- allow
  sync last 64 by byId

query item(itemId: items):
  return items[itemId]

query page(room: id, c: cursor ?):
  return items[room] after c last 20 by byRoomTime

query inbox():
  return memberships[viewer] first 32 by byPrincipalRoom { room, total: totals[.room] }

query counter(slot: counters):
  return counters[slot]

mutation add(room: id, title: text <=120, amount: int, fail: bool):
  row = insert items { room, title, amount }
  emit changed { id: row.id }
  require not fail else DELIBERATE_FAILURE
  return row

mutation revise(itemId: items, title: text <=120, amount: int):
  update items[itemId] { title, amount }
  return null

mutation remove(itemId: items):
  delete items[itemId]
  return null

mutation join(room: id, principal: principal):
  return insert memberships { room, principal, role: 'member' } if absent

mutation leave(room: id):
  row = memberships[room, viewer] ! else NOT_MEMBER
  delete memberships[row]
  return null

mutation increment(slot: counters):
  row = counters[slot] ! else NOT_FOUND
  update counters[row] { value: row.value + 1 }
  return row.value + 1
