effect digest from push
proc clearMessagePeriodUnread from custody

job digestSweep():
  chunk p in profiles first 100 by byId:
    if p.newFollowers + p.unreadMessages > 0:
      emit digest { to: p.id, newFollowers: p.newFollowers, unreadMessages: p.unreadMessages }

schedule dailyDigest every 24h: digestSweep()

mutation purgeMessage(id: messages):
  clearMessagePeriodUnread(id)
  delete messages[id]
  return null

schedule expireMessage on messages at .expiresAt: purgeMessage(.id)

-- Run once as system; a persisted clock is never reset on owner restart.
mutation armDailyDigest(utcHour: int):
  require utcHour >= 0 and utcHour < 24 else UTC_HOUR
  require digestClocks['daily'] = null else ALREADY_ARMED
  (_day, rem) = divmod(now - utcHour * 3600000, 86400000)
  insert digestClocks { id: 'daily', nextAt: now - rem + 86400000 }
  return null

job utcDigestSweep(clockId: digestClocks, cutoff: time):
  chunk p in profiles first 1 by byId:
    prior = dailyDigestReceipts[p.principal, cutoff]
    if prior = null and p.newFollowers + p.unreadMessages > 0:
      insert dailyDigestReceipts { principal: p.principal, cutoff }
      emit digest { to: p.principal, newFollowers: p.newFollowers, unreadMessages: p.unreadMessages }
  chunk clock in digestClocks first 1 by byId:
    if clock.id = clockId and clock.nextAt = cutoff:
      update digestClocks[clock] { nextAt: cutoff + 86400000 }

schedule utcDigest on digestClocks at .nextAt: utcDigestSweep(.id, .nextAt ! else DEADLINE)
