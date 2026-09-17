use personas alice, bob

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

table notes:
  ownerId: principal
  body: text <=200
  by byBody: body, id
  read <- .ownerId = viewer
  online only

-- uniform merge FIRST, then a non-uniform scan (notes by byBody: the rule reads .ownerId, which the scan does not pin)
query mergeThenNonUniform(c: cursor ?):
  page = merge messages after c last 2 by byRoomTime:
    [m.roomId] for m in members[viewer] first 50 by byPrincipalRoom
  other = notes first 5 by byBody
  return { page, n: count(other) }

-- the same two reads in the other order
query nonUniformThenMerge(c: cursor ?):
  other = notes first 5 by byBody
  page = merge messages after c last 2 by byRoomTime:
    [m.roomId] for m in members[viewer] first 50 by byPrincipalRoom
  return { page, n: count(other) }

-- control: the merge alone
query mergeAlone(c: cursor ?):
  return merge messages after c last 2 by byRoomTime:
    [m.roomId] for m in members[viewer] first 50 by byPrincipalRoom
