view originalPosts: count posts where .parentId = null and not .removed by .authorId
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
fn activityDay(d: int):
  return { day: d, posts: dailyPosts[viewer, d], likesReceived: dailyLikes[viewer, d] }
query summary():
  d = day(now)
  return { asOf: now, posts: originalPosts[viewer], likesReceived: receivedLikes[viewer], repostsReceived: receivedReposts[viewer], repliesReceived: receivedReplies[viewer], followers: followerCounts[viewer], following: followingCounts[viewer], days: [activityDay(d - 6), activityDay(d - 5), activityDay(d - 4), activityDay(d - 3), activityDay(d - 2), activityDay(d - 1), activityDay(d)] }
query trending(c: cursor ?):
  return posts where .parentId = null and not .removed and .at > now - 86400000 and .at <= now last 10 by .likeCount, .at after c postCard
