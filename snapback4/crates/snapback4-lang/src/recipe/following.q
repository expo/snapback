table authors:
  principal: principal
  shared: bool default false
  unique byPrincipal: principal
  cap 1000
  public 'delivery mode is public'
  insert <- .principal = viewer
  update <- allow
  sync public

table follows:
  followerId: principal
  followedId: principal
  at: time default 0
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  cap 1000 by followerId
  cap 1000 by followedId
  cap 100000
  public 'the follow graph is public'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public

table pulls:
  readerId: principal
  authorId: principal
  unique byReaderAuthor: readerId, authorId
  cap 32 by readerId
  cap 32000
  read <- .readerId = viewer
  insert <- allow
  delete <- .readerId = viewer
  sync

table pullCounts:                 -- server-only slot accounting; never lists installed authors
  readerId: principal
  used: int
  unique byReader: readerId
  cap 32000
  public 'only the number of installed pulls is public; routes stay reader-private'
  insert <- exists pullTotals[readerId = .readerId, value = .used]
  update (old, next) <- exists pullTotals[readerId = next.readerId, value = next.used]
  delete <- .readerId = viewer
  online only

maintain pullTotals: count pulls by readerId
  read <- deny
  online only

table posts:                       -- originals and attributed reposts, one source event each
  actorId: principal
  authorId: principal
  postId: id
  repost: bool
  at: time
  shared: bool
  unique byActorPost: actorId, postId, repost
  by byActorTime: actorId, at, id
  by byTime: at, id
  cap 1000 by actorId
  cap 60000
  immutable actorId, authorId, postId, repost, at, shared
  public 'original posts and attributed reposts are public'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

table removedEvents:               -- compact tombstones for deleted public source events
  eventId: id                       -- shared identity across source and tombstone tables; checked by the insert rule
  actorId: principal
  unique byEvent: eventId
  by byActor: actorId, id
  immutable eventId, actorId
  cap 1000 by actorId
  cap 32000
  public 'removal of a public source event is public; id is the eventId'
  insert <- .actorId = viewer and .id = .eventId and exists posts[id = .eventId, actorId = viewer]
  sync public

table feed:                        -- private inbox, with app post references
  readerId: principal
  eventId: posts on delete keep      -- a removed event is purged lazily, behind its tombstone
  actorId: principal
  authorId: principal
  postId: id
  repost: bool
  at: time
  unique byReaderEvent: readerId, eventId
  unique byReaderTime: readerId, at, eventId
  by byReaderActor: readerId, actorId, id
  by byTime: at, eventId
  by byEvent: eventId, id
  immutable readerId, eventId, actorId, at
  cap 1000 by readerId, actorId
  cap 50000 by readerId
  cap 1001 by eventId
  read <- .readerId = viewer
  insert <- .actorId = viewer or .readerId = viewer
  delete <- .readerId = viewer
  sync

table broadcast:                   -- public celebrity events, stored once
  readerId: principal
  eventId: posts
  actorId: principal
  authorId: principal
  postId: id
  repost: bool
  at: time
  unique byReaderEvent: readerId, eventId
  unique byReaderTime: readerId, at, eventId
  by byReaderActor: readerId, actorId, id
  by byTime: at, eventId
  immutable readerId, eventId, actorId, at
  cap 32000
  public 'celebrity posts and reposts are public'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

fn copy(p: posts, readerId: principal, shared: bool):
  if shared:
    insert broadcast { readerId, eventId: p.id, actorId: p.actorId, authorId: p.authorId, postId: p.postId, repost: p.repost, at: p.at }
  else:
    insert feed { readerId, eventId: p.id, actorId: p.actorId, authorId: p.authorId, postId: p.postId, repost: p.repost, at: p.at }
  return null

mutation register():
  insert authors { principal: viewer } if absent
  return null

fn tryPull(readerId: principal, authorId: principal):
  if readerId = viewer:
    if exists pulls[readerId, authorId]:
      return true
  slots = pullCounts[readerId = readerId]
  used = 0
  if slots != null:
    used = slots.used
  if used = 32:
    return false
  -- Foreign inserts happen only on an author's first promotion: no route
  -- for that author exists yet. Never probe another reader's private route.
  insert pulls { readerId, authorId }
  upsert pullCounts[readerId = readerId] { readerId, used: used + 1 }
  return true

fn addFollow(authorId: principal):
  require authorId != viewer else FEED_CANNOT_FOLLOW_SELF
  a = authors[principal = authorId] ! else FEED_AUTHOR_NOT_FOUND
  if exists follows[followerId = viewer, followedId = authorId]:
    return null
  if a.shared:
    require tryPull(viewer, authorId) else FEED_PULL_CAP
  insert follows { followerId: viewer, followedId: authorId, at: now }
  if not a.shared:
    near = follows[authorId] first 51 by byFollowed
    if count(near) > 50:
      -- Check the caller first so their own full slots name their own repair.
      require tryPull(viewer, authorId) else FEED_PULL_CAP
      update authors[principal = authorId] { shared: true }
      tryPull(authorId, authorId)
      for f in follows[authorId] by byFollowed:
        require tryPull(f.followerId, authorId) else FEED_PROMOTION_PULL_CAP
  visited = 0
  for p in posts[authorId] last 1000 by byActorTime:
    if visited = 865:
      break
    visited = visited + 1
    if not p.shared:
      copy(p, viewer, false)

  return null

mutation follow(authorId: principal):
  return addFollow(authorId)

fn dropFollow(authorId: principal):
  if not exists follows[followerId = viewer, followedId = authorId]:
    return null
  for e in feed[viewer, authorId] by byReaderActor:
    delete feed[e.id]
  if exists pulls[viewer, authorId]:
    delete pulls[viewer, authorId]
    slots = pullCounts[readerId = viewer] ! else FEED_PULL_COUNT_MISSING
    if slots.used = 1:
      delete pullCounts[readerId = viewer]
    else:
      update pullCounts[readerId = viewer] { used: slots.used - 1 }
  delete follows[followerId = viewer, followedId = authorId]

  return null

mutation unfollow(authorId: principal):
  return dropFollow(authorId)

fn deliver(p: posts):
  if p.shared:
    copy(p, viewer, true)
    if not exists pulls[viewer, viewer]:
      copy(p, viewer, false)
  else:
    copy(p, viewer, false)
    for f in follows[viewer] by byFollowed:
      copy(p, f.followerId, false)
  return null

mutation createPost(postId: id):
  require not exists removedEvents[eventId = postId] else FEED_EVENT_REMOVED
  a = authors[principal = viewer] ! else FEED_AUTHOR_NOT_FOUND
  p = insert posts { id: postId, postId, actorId: viewer, authorId: viewer, repost: false, at: now, shared: a.shared }
  deliver(p)
  return { id: p.id }

mutation repost(eventId: posts):
  original = posts[eventId] ! else FEED_POST_NOT_FOUND
  require not original.repost else FEED_ORIGINAL_REQUIRED
  if exists posts[viewer, original.postId, true]:
    return null
  a = authors[principal = viewer] ! else FEED_AUTHOR_NOT_FOUND
  p = insert posts { postId: original.postId, actorId: viewer, authorId: original.authorId, repost: true, at: now, shared: a.shared }
  deliver(p)
  return { id: p.id }

fn removeEvent(p: posts):
  require p.actorId = viewer else FEED_NOT_AUTHOR
  insert removedEvents { id: p.id, eventId: p.id, actorId: viewer }
  if p.shared:
    delete broadcast[viewer, p.id]
  delete posts[id = p.id]
  return null

mutation deletePost(postId: posts):
  p = posts[id = postId]
  if p != null:
    require not p.repost else FEED_ORIGINAL_REQUIRED
    removeEvent(p)
  return null

mutation unrepost(postId: id):
  p = posts[viewer, postId, true]
  if p != null:
    removeEvent(p)
  return null

query following(c: cursor ?):
  return merge feed after c last 20 by byReaderTime where not exists removedEvents[eventId = .eventId]:
    [viewer]
    broadcast[p.authorId] for p in pulls[viewer] by byReaderAuthor

job purgeRemoved():
  chunk p in removedEvents first 1 by byId:
    for e in feed[p.eventId] by byEvent:
      delete feed[e.id]
    delete removedEvents[id = p.id]
schedule purgeRemovedEvery every 1m: purgeRemoved
