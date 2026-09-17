use personas hub, sparse, outsider, small, wide, celebrity, seed

-- Shared chat rows; only members can read messages and other members.
table members:
  roomId: id
  principal: principal
  readOrdinal: int
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  cap 2048 by principal
  read <- .principal = viewer or exists members[.roomId, viewer]
  insert <- viewer = 'dev:seed'
  online only

table messages:
  key: text <=128
  roomId: id
  body: text <=4000
  ordinal: int
  at: time
  unique byKey: key
  unique byOrdinal: roomId, ordinal
  by byRoomWords: roomId, words(body), at, id
  read <- exists members[.roomId, viewer]
  insert <- viewer = 'dev:seed'
  online only

maintain messageCounts: count messages by roomId
  read <- exists members[.roomId, viewer]
  online only

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  cap 2048 by followerId
  read <- .followerId = viewer
  insert <- viewer = 'dev:seed'
  online only

table posts:
  key: text <=128
  authorId: principal
  body: text <=4000
  at: time
  negativeAt: int
  negativeLikes: int default 0
  unique byKey: key
  by byAuthorTime: authorId, at, id
  by byRank: negativeLikes, negativeAt, key, id
  public 'Posts and their current like counts are public.'
  insert <- .authorId = viewer or viewer = 'dev:seed'
  update <- allow
  online only

table likes:
  postKey: text <=128
  principal: principal
  unique byPostPrincipal: postKey, principal
  public 'Likes on public posts are public.'
  insert <- .principal = viewer or viewer = 'dev:seed'
  delete <- .principal = viewer
  online only

maintain likeCounts: count likes by postKey
  read <- allow
  online only

query chats(batch: cursor ?):
  return members[viewer] after batch first 20 by byPrincipalRoom { roomId }

query searchBatch(q: text <=100, batch: cursor ?, c: cursor ?):
  page = merge messages matching q after c last 20 by byRoomWords:
    [m.roomId] for m in members[viewer] after batch first 20 by byPrincipalRoom
  return page { roomId, messages: [{ key: .key, at: .at }] }

query following(c: cursor ?):
  page = merge posts after c last 20 by byAuthorTime:
    [f.followedId] for f in follows[viewer] first 2048 by byPair
  return page { key, at }

query roster(roomId: id, c: cursor ?):
  require exists members[roomId, viewer] else NOT_MEMBER
  return members[roomId] after c first 20 by byRoomPrincipal { principal }

-- Ordinals are the input's contiguous 1..N sequence, with no delete operation.
query unread():
  total = 0
  for m in members[viewer] first 2048 by byPrincipalRoom:
    total = total + max(0, messageCounts[m.roomId] - m.readOrdinal)
  return { total }

query trending(at: time, c: cursor ?):
  return posts after c first 10 by byRank where .at > at - 86400000 and .at <= at { key, likes: -.negativeLikes, at }

mutation post(key: text <=128, body: text <=4000, at: time):
  p = insert posts { key, authorId: viewer, body, at, negativeAt: -(at / 1) }
  return { key: p.key, at: p.at }

fn setLike(postKey: text <=128, principal: principal, liked: bool):
  p = posts[postKey] ! else POST_NOT_FOUND
  if liked:
    insert likes { postKey, principal } if absent
  else:
    if exists likes[postKey, principal]:
      delete likes[postKey, principal]
  update posts[p.id] { negativeLikes: 0 - likeCounts[postKey] }
  return null

mutation like(postKey: text <=128, liked: bool):
  return setLike(postKey, viewer, liked)

-- Import accepts bounded parallel scalar lists, all derivation stays here.
mutation seedMessages(keys: [text <=128] <=256, rooms: [id] <=256, bodies: [text <=4000] <=256, ordinals: [int] <=256, times: [time] <=256): server
  require viewer = 'dev:seed' else SEED_ONLY
  require count(keys) = count(rooms) and count(keys) = count(bodies) and count(keys) = count(ordinals) and count(keys) = count(times) else LENGTH_MISMATCH
  for i in range(0, count(keys)):
    insert messages { key: at(keys, i) ! else BAD_KEY, roomId: at(rooms, i) ! else BAD_ROOM, body: at(bodies, i) ! else BAD_BODY, ordinal: at(ordinals, i) ! else BAD_ORDINAL, at: at(times, i) ! else BAD_TIME }
  return count(keys)

mutation seedMembers(rooms: [id] <=256, principals: [principal] <=256, reads: [int] <=256): server
  require viewer = 'dev:seed' else SEED_ONLY
  require count(rooms) = count(principals) and count(rooms) = count(reads) else LENGTH_MISMATCH
  for i in range(0, count(rooms)):
    insert members { roomId: at(rooms, i) ! else BAD_ROOM, principal: at(principals, i) ! else BAD_PRINCIPAL, readOrdinal: at(reads, i) ! else BAD_ORDINAL }
  return count(rooms)

mutation seedFollows(followers: [principal] <=256, authors: [principal] <=256): server
  require viewer = 'dev:seed' else SEED_ONLY
  require count(followers) = count(authors) else LENGTH_MISMATCH
  for i in range(0, count(followers)):
    insert follows { followerId: at(followers, i) ! else BAD_PRINCIPAL, followedId: at(authors, i) ! else BAD_AUTHOR }
  return count(followers)

mutation seedPosts(keys: [text <=128] <=256, authors: [principal] <=256, bodies: [text <=4000] <=256, times: [time] <=256): server
  require viewer = 'dev:seed' else SEED_ONLY
  require count(keys) = count(authors) and count(keys) = count(bodies) and count(keys) = count(times) else LENGTH_MISMATCH
  for i in range(0, count(keys)):
    stamp = at(times, i) ! else BAD_TIME
    insert posts { key: at(keys, i) ! else BAD_KEY, authorId: at(authors, i) ! else BAD_AUTHOR, body: at(bodies, i) ! else BAD_BODY, at: stamp, negativeAt: -(stamp / 1) }
  return count(keys)

mutation seedLikes(keys: [text <=128] <=256, principals: [principal] <=256): server
  require viewer = 'dev:seed' else SEED_ONLY
  require count(keys) = count(principals) else LENGTH_MISMATCH
  for i in range(0, count(keys)):
    setLike(at(keys, i) ! else BAD_KEY, at(principals, i) ! else BAD_PRINCIPAL, true)
  return count(keys)
