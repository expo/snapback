use identity password

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200
  location: text <=50
  link: text <=2000 format url ?
  avatar: image <=10000000 ?
  createdAt: time default 0
  unique byPrincipal: principal
  unique byHandle: handle else HANDLE_TAKEN 'That handle is taken.'
  by byWords: words(displayName, handle), createdAt, id
  cap 2000
  immutable principal, createdAt
  public 'Clique profiles are discoverable by registered people'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public

query myProfile():
  return profiles[principal = viewer]
query profile(handle: text 3..20 format handle):
  return profiles[handle = handle]
query people(q: text <=100, c: cursor ?):
  if q = '':
    return profiles after c first 20 by byId
  return profiles matching q after c last 20 by byWords
mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200, location: text <=50, link: text <=2000 format url ?):
  if exists profiles[principal = viewer]:
    return upsert profiles[principal = viewer] { principal: viewer, displayName, handle, bio, location, link }
  return insert profiles { principal: viewer, displayName, handle, bio, location, link, createdAt: now }
mutation placeAvatar(avatar: image <=10000000):
  update profiles[principal = viewer] { avatar }
