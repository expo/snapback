use personas alice, bob

table msgs:
  roomId: id
  at: time
  body: text <=100
  unique byRoomAt: roomId, at
  read <- allow
  online only

-- two lanes, page of 1, cursor over the suffix [at] only (the index is total-unique but does not end in id)
query feed(a: id, b: id, c: cursor ?):
  return merge msgs after c last 1 by byRoomAt:
    [a]
    [b]
