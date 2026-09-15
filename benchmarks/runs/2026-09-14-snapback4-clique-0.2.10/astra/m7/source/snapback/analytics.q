maintain authoredTotals: count posts by authorId
  read <- .authorId = viewer
  online only
maintain authoredDays: count posts by authorId, day
  read <- .authorId = viewer
  online only
maintain receivedLikes: count likes by authorId
  read <- .authorId = viewer
  online only
maintain receivedLikeDays: count likes by authorId, day
  read <- .authorId = viewer
  online only
maintain receivedReposts: count timelines by postAuthor, repost
  read <- .postAuthor = viewer
  online only
maintain receivedReplies: count posts by parentAuthor
  read <- .parentAuthor = viewer
  online only
maintain postsInPeriod: count posts by authorId, period, parentId
  read <- allow
  online only

table postRanks:
  postId: posts
  score: int
  at: time
  expiresAt: time ?
  unique byPost: postId
  by byRank: score, at, id
  by byExpiry: expiresAt
  immutable postId, at
  public 'Public original-post ranking for the trailing 24 hours'
  insert <- allow
  update <- allow
  expire at .expiresAt
  sync public last 500 by byRank

query insights():
  (today, remainder) = divmod(now, 86400000)
  days = []
  for day in range(today - 6, today + 1):
    days = days + [{ day, posts: authoredDays[viewer, day], likesReceived: receivedLikeDays[viewer, day] }]
  return { asOf: now, posts: authoredTotals[viewer], likesReceived: receivedLikes[viewer], repostsReceived: receivedReposts[viewer, true], repliesReceived: receivedReplies[viewer], followers: followerCounts[viewer], following: followingCounts[viewer], days }

query trending():
  return postRanks last 10 by byRank where .at > now - 86400000 { *, post: posts[.postId] postCard }

job backfill():
  chunk p in posts first 100 by byId:
    update posts[p.id] { parentAuthor: posts[p.parentId].authorId, period: digestPeriod(p.at) }
    if p.parentId = null and p.at > now - 86400000:
      upsert postRanks[p.id] { score: likeCounts[p.id], at: p.at, expiresAt: p.at + 86400000 }
  chunk t in timelines first 100 by byId:
    update timelines[t.id] { postAuthor: posts[t.postId].authorId }

table digestStats:
  principal: principal
  periodStart: time
  periodEnd: time
  newFollowers: int
  newPostsInFollowing: int
  unreadMessages: int
  emitted: bool
  unique byPrincipalPeriod: principal, periodStart
  immutable principal, periodStart
  read <- .principal = viewer
  online only

table digestChats:
  principal: principal
  periodStart: time
  conversationId: conversations
  unique byPrincipalPeriodChat: principal, periodStart, conversationId
  immutable principal, periodStart, conversationId
  read <- .principal = viewer
  online only
maintain digestChatCounts: count digestChats by principal, periodStart
  read <- .principal = viewer
  online only

job digest(periodStart: time, periodEnd: time):
  if replayMode():
    return
  chunk p in profiles first 100 by byId:
    insert digestStats { principal: p.principal, periodStart, periodEnd, newFollowers: 0, newPostsInFollowing: 0, unreadMessages: 0, emitted: false } if absent
  chunk f in follows first 100 by byId:
    if f.at >= periodStart and f.at < periodEnd:
      old = digestStats[f.followedId, periodStart] ! else STATS_MISSING
      update digestStats[old.id] { newFollowers: old.newFollowers + 1 }
    posts = postsInPeriod[f.followedId, periodStart, null]
    if posts > 0:
      old = digestStats[f.followerId, periodStart] ! else STATS_MISSING
      update digestStats[old.id] { newPostsInFollowing: old.newPostsInFollowing + posts }
  chunk m in messages first 20 by byId:
    if m.at >= periodStart and m.at < periodEnd and m.deleted != true:
      for recipient in m.recipients:
        membership = members[m.conversationId, recipient]
        state = readStates[m.conversationId, recipient]
        unread = state.readArrival < m.arrival if state != null and state.readArrival != null and m.arrival != null else (state.readAt < m.at if state != null else true)
        if membership != null and membership.joinedAt <= m.at and unread:
          old = digestStats[recipient, periodStart] ! else STATS_MISSING
          update digestStats[old.id] { unreadMessages: old.unreadMessages + 1 }
          insert digestChats { principal: recipient, periodStart, conversationId: m.conversationId } if absent
  chunk stat in digestStats first 100 by byId:
    if stat.periodStart = periodStart and not stat.emitted:
      chats = digestChatCounts[stat.principal, periodStart]
      if stat.newFollowers + stat.newPostsInFollowing + stat.unreadMessages + chats > 0:
        emit notify { targetUserId: stat.principal, kind: 'digest', periodStart, periodEnd, newFollowers: stat.newFollowers, newPostsInFollowing: stat.newPostsInFollowing, unreadMessages: stat.unreadMessages, unreadChats: chats }
      update digestStats[stat.id] { emitted: true }
