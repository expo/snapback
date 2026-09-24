table @T@Posts:
  actorId: principal
  authorId: principal
  postId: id
  repost: bool
  at: time
  unique byActorPost: actorId, postId, repost
  by byActorTime: actorId, at, id
  by byTime: at, id
  immutable actorId, authorId, postId, repost, at
  public 'timeline events are public source metadata'
  sync public

table @T@RemovedEvents:
  eventId: id
  actorId: principal
  unique byEvent: eventId
  immutable eventId, actorId
  public 'removal of a public event is public'
  sync public

table @T@Feed:
  readerId: principal
  eventId: id
  epoch: id ?
  actorId: principal
  authorId: principal
  postId: id
  repost: bool
  at: time
  unique byReaderEvent: readerId, eventId, epoch
  unique byReaderTime: readerId, at, eventId, epoch
  by byReaderPage: readerId, at, eventId, epoch, id
  by byReaderActor: readerId, actorId, epoch, id
  by byEvent: eventId, id
  immutable readerId, eventId, epoch, actorId, authorId, postId, repost, at
  read <- .readerId = viewer
  sync

table @T@Work:
  kind: enum('delivery', 'backfill', 'cleanup', 'purge')
  actorId: principal
  readerId: principal ?
  viewerId: principal
  epoch: id ?
  remaining: int
  eventId: id ?
  cursor: text <=4096 ?
  at: time
  admitted: id
  status: enum('pending', 'parked', 'done')
  error: text <=4096 ?
  by byStatusTime: status, at, id
  by byReader: readerId
  by byViewer: viewerId, id
  read <- .viewerId = viewer
  sync

table @T@Edges:
  readerId: principal
  actorId: principal
  epoch: id
  unique byPair: readerId, actorId
  immutable readerId, actorId, epoch
  read <- .readerId = viewer
  sync
