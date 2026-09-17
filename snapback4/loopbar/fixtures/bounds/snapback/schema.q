use personas hub, sparse, outsider, small, wide, celebrity, seed

table members:
  roomId: id
  principal: principal
  readOrdinal: int
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  read <- exists members[.roomId, viewer]
  insert <- viewer = 'dev:seed'

table messages:
  key: text <=100
  roomId: id
  body: text <=100
  ordinal: int
  at: time
  by byRoomWords: roomId, words(body), at, id
  unique byKey: key
  read <- exists members[.roomId, viewer]
  insert <- viewer = 'dev:seed'

maintain messageCounts: count messages by roomId
  read <- exists members[.roomId, viewer]

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  public 'follow graph'
  insert <- viewer = 'dev:seed'

table posts:
  key: text <=100
  authorId: principal
  body: text <=100
  at: time
  unique byKey: key
  by byAuthorTime: authorId, at, id
  by byTime: at, id
  public 'public posts'
  insert <- .authorId = viewer or viewer = 'dev:seed'

table likes:
  postKey: text <=100
  principal: principal
  postAt: time
  unique byPair: postKey, principal
  public 'public likes'
  insert <- .principal = viewer or viewer = 'dev:seed'
  delete <- .principal = viewer

maintain trend: count likes by hour(.postAt), postAt, postKey
  read <- allow
  by byScore: hour, value, id

-- One server-grouped cursor; complete contents of each chat on this fixture.
query grouped(q: text <=100, c: cursor ?):
  return members[viewer] after c first 20 by byPrincipalRoom { roomId, messages: messages[.roomId] matching q last 100 by byRoomWords { key, at } }

-- The card's two independent cursors, with grouping still performed in Quarry.
query chats(batch: cursor ?):
  return members[viewer] after batch first 20 by byPrincipalRoom

query batches(q: text <=100, batch: cursor ?, c: cursor ?):
  page = merge messages matching q after c last 20 by byRoomWords:
    [m.roomId] for m in members[viewer] after batch first 20 by byPrincipalRoom
  return page { roomId, messages: [{ key: .key, at: .at }] }

query following(c: cursor ?):
  return merge posts after c last 20 by byAuthorTime:
    [f.followedId] for f in follows[viewer] first 1000 by byPair

query roster(roomId: id, c: cursor ?):
  return members[roomId] after c first 20 by byRoomPrincipal { principal }

query unread():
  total = 0
  for m in members[viewer] first 1000 by byPrincipalRoom:
    total = total + messageCounts[m.roomId] - m.readOrdinal
  return { total }

mutation post(key: text <=100, body: text <=100, at: time):
  return insert posts { key, body, at, authorId: viewer }

mutation like(postKey: text <=100, liked: bool):
  p = posts[postKey] ! else POST_NOT_FOUND
  if liked:
    insert likes { postKey, principal: viewer, postAt: p.at } if absent
  else if exists likes[postKey, viewer]:
    delete likes[postKey, viewer]

query trending(at: time, c: cursor ?):
  page = merge trend after c last 10 by byScore where .postAt > at - 86400000 and .postAt <= at:
    [hour(at) - 0]
    [hour(at) - 1]
    [hour(at) - 2]
    [hour(at) - 3]
    [hour(at) - 4]
    [hour(at) - 5]
    [hour(at) - 6]
    [hour(at) - 7]
    [hour(at) - 8]
    [hour(at) - 9]
    [hour(at) - 10]
    [hour(at) - 11]
    [hour(at) - 12]
    [hour(at) - 13]
    [hour(at) - 14]
    [hour(at) - 15]
    [hour(at) - 16]
    [hour(at) - 17]
    [hour(at) - 18]
    [hour(at) - 19]
    [hour(at) - 20]
    [hour(at) - 21]
    [hour(at) - 22]
    [hour(at) - 23]
    [hour(at) - 24]
  return page { key: .postKey, likes: .value, at: .postAt }

mutation seed_members(roomIds: [id] <=100, principals: [principal] <=100, readOrdinals: [int] <=100):
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(roomIds)):
    insert members { roomId: at(roomIds, i) ! else MISSING, principal: at(principals, i) ! else MISSING, readOrdinal: at(readOrdinals, i) ! else MISSING }

mutation seed_messages(keys: [text <=100] <=100, roomIds: [id] <=100, bodys: [text <=100] <=100, ordinals: [int] <=100, ats: [time] <=100):
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(keys)):
    insert messages { key: at(keys, i) ! else MISSING, roomId: at(roomIds, i) ! else MISSING, body: at(bodys, i) ! else MISSING, ordinal: at(ordinals, i) ! else MISSING, at: at(ats, i) ! else MISSING }

mutation seed_follows(followerIds: [principal] <=100, followedIds: [principal] <=100):
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(followerIds)):
    insert follows { followerId: at(followerIds, i) ! else MISSING, followedId: at(followedIds, i) ! else MISSING }

mutation seed_posts(keys: [text <=100] <=100, authorIds: [principal] <=100, bodys: [text <=100] <=100, ats: [time] <=100):
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(keys)):
    insert posts { key: at(keys, i) ! else MISSING, authorId: at(authorIds, i) ! else MISSING, body: at(bodys, i) ! else MISSING, at: at(ats, i) ! else MISSING }

mutation seed_likes(postKeys: [text <=100] <=100, principals: [principal] <=100, postAts: [time] <=100):
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(postKeys)):
    insert likes { postKey: at(postKeys, i) ! else MISSING, principal: at(principals, i) ! else MISSING, postAt: at(postAts, i) ! else MISSING }
