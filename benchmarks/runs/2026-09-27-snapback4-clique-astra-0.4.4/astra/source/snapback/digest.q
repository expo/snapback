table digestProgress:
  principal: principal
  through: time
  unique principal
  immutable principal
  read <- deny
  insert <- deny
  update <- deny
  online only
fn unreadIn(conversation: conversations, reader: principal, readOrdinal: int, periodStart: time, periodEnd: time):
  return count(messages where .conversation = conversation and .at >= periodStart and .at < periodEnd and not .tombstone and .sender != reader and .ordinal > readOrdinal)
job daily(periodStart: time, periodEnd: time):
  for p in profiles:
    previous = digestProgress[principal = p.principal]
    start = previous.through if previous != null else periodStart
    if start >= periodEnd:
      continue
    newFollowers = count(follows where .followed = p.principal and .at >= start and .at < periodEnd)
    newPostsInFollowing = 0
    for f in follows where .follower = p.principal:
      newPostsInFollowing = newPostsInFollowing + count(posts where .author = f.followed and .parent = null and not .removed and .at >= start and .at < periodEnd)
    unreadMessages = 0
    unreadChats = 0
    for m in members where .principal = p.principal:
      n = unreadIn(m.conversation, p.principal, max(m.seenOrdinal, m.joinedOrdinal), start, periodEnd)
      if n > 0:
        unreadMessages = unreadMessages + n
        unreadChats = unreadChats + 1
    if newFollowers > 0 or newPostsInFollowing > 0 or unreadMessages > 0:
      emit notify { targetUserId: p.principal, kind: 'digest', periodStart: start, periodEnd, newFollowers, newPostsInFollowing, unreadMessages, unreadChats } once ['digest', p.principal, periodEnd]
    upsert digestProgress[principal = p.principal] { through: periodEnd }
