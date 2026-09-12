use identity

-- The first table is private to its owner.
table todos:
  title: text <=200
  done: bool
  ownerId: principal
  by byOwnerId: ownerId
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer
