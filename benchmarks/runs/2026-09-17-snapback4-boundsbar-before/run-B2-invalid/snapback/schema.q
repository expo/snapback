use personas hub, sparse, outsider, small, wide, celebrity, seed

table members:
  roomId: text <=64
  principal: principal
  readOrdinal: int
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  read <- .principal = viewer or exists members[.roomId, viewer] or viewer = 'dev:seed'
  insert <- viewer = 'dev:seed'
  online only

table messages:
  key: text <=64
  roomId: text <=64
  body: text <=4000
  ordinal: int
  at: time
  unique byKey: key
  by byRoomWords: roomId, words(body), at, id
  by byRoomOrdinal: roomId, ordinal, id
  read <- exists members[.roomId, viewer] or viewer = 'dev:seed'
  insert <- viewer = 'dev:seed'
  online only

maintain roomCounts: count messages by roomId
  read <- exists members[.roomId, viewer] or viewer = 'dev:seed'
  online only

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  by byAuthor: followedId, followerId, id
  read <- .followerId = viewer or viewer = 'dev:seed'
  insert <- viewer = 'dev:seed'
  online only

table posts:
  key: text <=64
  authorId: principal
  body: text <=4000
  at: time
  likes: int default 0
  negativeLikes: int default 0
  negativeAt: int
  unique byKey: key
  by byAuthorTime: authorId, at, id
  by byRank: negativeLikes, negativeAt, key, id
  public 'posts and their live like totals are public'
  insert <- .authorId = viewer or viewer = 'dev:seed'
  update <- allow
  online only

table likes:
  postKey: text <=64
  principal: principal
  unique byPostPrincipal: postKey, principal
  public 'likes on public posts are public'
  insert <- .principal = viewer or viewer = 'dev:seed'
  delete <- .principal = viewer or viewer = 'dev:seed'
  online only

query roster(roomId: text <=64, c: cursor ?):
  require exists members[roomId, viewer] else NOT_MEMBER
  return members[roomId] after c first 20 by byRoomPrincipal { principal }

query unread():
  rows = members[viewer] first 4096 by byPrincipalRoom { unread: max(0, roomCounts[.roomId] - .readOrdinal) }
  return { total: sum(rows, .unread) }

query following(c: cursor ?):
  rows = merge posts after c last 20 by byAuthorTime:
    [f.followedId] for f in follows[viewer] first 4096 by byPair
  return rows { key, at }

query trending(at: time, c: cursor ?):
  return posts after c first 10 by byRank where .at > at - 86400000 and .at <= at { key, likes, at }

mutation post(key: text <=64, body: text <=4000, at: time):
  row = insert posts { key, body, at, authorId: viewer, negativeAt: 0 - (at / 1) }
  return { key: row.key, at: row.at }

fn setLike(postKey: text <=64, principal: principal, liked: bool):
  p = posts[postKey] ! else POST_NOT_FOUND
  existsLike = exists likes[postKey, principal]
  if liked and not existsLike:
    insert likes { postKey, principal }
    update posts[p.id] { likes: p.likes + 1, negativeLikes: 0 - (p.likes + 1) }
  if not liked and existsLike:
    delete likes[postKey, principal]
    update posts[p.id] { likes: p.likes - 1, negativeLikes: 0 - (p.likes - 1) }
  return null

mutation like(postKey: text <=64, liked: bool):
  return setLike(postKey, viewer, liked)

mutation seedMembers(rooms: [text <=64] <=128, principals: [principal] <=128, ordinals: [int] <=128):
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(rooms)):
    roomId = at(rooms, i) ! else INPUT
    principal = at(principals, i) ! else INPUT
    readOrdinal = at(ordinals, i) ! else INPUT
    insert members { roomId, principal, readOrdinal }
  return null

mutation seedMessages(keys: [text <=64] <=128, rooms: [text <=64] <=128, bodies: [text <=4000] <=128, ordinals: [int] <=128, times: [time] <=128):
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(keys)):
    key = at(keys, i) ! else INPUT
    roomId = at(rooms, i) ! else INPUT
    body = at(bodies, i) ! else INPUT
    ordinal = at(ordinals, i) ! else INPUT
    at = at(times, i) ! else INPUT
    require ordinal = roomCounts[roomId] + 1 else ORDINAL_SEQUENCE
    insert messages { key, roomId, body, ordinal, at }
  return null

mutation seedFollows(followers: [principal] <=128, authors: [principal] <=128):
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(followers)):
    followerId = at(followers, i) ! else INPUT
    followedId = at(authors, i) ! else INPUT
    insert follows { followerId, followedId }
  return null

mutation seedPosts(keys: [text <=64] <=128, authors: [principal] <=128, bodies: [text <=4000] <=128, times: [time] <=128):
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(keys)):
    key = at(keys, i) ! else INPUT
    authorId = at(authors, i) ! else INPUT
    body = at(bodies, i) ! else INPUT
    at = at(times, i) ! else INPUT
    insert posts { key, authorId, body, at, negativeAt: 0 - (at / 1) }
  return null

mutation seedLikes(keys: [text <=64] <=128, principals: [principal] <=128):
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(keys)):
    postKey = at(keys, i) ! else INPUT
    principal = at(principals, i) ! else INPUT
    setLike(postKey, principal, true)
  return null

query search(q: text <=100, c: cursor ?):
  return members[viewer] after c first 20 by byPrincipalRoom
    { roomId, messages: messages[.roomId] matching q last 256 by byRoomWords { key, at } }
