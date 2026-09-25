view originalPostCounts: count posts where .parentId = null and not .removed by .authorId
  online only
view receivedLikes: count likes by .postId.authorId
  online only
view receivedReposts: count reposts by .postId.authorId
  online only
view receivedReplies: count posts where .parentId != null by .parentId.authorId
  online only
view dailyPosts: count posts where .parentId = null and not .removed by .authorId, day(.at)
  online only
view dailyLikes: count likes by .postId.authorId, day(.at)
  online only
query insights():
  days = []
  for offset in range(0, 7):
    date = day(now) - 6 + offset
    days = days + [{ day: date, posts: dailyPosts[viewer, date], likesReceived: dailyLikes[viewer, date] }]
  return { posts: originalPostCounts[viewer], likesReceived: receivedLikes[viewer], repostsReceived: receivedReposts[viewer], repliesReceived: receivedReplies[viewer], followers: followerCounts[viewer], following: followingCounts[viewer], days, serverNow: now }
query trending():
  return posts where .parentId = null and not .removed and .at > now - 1d and .at <= now last 10 by .likeCount, .at postCard
