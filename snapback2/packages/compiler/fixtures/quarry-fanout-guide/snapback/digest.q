-- @ref LLP 1023.001#digest-and-backfill — every attempt revalidates the
-- exact facts read by earlier chunks in its final emission transaction.
effect digest from push

job queueDigestPeriod(period: time, periodEnd: time):
  chunk candidate in digestTargets first 25 by byId:
    prior = digests[candidate.target, period] by byTargetPeriod
    run = digestRuns[candidate.target, period] by byTargetPeriod
    if prior = null and run = null:
      periodVersion = digestPeriodVersions[period]
      recipientVersion = digestRecipientVersions[candidate.target]
      recipientPeriodVersion = digestRecipientPeriodVersions[candidate.target, period]
      insert digestRuns {
        target: candidate.target,
        period,
        periodEnd,
        attempt: 0,
        periodRevision: periodVersion,
        recipientRevision: recipientVersion,
        recipientPeriodRevision: recipientPeriodVersion,
        newPostsInFollowing: 0,
        unreadMessages: 0,
        unreadChats: 0,
        status: 'pending',
        retryAt: now,
      }
  chunk candidate in digestPeriodTargets[period] first 25 by byPeriod:
    prior = digests[candidate.target, period] by byTargetPeriod
    run = digestRuns[candidate.target, period] by byTargetPeriod
    if prior = null and run = null:
      periodVersion = digestPeriodVersions[period]
      recipientVersion = digestRecipientVersions[candidate.target]
      recipientPeriodVersion = digestRecipientPeriodVersions[candidate.target, period]
      insert digestRuns {
        target: candidate.target,
        period,
        periodEnd,
        attempt: 0,
        periodRevision: periodVersion,
        recipientRevision: recipientVersion,
        recipientPeriodRevision: recipientPeriodVersion,
        newPostsInFollowing: 0,
        unreadMessages: 0,
        unreadChats: 0,
        status: 'pending',
        retryAt: now,
      }

-- Each retry is a fresh job with fresh sweep cursors. A job cannot rewind a
-- completed sweep, so the row timer is the existing continuation seam.
job digestUser(runId: digestRuns, target: principal, period: time, attempt: int):
  chunk f in follows[target] first 50 by byFollower:
    run = digestRuns[runId]
    if run != null and run.status = 'pending' and run.attempt = attempt:
      n = periodPosts[f.followed, period]
      if n > 0:
        update digestRuns[run] { newPostsInFollowing: .newPostsInFollowing + n }
  chunk contribution in periodUnread[target, period] first 50 by byRecipientPeriodConversation:
    run = digestRuns[runId]
    if run != null and run.status = 'pending' and run.attempt = attempt:
      membership = memberships[contribution.membershipId]
      message = messages[contribution.messageId]
      if membership != null and membership.principal = target and membership.conversationId = contribution.conversationId and message != null and message.deleted != true and message.period = period and message.authorId = contribution.sender:
        mark = readMarks[contribution.conversationId, target] by byConversationActor
        deadline = message.expiresAt ?? now + 1
        readCutoff = mark.readAt ?? contribution.sentAt - 1
        if deadline > now and readCutoff < contribution.sentAt:
          if run.lastUnreadConversation = null or run.lastUnreadConversation != contribution.conversationId:
            update digestRuns[run] {
              unreadMessages: .unreadMessages + 1,
              unreadChats: .unreadChats + 1,
              lastUnreadConversation: contribution.conversationId,
            }
          else:
            update digestRuns[run] { unreadMessages: .unreadMessages + 1 }
          if message.expiresAt != null:
            if run.earliestExpiry = null:
              update digestRuns[run] { earliestExpiry: message.expiresAt }
            else:
              if message.expiresAt < run.earliestExpiry:
                update digestRuns[run] { earliestExpiry: message.expiresAt }
  chunk pending in digestRuns[runId] first 1 by byId:
    if pending.status = 'pending' and pending.attempt = attempt:
      finalWork = insert digestFinalWork { run: pending.id, newPostsInFollowing: pending.newPostsInFollowing }
      followingCount = digestFollowingCounts[target]
      if followingCount <= 500:
        update digestFinalWork[finalWork] { newPostsInFollowing: 0 }
        followed = follows[target] first 500 by byFollower { followed }
        for edge in followed:
          postCount = periodPosts[edge.followed, period]
          update digestFinalWork[finalWork] { newPostsInFollowing: .newPostsInFollowing + postCount }
      exactPosts = digestFinalWork[finalWork.id] ! else DIGEST_FINAL_STATE
      periodVersion = digestPeriodVersions[period]
      recipientVersion = digestRecipientVersions[target]
      recipientPeriodVersion = digestRecipientPeriodVersions[target, period]
      broadPostChanged = followingCount > 500 and periodVersion != pending.periodRevision
      changed = broadPostChanged or recipientVersion != pending.recipientRevision or recipientPeriodVersion != pending.recipientPeriodRevision
      expired = pending.earliestExpiry != null and pending.earliestExpiry <= now
      if changed or expired:
        delete digestFinalWork[exactPosts]
        update digestRuns[pending] {
          attempt: pending.attempt + 1,
          periodRevision: periodVersion,
          recipientRevision: recipientVersion,
          recipientPeriodRevision: recipientPeriodVersion,
          newPostsInFollowing: 0,
          unreadMessages: 0,
          unreadChats: 0,
          lastUnreadConversation: null,
          earliestExpiry: null,
          retryAt: now + 10000,
        }
      else:
        newFollowers = newFollowerPeriodCounts[target, true, period]
        prior = digests[target, period] by byTargetPeriod
        if prior = null:
          if newFollowers != 0 or exactPosts.newPostsInFollowing != 0 or pending.unreadMessages != 0:
            insert digests {
              target,
              period,
              newFollowers,
              newPostsInFollowing: exactPosts.newPostsInFollowing,
              unreadMessages: pending.unreadMessages,
              unreadChats: pending.unreadChats,
            }
            insert digestLogs {
              target,
              period,
              periodEnd: pending.periodEnd,
              newFollowers,
              newPostsInFollowing: exactPosts.newPostsInFollowing,
              unreadMessages: pending.unreadMessages,
              unreadChats: pending.unreadChats,
            }
            emit digest {
              to: target,
              period,
              periodEnd: pending.periodEnd,
              newFollowers,
              newPostsInFollowing: exactPosts.newPostsInFollowing,
              unreadMessages: pending.unreadMessages,
              unreadChats: pending.unreadChats,
            }
        delete digestFinalWork[exactPosts]
        update digestRuns[pending] { status: 'done', retryAt: null }

schedule digestAttempt on digestRuns at .retryAt if .status = 'pending': digestUser(.id, .target, .period, .attempt)
-- The minute cadence is this executable example. Production UTC boundaries
-- use the guide schedule's clock recipe and matching source buckets.
schedule hubDigest every 1m: queueDigestPeriod(.periodStart, .periodEnd)

job directoryBackfill():
  chunk entry in directory first 25 by byId:
    update directory[entry] { normalized: entry.handle }
