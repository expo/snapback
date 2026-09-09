mutation setFollow(target: principal, following: bool):
  require target != viewer else SELF_FOLLOW
  existing = follows[viewer, target]
  if following:
    if existing != null:
      return existing
    row = insert follows { follower: viewer, followed: target, at: now }
    return row
  if existing != null:
    delete follows[existing]
  return null
