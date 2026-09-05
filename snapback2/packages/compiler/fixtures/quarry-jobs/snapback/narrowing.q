-- keep profiles.avatarUrl optional and apply, then fill it:
job fill_profiles_avatarUrl(value: text <=2048):
  chunk p in profiles first 100 by byId:
    update profiles[p.id] { avatarUrl: p.avatarUrl ?? value }

-- keep profiles.tier optional and apply, then fill it:
job fill_profiles_tier(value: enum('free', 'pro')):
  chunk p in profiles first 100 by byId:
    update profiles[p.id] { tier: p.tier ?? value }
