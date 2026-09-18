use personas hub, sparse, outsider, small, wide, celebrity, seed

table members:
  roomId: id
  principal: principal
  readOrdinal: int
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  read <- .principal = viewer or exists members[.roomId, viewer]
  insert <- viewer = 'dev:seed'

table messages:
  key: text <=120
  roomId: id
  body: text <=4000
  ordinal: int
  at: time
  unique byKey: key
  unique byRoomOrdinal: roomId, ordinal
  by byRoomWords: roomId, words(body), at, id
  by byRoomTime: roomId, at, id
  cap 512 by roomId
  read <- exists members[.roomId, viewer]
  insert <- viewer = 'dev:seed'

maintain messageCounts: count messages by roomId
  read <- exists members[.roomId, viewer] or viewer = 'dev:seed'

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  read <- .followerId = viewer
  insert <- viewer = 'dev:seed'

table posts:
  key: text <=120
  authorId: principal
  body: text <=4000
  at: time
  negLikes: int
  negAt: int
  unique byKey: key
  by byAuthorTime: authorId, at, id
  by byHourRank: hour(at), negLikes, negAt, key, id
  immutable key, authorId, body, at, negAt
  public 'Public posts and their like scores'
  insert <- .authorId = viewer or viewer = 'dev:seed'
  update <- allow

table likes:
  postKey: text <=120
  principal: principal
  unique byPostPrincipal: postKey, principal
  read <- .principal = viewer or viewer = 'dev:seed'
  insert <- .principal = viewer or viewer = 'dev:seed'
  delete <- .principal = viewer

query search(q: text <=100, c: cursor ?):
  return members[viewer] after c first 20 by byPrincipalRoom where exists (messages[.roomId] matching q) { roomId, messages: messages[.roomId] matching q last 512 by byRoomWords { key, at } }

query following(c: cursor ?):
  page = merge posts after c last 20 by byAuthorTime:
    [f.followedId] for f in follows[viewer] by byPair
  return page { key, at }

query roster(roomId: id, c: cursor ?):
  require exists members[roomId, viewer] else NOT_MEMBER
  return members[roomId] after c first 20 by byRoomPrincipal { principal }

query unread():
  total = 0
  for m in members[viewer] by byPrincipalRoom:
    total = total + max(messageCounts[m.roomId] - m.readOrdinal, 0)
  return { total }

query trending(at: time, c: cursor ?):
  page = merge posts after c first 10 by byHourRank where .at > at - 86400000 and .at <= at:
    [h] for h in range(hour(at) - 24, hour(at) + 1)
  return page { key, likes: 0 - .negLikes, at }

fn putPost(key: text <=120, authorId: principal, body: text <=4000, at: time):
  return insert posts { key, authorId, body, at, negLikes: 0, negAt: 0 - (at / 1) }

mutation post(key: text <=120, body: text <=4000, at: time):
  p = putPost(key, viewer, body, at)
  return { key: p.key, at: p.at }

fn setLike(postKey: text <=120, principal: principal, liked: bool):
  p = posts[key = postKey] ! else POST_NOT_FOUND
  present = exists likes[postKey, principal]
  if liked and not present:
    insert likes { postKey, principal }
    update posts[p.id] { negLikes: p.negLikes - 1 }
  if not liked and present:
    delete likes[postKey, principal]
    update posts[p.id] { negLikes: p.negLikes + 1 }
  return null

mutation like(postKey: text <=120, liked: bool):
  return setLike(postKey, viewer, liked)

mutation importMember(roomId: id, principal: principal, readOrdinal: int):
  require viewer = 'dev:seed' else SEED_ONLY
  require readOrdinal >= 0 else BAD_ORDINAL
  insert members { roomId, principal, readOrdinal }
  return null

mutation importFollow(followerId: principal, followedId: principal):
  require viewer = 'dev:seed' else SEED_ONLY
  insert follows { followerId, followedId }
  return null

mutation importMessages(keys: [text <=120] <=128, rooms: [id] <=128, bodies: [text <=4000] <=128, ordinals: [int] <=128, times: [time] <=128):
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(keys)):
    key = at(keys, i) ! else BAD_BATCH
    roomId = at(rooms, i) ! else BAD_BATCH
    body = at(bodies, i) ! else BAD_BATCH
    ordinal = at(ordinals, i) ! else BAD_BATCH
    stamp = at(times, i) ! else BAD_BATCH
    require ordinal = messageCounts[roomId] + 1 else NONCONTIGUOUS_ORDINAL
    insert messages { key, roomId, body, ordinal, at: stamp }
  return null

mutation importPosts(keys: [text <=120] <=128, authors: [principal] <=128, bodies: [text <=4000] <=128, times: [time] <=128):
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(keys)):
    key = at(keys, i) ! else BAD_BATCH
    authorId = at(authors, i) ! else BAD_BATCH
    body = at(bodies, i) ! else BAD_BATCH
    stamp = at(times, i) ! else BAD_BATCH
    putPost(key, authorId, body, stamp)
  return null

mutation importLike(postKey: text <=120, principal: principal):
  require viewer = 'dev:seed' else SEED_ONLY
  return setLike(postKey, principal, true)
