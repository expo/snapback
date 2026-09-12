-- keep the predecessor schema; this truncates every profiles.avatarUrl to 100 characters.
-- To delete only over-long rows, keep any null fill and replace truncation with:
-- if (p.avatarUrl ?? '') != slice((p.avatarUrl ?? ''), 0, 100):
--   delete profiles[p.id]
job shrink_profiles_avatarUrl():
  chunk p in profiles first 100 by byId:
    if p.avatarUrl != null:
      update profiles[p.id] { avatarUrl: slice(p.avatarUrl, 0, 100) }

-- keep the predecessor schema; this deletes every row holding a removed case; null or absent values become the job's argument.
-- To map instead, replace each delete with: update profiles[p.id] { tier: <kept case> }
job remove_profiles_tier(value: enum('free')):
  chunk p in profiles first 100 by byId:
    if p.tier = null:
      update profiles[p.id] { tier: value }
    if p.tier = 'pro':
      delete profiles[p.id]
