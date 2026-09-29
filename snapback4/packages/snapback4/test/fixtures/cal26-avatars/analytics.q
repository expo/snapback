view totalPosts: count posts where .parentId = null and not .removed by .authorId
  online only
view receivedLikes: count likes by .postId.authorId
  online only
view receivedReposts: count reposts by .postId.authorId
  online only
view receivedReplies: count posts where .parentId != null and not .removed by .parentId.authorId
  online only
view dailyPosts: count posts where .parentId = null and not .removed by .authorId, day(.at)
  online only
view dailyLikes: count likes by .postId.authorId, day(.at)
  online only
fn activityDay(principal: principal, day: int):
  return { day, posts: dailyPosts[principal, day], likesReceived: dailyLikes[principal, day] }
query insights(principal: principal):
  today = day(now)
  return { at: now, posts: totalPosts[principal], likesReceived: receivedLikes[principal], repostsReceived: receivedReposts[principal], repliesReceived: receivedReplies[principal], followers: followers[principal], following: followingCounts[principal], days: [activityDay(principal, today - 6), activityDay(principal, today - 5), activityDay(principal, today - 4), activityDay(principal, today - 3), activityDay(principal, today - 2), activityDay(principal, today - 1), activityDay(principal, today)] }
query trending():
  return posts where .parentId = null and not .removed and .at > now - 1d and .at <= now last 10 by .likeCount, .at { *, author: profiles[principal = .authorId] }
fn unreadPeriod(conversation: conversations, principal: principal, seen: int, periodStart: time, periodEnd: time):
  return count(messages where .conversation = conversation and .at >= periodStart and .at < periodEnd and .sender != principal and .ordinal > seen and not .tombstone)
fn digestCounts(principal: principal, periodStart: time, periodEnd: time):
  newFollowers = count(follows where .followedId = principal and .at >= periodStart and .at < periodEnd)
  newPostsInFollowing = 0
  for f in follows where .followerId = principal:
    newPostsInFollowing = newPostsInFollowing + count(posts where .authorId = f.followedId and .parentId = null and not .removed and .at >= periodStart and .at < periodEnd)
  unreadMessages = 0
  unreadChats = 0
  for m in members where .principal = principal:
    n = unreadPeriod(m.conversation, principal, m.seenOrdinal, periodStart, periodEnd)
    unreadMessages = unreadMessages + n
    if n > 0:
      unreadChats = unreadChats + 1
  return { newFollowers, newPostsInFollowing, unreadMessages, unreadChats }
job digest(periodStart: time, periodEnd: time):
  for p in profiles:
    totals = digestCounts(p.principal, periodStart, periodEnd)
    if totals.newFollowers + totals.newPostsInFollowing + totals.unreadMessages > 0:
      emit notify { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers: totals.newFollowers, newPostsInFollowing: totals.newPostsInFollowing, unreadMessages: totals.unreadMessages, unreadChats: totals.unreadChats } once [p.principal, periodEnd]
