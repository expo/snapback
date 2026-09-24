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
  actorId: principal
  authorId: principal
  postId: id
  repost: bool
  at: time
  unique byReaderEvent: readerId, eventId
  unique byReaderTime: readerId, at, eventId
  by byReaderActor: readerId, actorId, id
  by byEvent: eventId, id
  immutable readerId, eventId, actorId, authorId, postId, repost, at
  read <- .readerId = viewer
  sync

table @T@Work:
  kind: enum('delivery', 'backfill', 'cleanup', 'purge')
  actorId: principal
  readerId: principal ?
  eventId: id ?
  cursor: text <=4096 ?
  at: time
  status: enum('pending', 'parked')
  error: text <=4096 ?
  by byStatusTime: status, at, id
  read <- deny
  online only
