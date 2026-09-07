use identity

table rooms:
  title: text <=80
  ownerId: principal
  by byOwner: ownerId
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer

table messages:
  roomId: rooms
  body: text <=200
  at: time
  ownerId: principal
  by byOwner: ownerId
  by byRoomOwner: roomId, ownerId
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer

table reactions:
  messageId: messages
  emoji: text <=8
  ownerId: principal
  by byOwner: ownerId
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer

table receipts:
  messageId: messages
  readAt: time
  ownerId: principal
  by byOwner: ownerId
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer
