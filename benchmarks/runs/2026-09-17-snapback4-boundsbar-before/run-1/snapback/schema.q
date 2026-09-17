use personas hub, sparse, outsider, small, wide, celebrity, seed

table members:
  roomId: id
  principal: principal
  readOrdinal: int
  unreadCount: int default 0
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  cap 100 by roomId
  read <- .principal = viewer or exists members[.roomId, viewer] or viewer = 'dev:seed'
  insert <- viewer = 'dev:seed'
  update <- viewer = 'dev:seed'
  online only

table messages:
  key: text <=100
  roomId: id
  body: text <=4000
  ordinal: int
  at: time
  unique byKey: key
  by byRoomOrdinal: roomId, ordinal, id
  by byRoomWords: roomId, words(body), at, id
  cap 4096 by roomId
  read <- exists members[.roomId, viewer] or viewer = 'dev:seed'
  insert <- viewer = 'dev:seed'
  online only

maintain unreadTotals: sum members of unreadCount by principal
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
  key: text <=100
  authorId: principal
  body: text <=4000
  at: time
  likes: int default 0
  negativeLikes: int default 0
  negativeAt: int
  hourAt: int
  unique byKey: key
  by byAuthorTime: authorId, at, id
  by byRank: hourAt, negativeLikes, negativeAt, key, id
  public 'Public posts and their like totals'
  insert <- .authorId = viewer or viewer = 'dev:seed'
  update <- allow
  online only

maintain postHours: count posts by hourAt
  read <- allow
  online only

table likes:
  postKey: text <=100
  principal: principal
  unique byPostPrincipal: postKey, principal
  read <- .principal = viewer or viewer = 'dev:seed'
  insert <- .principal = viewer or viewer = 'dev:seed'
  delete <- .principal = viewer or viewer = 'dev:seed'
  online only

query search(q: text <=100, c: cursor ?):
  return members[viewer] after c first 20 by byPrincipalRoom
    { roomId, messages: messages[.roomId] matching q last 4096 by byRoomWords { key, at } }

query following(c: cursor ?):
  page = merge posts after c last 20 by byAuthorTime:
    [f.followedId] for f in follows[viewer] first 1024 by byPair
  return page { key, at }

query roster(roomId: id, c: cursor ?):
  return members[roomId] after c first 20 by byRoomPrincipal { principal }

query unread():
  return { total: unreadTotals[viewer] }

query trending(at: time, c: cursor ?):
  startHour = hour(at - 86400000)
  endHour = hour(at)
  page = merge posts after c first 10 by byRank where .at > at - 86400000 and .at <= at:
    [h.hourAt] for h in postHours[hourAt >= startHour, hourAt <= endHour] first 25 by byGroup
  return page { key, likes, at }

fn addPost(key: text <=100, authorId: principal, body: text <=4000, at: time):
  insert posts { key, authorId, body, at, negativeAt: 0 - (at / 1), hourAt: hour(at) }
  return null

mutation post(key: text <=100, body: text <=4000, at: time):
  return addPost(key, viewer, body, at)

fn setLike(postKey: text <=100, principal: principal, liked: bool):
  p = posts[postKey] ! else POST_NOT_FOUND
  prior = exists likes[postKey, principal]
  if liked and not prior:
    insert likes { postKey, principal }
    update posts[p] { likes: p.likes + 1, negativeLikes: p.negativeLikes - 1 }
  else if not liked and prior:
    delete likes[postKey, principal]
    update posts[p] { likes: p.likes - 1, negativeLikes: p.negativeLikes + 1 }
  return null

mutation like(postKey: text <=100, liked: bool):
  return setLike(postKey, viewer, liked)

mutation seedMessages(keys: [text <=100] <=100, rooms: [id] <=100, bodies: [text <=4000] <=100, ordinals: [int] <=100, times: [time] <=100): server
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(keys)):
    key = at(keys, i) ! else BAD_BATCH
    roomId = at(rooms, i) ! else BAD_BATCH
    body = at(bodies, i) ! else BAD_BATCH
    ordinal = at(ordinals, i) ! else BAD_BATCH
    stamp = at(times, i) ! else BAD_BATCH
    insert messages { key, roomId, body, ordinal, at: stamp }
    for m in members[roomId] first 100 by byRoomPrincipal:
      if ordinal > m.readOrdinal:
        update members[m] { unreadCount: m.unreadCount + 1 }
  return count(keys)

mutation seedMembers(rooms: [id] <=20, principals: [principal] <=20, readOrdinals: [int] <=20): server
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(rooms)):
    roomId = at(rooms, i) ! else BAD_BATCH
    principal = at(principals, i) ! else BAD_BATCH
    readOrdinal = at(readOrdinals, i) ! else BAD_BATCH
    unreadCount = count(messages[roomId, ordinal > readOrdinal] first 4096 by byRoomOrdinal)
    insert members { roomId, principal, readOrdinal, unreadCount }
  return count(rooms)

mutation seedFollows(followers: [principal] <=100, followed: [principal] <=100): server
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(followers)):
    followerId = at(followers, i) ! else BAD_BATCH
    followedId = at(followed, i) ! else BAD_BATCH
    insert follows { followerId, followedId }
  return count(followers)

mutation seedPosts(keys: [text <=100] <=100, authors: [principal] <=100, bodies: [text <=4000] <=100, times: [time] <=100): server
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(keys)):
    key = at(keys, i) ! else BAD_BATCH
    authorId = at(authors, i) ! else BAD_BATCH
    body = at(bodies, i) ! else BAD_BATCH
    stamp = at(times, i) ! else BAD_BATCH
    addPost(key, authorId, body, stamp)
  return count(keys)

mutation seedLikes(keys: [text <=100] <=100, principals: [principal] <=100): server
  require viewer = 'dev:seed' else SEED_ONLY
  for i in range(0, count(keys)):
    postKey = at(keys, i) ! else BAD_BATCH
    principal = at(principals, i) ! else BAD_BATCH
    setLike(postKey, principal, true)
  return count(keys)
