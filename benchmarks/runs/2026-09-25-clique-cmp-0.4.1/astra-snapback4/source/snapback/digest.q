fn unreadIn(conversation: conversations, reader: principal, readAt: time, periodStart: time, periodEnd: time):
  return count(messages where .conversation = conversation and .at >= periodStart and .at < periodEnd and not .tombstone and .sender != reader and .at > readAt)
fn periodOriginals(author: principal, periodStart: time, periodEnd: time):
  return count(posts where .author = author and .parent = null and not .removed and .at >= periodStart and .at < periodEnd)
job digest(periodStart: time, periodEnd: time):
  for p in profiles:
    unreadMessages = 0
    unreadChats = 0
    newPostsInFollowing = 0
    newFollowers = count(follows where .followed = p.principal and .at >= periodStart and .at < periodEnd)
    for f in follows where .follower = p.principal:
      newPostsInFollowing = newPostsInFollowing + periodOriginals(f.followed, periodStart, periodEnd)
    for m in members where .principal = p.principal:
      n = unreadIn(m.conversation, p.principal, m.readAt, periodStart, periodEnd)
      if n > 0:
        unreadChats = unreadChats + 1
        unreadMessages = unreadMessages + n
    if newFollowers > 0 or newPostsInFollowing > 0 or unreadMessages > 0:
      emit notify { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers, newPostsInFollowing, unreadMessages, unreadChats } once [p.principal, periodEnd]
