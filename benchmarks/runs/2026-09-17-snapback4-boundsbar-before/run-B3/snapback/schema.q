use personas hub, sparse, outsider, small, wide, celebrity, seed

table members:
  roomId: text <=80
  principal: principal
  readOrdinal: int
  unique byRoomPrincipal: roomId, principal
  by byPrincipal: principal, roomId, id
  read <- .principal = viewer or exists members[.roomId, viewer]
  insert <- viewer = 'dev:seed'
  online only

table messages:
  key: text <=80
  roomId: text <=80
  body: text <=4000
  ordinal: int
  at: time
  unique byKey: key
  by byRoomWords: roomId, words(body), at, id
  read <- exists members[.roomId, viewer]
  insert <- viewer = 'dev:seed'
  online only

maintain roomCounts: count messages by roomId
  read <- exists members[.roomId, viewer]
  online only

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  read <- .followerId = viewer
  insert <- viewer = 'dev:seed'
  online only

table posts:
  key: text <=80
  authorId: principal
  body: text <=4000
  at: time
  likes: int default 0
  rankLikes: int default 0
  rankAt: int
  unique byKey: key
  by byAuthorTime: authorId, at, id
  unique byRank: rankLikes, rankAt, key
  read <- allow
  insert <- .authorId = viewer or viewer = 'dev:seed'
  update <- allow
  online only

table likes:
  postKey: text <=80
  principal: principal
  unique byPostPrincipal: postKey, principal
  read <- allow
  insert <- .principal = viewer or viewer = 'dev:seed'
  delete <- .principal = viewer
  online only

query roster(roomId: text <=80, c: cursor ?):
  require exists members[roomId, viewer] else NOT_MEMBER
  return members[roomId] after c first 20 by byRoomPrincipal { principal }

query unread():
  rows = members[viewer] first 4096 by byPrincipal { unread: max(0, roomCounts[.roomId] - .readOrdinal) }
  return { total: sum(rows, .unread) }

query following(c: cursor ?):
  rows = merge posts after c last 20 by byAuthorTime:
    [f.followedId] for f in follows[viewer] first 4096 by byPair
  return rows { key, at }

query trending(at: time, c: cursor ?):
  return posts after c first 10 by byRank where .at > at - 86400000 and .at <= at { key, likes, at }

mutation post(key: text <=80, body: text <=4000, at: time):
  row = insert posts { key, body, at, authorId: viewer, rankAt: 0 - (at / 1) }
  return { key: row.key, at: row.at }

fn setLike(postKey: text <=80, principal: principal, liked: bool):
  p = posts[postKey] ! else POST_NOT_FOUND
  present = exists likes[postKey, principal]
  if liked and not present:
    insert likes { postKey, principal }
    update posts[p.id] { likes: p.likes + 1, rankLikes: 0 - (p.likes + 1) }
  if not liked and present:
    delete likes[postKey, principal]
    update posts[p.id] { likes: p.likes - 1, rankLikes: 0 - (p.likes - 1) }
  return null

mutation like(postKey: text <=80, liked: bool):
  return setLike(postKey, viewer, liked)

mutation seedMember(roomId: text <=80, principal: principal, readOrdinal: int):
  require viewer = 'dev:seed' else SEED_ONLY
  insert members { roomId, principal, readOrdinal }
  return null

mutation seedMessage(key: text <=80, roomId: text <=80, body: text <=4000, ordinal: int, at: time):
  require viewer = 'dev:seed' else SEED_ONLY
  insert messages { key, roomId, body, ordinal, at }
  return null

mutation seedFollow(followerId: principal, followedId: principal):
  require viewer = 'dev:seed' else SEED_ONLY
  insert follows { followerId, followedId }
  return null

mutation seedPost(key: text <=80, authorId: principal, body: text <=4000, at: time):
  require viewer = 'dev:seed' else SEED_ONLY
  insert posts { key, authorId, body, at, rankAt: 0 - (at / 1) }
  return null

mutation seedLike(postKey: text <=80, principal: principal):
  require viewer = 'dev:seed' else SEED_ONLY
  return setLike(postKey, principal, true)

query chats(batch: cursor ?):
  return members[viewer] after batch first 20 by byPrincipal { roomId }

query searchBatch(q: text <=100, batch: cursor ?, c: cursor ?):
  matches = merge messages matching q after c last 20 by byRoomWords:
    [m.roomId] for m in members[viewer] after batch first 20 by byPrincipal
  return { rows: group(matches, 'roomId') { roomId: .key, messages: .items { key, at } }, continuation: matches {} }

mutation seedMessages(keys: [text <=80] <=100, rooms: [text <=80] <=100, bodies: [text <=4000] <=100, ordinals: [int] <=100, times: [time] <=100):
  require viewer = 'dev:seed' else SEED_ONLY
  i = 0
  for key in keys:
    roomId = at(rooms, i)
    body = at(bodies, i)
    ordinal = at(ordinals, i)
    stamp = at(times, i)
    require roomId != null and body != null and ordinal != null and stamp != null else INVALID_BATCH
    insert messages { key, roomId, body, ordinal, at: stamp }
    i = i + 1
  return null

mutation seedPosts(keys: [text <=80] <=100, authors: [principal] <=100, bodies: [text <=4000] <=100, times: [time] <=100):
  require viewer = 'dev:seed' else SEED_ONLY
  i = 0
  for key in keys:
    authorId = at(authors, i)
    body = at(bodies, i)
    stamp = at(times, i)
    require authorId != null and body != null and stamp != null else INVALID_BATCH
    insert posts { key, authorId, body, at: stamp, rankAt: 0 - (stamp / 1) }
    i = i + 1
  return null
