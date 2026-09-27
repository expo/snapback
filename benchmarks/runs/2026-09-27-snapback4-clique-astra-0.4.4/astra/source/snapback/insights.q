view originalPosts: count posts where .parent = null and not .removed by .author
  online only
view dailyPosts: count posts where .parent = null and not .removed by .author, day(.at)
  online only
view likesReceived: count likes by .post.author
  online only
view dailyLikes: count likes by .post.author, day(.at)
  online only
view repostsReceived: count reposts by .post.author
  online only
view repliesReceived: count posts where .parent != null and not .removed by .parent.author
  online only
query summary():
  days = []
  for offset in range(0, 7):
    d = day(now) - 6 + offset
    days = days + [{ day: d, posts: dailyPosts[viewer, d], likesReceived: dailyLikes[viewer, d] }]
  return { asOf: now, posts: originalPosts[viewer], likesReceived: likesReceived[viewer], repostsReceived: repostsReceived[viewer], repliesReceived: repliesReceived[viewer], followers: followerCount[viewer], following: followingCount[viewer], days }
query trending(c: cursor ?):
  return posts where .parent = null and not .removed and .at > now - 1d and .at <= now last 10 by .likeCount, .at after c postCard
