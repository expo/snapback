effect notify from push

fn settings(): appSettings['windows']

mutation setRecipeFollow(target: principal, following: bool):
  existing = follows[viewer, target]
  edge = digestFollows[viewer, target]
  if following:
    if existing = null:
      cfg = settings() ! else CONFIG
      (_period, rem) = divmod(now, cfg.digestPeriodMs)
      insert follows { follower: viewer, followed: target, periodStart: now - rem }
    if edge = null:
      insert digestFollows { follower: viewer, followed: target }
  else:
    if edge != null:
      delete digestFollows[edge]
    if existing != null:
      delete follows[existing]
  return null

mutation createRecipePost(postId: id ?):
  cfg = settings() ! else CONFIG
  (_period, rem) = divmod(now, cfg.digestPeriodMs)
  periodStart = now - rem
  row = insert posts { id: postId ?? new, author: viewer, isReply: false, periodStart }
  prior = postPeriodCounters[viewer, false, periodStart]
  if prior = null:
    insert postPeriodCounters { author: viewer, isReply: false, periodStart, total: 1 }
  else:
    update postPeriodCounters[prior] { total: prior.total + 1 }
  return row

mutation queueRecipeUnread(messageId: messages, conversationId: conversations, recipient: principal):
  cfg = settings() ! else CONFIG
  (_period, rem) = divmod(now, cfg.digestPeriodMs)
  insert pendingRead { messageId, recipient, conversationId, periodStart: now - rem }
  return null

mutation clearRecipeUnread(messageId: messages, recipient: principal):
  pending = pendingRead[messageId, recipient]
  if pending != null:
    delete pendingRead[pending]
  return null

job periodDigestSweep():
  chunk p in profiles first 1 by byId:
    cfg = settings() ! else CONFIG
    if cfg.replayMode = false:
      (_period, rem) = divmod(now, cfg.digestPeriodMs)
      periodEnd = now - rem
      periodStart = periodEnd - cfg.digestPeriodMs
      prior = digests[p.principal, periodStart]
      if prior = null:
        newFollowers = newFollowerPeriodCounts[p.principal, periodStart] ?? 0
        scratch = insert digestScratch { newPostsInFollowing: 0, unreadMessages: 0, unreadChats: 0 }
        following = digestFollows[p.principal] first 500 by byFollower { followed }
        for followed in following:
          postCounter = postPeriodCounters[followed.followed, false, periodStart]
          if postCounter != null:
            update digestScratch[scratch] { newPostsInFollowing: .newPostsInFollowing + postCounter.total }
        chats = memberships[p.principal] first 100 by byPrincipalConversation { conversationId }
        for membership in chats:
          messageCount = pendingReadPeriodByChat[p.principal, membership.conversationId, periodStart] ?? 0
          if messageCount > 0:
            update digestScratch[scratch] {
              unreadMessages: .unreadMessages + messageCount,
              unreadChats: .unreadChats + 1,
            }
        summary = digestScratch[scratch.id] ! else DIGEST_STATE
        if newFollowers != 0 or summary.newPostsInFollowing != 0 or summary.unreadMessages != 0 or summary.unreadChats != 0:
          insert digests {
            principal: p.principal,
            periodStart,
            periodEnd,
            newFollowers,
            newPostsInFollowing: summary.newPostsInFollowing,
            unreadMessages: summary.unreadMessages,
            unreadChats: summary.unreadChats,
          }
          insert pushLog {
            target: p.principal,
            kind: 'digest',
            periodStart,
            periodEnd,
            newFollowers,
            newPostsInFollowing: summary.newPostsInFollowing,
            unreadMessages: summary.unreadMessages,
            unreadChats: summary.unreadChats,
          }
          emit notify { to: p.principal, body: 'digest' }
        delete digestScratch[summary]
