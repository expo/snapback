query mine():
  return profiles[viewer]

query byHandle(handle: text <=20):
  return profiles[handle]

mutation createMyProfile(displayName: text <=50, handle: text <=20, avatarUrl: text <=2048 ?, bio: text <=200, location: text <=50, link: text <=2048 ?):
  existing = profiles[viewer]
  if existing != null:
    return existing
  row = insert profiles { principal: viewer, displayName, handle, avatarUrl, bio, location, link }
  return { id: row.id, principal: viewer, displayName, handle, avatarUrl, bio, location, link }

mutation updateMyProfile(displayName: text <=50, handle: text <=20, avatarUrl: text <=2048 ?, bio: text <=200, location: text <=50, link: text <=2048 ?):
  existing = profiles[viewer] ! else PROFILE_REQUIRED
  update profiles[existing] { displayName, handle, avatarUrl, bio, location, link }
  return { id: existing.id, principal: viewer, displayName, handle, avatarUrl, bio, location, link }
