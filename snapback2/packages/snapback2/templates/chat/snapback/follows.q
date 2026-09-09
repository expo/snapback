mutation setFollow(target: principal, following: bool):
  require target != viewer else SELF_FOLLOW
  if following:
    return insert follows { follower: viewer, followed: target, at: now } if absent
  existing = follows[viewer, target]
  if existing != null:
    delete follows[existing]
  return null
