query mine():
  return profiles[viewer] by byPrincipal

query byHandle(handle: text <=20):
  return profiles[handle] by byHandle

mutation createMyProfile(displayName: text <=50, handle: text <=20, avatarUrl: text <=2048 ?, bio: text <=200, location: text <=50, link: text <=2048 ?):
  existing = profiles[viewer] by byPrincipal
  if existing != null:
    return existing
  row = +profiles { principal: viewer, displayName, handle, avatarUrl, bio, location, link }
  return { id: row.id, principal: viewer, displayName, handle, avatarUrl, bio, location, link }

mutation updateMyProfile(displayName: text <=50, handle: text <=20, avatarUrl: text <=2048 ?, bio: text <=200, location: text <=50, link: text <=2048 ?):
  existing = profiles[viewer] by byPrincipal ! else PROFILE_REQUIRED
  ~profiles[existing] { displayName, handle, avatarUrl, bio, location, link }
  return { id: existing.id, principal: viewer, displayName, handle, avatarUrl, bio, location, link }
