job digestPass(period: int):
  chunk f in follows first 50 by byId:
    n = periodPosts[f.followed, period]
    account = digests[f.follower, period] by byTargetPeriod
    if account != null:
      update digests[account] { newPostsInFollowing: account.newPostsInFollowing + n }

job directoryBackfill():
  chunk entry in directory first 25 by byId:
    update directory[entry] { normalized: entry.handle }
