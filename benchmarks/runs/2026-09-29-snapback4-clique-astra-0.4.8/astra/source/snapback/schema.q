use identity password

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200
  location: text <=50
  link: text <=2000
  avatar: image <=10000000 ?
  unique principal
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  immutable principal
  public 'Clique profiles are discoverable by registered accounts'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public
  search displayName, handle
query myProfile():
  return profiles[principal = viewer]
query profile(handle: text 3..20 format handle):
  return profiles[handle = handle]
query profileById(principal: principal):
  return profiles[principal = principal]
query people(q: text <=100, c: cursor ?):
  return profiles matching q first 20 by .handle after c
mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200, location: text <=50, link: text <=2000 format url ?):
  upsert profiles[principal = viewer] { principal: viewer, displayName, handle, bio, location, link: link ?? '' }
mutation placeAvatar(avatar: image <=10000000):
  update profiles[principal = viewer] { avatar }
