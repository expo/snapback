table digestMarkers:
  principal: principal
  periodEnd: time
  unique byPrincipalPeriod: principal, periodEnd
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny
  online only
fn unreadIn(conversationId: conversations, reader: principal, readOrdinal: int, periodStart: time, periodEnd: time):
  return count(messages[conversationId, at >= periodStart, at < periodEnd] first 10001 by byConversationTime where not .tombstone and .senderId != reader and .ordinal > readOrdinal)
job daily(periodStart: time, periodEnd: time):
  chunk p in profiles first 1 by byId:
    if exists digestMarkers[p.principal, periodEnd]:
      continue
    unreadMessages = 0
    unreadChats = 0
    for m in members[p.principal] first 1000 by byPrincipal:
      n = unreadIn(m.conversationId, p.principal, m.readOrdinal, periodStart, periodEnd)
      if n > 0:
        unreadChats = unreadChats + 1
        unreadMessages = unreadMessages + n
    newPostsInFollowing = 0
    for f in follows[p.principal] first 1000 by byPair:
      newPostsInFollowing = newPostsInFollowing + periodPosts[f.followedId, digestBucket(periodStart)]
    newFollowers = periodFollowers[p.principal, digestBucket(periodStart)]
    if newFollowers > 0 or newPostsInFollowing > 0 or unreadMessages > 0:
      emit push { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers, newPostsInFollowing, unreadMessages, unreadChats }
    insert digestMarkers { principal: p.principal, periodEnd }
