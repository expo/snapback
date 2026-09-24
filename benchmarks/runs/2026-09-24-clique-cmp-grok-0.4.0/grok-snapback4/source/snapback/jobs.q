-- Daily digest: shortened grading schedule is every 2 minutes (config/digest.json).
-- Replay mode (`snapback4 dev --replay`) holds schedules and suppresses emits.

fn unreadIn(conversationId: conversations, reader: principal, readOrdinal: int, periodStart: time, periodEnd: time):
  return count(messages where .conversationId = conversationId and .at >= periodStart and .at < periodEnd and not .tombstone and .authorId != reader and .ordinal > readOrdinal)

job digest(periodStart: time, periodEnd: time):
  for p in profiles:
    newFollowers = count(follows where .followedId = p.principal and .at >= periodStart and .at < periodEnd)
    newPosts = count(posts where .at >= periodStart and .at < periodEnd and not .removed and (.authorId = p.principal or exists follows[followerId = p.principal, followedId = .authorId]))
    unread = 0
    chats = 0
    for m in memberships where .principal = p.principal:
      n = unreadIn(m.conversationId, p.principal, m.readOrdinal, periodStart, periodEnd)
      if n > 0:
        chats = chats + 1
        unread = unread + n
    if newFollowers > 0 or newPosts > 0 or unread > 0:
      emit notify { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers, newPostsInFollowing: newPosts, unreadMessages: unread, unreadChats: chats } once [p.principal, periodEnd]
schedule cliqueDigest every 2m: jobs.digest
