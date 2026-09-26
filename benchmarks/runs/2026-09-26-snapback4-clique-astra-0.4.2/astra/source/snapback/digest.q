-- Generated from config/digest.json; production config selects 08:00 UTC daily.
view periodPosts: count posts where .parent = null by .author, bucket(.at, 120s)
  online only
view periodFollowers: count follows by .followed, bucket(.at, 120s)
  online only
job daily(periodStart: time, periodEnd: time):
  for p in profiles:
    period = bucket(periodStart, 120s)
    newFollowers = periodFollowers[p.principal, period]
    newPostsInFollowing = periodPosts[p.principal, period]
    for f in follows where .follower = p.principal:
      newPostsInFollowing = newPostsInFollowing + periodPosts[f.followed, period]
    unreadMessages = 0
    unreadChats = 0
    for member in members where .principal = p.principal:
      unread = count(messages where .chat = member.chat and .at >= periodStart and .at < periodEnd and not .deleted and .sender != p.principal and .ordinal > member.readOrdinal)
      if unread > 0:
        unreadChats = unreadChats + 1
        unreadMessages = unreadMessages + unread
    if newFollowers > 0 or newPostsInFollowing > 0 or unreadMessages > 0:
      emit notify { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers, newPostsInFollowing, unreadMessages, unreadChats } once [p.principal, periodEnd]
schedule dailyDigest every 120s: digest.daily
