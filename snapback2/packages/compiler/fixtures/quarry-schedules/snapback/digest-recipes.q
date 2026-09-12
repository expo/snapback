effect notify from push

proc queuePeriodUnread from custody
proc clearPeriodUnread from custody

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
  row = insert posts { id: postId ?? new, author: viewer, isReply: false, periodStart, digestEligible: cfg.replayMode = false }
  if cfg.replayMode = false:
    prior = postPeriodCounters[viewer, false, periodStart]
    if prior = null:
      insert postPeriodCounters { author: viewer, isReply: false, periodStart, total: 1 }
    else:
      update postPeriodCounters[prior] { total: prior.total + 1 }
  return row

mutation deleteRecipePost(postId: posts):
  post = posts[postId] ! else NOT_FOUND
  require post.author = viewer else AUTHOR_REQUIRED
  if post.digestEligible:
    counter = postPeriodCounters[post.author, post.isReply, post.periodStart] ! else POST_COUNTER
    require counter.total > 0 else POST_COUNTER
    update postPeriodCounters[counter] { total: counter.total - 1 }
  delete posts[post]
  return null

mutation queueRecipeUnread(messageId: messages, conversationId: conversations, recipient: principal):
  cfg = settings() ! else CONFIG
  message = messages[messageId] ! else NOT_FOUND
  require message.author = viewer and message.conversationId = conversationId else MESSAGE_SCOPE
  expiry = message.expiresAt
  if expiry != null:
    require expiry > now else EXPIRED
  membership = memberships[conversationId, recipient] ! else MEMBERSHIP_REQUIRED
  if cfg.replayMode = false and recipient != message.author:
    (_period, rem) = divmod(now, cfg.digestPeriodMs)
    queuePeriodUnread(messageId, recipient, conversationId, membership.id, now - rem)
  return null

mutation clearRecipeUnread(messageId: messages, recipient: principal):
  require recipient = viewer else RECIPIENT_REQUIRED
  pending = periodUnread[messageId, recipient]
  if pending != null:
    clearPeriodUnread(pending.id)
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
        unreadMessages = periodUnreadByRecipientPeriod[p.principal, periodStart] ?? 0
        unreadChats = periodChatsByRecipientPeriod[p.principal, periodStart] ?? 0
        scratch = insert digestScratch { newPostsInFollowing: 0, unreadMessages, unreadChats }
        following = digestFollows[p.principal] first 500 by byFollower { followed }
        for followed in following:
          postCounter = postPeriodCounters[followed.followed, false, periodStart]
          if postCounter != null:
            update digestScratch[scratch] { newPostsInFollowing: .newPostsInFollowing + postCounter.total }
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
      clearPeriodUnread(row.id)

schedule recipeDigest every 2m: periodDigestSweep(.periodEnd)
