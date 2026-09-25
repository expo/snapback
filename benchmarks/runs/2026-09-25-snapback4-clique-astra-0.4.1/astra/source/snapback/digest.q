effect digestNotify retry 8 backoff 2s deadline 1d
fn unreadIn(conversationId: conversations, reader: principal, readOrdinal: int, periodStart: time, periodEnd: time):
  return count(messages where .conversationId = conversationId and .at >= periodStart and .at < periodEnd and not .deleted and .senderId != reader and .ordinal > readOrdinal)
fn followingPostsIn(reader: principal, periodStart: time, periodEnd: time):
  return count(posts where .parentId = null and not .removed and .at >= periodStart and .at < periodEnd and (.authorId = reader or exists follows[reader, .authorId]))
job daily(periodStart: time, periodEnd: time):
  for p in profiles:
    unreadMessages = 0
    unreadChats = 0
    for m in memberships where .principal = p.principal:
      n = unreadIn(m.conversationId, p.principal, m.readOrdinal, periodStart, periodEnd)
      if n > 0:
        unreadChats = unreadChats + 1
        unreadMessages = unreadMessages + n
    newFollowers = count(follows where .followedId = p.principal and .at >= periodStart and .at < periodEnd)
    newPostsInFollowing = followingPostsIn(p.principal, periodStart, periodEnd)
    if unreadMessages > 0 or newFollowers > 0 or newPostsInFollowing > 0:
      emit digestNotify { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers, newPostsInFollowing, unreadMessages, unreadChats } once [p.principal, periodEnd]
