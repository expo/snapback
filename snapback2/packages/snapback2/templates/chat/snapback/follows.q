mutation setFollow(target: principal, following: bool):
  require target != viewer else SELF_FOLLOW
  existing = follows[viewer, target] by byFollowerFollowed
  if following:
    if existing != null:
      return existing
    row = +follows { follower: viewer, followed: target, at: now }
    return { id: row.id, follower: viewer, followed: target, at: row.at }
  if existing != null:
    -follows[existing]
  return null
