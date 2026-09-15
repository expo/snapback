use identity password

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200
  location: text <=50
  link: text <=500 format url ?
  avatar: image <=10485760 ?
  unique byPrincipal: principal
  unique byHandle: handle
  by byWords: words(displayName, handle), id
  immutable principal
  public 'Registered profiles are discoverable by everyone'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public

query me():
  return profiles[viewer]

query profile(handle: text 3..20 format handle):
  return profiles[handle]

query people(q: text <=100, c: cursor ?):
  return profiles matching q after c first 20 by byWords

mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200, location: text <=50, link: text <=500 format url ?):
  other = profiles[handle]
  require other = null or other.principal = viewer else HANDLE_TAKEN
  upsert profiles[viewer] { displayName, handle, bio, location, link }

mutation avatar(photo: image <=10485760):
  update profiles[viewer] { avatar: photo }
