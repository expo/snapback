use personas alice, bob, carol

table posts:
  authorId: principal
  parentId: posts ?
  at: time
  removed: bool default false
  immutable authorId, parentId, at
  public 'public posts'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public last 1000 by .at
table reposts:
  actorId: principal
  postId: posts
  at: time
  unique actorId, postId
  immutable actorId, postId, at
  public 'public reposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public last 1000 by .at with own keys .actorId
table follows:
  followerId: principal
  followedId: principal
  unique followerId, followedId
  immutable followerId, followedId
  public 'public edges'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  online only
view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]
mutation post(postId: id):
  return insert posts { id: postId, authorId: viewer, at: now }
mutation repost(postId: posts):
  return insert reposts { actorId: viewer, postId, at: now } if absent
mutation follow(actor: principal):
  return insert follows { followerId: viewer, followedId: actor } if absent
query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] }

table rooms:
  title: text <=100
  read <- exists members[.id, viewer]
  sync to members[.id]
table members:
  room: rooms
  principal: principal
  unique room, principal
  immutable room, principal
  read <- exists members[.room, viewer]
  sync to members[.room]
table messages:
  room: rooms
  sender: principal
  ordinal: int
  text: text <=2000
  immutable room, sender, ordinal
  unique room, ordinal
  read <- exists members[.room, viewer]
  insert <- .sender = viewer and exists members[.room, viewer]
  retain delivered-history
  sync to members[.room] last 500 by .ordinal
table reactions:
  message: messages
  principal: principal
  emoji: text 1..32
  unique message, principal
  immutable message, principal
  read through .message
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync
query history(room: rooms, c: cursor ?):
  return messages where .room = room last 20 by .ordinal after c
query reactionRows(message: messages, c: cursor ?):
  return reactions where .message = message first 50 by .principal after c
mutation send(id: id, ordinal: int):
  return insert messages { id, room: 'room', sender: viewer, ordinal, text: 'live' }
mutation react(emoji: text 1..32):
  if exists reactions['anchor', viewer]:
    update reactions['anchor', viewer] { emoji }
  else:
    insert reactions { message: 'anchor', principal: viewer, emoji }
mutation unfollow(actor: principal):
  delete follows[viewer, actor]
