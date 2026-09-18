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
  key: text <=80
  roomId: id
  body: text <=4000
  ordinal: int
  at: time
  unique byKey: key
  unique byRoomOrdinal: roomId, ordinal
  by byRoomWords: roomId, words(body), at, id
  cap 256 by roomId
  read <- exists members[.roomId, viewer]
  insert <- viewer = 'dev:seed'

maintain messageCounts: count messages by roomId
  read <- exists members[.roomId, viewer]

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  read <- .followerId = viewer
  insert <- viewer = 'dev:seed'

table posts:
  key: text <=80
  authorId: principal
  body: text <=4000
  at: time
  negAt: int
  negLikes: int default 0
  unique byKey: key
  by byAuthorTime: authorId, at, id
  by byRank: hour(at), negLikes, negAt, key, id
  immutable key, authorId, at, negAt
  public 'Posts and their current like totals are public.'
  insert <- .authorId = viewer or viewer = 'dev:seed'
  update <- allow

table likes:
  postKey: text <=80
  principal: principal
  unique byPair: postKey, principal
  public 'Likes are public.'
  insert <- .principal = viewer
  delete <- .principal = viewer

query search(q: text <=100, c: cursor ?):
  return members[viewer] after c first 20 by byPrincipalRoom { roomId, messages: messages[.roomId] matching q last 256 by byRoomWords { key, at } }

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
    total = total + max(0, messageCounts[m.roomId] - m.readOrdinal)
  return { total }

query trending(at: time, c: cursor ?):
  page = merge posts after c first 10 by byRank where .at > at - 86400000 and .at <= at:
    [h] for h in range(hour(at) - 24, hour(at) + 1)
  return page { key, likes: 0 - .negLikes, at }

mutation post(key: text <=80, body: text <=4000, at: time):
  p = insert posts { key, authorId: viewer, body, at, negAt: 0 - (at / 1) }
  return { key: p.key, at: p.at }

mutation like(postKey: text <=80, liked: bool):
  p = posts[postKey] ! else POST_NOT_FOUND
  present = exists likes[postKey, viewer]
  if liked and not present:
    insert likes { postKey, principal: viewer }
    update posts[p.id] { negLikes: p.negLikes - 1 }
  else if not liked and present:
    delete likes[postKey, viewer]
    update posts[p.id] { negLikes: p.negLikes + 1 }
  return { postKey, liked }

mutation seedMembers(rooms: [id] <=128, principals: [principal] <=128, ordinals: [int] <=128):
  require viewer = 'dev:seed' else SEED_ONLY
  require count(rooms) = count(principals) and count(rooms) = count(ordinals) else BAD_BATCH
  for i in range(0, count(rooms)):
    insert members { roomId: at(rooms, i) ! else BAD_BATCH, principal: at(principals, i) ! else BAD_BATCH, readOrdinal: at(ordinals, i) ! else BAD_BATCH }
  return count(rooms)

mutation seedMessages(keys: [text <=80] <=128, rooms: [id] <=128, bodies: [text <=4000] <=128, ordinals: [int] <=128, times: [time] <=128):
  require viewer = 'dev:seed' else SEED_ONLY
  require count(keys) = count(rooms) and count(keys) = count(bodies) and count(keys) = count(ordinals) and count(keys) = count(times) else BAD_BATCH
  for i in range(0, count(keys)):
    insert messages { key: at(keys, i) ! else BAD_BATCH, roomId: at(rooms, i) ! else BAD_BATCH, body: at(bodies, i) ! else BAD_BATCH, ordinal: at(ordinals, i) ! else BAD_BATCH, at: at(times, i) ! else BAD_BATCH }
  return count(keys)

mutation seedFollows(followers: [principal] <=128, followed: [principal] <=128):
  require viewer = 'dev:seed' else SEED_ONLY
  require count(followers) = count(followed) else BAD_BATCH
  for i in range(0, count(followers)):
    insert follows { followerId: at(followers, i) ! else BAD_BATCH, followedId: at(followed, i) ! else BAD_BATCH }
  return count(followers)

mutation seedPosts(keys: [text <=80] <=128, authors: [principal] <=128, bodies: [text <=4000] <=128, times: [time] <=128):
  require viewer = 'dev:seed' else SEED_ONLY
  require count(keys) = count(authors) and count(keys) = count(bodies) and count(keys) = count(times) else BAD_BATCH
  for i in range(0, count(keys)):
    stamp = at(times, i) ! else BAD_BATCH
    insert posts { key: at(keys, i) ! else BAD_BATCH, authorId: at(authors, i) ! else BAD_BATCH, body: at(bodies, i) ! else BAD_BATCH, at: stamp, negAt: 0 - (stamp / 1) }
  return count(keys)
