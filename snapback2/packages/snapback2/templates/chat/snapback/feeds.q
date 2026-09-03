query globalFeed(cursorAt: time ?, cursorId: posts ?):
  page = posts[] before (cursorAt, cursorId) last 20 by byTime
  return page {
    post: .,
    author: profiles[.author],
  }

query followingFeed(cursorAt: time ?, cursorId: posts ?):
  page = merge posts before (cursorAt, cursorId) last 20 by byAuthorTime:
    [viewer]
    [f.followed] for f in follows[viewer] first 50 by byFollower
  return page { post: ., author: profiles[.author] }
