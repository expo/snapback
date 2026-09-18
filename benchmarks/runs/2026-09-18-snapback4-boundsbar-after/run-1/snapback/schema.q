use personas hub, sparse, outsider, small, wide, celebrity, seed

table members:
  roomId: id
  principal: principal
  readOrdinal: int
  unread: int
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  read <- .principal = viewer or exists members[.roomId, viewer] or viewer = 'dev:seed'
  insert <- viewer = 'dev:seed'

maintain unreadTotals: sum members of unread by principal
  read <- .principal = viewer

table messages:
  key: id
  roomId: id
  body: text <=4000
  ordinal: int
  at: time
  unique byKey: key
  by byRoomOrdinal: roomId, ordinal, id
  by byRoomWords: roomId, words(body), at, id
  cap 256 by roomId
  read <- exists members[.roomId, viewer] or viewer = 'dev:seed'
  insert <- viewer = 'dev:seed'

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  read <- .followerId = viewer
  insert <- viewer = 'dev:seed'

table posts:
  key: id
  authorId: principal
  body: text <=4000
  at: time
  negativeAt: int
  negativeLikes: int
  unique byKey: key
  by byAuthorTime: authorId, at, id
  unique byRank: hour(at), negativeLikes, negativeAt, key
  immutable key, authorId, at, negativeAt
  public 'Posts and their exact like scores are public'
  insert <- .authorId = viewer or viewer = 'dev:seed'
  update <- allow

table likes:
  postKey: id
  principal: principal
  unique byPair: postKey, principal
  public 'Like edges are public'
  insert <- .principal = viewer or viewer = 'dev:seed'
  delete <- .principal = viewer

query search(q: text <=100, c: cursor ?):
  return members[viewer] after c first 20 by byPrincipalRoom { roomId, messages: messages[.roomId] matching q last 256 by byRoomWords { key, at } }

query following(c: cursor ?):
  page = merge posts after c last 20 by byAuthorTime:
    [f.followedId] for f in follows[viewer] by byPair
  return page { key, at }

query roster(roomId: id, c: cursor ?):
  return members[roomId] after c first 20 by byRoomPrincipal { principal }

query unread():
  return { total: unreadTotals[viewer] }

query trending(at: time, c: cursor ?):
  page = merge posts after c first 10 by byRank where .at > at - 86400000 and .at <= at:
    [h] for h in range(hour(at) - 24, hour(at) + 1)
  return page { key, likes: -.negativeLikes, at }

fn addPost(key: id, authorId: principal, body: text <=4000, at: time):
  return insert posts { id: key, key, authorId, body, at, negativeAt: 0 - (at / 1), negativeLikes: 0 }

mutation post(key: id, body: text <=4000, at: time):
  p = addPost(key, viewer, body, at)
  return { key: p.key, at: p.at }

fn addLike(postKey: id, principal: principal):
  p = posts[key = postKey] ! else POST_NOT_FOUND
  if not exists likes[postKey, principal]:
    insert likes { postKey, principal }
    update posts[p.id] { negativeLikes: p.negativeLikes - 1 }
  return null

mutation like(postKey: id, liked: bool):
  if liked:
    addLike(postKey, viewer)
  else if exists likes[postKey, viewer]:
    p = posts[key = postKey] ! else POST_NOT_FOUND
    delete likes[postKey, viewer]
    update posts[p.id] { negativeLikes: p.negativeLikes + 1 }
  return null

mutation seedMessages(keys: [id] <=128, rooms: [id] <=128, bodies: [text <=4000] <=128, ordinals: [int] <=128, times: [time] <=128):
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(keys)):
    key = at(keys, i) ! else BAD_BATCH
    roomId = at(rooms, i) ! else BAD_BATCH
    require not exists (members[roomId] by byRoomPrincipal) else SEED_ROOM_CLOSED
    body = at(bodies, i) ! else BAD_BATCH
    ordinal = at(ordinals, i) ! else BAD_BATCH
    time = at(times, i) ! else BAD_BATCH
    insert messages { id: key, key, roomId, body, ordinal, at: time }
  return count(keys)

mutation seedMembers(rooms: [id] <=20, principals: [principal] <=20, ordinals: [int] <=20): server
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(rooms)):
    roomId = at(rooms, i) ! else BAD_BATCH
    principal = at(principals, i) ! else BAD_BATCH
    readOrdinal = at(ordinals, i) ! else BAD_BATCH
    unseen = messages[roomId, ordinal > readOrdinal] first 256 by byRoomOrdinal
    insert members { roomId, principal, readOrdinal, unread: count(unseen) }
  return count(rooms)

mutation seedFollows(followers: [principal] <=128, authors: [principal] <=128):
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(followers)):
    followerId = at(followers, i) ! else BAD_BATCH
    followedId = at(authors, i) ! else BAD_BATCH
    insert follows { followerId, followedId }
  return count(followers)

mutation seedPosts(keys: [id] <=128, authors: [principal] <=128, bodies: [text <=4000] <=128, times: [time] <=128):
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(keys)):
    key = at(keys, i) ! else BAD_BATCH
    authorId = at(authors, i) ! else BAD_BATCH
    body = at(bodies, i) ! else BAD_BATCH
    time = at(times, i) ! else BAD_BATCH
    addPost(key, authorId, body, time)
  return count(keys)

mutation seedLikes(keys: [id] <=128, principals: [principal] <=128):
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(keys)):
    key = at(keys, i) ! else BAD_BATCH
    principal = at(principals, i) ! else BAD_BATCH
    addLike(key, principal)
  return count(keys)
