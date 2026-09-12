effect notify from push

fn settings(): appSettings['windows']

mutation setRecipeFollow(target: principal, following: bool):
  existing = follows[viewer, target]
  edge = digestFollows[viewer, target]
  if following:
    if existing = null:
      cfg = settings() ! else CONFIG
      (_period, rem) = divmod(now, cfg.digestPeriodMs)
      insert follows { follower: viewer, followed: target, digestEligible: cfg.replayMode = false, periodStart: now - rem }
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
  if cfg.replayMode = false:
    prior = postPeriodCounters[viewer, false, periodStart]
    if prior = null:
      insert postPeriodCounters { author: viewer, isReply: false, periodStart, total: 1 }
    else:
      update postPeriodCounters[prior] { total: prior.total + 1 }
  return row

mutation queueRecipeUnread(messageId: messages, conversationId: conversations, recipient: principal):
  cfg = settings() ! else CONFIG
  membership = memberships[conversationId, recipient] ! else MEMBERSHIP_REQUIRED
  (_period, rem) = divmod(now, cfg.digestPeriodMs)
  periodStart = now - rem
  before = periodUnreadByMembershipPeriod[membership.id, periodStart] ?? 0
  insert periodUnread { messageId, recipient, conversationId, membershipId: membership.id, periodStart }
  if before = 0:
    insert periodChats { recipient, conversationId, membershipId: membership.id, periodStart }
  return null

mutation clearRecipeUnread(messageId: messages, recipient: principal):
  pending = periodUnread[messageId, recipient]
  if pending != null:
    delete periodUnread[pending]
    remaining = periodUnreadByMembershipPeriod[pending.membershipId, pending.periodStart] ?? 0
    if remaining = 0:
      chat = periodChats[pending.recipient, pending.conversationId, pending.membershipId, pending.periodStart]
      if chat != null:
        delete periodChats[chat]
  return null

job periodDigestSweep(cutoff: time):
  chunk p in profiles first 1 by byId:
    cfg = settings() ! else CONFIG
    if cfg.replayMode = false:
      (_period, rem) = divmod(cutoff, cfg.digestPeriodMs)
      periodEnd = cutoff - rem
      periodStart = periodEnd - cfg.digestPeriodMs
      prior = digests[p.principal, periodStart]
      if prior = null:
        newFollowers = newFollowerPeriodCounts[p.principal, true, periodStart] ?? 0
        scratch = insert digestScratch { newPostsInFollowing: 0, unreadMessages: 0, unreadChats: 0 }
        following = digestFollows[p.principal] first 500 by byFollower { followed }
        for followed in following:
          postCounter = postPeriodCounters[followed.followed, false, periodStart]
          if postCounter != null:
            update digestScratch[scratch] { newPostsInFollowing: .newPostsInFollowing + postCounter.total }
        unreadMessages = periodUnreadByRecipientPeriod[p.principal, periodStart] ?? 0
        unreadChats = periodChatsByRecipientPeriod[p.principal, periodStart] ?? 0
        update digestScratch[scratch] { unreadMessages, unreadChats }
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
  chunk row in periodUnread first 50 by byPeriod:
    cfg = settings() ! else CONFIG
    (_period, rem) = divmod(cutoff, cfg.digestPeriodMs)
    currentPeriodStart = cutoff - rem
    if row.periodStart < currentPeriodStart - cfg.digestPeriodMs:
      delete periodUnread[row]
  chunk chat in periodChats first 50 by byPeriod:
    cfg = settings() ! else CONFIG
    (_period, rem) = divmod(cutoff, cfg.digestPeriodMs)
    currentPeriodStart = cutoff - rem
    if chat.periodStart < currentPeriodStart - cfg.digestPeriodMs:
      delete periodChats[chat]

schedule recipeDigest every 2m: periodDigestSweep(.periodEnd)
