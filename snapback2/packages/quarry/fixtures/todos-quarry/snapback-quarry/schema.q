use identity

table todos:
  title: text <=200
  done: bool
  ownerId: id
  by byOwner: ownerId
  read r <- r.ownerId = viewer
  insert r <- r.ownerId = viewer
  update r <- r.ownerId = viewer
  delete r <- r.ownerId = viewer
