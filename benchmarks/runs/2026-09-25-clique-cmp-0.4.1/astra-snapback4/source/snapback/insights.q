view originalCounts: count posts where .parent = null and not .removed by .author
  online only
view receivedLikes: count likes by .post.author
  online only
view receivedReposts: count reposts by .post.author
  online only
view receivedReplies: count posts where .parent != null and not .removed by .parent.author
  online only
view dailyPosts: count posts where .parent = null and not .removed by .author, day(.at)
  online only
view dailyLikes: count likes by .post.author, day(.at)
  online only
fn activityDay(d: int):
  return { day: d, posts: dailyPosts[viewer, d], likesReceived: dailyLikes[viewer, d] }
query insights():
  d = day(now)
  return { asOf: now, posts: originalCounts[viewer], likesReceived: receivedLikes[viewer], repostsReceived: receivedReposts[viewer], repliesReceived: receivedReplies[viewer], followers: followerCounts[viewer], following: followingCounts[viewer], days: [activityDay(d - 6), activityDay(d - 5), activityDay(d - 4), activityDay(d - 3), activityDay(d - 2), activityDay(d - 1), activityDay(d)] }
query trending():
  return posts where .parent = null and .at > now - 1d and .at <= now and not .removed last 10 by .likeCount, .at postCard
