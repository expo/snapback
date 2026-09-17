use personas hub, sparse, outsider, small, wide, celebrity, seed

table members:
  roomId: id
  principal: principal
  readOrdinal: int
  unread: int default 0
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  cap 128 by roomId
  read <- .principal = viewer or exists members[.roomId, viewer] or viewer = 'dev:seed'
  insert <- viewer = 'dev:seed'
  update <- viewer = 'dev:seed'
  online only

table messages:
  key: id
  roomId: id
  body: text <=4000
  ordinal: int
  at: time
  unique byKey: key
  by byRoomWords: roomId, words(body), at, id
  read <- exists members[.roomId, viewer] or viewer = 'dev:seed'
  insert <- viewer = 'dev:seed'
  online only

maintain unreadTotals: sum members of unread by principal
  read <- .principal = viewer
  online only

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  cap 1024 by followerId
  read <- .followerId = viewer or viewer = 'dev:seed'
  insert <- viewer = 'dev:seed'
  online only

table posts:
  key: id
  authorId: principal
  body: text <=4000
  at: time
  likes: int default 0
  negLikes: int default 0
  negAt: int
  hourKey: int
  unique byKey: key
  by byAuthorTime: authorId, at, id
  unique byHourRank: hourKey, negLikes, negAt, key
  read <- allow
  insert <- .authorId = viewer or viewer = 'dev:seed'
  update <- allow
  online only

maintain postHours: count posts by hourKey
  read <- allow
  online only

table likes:
  postKey: id
  principal: principal
  unique byPostPrincipal: postKey, principal
  read <- .principal = viewer or viewer = 'dev:seed'
  insert <- .principal = viewer or viewer = 'dev:seed'
  delete <- .principal = viewer or viewer = 'dev:seed'
  online only

query chats(batch: cursor ?):
  return members[viewer] after batch first 20 by byPrincipalRoom { roomId }

query searchBatch(q: text <=100, batch: cursor ?, c: cursor ?):
  page = merge messages matching q after c last 20 by byRoomWords:
    [m.roomId] for m in members[viewer] after batch first 20 by byPrincipalRoom
  grouped = group(page, 'roomId') { roomId: .key, messages: .items { key, at } }
  return { rows: grouped, continuation: page { key } }

query following(c: cursor ?):
  page = merge posts after c last 20 by byAuthorTime:
    [f.followedId] for f in follows[viewer] first 1024 by byPair
  return page { key, at }

query roster(roomId: id, c: cursor ?):
  return members[roomId] after c first 20 by byRoomPrincipal { principal }

query unread():
  return { total: unreadTotals[viewer] }

query trending(at: time, c: cursor ?):
  start = at - 86400000
  startHour = hour(start)
  endHour = hour(at)
  page = merge posts after c first 10 by byHourRank where .at > start and .at <= at:
    [h.hourKey] for h in postHours[hourKey >= startHour, hourKey <= endHour] first 25 by byGroup
  return page { key, likes, at }

mutation post(key: id, body: text <=4000, at: time):
  p = insert posts { key, authorId: viewer, body, at, negAt: -(at / 1), hourKey: hour(at) }
  return { key: p.key }

fn setLike(postKey: id, principal: principal, liked: bool):
  p = posts[postKey] ! else POST_NOT_FOUND
  old = exists likes[postKey, principal]
  if liked and not old:
    insert likes { postKey, principal }
    update posts[p.id] { likes: p.likes + 1, negLikes: p.negLikes - 1 }
  if not liked and old:
    delete likes[postKey, principal]
    update posts[p.id] { likes: p.likes - 1, negLikes: p.negLikes + 1 }
  return null

mutation like(postKey: id, liked: bool):
  return setLike(postKey, viewer, liked)

mutation seedMember(roomId: id, principal: principal, readOrdinal: int):
  require viewer = 'dev:seed' else SEED_ONLY
  insert members { roomId, principal, readOrdinal }
  return null

mutation seedMessages(roomId: id, keys: [id] <=128, bodies: [text <=4000] <=128, ordinals: [int] <=128, times: [time] <=128): server
  require viewer = 'dev:seed' else SEED_ONLY
  require count(keys) = count(bodies) and count(keys) = count(ordinals) and count(keys) = count(times) else BAD_BATCH
  for i in range(0, count(keys)):
    insert messages { key: at(keys, i) ! else BAD_BATCH, roomId, body: at(bodies, i) ! else BAD_BATCH, ordinal: at(ordinals, i) ! else BAD_BATCH, at: at(times, i) ! else BAD_BATCH }
  for m in members[roomId] first 128 by byRoomPrincipal:
    delta = 0
    for ordinal in ordinals:
      if ordinal > m.readOrdinal:
        delta = delta + 1
    update members[m.id] { unread: m.unread + delta }
  return null

mutation seedFollows(followers: [principal] <=128, authors: [principal] <=128):
  require viewer = 'dev:seed' else SEED_ONLY
  require count(followers) = count(authors) else BAD_BATCH
  for i in range(0, count(followers)):
    insert follows { followerId: at(followers, i) ! else BAD_BATCH, followedId: at(authors, i) ! else BAD_BATCH }
  return null

mutation seedPosts(keys: [id] <=128, authors: [principal] <=128, bodies: [text <=4000] <=128, times: [time] <=128):
  require viewer = 'dev:seed' else SEED_ONLY
  require count(keys) = count(authors) and count(keys) = count(bodies) and count(keys) = count(times) else BAD_BATCH
  for i in range(0, count(keys)):
    stamp = at(times, i) ! else BAD_BATCH
    insert posts { key: at(keys, i) ! else BAD_BATCH, authorId: at(authors, i) ! else BAD_BATCH, body: at(bodies, i) ! else BAD_BATCH, at: stamp, negAt: -(stamp / 1), hourKey: hour(stamp) }
  return null

mutation seedLike(postKey: id, principal: principal):
  require viewer = 'dev:seed' else SEED_ONLY
  return setLike(postKey, principal, true)
