view postTotals: count posts where .parent = null by .author
  online only
view likesReceived: count likes by .post.author
  online only
view repostsReceived: count reposts by .post.author
  online only
view repliesReceived: count posts where .parent != null by .parent.author
  online only
view dailyPosts: count posts where .parent = null by .author, day(.at)
  online only
view dailyLikes: count likes by .post.author, day(.at)
  online only
fn activityDay(d: int):
  return { day: d, posts: dailyPosts[viewer, d], likesReceived: dailyLikes[viewer, d] }
query summary(refresh: int ?):
  d = day(now)
  return { posts: postTotals[viewer], likesReceived: likesReceived[viewer], repostsReceived: repostsReceived[viewer], repliesReceived: repliesReceived[viewer], followers: followers[viewer], following: followingCounts[viewer], asOf: now, days: [activityDay(d - 6), activityDay(d - 5), activityDay(d - 4), activityDay(d - 3), activityDay(d - 2), activityDay(d - 1), activityDay(d)] }
query trending(refresh: int ?, c: cursor ?):
  return posts where .parent = null and .at > now - 1d and .at <= now last 10 by .likes, .at after c postCard
