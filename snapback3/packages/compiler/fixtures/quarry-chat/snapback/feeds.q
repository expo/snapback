shape authorCard = { displayName, handle }

query globalFeed(c: cursor ?):
  page = posts[] after c last 20 by byTime
  return page {
    post: .,
    author: profiles[.author] authorCard,
  }

query followingFeed(c: cursor ?):
  page = merge posts after c last 20 by byAuthorTime:
    [viewer]
    [f.followed] for f in follows[viewer] first 50 by byFollower
  return page { post: ., author: profiles[.author] authorCard }
