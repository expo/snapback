table progress:
  principal: principal
  through: time
  unique principal
  read <- deny
  insert <- deny
  update <- deny
  online only
fn totals(reader: principal, start: time, end: time):
  newFollowers = count(follows where .followedId = reader and .at >= start and .at < end)
  newPosts = count(posts where .authorId = reader and .parentId = null and not .removed and .at >= start and .at < end)
  for edge in follows where .followerId = reader:
    newPosts = newPosts + count(posts where .authorId = edge.followedId and .parentId = null and not .removed and .at >= start and .at < end)
  unread = chat.digestUnread(reader, start, end)
  return { newFollowers, newPostsInFollowing: newPosts, unreadMessages: unread.unreadMessages, unreadChats: unread.unreadChats }
job daily(periodStart: time, periodEnd: time):
  for p in profiles:
    previous = progress[principal = p.principal]
    if previous != null and previous.through >= periodEnd:
      continue
    start = previous.through if previous != null else periodStart
    t = totals(p.principal, start, periodEnd)
    upsert progress[principal = p.principal] { principal: p.principal, through: periodEnd }
    if t.newFollowers > 0 or t.newPostsInFollowing > 0 or t.unreadMessages > 0:
      emit notify { targetUserId: p.principal, kind: 'digest', periodStart: start, periodEnd, newFollowers: t.newFollowers, newPostsInFollowing: t.newPostsInFollowing, unreadMessages: t.unreadMessages, unreadChats: t.unreadChats } once [p.principal, periodEnd]
