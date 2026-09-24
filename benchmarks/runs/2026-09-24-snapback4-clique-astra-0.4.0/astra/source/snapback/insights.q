view postTotals: count posts where .parent = null by .author
  online only
view receivedLikes: count likes by .post.author
  online only
view receivedReposts: count reposts by .post.author
  online only
view receivedReplies: count posts where .parent != null by .parent.author
  online only
view dailyPosts: count posts where .parent = null by .author, day(.at)
  online only
view dailyLikes: count likes by .post.author, day(.at)
  online only
query mine():
  days = []
  for d in range(day(now) - 6, day(now) + 1):
    days = days + [{ day: d, posts: dailyPosts[viewer, d], likesReceived: dailyLikes[viewer, d] }]
  return { posts: postTotals[viewer], likesReceived: receivedLikes[viewer], repostsReceived: receivedReposts[viewer], repliesReceived: receivedReplies[viewer], followers: followerCounts[viewer], following: followingCounts[viewer], days }
query trending(c: cursor ?):
  return posts where .parent = null and not .removed and .at > now - 1d and .at <= now last 10 by .likes, .at after c postCard

effect digest
job daily(periodStart: time, periodEnd: time):
  for p in profiles:
    followers = count(follows where .followed = p.principal and .at >= periodStart and .at < periodEnd)
    newPosts = count(posts where .author = p.principal and .parent = null and .at >= periodStart and .at < periodEnd)
    newPosts = newPosts + count(reposts where .actor = p.principal and .at >= periodStart and .at < periodEnd)
    for f in follows where .follower = p.principal:
      newPosts = newPosts + count(posts where .author = f.followed and .parent = null and .at >= periodStart and .at < periodEnd)
      newPosts = newPosts + count(reposts where .actor = f.followed and .at >= periodStart and .at < periodEnd)
    unread = 0
    unreadChats = 0
    for m in members where .principal = p.principal:
      n = count(messages where .chat = m.chat and .sender != p.principal and not .tombstone and .at > m.readAt and .at >= periodStart and .at < periodEnd)
      unread = unread + n
      if n > 0:
        unreadChats = unreadChats + 1
    if followers > 0 or newPosts > 0 or unread > 0:
      emit digest { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers: followers, newPostsInFollowing: newPosts, unreadMessages: unread, unreadChats } once [p.principal, periodEnd]
