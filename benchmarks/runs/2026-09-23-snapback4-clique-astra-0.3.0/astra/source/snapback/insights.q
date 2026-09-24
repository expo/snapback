maintain replyReceivedLikes: count likes by replyTarget.authorId
  read <- allow
  online only
maintain replyDailyLikes: count likes by replyTarget.authorId, day(.at)
  read <- allow
  online only
maintain nestedReceivedReplies: count replies by replyTarget.authorId
  read <- allow
  online only
maintain originalPostCounts: count posts by authorId
  read <- allow
  online only
maintain dailyPosts: count posts by authorId, day(.at)
  read <- allow
  online only
maintain receivedLikes: count likes by postId.authorId
  read <- allow
  online only
maintain dailyLikes: count likes by postId.authorId, day(.at)
  read <- allow
  online only
maintain receivedReposts: count reposts by postId.authorId
  read <- allow
  online only
maintain receivedReplies: count replies by postId.authorId
  read <- allow
  online only
query summary():
  days = []
  for d in range(day(now) - 6, day(now) + 1):
    days = days + [{ day: d, posts: dailyPosts[viewer, d], likesReceived: dailyLikes[viewer, d] + replyDailyLikes[viewer, d] }]
  return { at: now, posts: originalPostCounts[viewer], likesReceived: receivedLikes[viewer] + replyReceivedLikes[viewer], repostsReceived: receivedReposts[viewer], repliesReceived: receivedReplies[viewer] + nestedReceivedReplies[viewer], followers: followerCounts[viewer], following: followingCounts[viewer], days }
query trending(c: cursor ?):
  rows = merge posts after c last 10 by byHourLikes where .at > now - 86400000 and .at <= now:
    [h] for h in range(hour(now) - 24, hour(now) + 1)
  return rows postCard
