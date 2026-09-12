query mine():
  return profiles[owner=viewer]

query get(handle: text 3..20 format handle):
  return profiles[handle=handle]

mutation save(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200, location: text <=50, link: text <=2048 format url ?):
  upsert profiles[owner=viewer] { owner: viewer, displayName: displayName, handle: handle, bio: bio, location: location, link: link, avatar: null }
  return profiles[owner=viewer]
