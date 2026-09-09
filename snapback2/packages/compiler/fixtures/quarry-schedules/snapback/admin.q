effect digest from push

job digestSweep():
  chunk p in profiles first 100 by byId:
    if p.newFollowers + p.unreadMessages > 0:
      emit digest { to: p.id, newFollowers: p.newFollowers, unreadMessages: p.unreadMessages }

schedule dailyDigest every 24h: digestSweep()

mutation purgeMessage(id: messages):
  update messages[id] { body: null, expiresAt: null }
  return null

schedule expireMessage on messages at .expiresAt: purgeMessage(.id)
