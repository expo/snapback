use personas alice, bob

table msgs:
  roomId: id
  at: time
  body: text <=100
  by byRoomAt: roomId, at
  read <- allow
  online only

-- a NON-unique index that does not end in id, under a merge cursor
query feed(a: id, b: id, c: cursor ?):
  return merge msgs after c last 1 by byRoomAt:
    [a]
    [b]

